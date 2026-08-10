# Architecture

## Overview

Histora has one local data pipeline with two front ends:

```text
agent stores / exports
          │
          ▼
  discovery + adapters ──► normalized sessions ──► Markdown + SQLite state
          │                                      │
          └──────────────► local HTTP server ◄────┘
                                  │
                         browser GUI / Electron
```

The CLI and the desktop app call the same synchronization and state modules.
The browser UI is served by `src/server.mjs`; the Electron shell supplies the
desktop-only integrations.

## Runtime components

- `src/cli.mjs` exposes `sync`, `status`, `doctor`, `install-launchd`, and
  `serve`. It resolves the workspace from `HISTORA_WORKSPACE`, then the legacy
  `CHATHUB_WORKSPACE`, then the current working directory.
- `src/server.mjs` serves `public/` and the loopback JSON API. It defaults to
  `127.0.0.1:4767` and accepts `HISTORA_HOST`/`HISTORA_PORT` plus legacy
  `CHATHUB_HOST`/`CHATHUB_PORT` aliases.
- `src/desktop-main.mjs` creates the Electron window, resolves/migrates the
  packaged workspace, wires the updater, and passes Electron's opener into the
  server.
- `build/icon.png` is the transparent branding master; `build/icon.icns` is
  the macOS package icon, and `public/assets/histora-logo.png` is the 512px
  sidebar rendition. Replacing the sidebar asset also requires changing its
  cache key in `public/index.html`.
- `src/sync.mjs`, `src/discovery.mjs`, and `src/adapters/` discover source data,
  normalize records, render Markdown, and update `.histora/state.sqlite`.
- `src/launchd.mjs` renders macOS launchd or Windows Task Scheduler entries and
  writes watchdog logs under the workspace's `.histora/logs/` directory.

## Local API flow

The folder/file open path is deliberately asynchronous:

1. `public/app.js` sends `POST /api/open`.
2. The server resolves the supplied path (or its configured workspace) and
   checks that it exists.
3. The server awaits the injected opener. Packaged Electron injects
   `shell.openPath`; standalone server mode uses `open`, `cmd`, or `xdg-open`.
4. A non-empty Electron error string or rejected system command becomes a
   non-2xx response. The browser turns it into a bilingual toast.

This keeps the HTTP response truthful and makes the opener independently
testable without launching Finder or another desktop application.

## Workspace and configuration

The tracked `histora.config.yaml` template describes the workspace, sync
schedule, redaction setting, enabled channels, and adapter sources. A legacy
`chathub.config.yaml` is read when the current file is absent.

Development and CLI runs use the explicit workspace environment variable or
the current directory. Packaged desktop runs use
`~/Library/Application Support/Histora/workspace` and migrate an existing
Documents workspace once while preserving the source. Background scheduling
rejects protected user folders so a scheduled process does not depend on a
Documents/Desktop/Downloads path.

## Release flow

Git tags matching `v*` trigger `.github/workflows/release.yml`. The macOS job
builds, re-signs the bundle bottom-up, updates Electron ASAR integrity, repacks
DMG/ZIP artifacts, and regenerates their blockmaps. The Windows job builds NSIS
and portable artifacts. The publish job combines both artifact sets into a
GitHub Release. Apple notarization is not configured by default.
