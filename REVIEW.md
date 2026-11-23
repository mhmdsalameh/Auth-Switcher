# Review policy — Auth Switcher

<!-- Stage 5 (Deploy). Defines the passes Claude runs on every PR. Findings inform; they do not auto-approve or auto-block. Tag each finding by pass and severity. -->

- **Human threshold:** Mohammad Salameh approves every PR to `main` (sole maintainer).
- **Excluded paths:** `store/raw/**`, `store/screenshots/**`, `icons/*.png` (generated art), and anything CI already enforces.

## Risk tiers
Review depth follows the change's blast radius. `/sdlc-review` takes the highest tier any changed
path matches, and raises it one tier for unresolved `TODO(agent):` markers, a departure from
`plan.md`, or tests not proven able to fail. The same paths are in `.sdlc/config.yaml`
`tier1_paths` / `tier3_paths`; `sdlc-check.cjs tier` computes the tier from them.

| Tier | Paths / kinds of change | Human review |
|------|-------------------------|--------------|
| 1 — low | copy, styles, docs, tests only, `docs/**`, `*.md`, `store/**`, `icons/**` | CI green + skim of the summary |
| 2 — standard | everything not in tier 1 or 3 (`popup.*`, `tools/**`) | maintainer reads the diff |
| 3 — high | where credentials are sent (`background.js`), password export/import and encryption (`backup.js`), stored shape and migrations (`storage.js`), permissions (`manifest.json`), CI | two independent AI reviewers + tie-break (`/sdlc-review` 2b), then the maintainer reads every line |

## Passes
Run each pass and tag every finding with its pass and severity.

### Bugs / logic
Correctness, edge cases, subtle regressions, race conditions (service-worker restarts, concurrent
storage writes).

### Tests
Every requirement and every edge case `spec.md` lists has a test that can fail. Report a missing test
only for a case the running system can reach — name the caller or input that produces it. Flag tests
that assert a mock, a constant, or an input no caller can send.

### Security
Credentials sent only to configured domains; no passwords in logs, exports without a passphrase
clearly flagged, input from imported files sanitized, no new permissions without a reason.

### Compliance
Matches `spec.md`, `plan.md`, and the Chrome Web Store program policies (permissions justified,
`PRIVACY.md` still true).

## Important vs. Nit
- **Important:** breaks behavior, leaks data, or breaches policy.
- **Nit:** style, naming.

## Nit policy
Cap nits at 5 per PR; summarize the rest as a count. Prefer Important findings over style.

## Feedback loop
When review flags the same mistake twice, add the correction to `CLAUDE.md` as part of that review.
