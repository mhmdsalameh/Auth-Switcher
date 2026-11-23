# Plan: Bulk-link users to sites

<!-- Stage 3 (Build). Produced before any file was edited (plan mode not available in this session;
     no edits made until approval). Commit before implementing. -->

- **From:** `spec.md` @ c754a93 (approved)
- **Design:** `design.md` @ 38157ff (approved) — HTML mockup `design/mockup.html` (ADR 0004)
- **Status:** approved
- **Build protocol:** multi-session (`long-running-build`): ledger `FEATURES.json` (F001–F010),
  startup `init.ps1`, smoke test `npm test` at each session start.

## Work order
One commit per step; `npm test` green after each. Feature ids refer to `FEATURES.json`.

1. **F001 — `backup.js`**: `mergeBackup` also returns `addedIds` (ids of new records) and
   `matchedIds` (id of the first existing user that covered each skipped record, no duplicates).
   `added` / `skipped` stay numbers. Tests in `test/backup.test.mjs`.
2. **F002 — `links.js`** (new, pure, imports only `./backup.js`): `linkUsers`, `unlinkUsers(state,
   userIds, sites, { deleteOrphans })`, `deleteUsers`, `addSiteWithUsers` per the spec's contract
   table. Sites compared after `normalizeDomain`; inputs never mutated. New `test/links.test.mjs`.
3. **F003 — `storage.js`**: new export `writeChange({ activeByDomain, sessions, domains })` —
   writes `activeByDomain` through `writeActiveByDomain()` (`INSTANCE_AREA`) first, when given, then
   `sessions` and `domains` (those given) in **one** `chrome.storage.local.set`. New
   `test/storage.test.mjs` imports `storage.js` under a stubbed `chrome` and records call order.
4. **F004 — `background.js`**: one predicate `serves(session, site, domains)` = `site ∈ domains` and
   `site ∈ domainsOf(session)`. `onAuthRequired`: pinned user if the tab is pinned, else the signed-in
   user; answer only if `serves`; no fallback from pinned to signed-in. `syncRules`: pinned rules for
   `domainsOf(session) ∩ domains`; an active rule for a site only if `serves`. Tests in
   `test/background.test.mjs`; the existing pinned-tab test keeps passing (its user holds both sites).
5. **F005 — `test/wiring.test.mjs`** boundary rules (architecture §3): `backup.js` and `links.js`
   contain no `chrome.`, `document`, `fetch(`; `links.js` imports only `./backup.js`; no file imports
   `popup.js` or `background.js`; no import cycle among the five modules; `popup.js` writes
   `sessions` only through `writeChange` (no `storage.local.set({ sessions` / `{ domains, sessions`).
6. **F006 — `popup.css`**: the approved "Proposed additions" block from the mockup — `.btn-primary`
   text `var(--bg)`, `.choice-row` padding 6px, `.btn:disabled`, `.nav-icon`, `.pick-head`,
   `.pick-count`, `.pick-row`, `.pick-sites`, `.bulk-actions`, `.choice-list.open-list`,
   `.choice-user`, `.confirm-list`, `.form-actions.wrap`. Tokens only.
7. **F006 — `popup.html`**: nav icon `#manage-toggle` (inline SVG line icon, two people,
   "Manage users"); `#manage` section (`#manage-status` `role="status"`, select-all, `#manage-count`,
   `#manage-search`, `#manage-list`, `#bulk-link` / `#bulk-unlink` / `#bulk-delete`, hint);
   `#pick-form` sub-form (title, site list, submit, cancel); `#confirm` (`role="alertdialog"`, title,
   body, names list, delete / keep / cancel, note). F007: `#import-sites` step (heading, site list,
   submit, cancel, hint); passphrase submit renamed "Open file". F008: `#add-site-form` (heading,
   user list, submit, cancel, hint).
