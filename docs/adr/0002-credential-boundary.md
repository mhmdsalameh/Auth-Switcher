# 0002 — A password goes only to a site that is configured and linked to that user

- **Status:** accepted
- **Date:** 2026-11-23   **Deciders:** Mohammad Salameh   **Relates to:** `architecture.md` §5 @ draft (cycle bulk-link)

## Context
A stored user lists its sites in `domains: string[]`. That list can hold sites the tester has since
removed from the configured `domains` list (CLAUDE.md gotcha). Cycle bulk-link lets a tester link and
unlink many users at once, so a stale or wrong link affects many passwords in one action. Today:

- the active-user path in `onAuthRequired` matches the host to a configured site, then answers with
  `activeByDomain[site]`;
- the pinned-tab path answers with `tabAssignments[tabId]` for any configured site, without checking
  that the site is in that user's own list;
- `syncRules` builds pinned-tab header rules from the user's own list without intersecting the
  configured list.

## Decision
We will treat "site ∈ configured `domains` ∩ `domainsOf(user)`" as the one rule for sending a
password, and check it in the Worker every time it answers a challenge or builds a header rule —
for the active user and for a tab-pinned user. The Panel offers only configured sites for linking.
A change that removes a user from a site clears that site's signed-in user before it saves the
user list, so a failure in between fails closed.

When the two existing gaps are closed (this cycle or a later one) is decided in `spec.md`.

## Consequences
- Easier: one rule to test; the Panel no longer has to be trusted to keep storage consistent.
- Harder: a pinned tab that follows a link to a site its user is not linked to gets no credentials
  and Chrome's dialog appears — a visible behaviour change for pinned tabs.
- Reversing it means trusting stored links as-is, which re-opens the stale-site leak.

## Alternatives considered
| Alternative | Why rejected |
|-------------|--------------|
| Enforce only in the Panel (clean links on every save) | storage written by an older version, an import, or a second panel can still hold stale links; the Worker would send them |
| Prune stale sites from users in `migrate()` | loses links the tester may re-add the site for; still leaves the pinned-tab path unchecked |
