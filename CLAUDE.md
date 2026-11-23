# Auth Switcher

Chrome MV3 extension: several HTTP-auth logins per site, switched without restarting Chrome.
Vanilla JS, no build step, no dependencies. Flat repo — `CODEMAP.md` maps every file.

## Read first
- `STATE.md` — verified facts, open failures, last session. `CODEMAP.md` — where things are.
- `SDLC.md` — this repo follows the AI-native SDLC; cycles live in `docs/sdlc/<slug>/`.

## Commands
- All checks: `npm test` (syntax check of the five source modules, then every test script)
- Scoped: `node test/backup.test.mjs` (export/import, merge) · `node test/background.test.mjs`
  (worker, rules, migrate, credential boundary) · `node test/wiring.test.mjs` (manifest, DOM ids,
  messages, module boundaries) · `node test/links.test.mjs` (bulk link/unlink/delete) ·
  `node test/storage.test.mjs` (`writeChange` order)
- Package for the store: `npm run package` — production gate; needs a clean tree.

## Gotchas
- Read a user's sites through `domainsOf()` (`backup.js`), never `session.domain(s)` directly.
- A user's own `domains` can hold sites no longer configured; intersect with the configured list
  before anything outward (export, request rules).
- Show/hide with the `hidden` attribute only. No emoji in UI — inline SVG line icons.
- `.sdlc/` and `.github/workflows/` are guarded; a human authorizes edits there.
