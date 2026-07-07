#!/usr/bin/env node

// Interactive deploy script for LiveProbe.
// - Builds a Docker image locally
// - Uploads image tarball + compose config directly to the remote directory over SSH
// - Optionally runs docker compose up on the remote host
//
// Requirements: docker, ssh, scp (local + remote)

import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  rm,
  access,
  readFile,
  writeFile,
  constants as fsConstants,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const IMAGE_NAME = "liveprobe";
const COMPOSE_FILE = "docker-compose.yml";
const COLLECTOR_CONFIG = "otel-collector-config.yaml";

async function prompt(question) {
  const rl = createInterface({ input, output });
  try {
    const answer = await new Promise((resolve) =>
      rl.question(question, resolve),
    );
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function fileExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Run a command with live output (stdio inherited). */
function run(cmd, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

/** Resolve version input to a docker tag suffix (default: latest). */
function resolveVersion(input) {
  const version = input.trim();
  if (!version) return "latest";
  if (
    version.includes(":") ||
    version.includes("/") ||
    version.startsWith(IMAGE_NAME)
  ) {
    console.error(
      `Enter a version only (e.g. latest, 1.0.0, v1.0.0), not a full tag like ${IMAGE_NAME}:1.0.0`,
    );
    process.exit(1);
  }
  return version;
}

function imageTag(version) {
  return `${IMAGE_NAME}:${version}`;
}

/**
 * Reject remote directories with shell-unsafe characters. Remote paths are re-parsed by the
 * server's shell (both `ssh host cmd args` and the `cd <dir>` in runShell), so a space or a
 * metacharacter would split the path or inject a command.
 */
function validateRemoteDir(dir) {
  if (!/^[A-Za-z0-9_@%+=:,./-]+$/.test(dir)) {
    console.error(
      `Remote directory "${dir}" contains unsupported characters.\n` +
        "Use only letters, digits, and these: _ @ % + = : , . / -",
    );
    process.exit(1);
  }
  return dir;
}

/** Reuse one SSH session so password is only asked once per deploy. */
function createSshSession({ user, host, port }) {
  const controlPath = join(tmpdir(), `liveprobe-ssh-${user}-${host}-${port}`);
  const multiplex = [
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${controlPath}`,
    "-o",
    "ControlPersist=300",
    "-o",
    "StrictHostKeyChecking=accept-new",
  ];
  const target = `${user}@${host}`;

  return {
    async open() {
      await execFileAsync("ssh", ["-p", port, ...multiplex, target, "true"]);
    },
    async run(...remoteCmd) {
      await execFileAsync("ssh", [
        "-p",
        port,
        ...multiplex,
        target,
        ...remoteCmd,
      ]);
    },
    async runShell(cmd) {
      await execFileAsync("ssh", ["-p", port, ...multiplex, target, cmd]);
    },
    async copy(localPath, remotePath) {
      await execFileAsync("scp", [
        "-P",
        port,
        ...multiplex,
        localPath,
        `${target}:${remotePath}`,
      ]);
    },
    async close() {
      try {
        await execFileAsync("ssh", [
          "-p",
          port,
          "-o",
          `ControlPath=${controlPath}`,
          "-O",
          "exit",
          target,
        ]);
      } catch {
        // Master may already be closed.
      }
    },
  };
}

/** Ensure plain `docker` works (no sudo). */
async function requireDocker() {
  try {
    await execFileAsync("docker", ["info"], { timeout: 15000 });
  } catch {
    console.error(
      "Cannot access Docker (permission denied).\n\n" +
        "Add your user to the docker group, then log out and back in:\n" +
        "  sudo usermod -aG docker $USER\n" +
        "  newgrp docker\n" +
        "  docker ps\n",
    );
    process.exit(1);
  }
}

/** Strip build: blocks and pin image tags for remote deploy (no Dockerfile on server). */
function prepareRemoteCompose(raw, tag) {
  const lines = raw.split("\n");
  const out = [];
  let skipBuildBlock = false;
  let buildIndent = "";

  for (const line of lines) {
    // build: .  or  build: ./path  — replace in place, keep sibling keys (ports, env, …).
    const sameLineBuild = line.match(/^(\s*)build:\s*\S/);
    if (sameLineBuild) {
      out.push(`${sameLineBuild[1]}image: ${tag}`);
      continue;
    }

    // build:   (mapping on following lines — skip only its children)
    const blockBuild = line.match(/^(\s*)build:\s*$/);
    if (blockBuild) {
      buildIndent = blockBuild[1];
      skipBuildBlock = true;
      out.push(`${buildIndent}image: ${tag}`);
      continue;
    }

    if (skipBuildBlock) {
      if (
        line.startsWith(buildIndent + "  ") ||
        line.startsWith(buildIndent + "\t")
      ) {
        continue;
      }
      skipBuildBlock = false;
    }

    out.push(line);
  }

  return out.join("\n");
}

async function main() {
  console.log("=== LiveProbe deploy ===\n");

  await requireDocker();

  if (!(await fileExists(COMPOSE_FILE))) {
    console.error(`Missing ${COMPOSE_FILE}`);
    process.exit(1);
  }

  const defaultVersion = "latest";
  const version = resolveVersion(
    await prompt(`Image version [${defaultVersion}]: `),
  );
  const tag = imageTag(version);

  const defaultHost = "your-server.example.com";
  const host = (await prompt(`Remote host [${defaultHost}]: `)) || defaultHost;

  const defaultUser = "root";
  const user = (await prompt(`SSH username [${defaultUser}]: `)) || defaultUser;

  const defaultPort = "22";
  const port = (await prompt(`SSH port [${defaultPort}]: `)) || defaultPort;

  const defaultRemoteDir = "/var/www/liveprobe";
  const remoteDir = validateRemoteDir(
    (await prompt(`Remote directory [${defaultRemoteDir}]: `)) || defaultRemoteDir,
  );

  const runRemote = (
    await prompt("Run `docker compose up -d` on the remote host? [y/N]: ")
  )
    .toLowerCase()
    .startsWith("y");

  console.log("\nSummary:");
  console.log(`  Image            : ${tag}`);
  console.log(`  Remote host      : ${user}@${host}:${port}`);
  console.log(`  Remote directory : ${remoteDir}`);
  console.log(`  Run remote up    : ${runRemote ? "yes" : "no"}`);

  const confirm = (await prompt("Proceed? [y/N]: "))
    .toLowerCase()
    .startsWith("y");
  if (!confirm) {
    console.log("Aborted.");
    process.exit(0);
  }

  let tmpDir;
  let ssh;
  try {
    tmpDir = await mkdtemp(join(tmpdir(), "liveprobe-deploy-"));
    const imageTar = join(tmpDir, "liveprobe-image.tar");
    const stagedCompose = join(tmpDir, "docker-compose.yml");
    await writeFile(
      stagedCompose,
      prepareRemoteCompose(await readFile(COMPOSE_FILE, "utf8"), tag),
    );

    console.log("\n==> Building Docker image locally");
    await run("docker", "build", "-t", tag, ".").catch((err) => {
      console.error("docker build failed:", err.message);
      process.exit(1);
    });

    console.log("==> Saving Docker image to tarball");
    await run("docker", "save", "-o", imageTar, tag).catch((err) => {
      console.error("docker save failed:", err.message);
      process.exit(1);
    });

    ssh = createSshSession({ user, host, port });
    console.log("==> Opening SSH connection");
    await ssh.open().catch((err) => {
      console.error(
        "ssh connect failed:",
        err.stderr?.toString() || err.message,
      );
      process.exit(1);
    });

    console.log("==> Creating remote directory");
    await ssh.run("mkdir", "-p", remoteDir).catch((err) => {
      console.error("ssh mkdir failed:", err.stderr?.toString() || err.message);
      process.exit(1);
    });

    console.log("==> Uploading image tarball");
    await ssh.copy(imageTar, `${remoteDir}/`).catch((err) => {
      console.error("scp image failed:", err.stderr?.toString() || err.message);
      process.exit(1);
    });

    console.log("==> Uploading docker-compose.yml");
    await ssh
      .copy(stagedCompose, `${remoteDir}/docker-compose.yml`)
      .catch((err) => {
        console.error(
          "scp compose failed:",
          err.stderr?.toString() || err.message,
        );
        process.exit(1);
      });

    if (await fileExists(COLLECTOR_CONFIG)) {
      console.log("==> Uploading otel-collector-config.yaml");
      await ssh.copy(COLLECTOR_CONFIG, `${remoteDir}/`).catch((err) => {
        console.error(
          "scp collector config failed:",
          err.stderr?.toString() || err.message,
        );
        process.exit(1);
      });
    }

    const remoteImageTar = join(remoteDir, "liveprobe-image.tar");
    console.log("==> Loading image on remote host");
    await ssh.run("docker", "load", "-i", remoteImageTar).catch((err) => {
      console.error(
        "remote docker load failed:",
        err.stderr?.toString() || err.message,
      );
      process.exit(1);
    });

    console.log("==> Removing image tarball on remote host");
    await ssh.run("rm", "-f", remoteImageTar).catch((err) => {
      console.error("remote rm failed:", err.stderr?.toString() || err.message);
      process.exit(1);
    });

    if (runRemote) {
      console.log("==> Running docker compose up -d on remote host");
      await ssh
        .runShell(`cd '${remoteDir}' && docker compose up -d --no-build`)
        .catch((err) => {
          console.error(
            "remote docker compose up failed:",
            err.stderr?.toString() || err.message,
          );
          process.exit(1);
        });
    }

    console.log("\nDeployment complete.");
    console.log(`Remote directory: ${remoteDir}`);
    console.log("On the server:");
    console.log(`  cd ${remoteDir} && docker compose ps`);
    console.log(`  cd ${remoteDir} && docker compose logs -f`);
  } finally {
    if (ssh) await ssh.close();
    if (tmpDir)
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("Deploy script failed:", err);
  process.exit(1);
});
