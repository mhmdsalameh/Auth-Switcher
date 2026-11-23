# Security gate - Auth Switcher

<!-- A hard pre-ship checklist. Every item must be GREEN (or explicitly risk-accepted in writing)
before a Chrome Web Store release. In the Deploy stage, do NOT issue the release authorization
(SDLC_RELEASE_AUTH) until this gate passes. Re-run it every release. Items that do not apply to a
browser extension with no server are marked N/A with the reason. -->

- **Reviewed by:**   **Date:**   **Release:**
- **Verdict:** pass | pass-with-accepted-risks | blocked

## OWASP Top 10 (2021), as it applies to an extension
- [ ] **A01 Broken access control** - credentials are sent only to configured domains (challenge-response and pre-emptive rules); a removed domain receives nothing.
- [ ] **A02 Cryptographic failures** - encrypted exports use PBKDF2 + AES-GCM (`backup.js`); unencrypted exports are labelled as clear text; no passwords in source.
- [ ] **A03 Injection** - no `innerHTML` with stored or imported values; imported domains go through `normalizeDomain()`.
- [ ] **A04 Insecure design** - abuse cases for imported files and look-alike domains considered.
- [ ] **A05 Security misconfiguration** - manifest permissions are the minimum needed; no debug logging of credentials.
- [ ] **A06 Vulnerable / outdated components** - N/A while the extension has no dependencies.
- [ ] **A07 Auth failures** - N/A (the extension holds third-party credentials; it has no login of its own).
- [ ] **A08 Software / data integrity** - the store zip is built by `npm run package` from a clean tagged tree.
- [ ] **A09 Logging & monitoring failures** - no secrets or passwords in console output.
- [ ] **A10 SSRF** - N/A (no server).

## Data & privacy
- [ ] Stored data matches `PRIVACY.md`; nothing leaves the browser except to configured domains.
- [ ] Deletion path exists (remove user, remove extension).

## Release readiness
- [ ] Release record: version, changelog, rollout (store staged rollout or not), stored-shape migration and how it behaves on downgrade.
- [ ] `runbook.md` covers this release (rollback = previous zip; new failure modes); untested steps listed.

## Supply chain
- [ ] No runtime dependencies added; any added are pinned and reviewed.

## Non-functional gates (from spec NFR block)
- [ ] Accessibility target met — keyboard-only pass of every changed panel.

## Automated checks (run and paste output)
- [ ] **Secret scan:** gitleaks (CI `Secret scan`) - zero findings.
- [ ] Tests green (`npm test`).

## Sign-off
Blocking findings must be fixed (back through Build). Accepted risks are listed here with the
maintainer's written acknowledgement before ship.
