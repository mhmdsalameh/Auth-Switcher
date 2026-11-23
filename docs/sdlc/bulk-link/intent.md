# Intent: Bulk-link users to sites

- **Author / role:** Claude (SDLC orchestrator), with Mohammad Salameh
- **Date:** 2026-11-23
- **Status:** approved
- **Product owner:** Mohammad Salameh
- **Size:** new-system
- **Size reason:** the change decides which sites receive each stored password, and one path deletes users — the "always new-system" rule (sensitive data). No new subsystem; no architecture or infrastructure stage.
- **Project type(s):** web — closest profile for a Chrome extension; no profile fits exactly (see Open questions 2)
- **Program:** none

## Problem
A tester who wants several stored users to work on a site has to open each user's edit form, tick
the site, and save — once per user. Removing a site from several users is the same, one user at a
time. Imported users arrive only with the sites listed in the file, so each one then needs the same
per-user edit. Adding a new site leaves every existing user unlinked from it until each is edited.
Deleting several users takes one click per user. With tens of users and several sibling sites, this
is slow and easy to get wrong.

## Desired outcome
- **O1:** A tester links any number of users to one or more configured sites in one action.
- **O2:** A tester unlinks any number of users from one or more sites in one action. Users left with no site are deleted, after the tester confirms.
- **O3:** When importing a backup, the tester picks extra sites, and every imported user is linked to them in addition to the sites in the file.
- **O4:** When adding a new site, the tester picks which existing users it applies to, in the same action.
- **O5:** A tester deletes any number of users in one action.

## Success measures
- **Actions to link or unlink N users** — baseline: N form edits (one open-tick-save per user) ; target: 1 save for any N ≥ 1 ; measured by: counting user actions in the acceptance test for each of O1–O5
- **Users accidentally left with no site** — baseline: unknown (a user with no site is invisible in the panel) ; target: 0 — every bulk unlink either keeps a site on the user or deletes it after confirmation ; measured by: test over stored state after each bulk operation

## Affected users and systems
QA testers who keep several logins for HTTP-auth protected internal sites (for example K2). Main
tasks: give a set of test accounts access to a new or sibling site; take a site away from a set of
accounts; restore accounts from a backup onto the sites in use now; clear out accounts that are no
longer needed.

Systems: the side panel (`popup.html`/`popup.js`), stored users and sites (`chrome.storage.local`),
the service worker that answers credential challenges and builds request rules (`background.js`),
and export/import (`backup.js`).

| Stakeholder | Interest | Influence (decides / consulted / informed) | Contact |
|-------------|----------|--------------------------------------------|---------|
| Mohammad Salameh | product owner, maintainer | decides | GitHub `mhmdsalameh` |
| QA testers (consumer installs from the Chrome Web Store) | faster setup, no lost accounts | informed | store listing, GitHub issues |

## Example map
| Rule | Examples (input → expected result) | Questions |
|------|------------------------------------|-----------|
| Bulk link adds sites, never removes | Users A (site x), B (sites x, y); link A, B to y → A: x, y; B: x, y (unchanged) | — |
| Bulk link only offers configured sites | Configured x, y; link A to z → not possible | — |
| Bulk unlink removes only the chosen sites | A (x, y), B (x, y); unlink A, B from y → A: x; B: x | — |
| Bulk unlink deletes users left with no site, after confirmation | A (x), B (x, y); unlink A, B from x → tester confirms deletion of A → A deleted; B: y | — |
| Declining the deletion skips only those users | A (x), B (x, y); unlink A, B from x → tester declines → A unchanged (x); B: y | — |
| Unlink or delete leaves the site with no signed-in user | A is the signed-in user on x, B also linked to x; unlink A from x → x has no signed-in user until the tester picks one | — |
| Import adds chosen sites to the file's sites | File: C (x); tester picks y at import → C: x, y | — |
| Import adds chosen sites to skipped duplicates too | Existing E (x); file has E (x) again; tester picks y → E is skipped as a duplicate, E: x, y | — |
| Import never links to a site the tester did not pick or the file did not list | File: C (x); tester picks nothing → C: x | — |
| Adding a site can link existing users at once | Users A, B, D; add site z, pick A, B → A, B gain z; D unchanged | — |
| Bulk delete removes every chosen user | Delete A, B → both gone; none of their sites keeps them as signed-in user | Confirmation needed? Open question 1 |

