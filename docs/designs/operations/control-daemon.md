# Molibot Control Daemon (Remote Service Control)

Status: implemented (2026-06-17)

## Problem

Operators want to start / stop / restart the running Molibot service from chat
(Telegram), without SSH-ing into the host. The naive approach — handling a
`/restart` command inside the main bot — does not work reliably:

- The process handling the `/restart` command **is** the process being
  restarted. Killing it ends the handler before it can complete or report back.
- **Starting a fully stopped service is impossible from the main bot**, because
  when the service is down there is no bot listening to receive any command.

So a control surface that can cover all of start / stop / restart must live in a
process that is **independent of, and outlives, the main service**.

## Design

A small, independent daemon (`bin/molibot-control.js`) with a **dedicated**
Telegram bot. It imports nothing from the main app (no agent, runtime, or
settings code), so:

- it starts fast and has a tiny failure surface;
- its failure domain is isolated — a crash in the main app does not affect it;
- it stays online while the main service is down, which is the only way a chat
  command can bring a fully stopped service back up.

```
┌─────────────────────────────┐          ┌──────────────────────────────┐
│  molibot-control (always on) │  control │   molibot main service        │
│  - dedicated Telegram bot    │ ───────► │   (start-server wrapper via   │
│  - admin allow-list          │          │    molibot-service.sh)        │
│  - shells out to             │          │   ← start / stop / restart    │
│    molibot-service.sh        │          │                              │
└─────────────────────────────┘          └──────────────────────────────┘
        ▲ kept alive by molibot-control-service.sh (nohup supervisor)
```

This respects the project's layering: control / operations is an infra concern,
fully separate from the channel and agent layers, and never leaks upper logic
into a channel.

## Components

| File | Role |
|------|------|
| `bin/molibot-control.js` | The daemon. grammY long-polling on a dedicated bot token, admin allow-list auth, translates fixed commands into `molibot-service.sh` invocations and reports output back to chat. |
| `bin/molibot-control-service.sh` | nohup-based supervisor that keeps the daemon alive (start/stop/status/restart, crash auto-restart). Mirrors `molibot-service.sh`. |
| `bin/molibot-service.sh` (existing) | The authoritative start/stop/restart implementation the daemon calls. |

## Commands

Admin-only (non-admin chats are silently ignored). The service has two sources —
the deployed **release** (`MOLIBOT_CURRENT_LINK`) and the local **dev** working
tree the daemon lives in:

| Command | Action |
|---------|--------|
| `/status` | `molibot-service.sh status` (PID-based, mode-agnostic) |
| `/start` | release flow: run `molibot-update.sh` (build latest git ref → deploy to `current` → start) |
| `/start dev` | build the dev working tree (`npm run build`), then start it through `scripts/start-server.mjs` so the shared data-directory lease is enforced |
| `/build` | build the dev working tree (`npm run build`) only |
| `/stop` | `molibot-service.sh stop` (writes the stop marker, stays down) |
| `/restart` | restart the current release |
| `/restart dev` | build the dev working tree, then restart it |
| `/logs [n]` | tail the last `n` lines of the service log (default 50, max 200) |

Each command shells out via `spawn`, captures stdout/stderr, and replies with a
success/failure marker plus the output in a code block.

Notes:
- `/start` (release) pulls and builds the configured git ref (`MOLIBOT_GIT_REF`,
  default `master`) from GitHub into a fresh immutable release. Only **pushed**
  commits are included; it never touches the dev working tree.
- `/start dev` and `/restart dev` run `npm run build` first (through a login
  shell so node/npm resolve from the operator profile PATH), so local code
  changes are always picked up; a failed build aborts before (re)starting.
  `/build` runs the build alone.
- Stop/status are PID-file based, so they report/stop whichever source is
  currently running.

## Configuration

Two keys in `${DATA_DIR}/deploy.env` (interactively promptable via `molibot manage`):

```bash
MOLIBOT_CONTROL_TG_TOKEN=<token of a SEPARATE Telegram bot>
MOLIBOT_CONTROL_ADMIN_IDS=<chatId(s), comma-separated>
```

The daemon resolves the service script to the deployed release
(`${MOLIBOT_CURRENT_LINK}/bin/molibot-service.sh`) when available, falling back
to the script next to it, and passes through the deployment env
(`MOLIBOT_APP_DIR`, `MOLIBOT_LOG_FILE`, `MOLIBOT_PID_FILE`, …) so it acts on the
real deployment.

## Security

- A dedicated bot, kept out of the main conversation groups, to avoid accidental
  triggering.
- Hard admin allow-list (`MOLIBOT_CONTROL_ADMIN_IDS`); unknown chats get no
  response at all (their chat/user id is logged for setup, never replied to).
- A token is required. If the admin list is empty the daemon starts in
  **discovery mode**: it authorizes nothing (no command can run) but logs
  incoming chat ids so the operator can bootstrap their allow-list, then restart.
- No agent capabilities — only the fixed command set, never arbitrary shell.

## Operations

```bash
./bin/molibot-control-service.sh start    # start the daemon (auto-restart on crash)
./bin/molibot-control-service.sh status
./bin/molibot-control-service.sh stop
./bin/molibot-control-service.sh restart
```

Recommended: launch the control supervisor on boot (e.g. from the host's startup
hooks) so the control surface is always available.

## Future extensions

- **Docker backend**: a `MOLIBOT_CONTROL_BACKEND=docker|service` switch so the
  same commands map to `docker compose up -d / stop / restart` when deployed as a
  container. Deliberately not added yet to avoid premature complexity.
- **Feishu front-end**: a second listener (Feishu long-connection) sharing the
  same command core, if Feishu-based control is needed.
