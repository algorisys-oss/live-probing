# Deploying LiveProbe on Linux / macOS (no Docker)

LiveProbe's server is plain Node: it runs the TypeScript entrypoint through `tsx` and serves the
built UI from `packages/server/public`. Without Docker you do by hand what the `Dockerfile` does,
then keep the server running with systemd (Linux) or launchd / a process manager (macOS).

For a quick foreground run, `./serve.sh` already does steps 2–3 for you — this doc is for a
long-running install on a server. Windows: see [deploy-windows.md](deploy-windows.md).

## 1. Prerequisites

- **Node.js 22.13 or newer.** The history store uses the built-in `node:sqlite` module
  (`packages/server/src/history-store.ts`), which is unflagged only from 22.13 — the root
  `package.json` `engines` (`>=20`) understates this. Check with `node --version`.
- **Git** (or copy the repo over as a tarball).
- No database server: history is a single SQLite file at `DB_PATH`.

## 2. Build

```bash
sudo mkdir -p /opt/liveprobe && sudo chown "$USER" /opt/liveprobe
git clone <repo-url> /opt/liveprobe
cd /opt/liveprobe

npm ci                                   # full install: tsx (a devDependency) is needed at runtime
npm run build -w @liveprobe/ui           # tsc -b && vite build -> packages/ui/dist

# The server serves the UI from packages/server/public
rm -rf packages/server/public
cp -r packages/ui/dist packages/server/public
```

Build on the same OS/arch you run on: Vite/esbuild install platform-specific binaries, so a
`node_modules` built on macOS won't run on Linux (and vice versa).

## 3. Smoke test (foreground)

```bash
sudo mkdir -p /var/lib/liveprobe && sudo chown "$USER" /var/lib/liveprobe
PORT=4319 DB_PATH=/var/lib/liveprobe/liveprobe.db RETENTION_DAYS=30 \
  node --import tsx packages/server/src/index.ts
```

Open `http://localhost:4319`. Always set `PORT`: the code default is 4318 (only `serve.sh` and
the Docker image use 4319). `HOST` defaults to `127.0.0.1`; set `HOST=0.0.0.0` only if apps on
other machines (or a reverse proxy on another host) must reach it.

## 4. Configure

Put the server's env vars in one file, e.g. `/etc/liveprobe/liveprobe.env`:

```bash
PORT=4319
HOST=127.0.0.1
DB_PATH=/var/lib/liveprobe/liveprobe.db
NODE_ENV=production

# Data retention — history kept in the SQLite file at DB_PATH
RETENTION_DAYS=30          # keep the N most recent UTC days; 0 = keep forever
# Live (in-memory) view only — does not affect stored history
# LIVE_WINDOW_MINUTES=5
# MAX_TRACES=2000

# CORS_ORIGINS=https://liveprobe.example.com
# MASK_PII=off
# ALERT_WEBHOOK_URL=https://hooks.example.com/liveprobe
```

**Retention:** traces older than `RETENTION_DAYS` whole UTC days are deleted at startup and then
hourly, and the file is `VACUUM`ed so it shrinks on disk. `RETENTION_DAYS=7` keeps today plus the
previous 6 days. Invalid or negative values fall back to the default (30). Changing it takes
effect on the next restart.

Every other server env var from the README works here too.

## 5. Run as a service

### Linux (systemd)

```bash
sudo useradd --system --home /var/lib/liveprobe --shell /usr/sbin/nologin liveprobe
sudo chown -R liveprobe:liveprobe /var/lib/liveprobe
```

`/etc/systemd/system/liveprobe.service`:

```ini
[Unit]
Description=LiveProbe server
After=network.target

[Service]
User=liveprobe
WorkingDirectory=/opt/liveprobe
EnvironmentFile=/etc/liveprobe/liveprobe.env
ExecStart=/usr/bin/node --import tsx packages/server/src/index.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now liveprobe
journalctl -u liveprobe -f          # logs, incl. "retention: pruned N traces …"
```

Use the path from `which node` in `ExecStart` (nvm installs live under the user's home, which
the `liveprobe` user can't read — install Node system-wide or adjust `User=`). Run
`node --import tsx` rather than `npx tsx` so systemd stops the actual Node process.

#### Optional: algo-instrumentation collector

Equivalent of `./serve.sh --collector`. `/etc/systemd/system/liveprobe-collector.service`:

```ini
[Unit]
Description=LiveProbe algo-instrumentation collector
After=liveprobe.service
Requires=liveprobe.service

[Service]
User=liveprobe
WorkingDirectory=/opt/liveprobe
Environment=SOURCE=http ADAPTER=algo-instrumentation HTTP_PORT=4320 LIVEPROBE_URL=http://localhost:4319
ExecStart=/usr/bin/node --import tsx packages/collector/src/index.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now liveprobe-collector
```

### macOS

For a dev box, `./serve.sh` in a terminal (or under `tmux`) is enough — it honours the same env
vars, e.g. `RETENTION_DAYS=7 DB_PATH=~/liveprobe-data/liveprobe.db ./serve.sh`. For an
always-on install, wrap the same `node --import tsx packages/server/src/index.ts` command in a
launchd agent or a process manager such as pm2, with `WorkingDirectory` set to the repo root.

## 6. Network

The ingest and API have **no auth**. If the instrumented apps run on the same box, keep
`HOST=127.0.0.1` and open nothing. Otherwise allow only trusted networks, e.g. with ufw:

```bash
sudo ufw allow from 10.0.0.0/8 to any port 4319 proto tcp
```

For TLS + basic auth, put nginx in front — see the README's
[Behind a reverse proxy](../README.md#behind-a-reverse-proxy-tls--basic-auth) recipe (it works the
same without Docker: proxy to `http://127.0.0.1:4319`, set `CORS_ORIGINS`, no basic auth on `/ws`).

## 7. Updating

```bash
cd /opt/liveprobe
sudo systemctl stop liveprobe
git pull
npm ci
npm run build -w @liveprobe/ui
rm -rf packages/server/public && cp -r packages/ui/dist packages/server/public
sudo systemctl start liveprobe
```

History lives at `DB_PATH`, outside the repo, so it survives redeploys. To drop all history, stop
the service and delete the `DB_PATH` file.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Service starts then exits with no log line | The entrypoint only runs when `process.argv[1]` equals its own path (`packages/server/src/index.ts`). Keep `WorkingDirectory` at the repo root and the relative path shown above. |
| `No such built-in module: node:sqlite` | Node is older than 22.13 — upgrade. |
| `status=203/EXEC` in systemd | `ExecStart` node path is wrong or unreadable by the service user (see the nvm note in §5). |
| `SQLITE_CANTOPEN` / permission denied | The service user can't write the directory holding `DB_PATH`. |
| UI returns 404 `not_found` | `packages/server/public/index.html` is missing — redo the copy step in §2. |
| Remote browser can't connect | `HOST` is still `127.0.0.1`, or the firewall blocks the port. |
| History disk keeps growing | `RETENTION_DAYS=0` (disabled) or unset in the env file the service actually loads. |
| `ExperimentalWarning: SQLite …` in logs | Expected; harmless. |
