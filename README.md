# Histora

Histora is a local GUI and sync agent for AI conversation sessions. It detects installed agents, reads supported local session stores or exported conversation files, renders them as Markdown, and keeps a small SQLite state database for versioning and incremental updates.

## Run

```sh
npm start
```

Open the URL printed by the server.

## Desktop App

Run the cross-platform desktop app in development:

```sh
npm run desktop
```

Build distributable apps:

```sh
npm run dist:mac
npm run dist:win
```

`dist:win` targets Windows x64.

For a quick package smoke test on the current platform:

```sh
npm run pack:mac
npm run pack:win
```

The packaged macOS app is written under `release/mac-arm64/Histora.app` when built on Apple Silicon.
The unpacked Windows app is written under `release/win-unpacked/Histora.exe`.

The GUI uses bilingual Chinese/English labels and includes a schedule selector for:

- Sync by a custom minute interval from 1 to 1439 minutes
- Sync daily at a fixed time

Saving the schedule from the GUI rewrites `histora.config.yaml` and reinstalls the system scheduler: macOS uses `launchd`, and Windows uses Task Scheduler. Existing `chathub.config.yaml` files are still readable as a legacy fallback.

On macOS, Histora installs a small watchdog script in `~/Library/Application Support/Histora/` and points `launchd` at that script. The watchdog keeps the workspace path in `HISTORA_WORKSPACE`, records launch/exit lines in `.histora/logs/launchd.out.log`, and stops a stuck sync after 10 minutes so the next scheduled run is not blocked.

Packaged builds store Histora's workspace under `~/Library/Application Support/Histora/workspace`. On first launch, Histora migrates an existing `~/Documents/Chathub` or `~/Documents/Histora` workspace while preserving the original. Background sync refuses workspaces under Documents, Desktop, or Downloads, and only runs an installed app from Applications.

## Local HTTP API

The development server listens on `127.0.0.1:4767` by default. Override the
bind address with `HISTORA_HOST` and `HISTORA_PORT`; the legacy aliases
`CHATHUB_HOST` and `CHATHUB_PORT` are still accepted.

The desktop GUI uses these local endpoints, including:

- `GET /api/status` — current workspace, channels, sessions, and last run.
- `POST /api/sync` — run an immediate sync.
- `POST /api/open` — open the workspace, or an existing file path supplied as
  `{ "path": "/absolute/path" }`.
- `GET /api/sessions` — list indexed sessions with optional `channel`, `project`,
  and `limit` query parameters.

`/api/open` waits for the operating-system opener. Missing paths return `404`
and opener failures return `500`; the GUI surfaces both as a toast instead of
silently reporting success. The server is intended for loopback use and has no
authentication, so do not bind it to a public interface without adding an
appropriate access-control layer.

## CLI

```sh
npm run sync
npm run status
npm run doctor
npm run install-launchd
```

## Release

Pushing a `v*` tag starts `.github/workflows/release.yml`, which builds macOS
DMG/ZIP and Windows installer/portable artifacts and publishes a GitHub
Release. The macOS package is not Apple-notarized by default; on first launch,
use Finder's **Open** action if Gatekeeper blocks the app. The release workflow
re-signs the macOS bundle and regenerates blockmaps after repacking so updater
metadata matches the final artifacts.

## Output

Synced sessions are written to:

```text
channels/<channel>/projects/<project>/sessions/*.md
```

Indexes are written to each project folder and to `_index.md`.

## Agent Detection

Histora checks installed agents on startup and status refresh. The GUI shows command paths, app paths, configured data sources, and whether each source is immediately syncable.

Currently supported direct sources:

- ChatGPT Codex and Codex CLI: `CODEX_HOME` (normally `~/.codex`), including active sessions in `sessions/` and archived sessions in `archived_sessions/`
- Claude Code: `~/.claude/projects`
- OpenCode: `~/.local/share/opencode/opencode.db`
- Hermes Agent: `~/.hermes/state.db`
- Grok CLI: `~/.grok/sessions/*/{summary.json,updates.jsonl}`
- Accio Work: `~/.accio/accounts/*/agents/*/sessions/*.messages.jsonl`
- WorkBuddy: `~/.workbuddy/workbuddy.db` plus `~/.workbuddy/projects/**/*.jsonl`
- ZCode: `~/.zcode/cli/db/db.sqlite`
- Kimi Code: `~/.kimi-code/sessions/**/{state.json,agents/main/wire.jsonl}` (legacy `~/.kimi/sessions/` is also detectable)
- Mimo Code: `~/.local/share/mimocode/mimocode.db`
- Qoder CLI: `~/.qoder/projects/*/transcript/*.jsonl`
- Qoder Work: `~/Library/Application Support/QoderWork/data/agents.db` (macOS)
- Trae: VS Code-compatible `User/workspaceStorage/*/chatSessions/*.json` under Trae's Application Support folder (macOS)

Supported export/import sources:

- Gemini CLI: JSON or JSONL conversation export, or a configured sessions directory
- OpenClaw: JSON or JSONL conversation export, or a configured sessions directory
- Claude Desktop: exported JSON or JSONL conversation files (the desktop cache is intentionally not parsed)
- MiniMax CLI: configured JSON or JSONL export files; the official `mmx` CLI does not currently expose a local session archive for automatic discovery
