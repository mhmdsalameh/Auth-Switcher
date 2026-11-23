# Project State

> Auth Switcher — Chrome MV3 extension for holding several logins to the same
> HTTP-auth protected site and switching between them. Vanilla JS, no build step.

## Verified facts

- `npm test` runs 40 checks: `node --check` on all 4 sources, then `wiring`, `backup`,
  `background` suites. Green as of 2026-09-01.
- `background.test.mjs` runs `background.js` inside `node:vm` with stubbed `chrome.*`.
  It inlines `storage.js` and `backup.js` textually and strips `import` lines, so any new
  cross-module import must be added to the `SHARED` constant at the top of that file.
- `wiring.test.mjs` is a static guard suite: every `$("#id")` in `popup.js` must exist in
  `popup.html`, every `className = "x"` must have a `.x` rule in `popup.css`, and every
  `{type: "x"}` message must have a handler in `background.js`.
- `storage.local` is shared between the normal and private-window instances by design;
  session state goes through `INSTANCE_AREA` (`storage.js:35`) instead.

## General rules

- The destructive path (`clearSiteData`) must only ever touch the domains passed to it.
  Never add `cache: true` without an `origins` filter; never make `cookies: true`
  unconditional — `wiring.test.mjs` fails the build on both.
- `preemptive` must default to `false`; `true` breaks NTLM/Negotiate sites outright.
- Any change to the stored `Session` shape needs a step in `migrate()` and must stay
  idempotent — it runs on every worker spin-up, not just on update.

## Open failures

None.

## Lessons

- A user's credentials frequently apply to several sibling domains (`k2.corp.com` and
  `k2test.corp.com`). The stored shape is `domains: string[]` for that reason; read it
  through `domainsOf()` rather than either field, so records written by an older version
  still resolve before `migrate()` has run.
- `activeByDomain` stays keyed by domain even for multi-domain users: switching is scoped
  to the one domain the panel is showing, so no domain the user was not looking at gets
  its cookies cleared.

## Release state

- **1.3.0** prepared on branch `release/1.3.0`: multi-site users, password reveal,
  tab-following. `npm run package` builds `../auth-switcher-1.3.0.zip` from HEAD.
- **No git tag yet, deliberately.** `tools/package.mjs` treats an existing `v<version>` tag
  as "already shipped" and refuses to build, so tag only *after* a successful upload.
- **Blocking a store upload:** `store/screenshots/` still shows the 1.2.0 panel. New raw
  captures have to be taken from a real browser before `tools/make-screenshots.py` can
  re-compose them.
- **Also blocking:** no build of this code has ever been run in Chrome. See the caveat below.

## Last session

**2026-11-23 (test)** — `/sdlc-test` for bulk-link. **E2E without a server:** Playwright MCP
`browser_run_code_unsafe` with `context.route("https://as.test/**", r => r.fulfill({ path }))` serves
the repo (https so `crypto.subtle` works) and `page.addInitScript({ path: "test/e2e/chrome-stub.js" })`
supplies `chrome.*` (seed in `sessionStorage.__seed`, writes in `window.__writes`). That code runner has
no `fs`/`require`; files only via `download.saveAs` (Chrome stops after ~10 downloads per call).
All 13 design PNGs compared; F006–F008 now `passing`. Fixed in `b54aedd`: action buttons hidden while
a sub-form is open (as in the PNGs), search on its own line at <= 300px (was ~16px at 180px), focus
back to Import… / the site field after saving, import write errors shown, search min-height 24px,
viewport meta. 7c cut 3 tests (`faabd72`); R10 test strengthened (`e3f4582`). Step 8: every R1–R14 and
the wiring boundary rules shown to fail on a targeted break (list in the test report). UI checker
(`sdlc-ui-check.cjs`, config `.playwright-mcp/ui-check/ui-check.json`, minTarget 24 = WCAG 2.2 AA,
palette allowed): PASS after the user-approved fix of 18 older controls (`.icon-btn` min 24px, chip ✕
24px hit area via negative margin, ⚙ glyph -> inline SVG gear). Gate not armed: `.sdlc/ui-check.json`
/ `ui-gate.json` are guarded.
Seen, pre-existing: `mergeBackup` signs a user in on *every* configured site with nobody signed in,
not only the file's sites; success copy says "Imported 1 users". `plan.md` re-approved. No `evals/` set: skipped this cycle by the user's decision.
**Pending human:** commit `.sdlc/gates/*.jsonl` (guarded); a real-Chrome load of the unpacked
extension is still never done (the e2e used a `chrome` stub).
**Next action:** `/sdlc-review`.

