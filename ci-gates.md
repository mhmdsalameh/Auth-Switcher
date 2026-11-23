# CI gates — Auth Switcher

<!-- The enforcement layer. Workflow: .github/workflows/ci-gates.yml -->

## Why this file exists

An instruction can be forgotten, a hook can be missing on someone's laptop, and a model's output
varies run to run. A required status check does not. **What must always hold, CI enforces; everything
else is guidance.**

## The gates

| Gate (check name) | Blocks merge | Threshold / rule | Owner |
|-------------------|--------------|------------------|-------|
| `Tests` | yes | `npm test` passes: syntax check of every entry file + all test scripts | Mohammad Salameh |
| `Secret scan` | yes | gitleaks: zero findings, history included | Mohammad Salameh |
| `Navigation docs` | yes | `.sdlc/bin/repo-docs-check.cjs` reports no errors | Mohammad Salameh |
| `Requirements have tests` | yes | every `R#` in each `docs/sdlc/*/spec.md` is referenced in `test/*.test.mjs` | Mohammad Salameh |
| Accessibility (UI) | on release | keyboard-only pass of every changed panel | Mohammad Salameh |

Not adopted, and why: lint and type check (none configured), coverage floor (the tests are plain
Node scripts with no coverage tool), dependency audit (no dependencies), module boundaries (flat
repo, no `architecture.md`), API contracts, migrations, performance and fault injection (no server).
Add a gate when the thing it checks exists.

## Branch protection (the part people forget)

The workflow only matters once the checks are **required**. The command below has not been run or
checked against the current GitHub API docs; verify the flags first.

```bash
gh api -X PUT repos/mhmdsalameh/Auth-Switcher/branches/main/protection \
  -F 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=Tests' \
  -f 'required_status_checks[contexts][]=Secret scan' \
  -f 'required_status_checks[contexts][]=Navigation docs' \
  -f 'required_status_checks[contexts][]=Requirements have tests' \
  -F 'enforce_admins=false' \
  -F 'required_pull_request_reviews=null' \
  -F 'restrictions=null'
```

Confirm afterwards with `gh api repos/mhmdsalameh/Auth-Switcher/branches/main/protection`.
`required_pull_request_reviews` is null because a sole maintainer cannot approve their own PR.

## Exceptions

An exception is a written, time-boxed decision, recorded in `security-gate.md` (risk) or an ADR
(design), naming who accepted it and when it is revisited. Disabling a gate to get a change through
is not an exception.
