---
name: design-system
description: Auth Switcher's design system — hard visual rules, tokens, components, and where the Figma source lives. Load for any UI work in this repo: designing screens in /sdlc-ux, building UI in /sdlc-plan, and visual checks in /sdlc-test.
---

# Design system — Auth Switcher

## Sources of truth
- **Figma file:** none, by the maintainer's decision. Designs are HTML mockups that use the
  real `popup.css` tokens, committed under each cycle's `docs/sdlc/<slug>/design/`.
- **Code tokens:** `popup.css` `:root` custom properties
- **Component library in code:** none; components are CSS classes in `popup.css` and DOM built in `popup.js`
- **When Figma and code disagree:** code wins (it is the only source today)

## Hard rules
- No emojis in UI, copy, or icons — use text labels or inline SVG line icons. Windows paints emoji through Segoe UI Emoji in its own colours, which ignores the muted `.icon-btn` treatment (see the password-reveal eye in `popup.js` `addReveal()`).
- No gradients — flat, solid fills only.
- Use a token, never a raw hex value, whenever a token exists.
- Show and hide with the `hidden` attribute only; `popup.css` enforces `[hidden] { display: none !important; }`.
- Every flex row that holds text carries `min-width: 0`; the panel is fluid down to 180px under zoom.

## Tokens
- **Tiers:** one tier only — role tokens in `:root`. No reference or component tier.
- **Modes / themes:** dark only.
- **File format:** CSS custom properties, `popup.css`
- **Color:** `--bg` #1e1e1e, `--surface` #252526, `--surface-hi` #2d2d2e, `--border` #3c3c3c, `--text` #e4e4e4, `--muted` #9d9d9d, `--accent` #4a9eff, `--user` (set per active user from JS)
- **Typography:** 13px/1.45 "Segoe UI", system-ui, sans-serif; labels and hints 11px; `--mono` Consolas, "Cascadia Mono", ui-monospace, monospace
- **Spacing:** no tokens; raw px in `popup.css` (content padding 10px, 7px under 300px width)
- **Radius / elevation:** no tokens; unknown as a system

## Components
| Component | Code path | Figma node | Status | Notes |
|-----------|-----------|------------|--------|-------|
| Domain tabs / select | `popup.css` `.tabs`, `.domain-select` | none | stable | follows the active tab |
| User row | `.row`, `.row-main`, `.row-actions` | none | stable | built in `popup.js` `buildRow()` |
| Button | `.btn`, `.btn-primary`, `.btn-wide`, `.icon-btn` | none | stable | |
| Chip list | `.chips`, `.chip`, `.chip-remove` | none | stable | configured domains in Settings |
| Checkbox dropdown | `.choice*` | none | stable | domain picker in the add/edit form |
| Sub-form | `.sub-form`, `.sub-head`, `.form-actions` | none | stable | export and import |
| Password reveal | `.pw`, `.pw-toggle` | none | stable | `addReveal()` |
| Message | `.msg`, `.msg-warn` | none | stable | |

## Known mismatches
- None recorded (no Figma source).

## Accessibility baseline
- **Target:** WCAG 2.2 AA for new and changed controls (approved with `docs/sdlc/bulk-link/spec.md`, 2026-11-23)
- **Minimum contrast / focus style / touch-target size used here:** unknown
