# Architecture: Auth Switcher

<!-- Stage 2a. Written for cycle bulk-link (docs/sdlc/bulk-link/intent.md). The extension existed
     before the SDLC; this records it as built, plus the one module the cycle adds (links.js).
     Sections that assume servers (gateways, service SLOs, tenancy) are answered "n/a" with the
     reason rather than left out. -->

- **From intent:** `docs/sdlc/bulk-link/intent.md` @ 5ee7ecd   **Status:** draft
- **Architect / approver:** Mohammad Salameh (pending)   **Date:** 2026-11-23
- **Supersedes:** none (first architecture record; the code predates the SDLC)

## 1. Context (C4 level 1)
One user (a QA tester) works in one Chrome profile. The extension stores that tester's HTTP-auth
logins for internal sites and answers each site's auth challenge with the login the tester picked.
Nothing runs on a server of ours; no data leaves the browser except files the tester exports.

```
QA tester ──side panel──▶ Auth Switcher (Chrome extension, MV3) ──HTTP auth answer──▶ protected sites
                                 │  ▲
                   chrome.* APIs │  │ events (auth challenge, tab, storage)
                                 ▼  │
                           Chrome browser ◀── Chrome Web Store (install / update)
```

| External system | Direction | Protocol / contract | Owner | Availability & limits |
|-----------------|-----------|---------------------|-------|-----------------------|
| Protected sites (e.g. K2 environments) | out (credentials) / in (401 challenge) | HTTP auth: Basic, Digest, NTLM, Negotiate via `webRequest.onAuthRequired`; optional pre-emptive `Authorization: Basic` header via declarativeNetRequest | each site's operator (tester's organisation) | unknown — internal sites outside our control; the extension only answers challenges |
| Chrome browser (extension platform) | both | Manifest V3 APIs: `storage`, `webRequest` + `webRequestAuthProvider`, `declarativeNetRequest`, `cookies`, `browsingData`, `tabs`, `sidePanel`; minimum Chrome 144 | Google | in-process; `storage.local` and `storage.session` quota 10 MB each; 5000 session DNR rules (developer.chrome.com, read 2026-11-23) |
| Chrome Web Store | out (package upload) / in (updates to installs) | store dashboard upload of the zip from `npm run package` | Google; listing owned by Mohammad Salameh | review time unknown; release is manual (`deploy-profile.md`) |
| Tester's file system | both | backup file v1 (`backup.js` `FORMAT`), AES-GCM + PBKDF2-SHA256 600k, or plaintext without a passphrase | the tester | local; file picker / download only |

## 2. Containers (C4 level 2)
One package, two instances at run time: `"incognito": "split"` starts a second, independent worker
and panel for private windows. Both instances share `storage.local` (configuration) and keep their
own session state (`INSTANCE_AREA`).

| Container | Responsibility | Technology |
|-----------|----------------|------------|
| Worker | service worker `background.js`: answers auth challenges, builds DNR header rules, switches the signed-in user per site, migrates the stored shape | MV3 module service worker, vanilla JS |
| Panel | side panel `popup.html` / `popup.js` / `popup.css`: all UI; the writer of configuration (users, sites, settings) | extension page in `chrome.sidePanel`, vanilla JS, no framework |
| Local store | `chrome.storage.local`: configuration shared by both instances, plus normal-profile session state | Chrome extension storage (key-value) |
| Session store | `chrome.storage.session`: per-instance, in-memory state: tab pins, auth attempts, private-window session state | Chrome extension storage (key-value, memory) |

### Architecture style
**Style:** modular monolith
**Migration:** none: existing system documented as built; this cycle adds one module (`links.js`)
**Per-module patterns:** none

| Force | This system | Points to |
|-------|-------------|-----------|
| Teams (number) | 1 maintainer | monolith |
| Domain complexity | low: users, sites, one signed-in user per site | monolith |
| Independent deploy need | none — Chrome ships the package as one unit | monolith |
| Parts that scale differently | none — one tester, tens of users | monolith |
| Consistency across modules | needed: a user's sites and each site's signed-in user must agree | monolith |
| Team experience with distributed systems | not relevant — no network between parts | monolith |

| Rejected style | Why (force) |
|----------------|-------------|
| services | independent deploy need: none; Chrome loads one package, there is nothing to deploy separately |
| event-driven | consistency across modules: the panel needs its own write to be visible at once; `storage.onChanged` is used only to repaint and rebuild rules |
| n-tier with a backend | data stays on the device by policy (`PRIVACY.md`); a server adds a place for passwords to leak |

