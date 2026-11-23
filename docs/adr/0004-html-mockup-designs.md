# 0004 — UX designs are committed HTML mockups, not Figma

- **Status:** accepted
- **Date:** 2026-11-23   **Deciders:** Mohammad Salameh   **Relates to:** `docs/sdlc/bulk-link/intent.md` (Constraints)

## Context
The default `/sdlc-ux` flow designs screens in Figma and commits exported PNGs. This repo's UI is
one side panel built from `popup.html` and `popup.css`, with tokens defined in `popup.css` and hard
visual rules in `.claude/skills/design-system/SKILL.md`. The maintainer decided during the bulk-link
intent that designs here are HTML mockups.

## Decision
We will design new or changed panel screens as static HTML mockups that load the real `popup.css`
tokens, commit them under the cycle folder (`docs/sdlc/<slug>/design/`), and export PNGs of each
state from a browser for `design.md`. `docs/ux/inventory.md` rows link the mockup instead of a Figma
node.

## Consequences
- Easier: the mockup uses the shipped tokens and widths, so what is approved is close to what is built;
  no Figma file to keep in step.
- Harder: no canvas for exploring many options side by side; reviewers open a file or a PNG.
- Reversing it means rebuilding the design system's components in Figma.

## Alternatives considered
| Alternative | Why rejected |
|-------------|--------------|
| Figma (SDLC default) | maintainer's decision; a second source of truth for a one-page UI |
| Design directly in code, no mockup | skips the design gate before `/sdlc-plan` |