8. **`popup.js`**
   - **F006** Manage users page: `manageOpen`, `selected` (Set of ids), `manageQuery`, `pickMode`
     (`link` | `unlink` | null), `confirmMode`. Lists selectable users (≥ 1 live site) in stored
     order; search at ≥ 5 users; select-all acts on shown rows; actions disabled at 0 selected.
     Link → `linkUsers` → `writeChange`. Unlink → `unlinkUsers(..., { deleteOrphans: false })` to get
     `orphans`; none → save; some → Confirm deletion (Delete → `deleteOrphans: true`; Keep them →
     `false`; Cancel → back to Choose sites). Delete → Confirm → `deleteUsers`. Focus moves into an
     opened sub-form (safe button in a confirmation) and back to the opener on close; Escape closes.
     Status line copy per `design.md`. Nav: Manage and Settings pages are exclusive; each shows Back.
   - **F007** Import: file → (encrypted: passphrase, "Open file") → extra-site step listing merged
     `domains` with a "new" badge for sites the file adds → `mergeBackup` then `linkUsers` with
     `[...addedIds, ...matchedIds]` → `writeChange`. Status copy per `design.md`.
   - **F008** Add site: Enter / "This site" / detected "Add" open `#add-site-form` when ≥ 1 user
     exists (otherwise add at once, as today); save → `addSiteWithUsers` → `writeChange` (one write of
     `domains` + `sessions`); Cancel keeps the typed site.
   - **F009** Per-row delete, edit-form save, add-form save and the existing import path use
     `writeChange` (R7 write order).
   - `storage.onChanged` repaint and `syncToTab` are suppressed while a Manage sub-form, the import
     site step or the add-site form is open (same reason as `formOpen`).
9. **F010 — docs and scripts**: `package.json` `test` adds `node --check links.js`,
   `node test/links.test.mjs`, `node test/storage.test.mjs`; `CLAUDE.md` scoped commands;
   `architecture.md` Storage contract row adds `writeChange`; `CODEMAP.md` (links.js, writeChange,
   Manage page, new tests); `STATE.md`.

## Files
| File | Change | New? |
|------|--------|------|
| `backup.js` | `mergeBackup` returns `addedIds`, `matchedIds` | no |
| `links.js` | pure bulk transforms | yes |
| `storage.js` | `writeChange()` export | no |
| `background.js` | `serves()`; boundary in `onAuthRequired` and `syncRules` | no |
| `popup.html` | nav icon, Manage page, pick form, confirm, import site step, add-site form | no |
| `popup.js` | Manage page flows, import flow, add-site flow, writes via `writeChange` | no |
| `popup.css` | approved additions and two fixes | no |
| `test/links.test.mjs` | links.js tests | yes |
| `test/storage.test.mjs` | write order and write count | yes |
| `test/backup.test.mjs` | `addedIds` / `matchedIds` | no |
| `test/background.test.mjs` | R13 cases | no |
| `test/wiring.test.mjs` | boundary rules, writes through `writeChange` | no |
| `package.json` | test script | no |
| `CLAUDE.md`, `architecture.md`, `CODEMAP.md`, `STATE.md` | docs | no |
| `FEATURES.json`, `init.ps1` | build ledger, startup script | yes |

## Proof
Each test name carries its R-ID.

