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
