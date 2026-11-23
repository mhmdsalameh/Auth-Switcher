# Spec: Bulk-link users to sites

<!-- Stage 2 (Design). Produced from intent.md in one session with policy skills active. -->

- **From intent:** `docs/sdlc/bulk-link/intent.md` @ 5ee7ecd (approved); architecture `architecture.md` @ d31b932 (approved)
- **Author / prompt+skill versions:** Claude Opus 5.5 (`claude-opus-5-5`) with Mohammad Salameh; `/sdlc-spec`; skills `ai-native-sdlc`, `production-readiness`, `requirements-elicitation`, `project-types` (web profile), `codebase-navigation` from `~/.claude` @ f647b37; project skill `design-system` @ e92cd78
- **Status:** draft

## Problem & proposed solution
**Problem (from the intent).** A tester links or unlinks a site one user at a time, through each
user's edit form. Imported users arrive only with the sites in the file. A newly added site has no
users until each is edited. Deleting users takes one click each. With tens of users and several
sibling sites this is slow and easy to get wrong.

**Solution.** Five bulk actions in the side panel — link, unlink, delete, extra sites at import,
users for a new site — each computed by a new pure module `links.js` (ADR 0003) and saved by the
Panel in one save. A bulk unlink that would leave users with no configured site asks before it
deletes them. The Worker enforces the credential boundary of ADR 0002 on every answer and header
rule, so a stale or removed link never sends a password, in either browser instance.

## Affected users and systems
- **Users:** QA testers who keep several HTTP-auth logins for internal sites (intent).
- **Systems:**
  - Panel (`popup.html`, `popup.js`, `popup.css`): the five actions, confirmations, write order.
  - Links (`links.js`, new): the pure transforms.
  - Backup (`backup.js`): `mergeBackup` reports which users it added and which existing users
    covered a skipped record (additive return fields).
  - Worker (`background.js`): credential boundary in `onAuthRequired` and `syncRules`.
  - Tests: `test/links.test.mjs` (new), `test/background.test.mjs`, `test/backup.test.mjs`,
    `test/wiring.test.mjs`.

## Terms
- **Configured sites:** the stored `domains` list (Settings).
- **A user's sites:** `domainsOf(user)`. May hold sites that are no longer configured ("stale sites").
- **Live sites of a user:** a user's sites ∩ configured sites.
- **Signed-in user of a site:** `activeByDomain[site]` in this instance's area (`INSTANCE_AREA`).
- **Pinned user of a tab:** `tabAssignments[tabId]` (Open as).
- **Selectable users:** every stored user with at least one live site.

## Requirements
Each `R#` names its tests. Tests in `test/links.test.mjs` call `links.js` directly; Worker tests run
in `test/background.test.mjs`.

### R1 — Bulk link adds sites and never removes any *(traces to: O1, C1)*
- **Given** user A with sites [x] and user B with sites [x, y], and configured sites [x, y]
  **When** the tester links A and B to y and saves
  **Then** A has [x, y], B has [x, y], and no other user changes.
- **Given** user A with sites [x, stale] where `stale` is not configured
  **When** the tester links A to y
  **Then** A has [x, stale, y] — sites the action did not name are kept, stale ones included.
- **Given** the tester has chosen 3 users and 2 sites
  **When** the save control is shown
  **Then** it names the 2 sites and the count 3 before the tester saves.

### R2 — Bulk link offers and applies only configured sites *(traces to: C8)*
- **Given** configured sites [x, y]
  **When** the link action lists sites to choose from
  **Then** it lists exactly x and y.
- **Given** configured sites [x, y] and user A with [x]
  **When** `linkUsers` is called for A with site z (not configured)
  **Then** A is unchanged and the result reports z as not applied.

### R3 — Bulk link, new-site linking and import extra sites leave signed-in users unchanged *(traces to: O1, O3, O4)*
- **Given** site y has no signed-in user
  **When** the tester links A and B to y
  **Then** y still has no signed-in user until the tester picks one.
- **Given** site y has signed-in user C
  **When** the tester links A and B to y
  **Then** C is still the signed-in user of y.

### R4 — Bulk unlink removes only the chosen sites *(traces to: O2, C2)*
- **Given** A with [x, y] and B with [x, y]
  **When** the tester unlinks A and B from y and saves
  **Then** A has [x] and B has [x].