| R# | Proof |
|----|-------|
| R1 | `links.test`: "R1 link adds sites, keeps others and stale ones"; "R1 unknown ids skipped". UI bullet (save names sites and count): `/sdlc-test` e2e on `popup.html` + screenshot vs `design/manage-link.png` |
| R2 | `links.test`: "R2 non-configured site not applied, reported in notApplied"; UI list = configured sites: e2e |
| R3 | `links.test`: "R3 link and addSiteWithUsers leave activeByDomain unchanged"; "R3 import extra sites adopt no signed-in user" |
| R4 | `links.test`: "R4 unlink removes only chosen sites"; "R4 unlink of a site not held is a no-op" |
| R5 | `links.test`: "R5 orphans = users with no live site left (stale counts as none)"; "R5 deleteOrphans deletes them in the same result". Confirmation names users: e2e + screenshot vs `confirm-last-site.png` |
| R6 | `links.test`: "R6 keep orphans still unlinks the others"; "R6 all orphans kept changes nothing". Copy "No user was changed.": e2e |
| R7 | `links.test`: "R7 unlinking or deleting the signed-in user clears that site, no successor"; `storage.test`: "R7 writeChange writes activeByDomain before sessions"; `wiring.test`: "popup.js writes sessions only through writeChange" (covers per-row delete and edit form) |
| R8 | `links.test`: "R8 import links every imported user to picked extra sites"; "R8 extra sites offered from merged domains"; "R8 encrypted file same result" (via `openBackup`) |
| R9 | `backup.test`: "R9 mergeBackup reports addedIds and matchedIds"; `links.test`: "R9 matched existing user gets extra sites, no duplicate" |
| R10 | `backup.test`: "R10 result unchanged apart from the new id fields"; `links.test`: "R10 no extra sites equals mergeBackup result" |
| R11 | `links.test`: "R11 addSiteWithUsers configures site and links chosen users only"; "R11 no users chosen adds site only" |
| R12 | `links.test`: "R12 deleteUsers removes users and their activeByDomain entries". Confirmation names users, decline changes nothing: e2e + screenshot vs `confirm-delete.png` |
| R13 | `background.test`: "R13 pinned tab gets no credentials on a site its user lacks"; "R13 signed-in user not linked to the site gets none"; "R13 syncRules pinned rules skip stale sites"; "R13 syncRules no active rule for an unlinked signed-in user"; "R13 pinned user linked to the site still answered" |
| R14 | `storage.test`: "R14 one sessions write for N = 1, 2, 50"; "R14 domains and sessions in one set call". Performance: `links.test` "1,000 users × 20 sites under 50 ms" |

UI (F006–F008): `/sdlc-test` drives `popup.html` over HTTP with a `chrome` stub in `test/e2e/`
(Playwright), checks keyboard path and focus, and compares screenshots at 320px and 180px with the
13 approved PNGs in `design/`.

## Risks / alternatives the engineer interrogated
- **Where the R7 write order lives** — chosen: `storage.js` `writeChange()`, unit-tested with a
  `chrome` stub, and a wiring rule forcing `popup.js` through it (Mohammad Salameh, 2026-11-23).
  Rejected: ordered writes inline in each popup handler — only a static check possible, does not
  meet R7's "test that records the order of the storage calls". Cost: additive change to the Storage
  contract (tier-3 file), recorded in `architecture.md`.
- **Session count** — chosen: multi-session build with `FEATURES.json` (Mohammad Salameh,
  2026-11-23). Rejected: single session (9 steps, high risk of an unfinished context).
- **R13 changes pinned-tab behaviour** (a pinned tab on a site its user lacks gets Chrome's dialog) —
  accepted in ADR 0002.
- **Two `set` calls on one area** in the normal profile (`INSTANCE_AREA` is `storage.local`) — R14
  allows `activeByDomain` once before `sessions`; not merged into one call so the private-instance
  path stays the same code.
- **`/sdlc-infra`** listed as next by `sdlc-gate status` — skipped at `/sdlc-arch` (no hosting).
- **No DOM harness for `popup.js`** — UI-only bullets are proven at `/sdlc-test` (e2e + screenshots),
  not by unit tests.

## Departures from plan
<!-- If implementation diverged, record what and why. Keep plan.md matching the merged diff. -->
- F005 and F009 land in one commit: the wiring rule "popup.js writes sessions only through
  `writeChange`" fails until the existing popup writes move, so the two cannot be green apart.
  F009 also routes `setDomains` (chip removal) through `writeChange({ domains })` and the per-row
  delete through `links.js` `deleteUsers` instead of its own copy of the same rule.
- `/sdlc-test` added a step for existing controls below WCAG 2.2 AA 24px targets: `.icon-btn`
  min 24x24, `.chip-remove` 24x24 hit area (negative margin keeps the chip size), Settings ⚙
  glyph replaced by an inline SVG gear (approved by Mohammad Salameh, 2026-11-23).

## Revisions
- 2026-11-23 — proposed and approved by Mohammad Salameh (write order in `storage.js`; multi-session).
