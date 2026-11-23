# 0001 — One MV3 package as a modular monolith, boundaries checked by tests

- **Status:** accepted
- **Date:** 2026-11-23   **Deciders:** Mohammad Salameh   **Relates to:** `architecture.md` @ draft (cycle bulk-link)

## Context
Auth Switcher is a Chrome Manifest V3 extension maintained by one person. Chrome installs and
updates it as one package from the Chrome Web Store. There is no server; all state lives in Chrome
extension storage. The code is five ES module files with no build step and no dependencies. The
style was never written down before the SDLC was adopted; this ADR records it so later cycles do not
re-decide it.

## Decision
We will keep the extension as one package organised as a modular monolith. Each module is one file
(or the panel's three files) with a listed public surface: Storage (`storage.js`), Backup
(`backup.js`), Links (`links.js`, added in cycle bulk-link), Worker (`background.js`) and Panel
(`popup.*`). Backup and Links stay pure (no `chrome.*`, no DOM, no network). We will enforce the
import rules and the absence of cycles in `test/wiring.test.mjs`, which CI runs on every PR.

## Consequences
- Easier: one place to test, one artifact to ship, no inter-process contracts beyond runtime messages.
- Harder: nothing but a test stops a module from reaching into another; the wiring test must grow
  with each new module.
- Commits us to: no dependency-based boundary tool (none fits a no-dependency repo). Reversing it
  means adding a bundler and a tool such as dependency-cruiser.

## Alternatives considered
| Alternative | Why rejected |
|-------------|--------------|
| Services (backend + extension) | no independent deploy need; a server would hold passwords off-device, against `PRIVACY.md` |
| Event-driven between panel and worker | the panel needs its own write to be visible immediately; events add ordering problems for no gain |
| dependency-cruiser / madge for boundaries | adds the repo's first npm dependency and lockfile for five files |