- **Given** A with [x, stale]
  **When** the tester unlinks A from y, which A does not hold
  **Then** A is unchanged.
- **Given** configured sites [x, y]
  **When** the unlink action lists sites to choose from
  **Then** it lists exactly x and y.

### R5 — Bulk unlink deletes users left with no live site, after confirmation *(traces to: O2, C3)*
- **Given** A with [x] and B with [x, y]
  **When** the tester unlinks A and B from x
  **Then** before anything is saved, the panel asks to confirm deleting A and names A.
- **Given** that confirmation is shown
  **When** the tester confirms
  **Then** A is deleted, B has [y], and both changes are saved in the same save.
- **Given** A with [x, stale] where `stale` is not configured
  **When** the tester unlinks A from x
  **Then** A counts as left with no live site and is named in the confirmation.

### R6 — Declining the deletion keeps those users and still unlinks the others *(traces to: C9)*
- **Given** A with [x] and B with [x, y], and the confirmation names A
  **When** the tester declines
  **Then** A still has [x], B has [y], and the unlink of B is saved.
- **Given** A with [x] and B with [x], and the confirmation names A and B
  **When** the tester declines
  **Then** nothing changes and the panel says no user was changed.

### R7 — A site loses its signed-in user when that user is unlinked from it or deleted *(traces to: C10)*
- **Given** A is the signed-in user of x and B is also linked to x
  **When** the tester unlinks A from x
  **Then** x has no signed-in user; B is not made the signed-in user.
- **Given** A is the signed-in user of x and of y
  **When** A is deleted by bulk delete or by a confirmed last-site deletion
  **Then** neither x nor y has a signed-in user.
- **Given** any Panel change that removes a user's right to a site (bulk unlink, bulk delete, the
  per-row delete, unticking a site in the edit form)
  **When** the Panel saves it
  **Then** it writes `activeByDomain` before `sessions` (architecture §4), shown by a test that
  records the order of the storage calls.

### R8 — Import links every imported user to the extra sites the tester picks *(traces to: O3, C4)*
- **Given** a file with user C on [x], and the tester picks y as an extra site
  **When** the import is saved
  **Then** C has [x, y].
- **Given** configured sites [x] and a file that adds site w
  **When** the import lists extra sites to choose from
  **Then** it lists x and w (configured sites after the merge).
- **Given** an encrypted file
  **When** the tester enters the passphrase
  **Then** the extra-site choice applies the same as for a plain file.

### R9 — Extra import sites also go to existing users that cover a skipped duplicate *(traces to: C11)*
- **Given** existing user E with [x], and a file with E on [x]
  **When** the tester picks y and imports
  **Then** E is skipped as a duplicate, E has [x, y], and no second E exists.

### R10 — Import with no extra sites links only the file's sites *(traces to: C4)*
- **Given** a file with user C on [x]
  **When** the tester picks no extra site and imports
  **Then** C has [x], and the result equals today's `mergeBackup` result.

### R11 — Adding a site can link chosen existing users in the same action *(traces to: O4, C5)*
- **Given** users A, B, D and configured sites [x]
  **When** the tester adds site z, chooses A and B, and saves
  **Then** z is configured, A and B have z, D is unchanged, and z has no signed-in user.
- **Given** the same start
  **When** the tester adds site z and chooses no user
  **Then** z is configured and no user changes.

### R12 — Bulk delete removes every chosen user, after a confirmation that names them *(traces to: O5, C6)*
- **Given** users A, B, D
  **When** the tester chooses A and B for deletion
  **Then** the panel asks to confirm and names A and B before anything is saved.
- **Given** that confirmation
  **When** the tester confirms
  **Then** A and B are gone, D is unchanged, and no site has A or B as its signed-in user.
- **Given** that confirmation
  **When** the tester declines
  **Then** nothing changes.

### R13 — The Worker sends a password only to a site that is configured and among that user's sites *(traces to: C8, C10)*
- **Given** tab 5 pinned to user A, A has [x], configured sites [x, y]
  **When** a page in tab 5 on y sends an auth challenge
  **Then** the Worker answers with no credentials (`callback({})`) and does not fall back to y's signed-in user.