### Entry and discovery
**No gateway:** no server; the panel talks to the worker in-process through `chrome.runtime` messaging.
**Service discovery:** static config: Chrome routes `chrome.runtime` messages to this extension's own worker by extension id; one worker per profile instance
**Health input:** n/a

### Sync links
| From | To | Protocol | Operations | Idempotency for retried writes | Why |
|------|----|----------|------------|--------------------------------|-----|
| Panel | Worker | other: `chrome.runtime.sendMessage` | `switch {sessionId, domain}`, `openAs {sessionId, url}`, `sync` | n/a: the panel never retries; `switch` and `sync` are idempotent | actions that need worker-only APIs (cookies, DNR, tabs) |

### Async links
`storage.onChanged` is Chrome's change event on the two stores; both containers listen.

| Producer | Consumer(s) | Channel | Type | Delivery | Ordering | Dedup key | Failure path | Schema + compatibility |
|----------|-------------|---------|------|----------|----------|-----------|--------------|------------------------|
| Local store, Session store | Worker, Panel | `chrome.storage.onChanged` (Worker runs `syncRules`, Panel repaints) | event bus | at-most-once (Chrome documents no guarantee; loss is acceptable because every consumer rebuilds from the full stored state, and the worker also rebuilds on every boot) | none | n/a: consumers re-read full state, never apply the delta | drop: next event or worker boot rebuilds everything | `storage.js` `STORAGE_DEFAULTS` + `migrate()` steps; NONE: one package, producer and consumer ship together |

## 3. Modules and boundaries
| Module | Path | Responsibility | Public contract | May depend on | Owner |
|--------|------|----------------|-----------------|---------------|-------|
| Storage | `storage.js` | the one stored shape and defaults; per-instance state accessors | `storage.js` exports: `STORAGE_DEFAULTS`, `INSTANCE_DEFAULTS`, `IS_INCOGNITO`, `INSTANCE_AREA`, `readActiveByDomain`, `writeActiveByDomain`, `readInstanceState` | none | Mohammad Salameh |
| Backup | `backup.js` | backup file build / open / merge; site normalisation; reading a user's sites | `backup.js` exports: `FORMAT`, `normalizeDomain`, `domainsOf`, `buildBackup`, `parseBackup`, `openBackup`, `mergeBackup` | none | Mohammad Salameh |
| Links (new, this cycle) | `links.js` | bulk link, bulk unlink, bulk delete, extra sites at import, users for a new site — as pure state transforms returning the next `sessions` and `activeByDomain` | `links.js` exports (named in `spec.md`) | Backup | Mohammad Salameh |
| Worker | `background.js` | credential answering, DNR rules, switching, migration | message handlers `switch`, `openAs`, `sync` (handler object in `background.js`) | Storage, Backup | Mohammad Salameh |
| Panel | `popup.html`, `popup.js`, `popup.css` | UI; persists configuration | none consumed by other modules | Storage, Backup, Links, Worker (messages only) | Mohammad Salameh |

- **Boundary rule:** a module imports only another module's exports listed above. Backup and Links
  are pure: no `chrome.*`, no `document`/DOM, no `fetch`. Only the Panel and the Worker touch
  Chrome APIs; only the Worker touches cookies, DNR and auth answers.
- **Enforced by:** `test/wiring.test.mjs` (static source checks, run by `npm test` in the CI
  `Tests` job). It already fails on a missing import target and on duplicated storage defaults.
  Build for this cycle adds rules there: Backup and Links contain no `chrome.`, `document` or
  `fetch(`; Links imports only `./backup.js`; no module imports `popup.js` or `background.js`.
- **Cycles:** not permitted. Checked by the same test (import graph of the five modules).

## 4. Data architecture
- **Ownership:** the Panel is the only writer of configuration (`sessions`, `domains`,
  `selectedDomain`, `preemptive`). The Worker writes configuration only in `migrate()` (shape
  upgrade, normal profile only, idempotent) and `seenChallenges`. `activeByDomain` is written by
  the Worker on `switch` and by the Panel when users are deleted, unlinked or imported — always
  through `writeActiveByDomain()`. Backup and Links compute new state; they never write it.