## Captured requirements
- **C1** [Must] Link several users to one or more configured sites in one action. — source: conversation 2026-11-23
- **C2** [Must] Unlink several users from one or more sites in one action. — source: conversation 2026-11-23
- **C3** [Must] A bulk unlink that leaves a user with no site deletes that user, after the tester confirms. — source: conversation 2026-11-23
- **C4** [Must] At import, the tester can choose sites; every imported user gets them in addition to the sites in the file. — source: conversation 2026-11-23
- **C5** [Should] When adding a new site, the tester can choose which existing users it applies to. — source: conversation 2026-11-23
- **C6** [Should] Delete several users in one action. — source: conversation 2026-11-23
- **C7** [Must] Linking or unlinking any number of users takes one save. — source: conversation 2026-11-23
- **C8** [Must] Bulk link offers only configured sites. — source: conversation 2026-11-23
- **C9** [Must] If the tester declines the last-site deletion, the unlink still applies to the other users; the users who would lose their last site stay unchanged. — source: conversation 2026-11-23
- **C10** [Must] A site whose signed-in user is unlinked or deleted has no signed-in user until the tester picks one. — source: conversation 2026-11-23
- **C11** [Must] Sites chosen at import are also added to existing users the import skips as duplicates. — source: conversation 2026-11-23

## Why now
The maintainer hit this while setting up users across sibling sites: multi-site users (shipped
2026-09-01) made per-user linking common, and the per-user edit form is the only way to do it.

## Constraints
- Chrome ≥ 144, Manifest V3, side panel UI; panel width is fluid down to 180px under zoom (Chrome's own floor is 320dip).
- Stored user shape stays `domains: string[]`; existing users and existing backup files keep working.
- Hard visual rules from `.claude/skills/design-system/SKILL.md`: no emoji, no gradients, tokens from `popup.css`.
- Designs are HTML mockups, not Figma (maintainer's decision).
- No new extension permissions.

## Assumptions and risks
- Testers keep tens of users at most, so one list with checkboxes stays usable. — owner: Mohammad Salameh ; verify: ask the maintainer for the largest real count before design
- Risk: a tester bulk-links a user to the wrong site, and the user's password is then sent to that site. — owner: Mohammad Salameh ; mitigate: only configured sites can be chosen; the action names the sites and the user count before it saves
- Risk: a bulk unlink deletes users the tester wanted to keep. Undo is a non-goal, so a deletion is final. — owner: Mohammad Salameh ; mitigate: the confirmation names every user to be deleted; tester can export a backup first
- Risk (pre-mortem): the signed-in user on a site is unlinked or deleted, and the site keeps sending the old credentials. — owner: Mohammad Salameh ; mitigate: spec states what the signed-in user becomes; tests cover it
- Risk (known, open): pinned-tab request rules read each user's own sites without checking the configured list (STATE.md, Open failures). Bulk link makes such stale sites more common. — owner: Mohammad Salameh ; mitigate: decide in spec whether this cycle fixes it

## Non-goals
- Undo of a bulk link, unlink or deletion after it is saved.
- Bulk editing of other user fields (name, colour, username, password).

## Open questions
1. Does bulk delete (C6) ask for confirmation, given the existing per-row delete does not? — owner: Mohammad Salameh ; blocks next stage: no
2. Project type: no profile covers a browser extension; `web` is recorded. Store distribution and update concerns get no profile checklist. — owner: Mohammad Salameh ; blocks next stage: no
3. Largest real number of users and sites per install (sizes the list design). — owner: Mohammad Salameh ; blocks next stage: no

## Sources
- Conversation with Mohammad Salameh, 2026-11-23 (scope, priorities, import rule, last-site rule, decline rule, signed-in rule, duplicate rule, configured-sites rule, non-goals, project type, consumer installs).
- Code read: `popup.js` (per-user edit form, per-row delete without confirmation), `backup.js` (`mergeBackup`, `toPayload`), `STATE.md`.

## Revision history
- 2026-11-23 — first draft. Size raised from bounded to new-system: credentials and user deletion.
