# Handoff

## Verified state — 2026-08-10

- Release `v0.10.6` is published at
  `https://github.com/newtol-labs/Histora/releases/tag/v0.10.6`; it contains
  the H/synchronization logo for both the application bundle and sidebar, plus
  the `#2a3a56` sidebar background that keeps the dark rounded logo tile distinct.
- The folder/file open flow waits for the actual desktop opener, validates the
  target path, and surfaces failures through the local API and GUI toast.
- The release workflow builds macOS and Windows artifacts, re-signs the macOS
  bundle, and regenerates final blockmaps before publishing.

## Verification

- `npm test` passes.
- The packaged macOS app was exercised through `POST /api/open` against an
  isolated workspace and returned `200`.
- DMG checksum verification, ZIP extraction, deep code-signature verification,
  and Electron ASAR integrity checks pass for the local macOS artifact.
- GitHub Actions run `31372410443` completed successfully for Windows, macOS,
  and the publish job.
- The current local macOS smoke package contains the sidebar color and the
  cache-busted H/synchronization sidebar asset.

## Constraints for the next change

- The macOS build is ad-hoc signed and is not Apple-notarized. Keep the manual
  first-launch guidance in release docs until Developer ID signing and
  notarization are configured.
- Keep the local server on loopback by default; its API has no authentication.
- Preserve user workspace data and local configuration when cleaning or
  rebuilding the project.
- Update the API integration and architecture docs together when routes or
  opener behavior changes.