- **Write order for one change:** a change that removes a user's right to a site clears that site
  from `activeByDomain` **before** it writes `sessions`. If the second write fails, the site has no
  signed-in user (fails closed) instead of a signed-in user no longer linked to it.
- **History & audit:** none kept. No undo (intent non-goal). The tester's backup export is the only
  recovery copy.
- **Migrations:** every change to the stored `Session` shape adds a step in `migrate()`, idempotent,
  run on every worker boot. This cycle keeps `domains: string[]` — no migration. The backup file
  format keeps `version` 1; a format change bumps it.
- **Analytics path:** none: no telemetry by policy (`PRIVACY.md`).

### Stores
| Store | Type | Holds | Access patterns served | Replication | Retention / tier | Why | Rejected |
|-------|------|-------|------------------------|-------------|------------------|-----|----------|
| Local store | key-value | `chrome.storage.local`: `sessions` (incl. passwords), `domains`, `selectedDomain`, `preemptive`, `seenChallenges`; normal-profile `INSTANCE_AREA` keys | read whole config on each challenge, rule rebuild and render; whole-array write on each save | none | indefinite: configuration the tester keeps until they delete it or uninstall | shared by both instances, survives restart, no permission beyond `storage` | IndexedDB: no need for queries over tens of records; `storage.sync`: would copy passwords to Google servers |
| Session store | key-value | `chrome.storage.session`: `tabAssignments`, `authAttempts`; private-window `INSTANCE_AREA` keys | read with config; small writes per pin or challenge | none | indefinite: memory only, cleared when the browser or private window closes | state that must die with the browser or the private window | Local store: would leak private-window state into the normal profile |
| Backup file | object | exported users and sites (backup format v1) | whole-file write on export, whole-file read on import | none | indefinite: the tester's file, outside the extension's control | the only way to move users between machines and the only recovery copy | cloud sync: data leaves the device |

### Top queries
| Query (access pattern) | Store | Peak per second | Index / key that serves it | Scan acceptable because |
|------------------------|-------|-----------------|----------------------------|-------------------------|
| Signed-in user for the challenged site (`activeByDomain` from `INSTANCE_AREA`) | Local store | 1 (one per auth challenge; not measured — no telemetry) | key `activeByDomain[domain]`, then scan of `sessions` by id | tens of users (intent assumption, owner Mohammad Salameh) |
| Users linked to the site shown in the panel | Local store | 1 (render; not measured) | scan of `sessions` through `domainsOf()` | tens of users |
| Bulk link / unlink / delete | Local store | 1 (tester action; not measured) | whole `sessions` array read, transformed by Links, written once | tens of users; one write per save (C7) |

### Consistency per operation
| Operation / data | Model | On partition | Normal operation | Store + configuration (verify) |
|------------------|-------|--------------|------------------|--------------------------------|
| Panel save → its own next render | read your writes | PC | EC | `chrome.storage.local.set` resolves before `load()` re-reads (`popup.js` pattern) |
| Two panels (two windows or the private window) editing users at once | eventual (last writer wins per key) | PA | EL | `storage.local` whole-key writes; a concurrent save can overwrite another panel's change — accepted, one tester |
| Worker answer after a panel save | eventual | PA | EL | worker reads storage on every challenge; rules rebuilt on `storage.onChanged` |

**No cross-module transactions:** configuration is written to one browser store by one container (the Panel), and the Worker only rebuilds idempotently; the two-key bulk write (`activeByDomain`, then `sessions`) is ordered to fail closed (Write order above) instead of being made atomic.

## 5. Cross-cutting decisions
- **Credential boundary (ADR 0002):** a password goes to a site only when that site is in the
  configured `domains` **and** in the user's own sites (`domainsOf(user)`). The Worker checks it at
  answer time and at rule build; the Panel offers only configured sites (C8). Known gaps against
  this rule are risks in §8.
- **Errors:** the Panel shows errors inline in the section that caused them; the Worker records
  diagnostics in `INSTANCE_AREA` (`ruleError`, `insecureHost`, `lastReset`) and the Panel reads them.
  No error leaves the device.
- **Logging, metrics, tracing:** none beyond the diagnostics keys; no telemetry (`PRIVACY.md`).
  Never log a password.
- **Config and secrets:** stored passwords are tester data in `storage.local`; the extension holds
  no secret of its own.
- **Idempotency and retries:** no external calls. Auth answers are one-shot per request
  (`alreadyAttempted`) so rejected credentials never loop.
