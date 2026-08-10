# Histora project rules

Histora is a local GUI and synchronization agent for AI conversation sessions.
Keep project-specific decisions and operating constraints here and in `docs/`;
do not add them to the global Codex instructions.

## Fast checks

```sh
npm test
npm run doctor
npm run desktop
```

Use `npm run dist:mac` or `npm run dist:win` only when a distributable is
needed. Build output belongs in the ignored `release/` directory.

## Boundaries

- `src/server.mjs` owns the loopback HTTP server and API contract.
- `src/desktop-main.mjs` owns Electron lifecycle, workspace resolution, menus,
  and desktop integrations.
- `src/sync.mjs`, `src/state.mjs`, and `src/adapters/` own discovery, parsing,
  normalization, Markdown output, and SQLite state.
- `public/` is a browser client of the local API; it must not depend on Node or
  Electron globals.
- `/api/open` must wait for the opener result and return a non-2xx response on
  failure. Packaged Electron uses `shell.openPath`; the standalone server uses
  the platform opener.
- Background scheduling must use an installed app from Applications on macOS,
  and must not place a background-sync workspace under Documents, Desktop, or
  Downloads.

## Data and configuration

- `histora.config.yaml` is the tracked template; `chathub.config.yaml` is a
  legacy fallback.
- `HISTORA_WORKSPACE` is the canonical workspace override; `CHATHUB_WORKSPACE`
  remains a compatibility alias.
- Treat `.histora/`, `channels/`, `_index.md`, and local `config/` contents as
  user data unless a task explicitly says otherwise. Never commit credentials,
  session transcripts, SQLite databases, or generated release files.
- The loopback server defaults to `127.0.0.1:4767`. If changing its host or
  routes, update `README.md`, `docs/integration-guide.md`, and
  `docs/architecture.md` in the same change.

## Documentation map

- `README.md` — first-run commands, supported sources, and concise API/release
  notes.
- `docs/architecture.md` — runtime components and data flows.
- `docs/integration-guide.md` — local API and configuration usage.
- `docs/operator-runbook.md` — diagnostics, scheduling, and release operations.
- `docs/handoff.md` — verified state and known constraints at handoff.

Keep these files factual and concise. Put historical detail in Git history,
not in this rules file.