- **Given** `activeByDomain[y]` = A and A has [x] only (for example the private-window instance, whose
  `activeByDomain` the normal panel cannot clear)
  **When** a page on y sends an auth challenge
  **Then** the Worker answers with no credentials.
- **Given** pre-emptive mode, tab 5 pinned to A, A has [x, stale] and `stale` is not configured
  **When** `syncRules` runs
  **Then** it builds a pinned rule for x only, none for `stale`.
- **Given** pre-emptive mode and `activeByDomain[y]` = A, A has [x] only
  **When** `syncRules` runs
  **Then** it builds no header rule for y.
- **Given** tab 5 pinned to A, A has [x, y], configured [x, y]
  **When** a page in tab 5 on y sends an auth challenge
  **Then** the Worker answers with A's credentials (today's behaviour is kept where the link holds).

### R14 — Every bulk action is one save for any number of users *(traces to: C7)*
- **Given** N chosen users, for N = 1, 2 and 50
  **When** the tester saves a bulk link, unlink, delete, import with extra sites, or new site with users
  **Then** `sessions` is written exactly once, and `activeByDomain` at most once before it.
- **Given** the tester adds a site with users (R11)
  **When** it saves
  **Then** `domains` and `sessions` are written in one `storage.local.set` call.

## Registered capabilities
N/A: this repo has no requirements registry (`.sdlc/config.yaml` has no `requirements_registry:`
and `docs/requirements/registry.md` does not exist).

## Existing system (replacements only — otherwise "N/A: no system replaced")
N/A: no system replaced. The per-user edit form and per-row delete stay as they are, except the
write order in R7.

## Design

### Components and data flow
```
Panel (popup.js)                    links.js (pure)                 storage                Worker
 choose users + sites  ──state──▶  linkUsers / unlinkUsers /   ──next state──▶ Panel writes:
 confirm deletions                 deleteUsers / addSiteWithUsers           1. activeByDomain (INSTANCE_AREA)
                                   ◀── orphans (users left with              2. sessions (+ domains) storage.local
                                       no live site)                         │ storage.onChanged
                                                                             ▼
                                                                  syncRules (boundary R13);
                                                                  onAuthRequired reads on each challenge
```

### `links.js` public contract
All functions are pure: no `chrome.*`, no DOM, no `fetch`. Input objects are never mutated. Sites
are compared after `normalizeDomain`. `state` = `{ sessions, domains, activeByDomain }`.

| Function | Returns | Rules |
|----------|---------|-------|
| `linkUsers(state, userIds, sites)` | `{ sessions, notApplied }` | adds each configured site in `sites` to each user in `userIds`, once; unknown ids and non-configured sites are skipped (`notApplied` lists the sites); order of existing sites is kept, new ones appended in configured order (R1, R2, R3) |
| `unlinkUsers(state, userIds, sites, { deleteOrphans })` | `{ sessions, activeByDomain, orphans }` | removes `sites` from each user; `orphans` = ids of users whose live sites become empty; with `deleteOrphans: true` they are deleted, with `false` they stay unchanged while the others are unlinked; any site whose signed-in user lost it, or was deleted, is removed from `activeByDomain` (R4–R7) |
| `deleteUsers(state, userIds)` | `{ sessions, activeByDomain }` | removes the users and every `activeByDomain` entry that names them (R7, R12) |
| `addSiteWithUsers(state, site, userIds)` | `{ domains, sessions }` | normalizes `site`, appends it to `domains` if new, then `linkUsers` for it (R11) |

Import (R8–R10) composes existing functions in the Panel: `mergeBackup(state, payload)` first, then
`linkUsers` on its result with `[...addedIds, ...matchedIds]` and the picked sites. Extra sites are
offered from the merged `domains`, so `linkUsers` accepts them.

### `backup.js` change (additive)
`mergeBackup` also returns `addedIds` (ids of new records) and `matchedIds` (ids of existing users
that covered a skipped record, first match per record, no duplicates). `added` and `skipped` stay
numbers; existing callers are unaffected. Its existing signed-in-user rule for the file's sites is
unchanged; the extra sites are linked after it, so they never adopt a signed-in user (R3).

