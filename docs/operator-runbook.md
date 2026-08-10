# Operator runbook

## Health checks

Run the deterministic test suite and local diagnostics:

```sh
npm test
npm run doctor
npm run status
```

For a running server, verify the API before opening the GUI:

```sh
curl --fail http://127.0.0.1:4767/api/status
```

## Folder-opening troubleshooting

1. Confirm the target exists and is readable.
2. Call `POST /api/open` directly as shown in
   [`integration-guide.md`](integration-guide.md).
3. Treat `404` as a stale/missing session path and `500` as an operating-system
   opener failure; the GUI should show the returned `error` text.
4. In the desktop build, verify that the app is running as an installed
   Electron app. The menu and API both use Electron's `shell.openPath`.
5. If only background scheduling fails, check that the macOS app is installed
   under `/Applications` and that the workspace is not under Documents, Desktop,
   or Downloads.

## Scheduling

The GUI's schedule form writes `histora.config.yaml` and reinstalls the
platform scheduler. macOS uses `com.jet.histora.sync` plus a watchdog at
`~/Library/Application Support/Histora/histora-sync-launchd.sh`; Windows uses
the `Histora Sync` Task Scheduler entry.

Workspace logs are written to:

```text
<workspace>/.histora/logs/launchd.out.log
<workspace>/.histora/logs/launchd.err.log
```

The watchdog stops a scheduled sync after ten minutes so a stuck process does
not block the next run.

## Build and release

```sh
npm run pack:mac     # unpacked macOS smoke package
npm run pack:win     # unpacked Windows x64 smoke package
npm run dist:mac     # macOS DMG + ZIP
npm run dist:win     # Windows NSIS + portable
```

Push a version tag such as `v<version>` to run the GitHub release workflow. The
macOS job re-signs the generated bundle, repairs Electron ASAR integrity,
rebuilds DMG/ZIP blockmaps, and publishes the final assets. The package is not
Apple-notarized by default; use Finder's **Open** action on the first launch if
Gatekeeper blocks it.

## Data safety

Do not delete `.histora/`, `channels/`, or a user's configured workspace while
diagnosing a failure. Build output in `release/` is reproducible; session
transcripts and SQLite state are not.
