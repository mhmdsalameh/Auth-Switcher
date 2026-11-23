# 0003 — Bulk link, unlink and delete live in a pure `links.js`; the Panel persists

- **Status:** proposed
- **Date:** 2026-11-23   **Deciders:** Mohammad Salameh   **Relates to:** `architecture.md` §3 @ draft; `docs/sdlc/bulk-link/intent.md`

## Context
Cycle bulk-link adds five state changes (intent O1–O5): link users to sites, unlink users from sites
(deleting users left with no site after confirmation), add sites to imported users and skipped
duplicates, link existing users to a new site, and delete many users. Each changes `sessions` and
`activeByDomain` together. Today the Panel writes both directly from four handlers; the Worker only
reads them (plus `migrate()`). `backup.js` already shows the pattern of a pure transform
(`mergeBackup`) that the Panel persists, and it is tested in Node.

## Decision
We will add a module `links.js` with pure functions: each takes the current `sessions`,
`activeByDomain` and configured `domains` and returns the next `sessions` and `activeByDomain`, plus
the users that would be left with no site so the Panel can ask for confirmation. It imports only
from `backup.js` (`domainsOf`, `normalizeDomain`). The Panel calls it and persists the result —
`activeByDomain` first, then `sessions` — in one save per action. The function names are fixed in
`spec.md`.

Chosen by Mohammad Salameh on 2026-11-23 over the two alternatives below.

## Consequences
- Easier: every rule in the intent's example map becomes a Node unit test with no Chrome stub.
- Harder: one more file in the `background.test.mjs` `SHARED` list if the Worker ever imports it,
  and one more module for the wiring boundary rules.
- Commits us to: the Panel remains the writer of configuration. Moving writes to the Worker later
  means moving the persist calls, not the logic.

## Alternatives considered
| Alternative | Why rejected |
|-------------|--------------|
| Functions inside `backup.js` | mixes link editing into the file-transfer module and widens a tier-3 file for non-backup changes |
| Worker owns the writes (new `bulkLink` / `bulkUnlink` / `bulkDelete` messages) | the Panel still writes `sessions` everywhere else, so ownership splits; adds three message contracts |