### Worker change (`background.js`)
One predicate, used in both paths: `serves(session, site, domains)` = `site ∈ domains` and
`site ∈ domainsOf(session)`.
- `onAuthRequired`: the user is the pinned user if the tab is pinned, else the signed-in user; answer
  only if `serves(...)`. No fallback from a pinned user to the signed-in user (ADR 0002).
- `syncRules`: pinned rules for `domainsOf(session) ∩ domains`; a site's active rule only if `serves(...)`.

### Decisions
| Decision | Rationale | Rejected alternatives |
|----------|-----------|-----------------------|
| Close all Worker boundary gaps this cycle (R13) | The normal panel cannot clear the private instance's `activeByDomain` (`storage.session`), so only a Worker check stops an unlinked password there; bulk unlink makes stale links common. Chosen by Mohammad Salameh 2026-11-23. | Close only the two recorded gaps (leaves the active-user path); defer (relies on Panel write order, which cannot reach the private instance) |
| Bulk link, new-site linking and import extra sites do not set a signed-in user (R3) | Chosen by Mohammad Salameh 2026-11-23: the tester picks who is signed in. Differs on purpose from the single add/edit form, which still adopts. | Adopt the first newly linked user, as add/edit/import do today |
| Bulk delete confirms and names every user (R12) | No undo (intent non-goal); same pattern as the last-site deletion. Chosen by Mohammad Salameh 2026-11-23 (intent Open question 1). | Count-only confirmation; no confirmation like the per-row delete |
| Import extra sites come from the merged site list (R8) | A file often brings a new sibling site the tester wants every imported user on. Chosen by Mohammad Salameh 2026-11-23. | Configured sites before the import only |
| "Left with no site" means no **live** site (R5) | A user with only stale sites appears in no list (intent success measure: such users are invisible). | Count stale sites as sites: leaves invisible users |
| Unlink offers configured sites only (R4) | Matches what the panel shows; stale sites already send nothing after R13. | Also list stale sites: shows sites the tester removed |
| Unlink computes orphans and applies in one function with a `deleteOrphans` flag | The Panel calls once to get `orphans` for the confirmation, then once with the answer; both calls are pure, so no half-applied state exists before the save. | Separate `planUnlink` / `applyUnlink`: two functions that must agree on the same rule |
| `mergeBackup` returns ids additively (R9) | Links must not re-implement the duplicate rule (`covered`); additive fields keep existing callers and tests valid. | Recompute duplicates in `links.js`: two copies of one rule |
| Confirmations are in-panel sub-forms, not `window.confirm` | Matches the design system's sub-form component and keeps keyboard focus inside the panel. | Native `confirm()`: unstyled, blocks the page |
| Per-row delete and edit form adopt the write order (R7) | Architecture §4 makes it a rule for every change that removes a right to a site; today both write `sessions` first. | Leave them: the rule would hold only for bulk actions |

## Non-functional requirements (production readiness)

| Domain | Decision / target for this feature |
|--------|-------------------------------------|
| Threat model (STRIDE) | **Boundary:** Panel → storage → Worker → protected site. **S:** no new caller; `onMessage` sender check unchanged; no new message types. **T:** an imported file is untrusted; sites go through `normalizeDomain` (existing) and extra sites must be in the merged list (R2/R8). **R:** no audit log by policy (no telemetry); accepted, single tester. **I:** main abuse case — password sent to a wrong or removed site: mitigated by R2 (configured only), R13 (Worker check on every answer and rule, both instances), R7 (fail-closed write order), R1 (save names sites and count). **D:** N/A — local actions, one tester. **E:** pinned tab borrowing a user on a site that user is not linked to: closed by R13. |
| Data & privacy | Data touched: stored users (name, username, password — **secret**), sites (internal). No new field, no new store, no data leaves the device. Deletion is final (no undo, intent non-goal); recovery is the tester's export. No `Session` shape change, so no `migrate()` step; backup format stays v1 (the `mergeBackup` change is return-value only). |
| Observability | No telemetry or logs (`PRIVACY.md`, architecture §5). After each bulk save the panel shows one status line with the count of users changed and deleted. SLOs: N/A — no SLI can be measured (architecture §7). |
| Performance budget | `links.js` functions finish in < 50 ms for 1,000 users × 20 sites in Node (test in `test/links.test.mjs`). One `sessions` write per save (R14). Core Web Vitals: N/A — local extension page, no network load. Storage: 1,000 users stay well under the 10 MB `storage.local` quota (checked in `/sdlc-test` by measuring the serialized size). |
| Accessibility & i18n | Target WCAG 2.2 AA for the new controls (web profile): every checkbox and site choice has a visible label; all five actions and both confirmations work by keyboard alone with visible focus; the confirmation moves focus to itself and back on close; status lines are announced (`role="status"`). Layout works down to 180px panel width (design system). i18n: N/A — the extension is English only (no `default_locale` in `manifest.json`). |
| Supply chain | No dependencies added; the repo stays dependency-free (no lockfile to pin). No new permissions (`test/wiring.test.mjs` exact-list check, architecture §7). |
| System design | Inherits `architecture.md`: Links pure (ADR 0003), Panel is the writer, write order §4, credential boundary §5 (ADR 0002). `infrastructure.md`: N/A — no hosting (intent Size reason). No deviation. |

