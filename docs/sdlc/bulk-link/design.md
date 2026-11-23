# Design: Bulk-link users to sites

<!-- Stage 2b (UX). HTML mockup instead of Figma (ADR 0004). Commit before /sdlc-plan. -->

- **From:** `spec.md` @ c754a93
- **Figma file:** none — HTML mockup `design/mockup.html` loading the shipped `popup.css` (ADR 0004)
- **Status:** draft
- **Approved by:**

Mockup: serve the repo root over HTTP and open `docs/sdlc/bulk-link/design/mockup.html`. Each frame
is 320px wide (Chrome's side panel minimum) except `manage-narrow` (180px, page zoom). CSS the
mockup adds is marked "Proposed additions to popup.css" and uses tokens only.

## Screens

### Users *(traces to: R1, R4, R12)*
- **Pattern:** Row list
- **Figma:** n/a — `design/mockup.html#users-nav`
- **Export:** `design/users-nav.png`
- **States:** default (unchanged except the nav)
- **Copy:** nav icon accessible name and tooltip "Manage users".
- **Behavior the picture doesn't show:** a new nav icon (inline SVG line icon, two people) sits
  before Settings and opens Manage users. Hidden while Settings or Manage users is open (each page
  shows Back instead, as Settings does today).

### Manage users *(traces to: R1, R4, R12, R14)*
- **Pattern:** Selectable row list
- **Figma:** n/a — `design/mockup.html#manage-none`, `#manage-link`, `#manage-result`, `#manage-empty`, `#manage-narrow`
- **Export:** `design/manage-none.png` (also `manage-link.png`, `manage-result.png`, `manage-empty.png`, `manage-narrow.png`)
- **States:** default with none selected (actions disabled); some selected; no results (search);
  empty (no user with a live site); success (status line after a save); narrow 180px.
- **Copy:**
  - Nav title "Manage users"; Back button "Back"; close "Close panel".
  - Select-all label "Select all"; "Select all shown" while a search filters the list.
  - Count "N of M selected".
  - Actions "Link to sites", "Unlink from sites", "Delete users".
  - Hint with none selected: "Select users to link, unlink or delete them together."
  - No results: `No users match "{query}".`
  - Empty: "No users yet. Add one from the Users page, or import a backup in Settings."
  - Success lines (one `role="status"` line, built from the parts that apply):
    "Linked N users to {site}." / "Linked N users to K sites." / "Unlinked N users from {site}." /
    "Unlinked N users from K sites." / "Deleted N users." / "No user was changed."
    Singular "1 user", "1 site".
- **Behavior the picture doesn't show:**
  - Lists every user with at least one live site (spec Terms), in stored order. Users with only stale sites are not listed.
  - Each row: checkbox, colour dot, name, username, live sites ("first +N"; full list in the row's tooltip). The whole row toggles the checkbox; rows never switch users here.
  - Search appears at 5 or more users (same threshold as the Users page) and filters by name or username. Select all acts on the shown rows only; hidden selected rows stay selected and count in "N of M".
  - Action buttons are disabled with 0 selected. Choosing one opens Choose sites or Confirm deletion below the list and moves focus to it.
  - After a save, the selection clears and the status line shows; it clears on the next action.

### Choose sites *(traces to: R1, R2, R4, R14)*
- **Pattern:** Sub-form
- **Figma:** n/a — `design/mockup.html#manage-link`, `#manage-unlink-empty`
- **Export:** `design/manage-link.png` (also `manage-unlink-empty.png`)
- **States:** link with sites chosen; unlink with no site chosen (save disabled).
- **Copy:**
  - Heading "Link N users to" / "Unlink N users from".
  - Save button "Link N users to K sites" / "Unlink N users from K sites" (singular "1 user", "1 site"); with no site chosen it is disabled and reads "Pick at least one site".
  - Cancel "Cancel".
- **Behavior the picture doesn't show:**
  - Lists configured sites only, in configured order, none ticked at open (R2, R4).
  - Link save writes once (R14). Unlink save first checks for users left with no live site: none → saves; some → Confirm deletion replaces this form (R5).
  - Escape or Cancel closes the form and returns focus to the action button that opened it.

### Confirm deletion *(traces to: R5, R6, R7, R12)*
- **Pattern:** Sub-form
- **Figma:** n/a — `design/mockup.html#confirm-last-site`, `#confirm-delete`
- **Export:** `design/confirm-last-site.png` (also `confirm-delete.png`)
- **States:** last-site deletion during unlink; bulk delete.
- **Copy:**
  - Last-site title: "N users would have no site left". Body: "Unlinking {site} removes their last site. Deleted users cannot be restored, except from an export." (for several sites: "Unlinking these sites removes their last site. …")
  - Last-site buttons: "Delete N users" · "Keep them" (primary) · "Cancel".
  - Note under it: "Keep them: {others} is still unlinked from {site}; {names} stay as they are." When every selected user would be deleted, the note is "Keep them: no user is changed."
  - Bulk delete title: "Delete N users?" Body: "They are removed from every site. This cannot be undone, except from an export." Buttons: "Delete N users" · "Cancel" (primary).
  - Names list: every affected user, name and username, no truncation of the count.
- **Behavior the picture doesn't show:**
  - The destructive button is never the primary one; the safe choice is primary and gets focus when the confirmation opens.
  - Delete applies R5/R12; Keep them applies R6; Cancel returns to Choose sites (last-site) or the list (bulk delete) with nothing saved.
  - `role="alertdialog"` labelled by the title; it is in the page flow, not a modal over the page.

### Import *(traces to: R8, R9, R10)*
- **Pattern:** Sub-form
- **Figma:** n/a — `design/mockup.html#import-locked`, `#import-sites`, `#import-done`
- **Export:** `design/import-sites.png` (also `import-locked.png`, `import-done.png`)
- **States:** encrypted file needs passphrase; file open with extra-site choice (plain or after passphrase); no extra site picked; success; error (existing messages unchanged).
- **Copy:**
  - Passphrase step: field label "Passphrase for this file"; buttons "Open file" (was "Import") · "Cancel"; hint "This backup is encrypted."
  - Site step: heading "N users in this file. Also link them to"; new sites from the file carry a "new" badge; buttons "Import N users" · "Cancel"; hint "Optional. Users already here that match the file get these sites too."
  - Success: "Imported N users, skipped K already here. Linked all M to {site}." — the "Linked…" sentence only when extra sites were picked; existing "Imported N users." forms are kept otherwise.
- **Behavior the picture doesn't show:**
  - Picking a file no longer imports at once: plain files go straight to the site step; encrypted files go to the passphrase step first, then the site step (the file's sites are unknown until it is decrypted).
  - Site list = configured sites plus the sites this file adds (R8), none ticked.
  - "Linked all M" counts imported plus matched existing users (R9).

### Settings *(traces to: R3, R11)*
- **Pattern:** Chip list
- **Figma:** n/a — `design/mockup.html#add-site`
- **Export:** `design/add-site.png`
- **States:** new site with users chosen; none chosen; no stored users (form skipped, site added at once as today).
- **Copy:**
  - Heading "Who can sign in to {site}?"
  - Save "Add site, link N users" (singular "1 user"); with none chosen "Add site". Cancel "Cancel".
  - Hint "Nobody is signed in to the new site until you pick a user."
- **Behavior the picture doesn't show:**
  - All three ways to add a site (Enter in the field, "This site", the detected-site "Add") open this form when at least one user exists. The site is not saved until "Add site…" (R11, R14: one write of `domains` and `sessions`).
  - Lists every stored user (name, username), none ticked.
  - Cancel keeps the typed site in the field.

## User flow
Spans several screens; drawn as text here (no FigJam, ADR 0004):

```
Users ──nav icon──▶ Manage users ──select──▶ Link to sites ──▶ Choose sites ──save──▶ status line
                                   │                 Unlink ──▶ Choose sites ──save──┬─ no orphans ─▶ status line
                                   │                                                 └─ orphans ──▶ Confirm deletion ─▶ Delete | Keep them ─▶ status line
                                   │                                                                               └─ Cancel ─▶ Choose sites
                                   └──────────▶ Delete users ──▶ Confirm deletion ──▶ Delete ─▶ status line | Cancel ─▶ list
Settings ─ Import… ─▶ [encrypted: passphrase ─ Open file] ─▶ extra sites ─ Import N users ─▶ status
Settings ─ add site ─▶ [users exist: Who can sign in? ─ Add site…] ─▶ chip added
```

## Design system usage
- **Components used:** nav tabs (`.tabs`, `.nav-title`, `.icon-btn`), row (`.rows`, `.dot`, `.row-meta`, `.row-name`, `.row-user`), checkbox list (`.choice-list`, `.choice-item`, `.choice-row`, `.choice-box`, `.choice-name`), button (`.btn`, `.btn-primary`), box and sub-form (`.box`, `.sub-form`, `.form-actions`), message (`.msg`, `.msg-warn`), badge (`.badge`), search (`.user-search`), chip list (`.chips`, `.chip`).
- **Tokens / variables used:** `--bg`, `--surface`, `--surface-hi`, `--border`, `--text`, `--muted`, `--accent`, `--mono`. No raw hex in the proposed CSS (grep of the mockup's proposed block). User dots use the existing `PALETTE` in `popup.js`.
- **Proposed popup.css changes:** `.btn-primary` text `var(--bg)`; `.choice-row` padding 6px; `.btn:disabled`; `.pick-head`, `.pick-count`, `.pick-row` (grid), `.pick-sites`, `.bulk-actions`, `.choice-list.open-list`, `.choice-user`, `.confirm-list`, `.form-actions.wrap`, `.nav-icon`.
- **Inventory:** rows added — Manage users, Choose sites, Confirm deletion; rows changed — Users, Settings, Import. Pattern added — Selectable row list (stable).

## New components and patterns
| Component or pattern | Consumers (apps/teams) | Nearest existing | Why it does not fit | Status | Decided by |
|---|---|---|---|---|---|
| Selectable row list | Side panel: Manage users (this cycle); any later bulk action on users | Row list (`buildRow()`) | its rows are switch buttons with icon actions; selecting would collide with switching, and it lists one site only | stable | Mohammad Salameh (2026-11-23) |

## Accessibility
Target: WCAG 2.2 AA (spec NFR). Measured on the rendered mockup in Chromium (Playwright), computed
colours and bounding boxes.

| Check | Screen | Measured | Target | Pass |
|-------|--------|----------|--------|------|
| text contrast: name `--text` on `--surface` | Manage users | 12.04:1 | 4.5:1 | yes |
| text contrast: username, sites, hints `--muted` on `--surface` | Manage users, Confirm deletion, Settings | 5.65:1 | 4.5:1 | yes |
| text contrast: count `--muted` on `--bg` | Manage users | 6.15:1 | 4.5:1 | yes |
| text contrast: site names `--text` on `--bg` | Choose sites | 13.11:1 | 4.5:1 | yes |
| text contrast: primary button, before | all | 2.75:1 (white on `--accent`) | 4.5:1 | no — fixed below |
| text contrast: primary button, after (`--bg` on `--accent`) | all | 6.05:1 (hover 6.73:1) | 4.5:1 | yes |
| target size: checkbox rows in lists, before | Choose sites, Import, Settings | 23px tall, touching | 24×24 CSS px (2.5.8) | no — fixed below |
| target size: checkbox rows in lists, after | Choose sites, Import, Settings | 28px tall (45px with username) | 24×24 CSS px | yes |
| target size: Select all | Manage users | 25px tall | 24×24 CSS px | yes |
| target size: user rows | Manage users | 298×63 | 24×24 CSS px | yes |
| target size: buttons | all | 31px tall | 24×24 CSS px | yes |
| target size: nav icon | Users | 28×34 | 24×24 CSS px | yes |
| target size: chip remove (existing, unchanged) | Settings | 13px tall | 24×24 CSS px or spacing exception | not measured: spacing exception not checked |
| horizontal overflow | all 13 frames | none (script: no element outside its frame) | none at 320px and 180px | yes |
| keyboard path | Manage users → Choose sites → Confirm deletion | designed: native checkboxes and buttons in DOM order; focus moves to an opened form and back on close; safe button focused in confirmations | operable by keyboard, visible focus | verify at `/sdlc-test` |

## Design review
| Check | Finding | Screen | Resolution |
|-------|---------|--------|------------|
| States complete (every screen × applicable state) | none — loading N/A (local storage, no wait); no-permission N/A (single tester) | all | — |
| Usability heuristics (Nielsen's 10) | H5 error prevention: destructive actions confirm and name every user; safe choice is primary | Confirm deletion | designed in |
| Usability heuristics (Nielsen's 10) | H1 visibility: a bulk save gave no feedback in the first draft | Manage users | resolved: `role="status"` result line |
| Usability heuristics (Nielsen's 10) | H3 user control: no undo after save (intent non-goal) | Confirm deletion | accepted in intent; copy points to export |
| Usability heuristics (Nielsen's 10) | H4 consistency: bulk link does not set a signed-in user, unlike the single add/edit form | Settings, Manage users | resolved: hint "Nobody is signed in to the new site until you pick a user." (spec R3 decision) |
| Copy (clear, consistent, error text says how to recover) | First draft used "1 of 5" at 180px and "N of M selected" at 320px | Manage users | resolved: "N of M selected" at every width |
| Copy (clear, consistent, error text says how to recover) | Import button renamed "Open file" on the passphrase step, because importing now happens one step later | Import | designed in |
| Platform guideline (project-types profile) | web profile: breakpoints — panel is 320px minimum, 180px under zoom; both rendered without overflow. CWV N/A (spec) | all | — |
| Platform guideline (project-types profile) | product UI rule "body text 16px" conflicts with the design system's 13px base | all | design system overrides product UI rules (stated in the rules file); kept 13px |
| Platform guideline (project-types profile) | product UI rule "destructive actions use the danger style": no danger token exists | Confirm deletion | `.msg-warn` frame + destructive button never primary; no new colour invented |
| Token drift (`sdlc-ui-tokens.cjs` output, per mode) | not run: no Figma variables (ADR 0004); the mockup loads `popup.css` itself, so its tokens cannot drift. Proposed CSS: no raw hex (grep) | all | — |
| Contrast | primary button 2.75:1 (pre-existing) | all | resolved: `--bg` text on `--accent`, 6.05:1 — chosen by Mohammad Salameh 2026-11-23 |
| Target size | checkbox rows 23px (pre-existing) | Choose sites, Import, Settings, add/edit picker | resolved: `.choice-row` padding 6px everywhere — chosen by Mohammad Salameh 2026-11-23 |
| Target size | chip remove button 13px tall (pre-existing, not touched by this cycle) | Settings | open: carried to `/sdlc-test` to check the spacing exception; owner Mohammad Salameh |

## Risks
- No Figma source (ADR 0004): the mockup is the reference; `/sdlc-test` compares screenshots of the built panel with these PNGs.
- The primary-button and checkbox-row fixes change existing screens (every primary button, the add/edit site picker). `/sdlc-test` re-shoots those screens.

## Open design questions
1. Chip remove target size (13px) — does it meet the 2.5.8 spacing exception? — owner: Mohammad Salameh ; blocks build: no
