# UX inventory - Auth Switcher

<!-- One row per screen. /sdlc-ux greps it before drawing and adds or updates rows in the same
     commit as design.md. Seeded by /sdlc-init from popup.html (one page, sections shown and hidden). -->

## Screens
| App | Screen | Pattern | States | Design | Status |
|-----|--------|---------|--------|--------|--------|
| Side panel | Users | Row list | default, empty (no domain), empty (no users) | `docs/sdlc/bulk-link/design.md` (nav icon added) | planned |
| Side panel | Add / edit user | Inline form | add, edit, error | none (pre-SDLC) | live |
| Side panel | Settings | Chip list | default, empty, detected-domain suggestion, add site with users | `docs/sdlc/bulk-link/design.md` | planned |
| Side panel | Export | Sub-form | default, success, error | none (pre-SDLC) | live |
| Side panel | Import | Sub-form | passphrase needed, extra sites, success, error | `docs/sdlc/bulk-link/design.md` | planned |
| Side panel | Manage users | Selectable row list | none selected, some selected, no results, empty, success, narrow | `docs/sdlc/bulk-link/design.md` | planned |
| Side panel | Choose sites | Sub-form | link, unlink, no site chosen | `docs/sdlc/bulk-link/design.md` | planned |
| Side panel | Confirm deletion | Sub-form | last-site deletion, bulk delete | `docs/sdlc/bulk-link/design.md` | planned |

## Patterns
| Pattern | Entry | Status |
|---------|-------|--------|
| Row list | none yet (`popup.js` `buildRow()`) | stable |
| Inline form | none yet (`#add-form`) | stable |
| Chip list | none yet (`popup.js` `renderDomains()`) | stable |
| Sub-form | none yet (`#export-form`, `#import-form`) | stable |
| Checkbox dropdown | none yet (`#domain-choice`) | stable |
| Selectable row list | none yet (`docs/sdlc/bulk-link/design.md`, Manage users) | stable |