## Constraints & dependencies
- Chrome ≥ 144, MV3, side panel; fluid width down to 180px.
- Stored shape stays `domains: string[]`; existing users and backup files keep working.
- Design system hard rules: no emoji, no gradients, tokens from `popup.css`, `hidden` attribute only.
- Designs are HTML mockups (ADR 0004).
- No new permissions.
- New module `links.js` must be added to `SHARED` in `test/background.test.mjs` only if the Worker
  imports it (it does not in this design).
- Tier-3 paths changed: `background.js`, `backup.js` (`.sdlc/config.yaml`), so `/sdlc-review` runs
  the tier-3 review.

## Policy concerns (flagged)
| Area | Concern | Owner | Resolution |
|------|---------|-------|------------|
| security | R13 changes pinned-tab behaviour: a pinned tab on a site its user is not linked to now gets Chrome's dialog | Mohammad Salameh | resolved: accepted in ADR 0002 and the 2026-11-23 decision to close the gaps |
| security | The normal panel cannot clear the private-window instance's signed-in users | Mohammad Salameh | resolved: R13 Worker check covers both instances |
| security | Tier-3 files change (`background.js`, `backup.js`) | Mohammad Salameh | carried to `/sdlc-review`: tier-3 review with two reviewers |
| compliance | No new data, no data leaves the device; `PRIVACY.md` unchanged | Mohammad Salameh | resolved: no change needed; re-confirmed in `security-gate.md` at release |
| brand / UX | Deletions are final; confirmation must name every user (R5, R12) | Mohammad Salameh | resolved by R5 and R12; copy reviewed at `/sdlc-ux` |
| brand / UX | Accessibility target WCAG 2.2 AA is new for this repo (design system says "unknown") | Mohammad Salameh | open: approve with this spec, then record it in the design-system skill |

## Success criteria
- R1–R14 each have at least one passing test named with the R-ID (`sdlc-check.cjs trace`).
- Intent measure "actions to link or unlink N users": 1 save for any N ≥ 1 (R14).
- Intent measure "users accidentally left with no site": 0 after every bulk action (R5, R6, tests
  over the stored state).
- Credential boundary fitness function (architecture §7) passes, including the new pinned-tab and
  active-user cases (R13).
- Wiring boundary rules for `links.js` pass (architecture §3).
- `npm test` green.

## Open questions (resolved / carried forward)
1. *(intent 1)* Does bulk delete confirm? — **Resolved:** yes, naming every user (R12).
2. *(intent 2)* Project type: no profile fits a browser extension; `web` applied. — **Carried
   forward** (owner Mohammad Salameh): store review and update concerns get no profile checklist;
   `/sdlc-review` uses `deploy-profile.md`.
3. *(intent 3)* Largest real number of users and sites per install. — **Carried forward to
   `/sdlc-ux`** (owner Mohammad Salameh): sizes the selection list; the performance budget assumes 1,000 users.
4. *(architecture §8)* Close the pinned-tab and `syncRules` gaps this cycle? — **Resolved:** yes,
   plus the active-user check (R13).
5. *(architecture §8)* `storage.onChanged` delivery to a sleeping worker. — **Carried to `/sdlc-test`**
   (owner Mohammad Salameh): bulk unlink while a pinned tab is open.