- **Background jobs:** none scheduled. Event-driven only (challenge, tab, storage, install, startup).
- **Caching:** none; every read goes to Chrome storage.

### Clients and sessions
| Client | Type | Flow | PKCE | Token storage |
|--------|------|------|------|---------------|
| Panel | browser | other: none — no sign-in to the extension itself | n/a | n/a |

**No sessions of our own:** the "signed-in user" per site is the site's own HTTP-auth state; the
extension issues no tokens or cookies.

### Authorization
**Model:** ABAC — attribute: the challenged site is in `domains` and in `domainsOf(user)`
**Decision point:** in-process, `background.js` (`onAuthRequired`, `syncRules`, `switchTo`)
**Enforcement:** every auth challenge and every rule rebuild, in the Worker
**Object-level check:** `switchTo` checks the requested site against the user's own sites and refuses a mismatch
**Default:** deny — no match answers `callback({})` and Chrome's own dialog appears
**Tests:** `test/background.test.mjs`

### Service identity
| Call (from → to) | Service auth | User identity |
|------------------|--------------|---------------|
| Panel → Worker | network only: in-browser messaging between pages of one extension; the manifest has no `externally_connectable` and no content scripts, so only this extension's pages can send | none: one local tester |

### Encryption and keys
**TLS minimum:** 1.2 (set by Chrome, which disabled TLS 1.0 and 1.1 in 2020; the extension does not choose it). The Worker refuses Basic over plain HTTP to a non-private host.

| Store | Data class | At rest | Key location | Rotation | Who can decrypt |
|-------|------------|---------|--------------|----------|-----------------|
| Local store | secret | none: Chrome profile storage, no extension-held key; any decryption key would sit beside the data | n/a | n/a | anyone with the OS account and Chrome profile |
| Session store | internal | none: memory only, gone with the browser | n/a | n/a | this extension instance |
| Backup file | secret | application: AES-GCM, key from passphrase via PBKDF2-SHA256 600k; plaintext if the tester sets no passphrase | the tester's passphrase (never stored) | per export | holder of the passphrase |

### Tenancy
**Tenancy:** single-tenant: one tester per Chrome profile
**Tenant id source:** n/a

## 6. Technology choices
| Area | Choice | Why | Rejected alternatives |
|------|--------|-----|-----------------------|
| Platform | Chrome MV3 extension, minimum Chrome 144 | only way to answer HTTP auth for the browser the tester already uses | not recorded (pre-SDLC) |
| Language | vanilla JavaScript ES modules, no build step | no toolchain to maintain; the store receives the reviewed source as is | TypeScript + bundler: adds a build step the package flow does not have (not recorded beyond this) |
| UI host | `chrome.sidePanel` | an action popup closes on focus loss (CODEMAP, Side panel UI) | action popup |
| Credential answer | `webRequest.onAuthRequired` (`asyncBlocking`), optional DNR Basic header | supports every scheme; DNR avoids the 401 round trip for Basic | DNR only: Basic only, breaks NTLM/Negotiate |
| Storage | `chrome.storage.local` / `.session` | see §4 Stores | `storage.sync`, IndexedDB |
| Backup crypto | WebCrypto AES-GCM + PBKDF2-SHA256 | built in, no dependency | a crypto library: a dependency to audit |
| Tests | plain Node scripts (`node:vm` with stubbed `chrome.*`) | no dependencies, no lockfile | Jest / Vitest: dependencies to audit (not recorded beyond this) |
| Bulk state changes | pure module `links.js` (ADR 0003) | testable in Node, one write per save | inside `backup.js`; worker-owned writes |
| Design mockups | HTML mockups, not Figma (ADR 0004) | maintainer's decision (intent Constraints) | Figma |

