# Deploying LiveProbe on Windows Server (no Docker)

LiveProbe's server is plain Node: it runs the TypeScript entrypoint through `tsx` and serves the
built UI from `packages/server/public`. On Windows you do by hand what `serve.sh` and the
`Dockerfile` do, then register the server as a Windows service.

> Not yet exercised on a real Windows host — treat this as the reference procedure and report
> anything that differs.

## 1. Prerequisites

- **Node.js 22.13 or newer** (LTS MSI from nodejs.org). The history store uses the built-in
  `node:sqlite` module (`packages/server/src/history-store.ts`), which is unflagged only from
  22.13 — the root `package.json` `engines` (`>=20`) understates this.
- **Git** (or copy the repo over as a zip).
- **[NSSM](https://nssm.cc)** to run Node as a service (alternatives: WinSW, Task Scheduler).

## 2. Build

```powershell
cd C:\apps
git clone <repo-url> liveprobe
cd C:\apps\liveprobe

npm ci                                   # full install: tsx (a devDependency) is needed at runtime
npm run build -w @liveprobe/ui           # tsc -b && vite build -> packages\ui\dist

# The server serves the UI from packages\server\public
Remove-Item -Recurse -Force packages\server\public -ErrorAction SilentlyContinue
Copy-Item -Recurse packages\ui\dist packages\server\public
```

An offline server can receive a folder built elsewhere (`node_modules` included), but build it
**on Windows**: Vite/esbuild install platform-specific binaries, so a Linux-built `node_modules`
won't run.

## 3. Smoke test (foreground)

```powershell
$env:PORT = "4319"
$env:HOST = "0.0.0.0"                     # default 127.0.0.1 = loopback only
$env:DB_PATH = "C:\liveprobe-data\liveprobe.db"
node --import tsx packages\server\src\index.ts
```

Open `http://localhost:4319`. Always set `PORT`: the code default is 4318 (only `serve.sh` and
the Docker image use 4319).

## 4. Install as a Windows service

Elevated PowerShell:

```powershell
$node = (Get-Command node).Source
New-Item -ItemType Directory -Force C:\liveprobe-data\logs | Out-Null

nssm install LiveProbe $node "--import tsx packages\server\src\index.ts"
nssm set LiveProbe AppDirectory C:\apps\liveprobe
nssm set LiveProbe AppEnvironmentExtra PORT=4319 HOST=0.0.0.0 DB_PATH=C:\liveprobe-data\liveprobe.db NODE_ENV=production
nssm set LiveProbe AppStdout C:\liveprobe-data\logs\server.log
nssm set LiveProbe AppStderr C:\liveprobe-data\logs\server.err.log
nssm set LiveProbe Start SERVICE_AUTO_START
nssm start LiveProbe
```

Run `node --import tsx` directly rather than `npx tsx`: `npx` is a `.cmd` shim, and stopping the
service can orphan the child Node process.

Every server env var from the README works here (`RETENTION_DAYS`, `LIVE_WINDOW_MINUTES`,
`MAX_TRACES`, `CORS_ORIGINS`, `MASK_PII`, `ALERT_WEBHOOK_URL`, …) — append them to
`AppEnvironmentExtra`.

### Optional: algo-instrumentation collector

Equivalent of `./serve.sh --collector`:

```powershell
nssm install LiveProbeCollector $node "--import tsx packages\collector\src\index.ts"
nssm set LiveProbeCollector AppDirectory C:\apps\liveprobe
nssm set LiveProbeCollector AppEnvironmentExtra SOURCE=http ADAPTER=algo-instrumentation HTTP_PORT=4320 LIVEPROBE_URL=http://localhost:4319
nssm set LiveProbeCollector DependOnService LiveProbe
nssm start LiveProbeCollector
```

## 5. Firewall

The ingest and API have **no auth**. If the instrumented apps run on the same box, keep
`HOST=127.0.0.1` and open nothing. Otherwise allow only trusted networks:

```powershell
New-NetFirewallRule -DisplayName "LiveProbe 4319" -Direction Inbound -Protocol TCP `
  -LocalPort 4319 -RemoteAddress 10.0.0.0/8 -Action Allow
```

## 6. Optional: behind IIS (TLS on 443)

Install **URL Rewrite** + **Application Request Routing**, enable ARR's proxy, and turn on the
**WebSocket Protocol** Windows feature (without it the live `/ws` stream fails). Add a
reverse-proxy rule to `http://localhost:4319`, and set `CORS_ORIGINS` to the exact public browser
origin (scheme + host + port) — the WebSocket origin check rejects it otherwise. Same rules as the
README's nginx recipe: don't put basic auth on `/ws`.

## 7. Updating

```powershell
cd C:\apps\liveprobe
nssm stop LiveProbe
git pull
npm ci
npm run build -w @liveprobe/ui
Remove-Item -Recurse -Force packages\server\public
Copy-Item -Recurse packages\ui\dist packages\server\public
nssm start LiveProbe
```

History lives at `DB_PATH`, outside the repo, so it survives redeploys.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Service starts then exits with no log line | The entrypoint only runs when `process.argv[1]` equals its own path (`packages/server/src/index.ts`). Launch from `AppDirectory` with the relative path shown above. |
| `No such built-in module: node:sqlite` | Node is older than 22.13 — upgrade. |
| UI returns 404 `not_found` | `packages\server\public\index.html` is missing — redo the copy step in §2. |
| Remote browser can't connect | `HOST` is still `127.0.0.1`, or the firewall rule is missing. |
| Live feed blank behind IIS | WebSocket Protocol feature not installed, or `CORS_ORIGINS` doesn't match the browser origin. |
| `ExperimentalWarning: SQLite …` in logs | Expected; harmless. |

`serve.sh`, `dev-start.sh`, `npm run e2e:serve` and `scripts/deploy.js` are bash- or
Docker-only and don't apply on Windows.