**2026-11-23 (build, session 1 continued)** — F006–F008 code complete: `popup.css` approved
additions (`.btn-primary` text `--bg`, `.choice-row` 6px, bulk classes); `popup.html` nav icon,
`#manage` page, `#pick-form`, `#confirm`, `#import-sites`, `#add-site-form`, "Open file";
`popup.js` Manage users (selection, search ≥ 5, link / unlink + last-site confirmation / delete),
import extra-site step, "Who can sign in?" for new sites. F010 done (`CODEMAP.md`). `npm test`
green. **Not rendered:** starting a local HTTP server for Playwright was denied by the auto-mode
classifier, so F006–F008 stay `in_progress`. A scratch fake-DOM run of `popup.js` (not a UI check)
drove unlink → Keep them, bulk delete and add-site: write order and statuses matched the spec.
**Next action:** `/sdlc-test` — needs a way to serve the repo over HTTP (user to allow a local
static server, or load the unpacked extension in Chrome) to run the e2e + screenshot comparison
against `docs/sdlc/bulk-link/design/*.png`; then mutation checks (step 8) incl. the new wiring
purity / cycle rules. `plan.md` still needs re-approval (stale).

**2026-11-23 (build, session 1)** — `/sdlc-plan` for bulk-link: `plan.md` approved by Mohammad
Salameh (`a46bd2f`, gate recorded); multi-session build with `FEATURES.json` (F001–F010) and
`init.ps1` (smoke test = `npm test`). Landed: F001 `mergeBackup` `addedIds`/`matchedIds`
(`ac67bfd`); F002 `links.js` + `test/links.test.mjs` (`ee4f30d`); F003 `storage.js`
`writeChange()` + `test/storage.test.mjs` (`fea3c48`); F004 Worker `serves()` boundary in
`onAuthRequired`/`syncRules` (`807dfde`); F005+F009 wiring boundary rules and every popup write
through `writeChange` (`3134967`). `npm test`: wiring PASS, backup 16, links 25, storage 3,
background 28. Facts: VM-built arrays need spreading before `deepEqual` (foreign prototype);
`storage.js` can be imported fresh per test with a `?instance=N` query under a `chrome` stub.
**Pending human:** `plan.md` is `stale` (Departures note for F005+F009) — re-approve with
`sdlc-gate.cjs approve docs/sdlc/bulk-link/plan.md --by "Mohammad Salameh"`. `.sdlc/gates/*.jsonl`
still uncommitted (guarded). **Next action:** run `./init.ps1`, then F006 — `popup.css` approved
additions, then `popup.html` + `popup.js` Manage users page (plan.md steps 6–8); then F007 import
step, F008 add-site form, F010 `CODEMAP.md`.

