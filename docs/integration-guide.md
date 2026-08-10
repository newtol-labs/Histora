# Integration guide

Histora exposes a local, unauthenticated HTTP API for its browser GUI and for
small local integrations. Keep the server on loopback unless an access-control
layer is added first.

## Start the server

```sh
npm install
npm start
```

The server prints its URL. The default is `http://127.0.0.1:4767`.

Environment overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HISTORA_HOST` | `127.0.0.1` | Bind address |
| `HISTORA_PORT` | `4767` | Bind port |
| `HISTORA_WORKSPACE` | current directory | Workspace for CLI/server |
| `CODEX_HOME` | `~/.codex` | Codex source discovery root |

`CHATHUB_HOST`, `CHATHUB_PORT`, and `CHATHUB_WORKSPACE` remain supported as
legacy aliases.

## API quick reference

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/status` | Workspace, channel, project, session, and last-run status |
| `GET` | `/api/sessions` | Indexed sessions; accepts `channel`, `project`, and `limit` |
| `GET` | `/api/logs` | Recent synchronization logs |
| `GET` | `/api/config` | Parsed workspace configuration |
| `POST` | `/api/sync` | Run a sync; optional body `{ "channelId": "codex" }` |
| `POST` | `/api/open` | Open the workspace or a supplied existing path |
| `POST` | `/api/sync-settings` | Save cadence and schedule, then reinstall the scheduler |
| `POST` | `/api/install-launchd` | Install the platform scheduler for the workspace |
| `GET` | `/api/update-state` | Read packaged updater state |
| `POST` | `/api/check-update` | Check the GitHub update feed |
| `POST` | `/api/install-update` | Install a downloaded signed update |
| `POST` | `/api/open-release` | Open the latest GitHub Release page |

## Opening a path

Open the configured workspace:

```sh
curl -X POST http://127.0.0.1:4767/api/open \
  -H 'Content-Type: application/json' \
  -d '{}'
```

Open a session file or another existing absolute path:

```sh
curl -X POST http://127.0.0.1:4767/api/open \
  -H 'Content-Type: application/json' \
  -d '{"path":"/absolute/path/to/session.md"}'
```

Success returns `200` with `{ "ok": true, "path": "..." }`. A missing target
returns `404`; an operating-system opener failure returns `500` with an
`error` field. The desktop build uses Electron's `shell.openPath`, while the
standalone server delegates to the platform command.

## Configuration and data

Use `histora.config.yaml` for workspace and channel configuration. The
application reads `chathub.config.yaml` only as a legacy fallback. Session
Markdown is written under `channels/<channel>/projects/<project>/sessions/`;
the SQLite state database is `.histora/state.sqlite`.
