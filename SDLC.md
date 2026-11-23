# This repo follows the AI-Native SDLC

Six stages, each committing a versioned artifact. The commit chain is the audit trail.

```
(program.md) → intent.md → architecture.md + ADRs → infrastructure.md → spec.md → plan.md → code+tests → reviewed PR + runbook.md → deployment record → incident intent.md → (loops)
```

| Stage | Command | Artifact |
|-------|---------|----------|
| Program | `/sdlc-program` | `program.md` + `risk-register.md` (multi-system initiatives) |
| Plan | `/sdlc-intent` | `intent.md` (with project type) |
| Architecture | `/sdlc-arch` | `architecture.md` + ADRs (new system / changed boundary) |
| Infrastructure | `/sdlc-infra` | `infrastructure.md` (new system / changed load or hosting) |
| Design | `/sdlc-spec` | `spec.md` |
| Build | `/sdlc-plan` | `plan.md`, then code |
| Test | `/sdlc-test` | tests + evals |
| Deploy | `/sdlc-review` | reviewed PR (per `REVIEW.md`) + release record + `runbook.md` |
| Maintain | `/sdlc-maintain` | incident `intent.md` (per `bands.yaml`) |

- **Config:** `.sdlc/config.yaml`
- **Enforcement:** the SDLC guard hook (protected paths, production gate) + the CI gates in `ci-gates.md`
- **Full workflow:** run `/sdlc`
