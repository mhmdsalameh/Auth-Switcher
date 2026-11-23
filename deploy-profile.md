# Deploy profile - Auth Switcher

<!-- The Deploy stage reads the commands and tiers from here. "unknown" marks a field nobody has
confirmed yet. -->

## Stack
- **Infrastructure:** none (client-only Chrome extension, Manifest V3) · **IaC:** none
- **Hosting / platform:** Chrome Web Store
- **Runtime:** Chrome ≥ 144 (`manifest.json` `minimum_chrome_version`); Node 24 for tests and packaging
- **Database:** `chrome.storage.local` / `chrome.storage.session` in the user's browser. **Backups:** user-initiated export (`backup.js`)
- **Domain & TLS:** N/A. Project pages under `docs/` (GitHub Pages: unknown whether enabled)
- **Secrets manager:** N/A — no service secrets. Store account credentials stay with the maintainer.

## Environments (tiers the Deploy gate uses)
| Env | Branch | URL | Who can deploy |
|-----|--------|-----|----------------|
| development | feature branches | Load unpacked in a local Chrome | agent (free) |
| staging | none | none | — |
| production | `main` + tag `v<version>` | Chrome Web Store listing (URL unknown) | **agent prepares the zip; Mohammad Salameh uploads** |

## Commands (exact, copy-pasteable)
- **Build:** `npm run package` (runs `npm test`, then `tools/package.mjs`; writes `../auth-switcher-<version>.zip`)
- **Test:** `npm test`
- **Deploy staging:** none
- **Deploy production:** manual upload in the Chrome Web Store developer dashboard
- **Rollback:** upload the previous version's zip with a bumped version number (the store rejects a lower version). Unproven.
- **DB migrate:** `migrate()` in `background.js` runs on every service-worker start. **Migrate rollback:** none — an older build reads the newer shape as-is.

## CI/CD
- **CI provider:** GitHub Actions  **Pipeline file:** `.github/workflows/ci-gates.yml`
- Agent write-steps arrive as **PRs through branch protection** - no direct push to `main`.

## Monitoring & alerting (feeds the Maintain stage)
- **Metrics/APM:** none
- **Uptime check:** N/A
- **Key metrics watched (bands.yaml):** none yet; store reviews and GitHub issues are the only signal
- **On-call / alert channel:** unknown