**2026-11-23 (spec + ux)** — `/sdlc-spec` for bulk-link: `docs/sdlc/bulk-link/spec.md` R1–R14,
approved by Mohammad Salameh (`c754a93`, gate recorded). Decisions: close all Worker boundary gaps
this cycle (R13 — also found the active-user path never checks the user's own sites; the normal panel
cannot clear the private instance's `activeByDomain`); bulk link / new-site / import-extra-sites set
no signed-in user; bulk delete confirms naming every user; import extra sites come from the merged
list; `mergeBackup` gains `addedIds`/`matchedIds`. WCAG 2.2 AA recorded in the design-system skill.
`/sdlc-ux`: HTML mockup + 13 PNGs + `design.md` + inventory rows committed as draft (`2112a49`);
new pattern Selectable row list (stable). Measured: `.btn-primary` white on `--accent` is 2.75:1 →
use `--bg` text (6.05:1); `.choice-row` 23px → padding 6px; both approved, apply at Build.
`sdlc-check design.md` has 1 error (no Figma URL, ADR 0004) — approve with `--accept-errors`.
Pending: design approval; commit of `.sdlc/gates/*.jsonl` (guarded); `.playwright-mcp/` is
untracked scratch, not ignored. Mockup needs an HTTP server (no Python here; Playwright blocks
`file:`). Next: design approval, then `/sdlc-plan`.

**2026-11-23 (arch)** — `/sdlc-arch` for bulk-link: root `architecture.md` + ADRs 0001–0004
(modular monolith; credential boundary = configured ∩ user's sites, checked in the Worker; bulk
changes in a pure `links.js` the Panel persists, `activeByDomain` cleared before `sessions` is
written; HTML mockup designs). Approved by Mohammad Salameh (`d31b932`), with 5 accepted
server-only lint errors. Found: `onAuthRequired` answers a tab-pinned user for any configured site
without checking that user's own sites — `/sdlc-spec` decides whether this cycle closes it, with the
`syncRules` gap. Boundary rules go into `test/wiring.test.mjs` at Build. `/sdlc-infra` skipped (no
hosting). Next: `/sdlc-spec`.

**2026-11-23** — Scaffolded the AI-native SDLC (minimal init, `18ece27`) and opened cycle
`bulk-link` on `feat/bulk-link`: intent approved by Mohammad Salameh (`5ee7ecd`), size
new-system. Next: `/sdlc-arch` — a short `architecture.md` for the existing extension
(modules, data ownership, credential boundary) plus an ADR for HTML-mockup designs, then
`/sdlc-spec`. Pending human actions: create `.sdlc/ui-check.json` (guarded path), run the
branch-protection command in `ci-gates.md`. The export fix for deleted domains is on
`fix/export-deleted-domains` (`637078e`), not merged; `feat/url-switch` deletions are stashed.

**2026-09-01** — Added multi-domain users. `Session.domain` (string) became
`Session.domains` (string[]), with a v2→v3 migration. The add/edit form grew a
collapsible checkbox dropdown listing the configured sites, shown only when more than one
domain is configured. Switching remains scoped to the selected domain; the popup now sends
that domain with the `switch` message.

Then added a show/hide toggle to every password field — the user password plus both backup
passphrases — as one reusable `addReveal()` in `popup.js`. It uses an inline SVG eye rather
than the 👁 emoji, which Windows paints through Segoe UI Emoji in its own colours and would
ignore the muted-grey `.icon-btn` treatment every other control uses. Revealing is never
sticky: `form.reset()` restores a field's value but not its type, so each reset point calls
`hidePasswords()` explicitly.

Then made the site picker follow the active tab (`syncToTab`, `popup.js:575`), so the
dropdown stops needing a manual switch. `tabDomain` and `pinnedDomain` are panel-local
module state on purpose — `selectedDomain` lives in shared `storage.local`, so persisting
browsing activity there would drag every other window's panel, and the private-window
instance, around in lockstep. Following is suppressed while a form is open because the
submit handler resolves `currentDomain()` at save time.

Verified with `npm test` (40 checks). The form-open guard was mutation-tested: deleting it
does make `wiring.test.mjs` fail. **The UI itself was never rendered** — no browser
automation was available in this session, so the picker's and the eye toggle's appearance
and focus behaviour are reasoned from the CSS, not observed.
