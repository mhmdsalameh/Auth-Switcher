# UX inventory - Auth Switcher

<!-- One row per screen. /sdlc-ux greps it before drawing and adds or updates rows in the same
     commit as design.md. Seeded by /sdlc-init from popup.html (one page, sections shown and hidden). -->

## Screens
| App | Screen | Pattern | States | Design | Status |
|-----|--------|---------|--------|--------|--------|
| Side panel | Users | Row list | default, empty (no domain), empty (no users) | none (pre-SDLC) | live |
| Side panel | Add / edit user | Inline form | add, edit, error | none (pre-SDLC) | live |
| Side panel | Settings | Chip list | default, empty, detected-domain suggestion | none (pre-SDLC) | live |
| Side panel | Export | Sub-form | default, success, error | none (pre-SDLC) | live |
| Side panel | Import | Sub-form | default, passphrase needed, success, error | none (pre-SDLC) | live |

## Patterns
| Pattern | Entry | Status |
|---------|-------|--------|
| Row list | none yet (`popup.js` `buildRow()`) | stable |
| Inline form | none yet (`#add-form`) | stable |
| Chip list | none yet (`popup.js` `renderDomains()`) | stable |
| Sub-form | none yet (`#export-form`, `#import-form`) | stable |
| Checkbox dropdown | none yet (`#domain-choice`) | stable |