## 7. Quality attributes (drives the specs' NFR blocks)
| Attribute | Target | Fitness function (automated check) | Runs in (CI job / schedule) | Owner |
|-----------|--------|------------------------------------|-----------------------------|-------|
| Credential boundary | a password reaches a site only if the site is configured and in the user's sites; 0 exceptions | `test/background.test.mjs` cases for `onAuthRequired`, `syncRules`, `switchTo` (pinned-tab cases added in this cycle) | CI `Tests` (`npm test`) per PR | Mohammad Salameh |
| Module boundary | Backup and Links pure; no import cycles; imports only listed exports | `test/wiring.test.mjs` boundary rules (§3) | CI `Tests` per PR | Mohammad Salameh |
| No user without a site after a bulk change | 0 | Links unit tests over the resulting state (intent success measure) | CI `Tests` per PR | Mohammad Salameh |
| One storage write per bulk save | 1 `sessions` write for any N ≥ 1 (C7) | Links/Panel test counting `storage.local.set` calls | CI `Tests` per PR | Mohammad Salameh |
| No new permissions | manifest permissions unchanged | `test/wiring.test.mjs` manifest checks (exact list added in this cycle) | CI `Tests` per PR | Mohammad Salameh |
| Recovery (RPO / RTO) | RPO = the tester's last export; RTO = one import | `test/backup.test.mjs` export → import round trip | CI `Tests` per PR | Mohammad Salameh |
| Data residency | no data leaves the device except tester-exported files | manual: maintainer, each release, `security-gate.md` data section | release | Mohammad Salameh |
| Storage size | < 10 MB `storage.local` quota | manual: maintainer, when the intent's user-count assumption is answered (Open question 3) | once per cycle | Mohammad Salameh |
| Availability, latency, SLOs | n/a: runs inside the tester's browser; no service of ours and no telemetry to measure an SLI | manual: none possible — reported issues only | n/a | Mohammad Salameh |

### Critical paths
**No critical paths with service targets:** every path runs in-process in the tester's browser; the
only network hop is Chrome's own request to the protected site, which the extension does not time.

### Call policies
| Call (from → to) | Timeout (ms) | Max attempts | Backoff | Retry budget | Breaker / limit | On failure | User-visible effect |
|------------------|--------------|--------------|---------|--------------|-----------------|------------|---------------------|
| Panel → Worker | none: in-browser messaging; `sendMessage` resolves when the handler finishes or rejects if no worker answers | 1 | none | none: no retries | none: one tester, one action at a time | fail fast | the action does not happen; the panel re-renders from storage |

### SLOs and alerts
**No SLOs:** no telemetry by policy (`PRIVACY.md`), so no SLI can be measured.

## 8. Risks and open questions
| Risk / question | Impact | Owner | Mitigation or decision date |
|-----------------|--------|-------|-----------------------------|
| `onAuthRequired` answers with a tab-pinned user (`tabAssignments`) for any configured site, without checking the site is in that user's sites. After a bulk unlink, a pinned tab can still send the old password. | password sent to a site the tester unlinked | Mohammad Salameh | `/sdlc-spec` decides whether this cycle closes it (ADR 0002) |
| `syncRules` builds pinned-tab rules from the user's own sites without intersecting the configured list (STATE.md, intent risk). | header sent for a site no longer configured | Mohammad Salameh | `/sdlc-spec`, same decision |
| `activeByDomain[site]` can name a user no longer linked to that site if the write order in §4 is not followed. | old password stays signed in on the site (C10) | Mohammad Salameh | write order in §4; Links tests; Worker check per ADR 0002 |
| `storage.onChanged` delivery to a sleeping or busy worker is not documented. | stale rules until the next event or boot | Mohammad Salameh | rebuild on every boot already exists; verify in `/sdlc-test` with an unlink while a pinned tab is open |
| Two panels editing at once lose one change (last writer wins). | a bulk change silently overwritten | Mohammad Salameh | accepted for one tester; revisit if reported |
| Passwords are stored unencrypted in the Chrome profile. | anyone with the OS account reads them | Mohammad Salameh | accepted pre-SDLC; stated in `PRIVACY.md` (verify wording at `/sdlc-review`) |
| Largest real user and site counts unknown (intent Open question 3). | list design and storage size | Mohammad Salameh | answer before `/sdlc-ux` |

## 9. Decisions log
| ADR | Decision | Status |
|-----|----------|--------|
| `docs/adr/0001-modular-monolith-extension.md` | one MV3 package, modules as ES module files, boundaries checked by `wiring.test.mjs` | proposed |
| `docs/adr/0002-credential-boundary.md` | a password goes only to a site that is configured and in the user's sites; checked in the Worker | proposed |
| `docs/adr/0003-pure-links-module.md` | bulk link / unlink / delete live in a pure `links.js`; the Panel persists | proposed |
| `docs/adr/0004-html-mockup-designs.md` | UX designs are committed HTML mockups, not Figma | proposed |
