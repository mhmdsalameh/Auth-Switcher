# Code Navigation Map

> Generated: 2026-08-15. Re-run `/codemap` for full rebuild, or `/codemap update <file>` after edits.
> Stale entries are tracked in `.codemap-dirty` — run `/codemap update` to patch them.

## Project Overview

Chrome MV3 extension that lets a QA tester hold several logins for the same HTTP-auth
protected site (K2) and switch between them without restarting the browser. The core
problem it solves is Chrome's in-memory **HTTP auth cache**, which survives tab closing and
"clear cache". Vanilla JS, no build step, no dependencies. 6 source files + 3 test files,
~1.9 KLOC including tests.

## How to use this map

- **Finding code**: Go to the relevant domain section → `file:line` → open directly.
- **Before editing a function**: Read its entry in the [Function Dependency Index](#function-dependency-index) to see what callers will be affected.
- **After editing**: Run `/codemap update <changed-file>` to keep the map accurate.
- **Verifying**: `npm test` — 25 checks. The suite is the safety net, not this document.

---

## Domains

### Credential answering

> Supplies the right username/password when a site issues an HTTP auth challenge.

| File | Line | What it is |
|------|------|------------|
| `background.js` | 160 | `chrome.webRequest.onAuthRequired` listener — the primary mechanism |
| `background.js` | 137 | `alreadyAttempted()` — one-shot guard so rejected credentials don't loop |
| `background.js` | 151 | `noteChallenge()` — records out-of-scope hosts to suggest in the popup |
| `background.js` | 44 | `domainForHost()` — resolves a challenged host to its configured domain |
| `background.js` | 52 | `isPrivateHost()` — intranet test; gates cleartext-Basic refusal |

### Pre-emptive headers (optional, Basic auth only)

> Attaches `Authorization: Basic` via declarativeNetRequest so no 401 ever occurs.

| File | Line | What it is |
|------|------|------------|
| `background.js` | 94 | `syncRules()` — rebuilds all DNR session rules from scratch |
| `background.js` | 74 | `authRule()` — builds one modifyHeaders rule; adds the https-only anchor |
| `background.js` | 68 | `basicHeader()` — RFC 7617 UTF-8 + base64 encoding |
| `background.js` | 19 | `ALL_RESOURCE_TYPES` — DNR omits `main_frame` by default; this restores it |

### Session switching

> Changes the active user for one domain and clears the state that pins the old identity.

| File | Line | What it is |
|------|------|------------|
| `background.js` | 299 | `switchTo()` — the main entry; scoped to one domain |
| `background.js` | 236 | `clearSiteData()` — deletes only the target domain's cookies + web storage |
| `background.js` | 293 | `needsAuthFlush()` — decides whether the auth-cache flush is required |
| `background.js` | 225 | `cookieUrl()` — reconstructs a URL from a cookie record, for `cookies.remove` |
| `background.js` | 280 | `reloadTabsIn()` — reloads affected tabs |
| `background.js` | 312 | `openAs()` — pins a new tab to a specific user |

### Popup UI

> Renders the domain picker, the active user, the switch list, and settings.

| File | Line | What it is |
|------|------|------------|
| `popup.js` | 223 | `render()` — single render entry, called only from `load()` |
| `popup.js` | 59 | `renderDomainPicker()` — domain dropdown |
| `popup.js` | 79 | `renderDomains()` — domain chips + detected-host suggestion |
| `popup.js` | 127 | `buildRow()` — one user row with edit/open/delete |
| `popup.js` | 203 | `openUserForm()` — shared add/edit form |
| `popup.js` | 40 | `currentDomain()` — selected tab, falling back to first domain |
| `popup.html` | 1 | Popup markup |
| `popup.css` | 10 | Styles; the --user custom property is set per active user from JS |

### Backup (export / import)

> Encrypted transfer of users and domains between machines.

| File | Line | What it is |
|------|------|------------|
| `backup.js` | 43 | `buildBackup()` — AES-GCM + PBKDF2, or plaintext if no passphrase |
| `backup.js` | 66 | `parseBackup()` — format/version validation |
| `backup.js` | 78 | `openBackup()` — decrypt (iteration count is read from the file, so old files still open) |
| `backup.js` | 99 | `mergeBackup()` — non-destructive merge, dedupe by domain+username |
| `backup.js` | 21 | `deriveKey()` — PBKDF2-SHA256, 600k iterations |
| `backup.js` | 9 | `normalizeDomain()` — the only sanitizer for anything entering the domain allowlist |

---

## Shared / Infrastructure

| File | Line | What it is |
|------|------|------------|
| `storage.js` | 6 | `STORAGE_DEFAULTS` — **single** canonical shape of shared `storage.local` |
| `storage.js` | 17 | `INSTANCE_DEFAULTS` — per-instance diagnostics; never shared across profiles |
| `storage.js` | 37 | `IS_INCOGNITO` — which profile instance this code is running in |
| `storage.js` | 39 | `INSTANCE_AREA` — storage area that must not cross the profile boundary |
| `storage.js` | 60 | `readInstanceState()` — the popup's read path for the diagnostics |
| `background.js` | 62 | `getConfig()` — reads local + session storage together |
| `background.js` | 27 | `migrate()` — v1 (flat sessions) → v2 (per-domain) |
| `background.js` | 221 | `hostInScope()` — domain matching, used by cookie filtering |
| `backup.js` | 9 | `normalizeDomain()` — strips scheme/path/port, lowercases (moved here from `popup.js`) |
| `popup.js` | 13 | `PALETTE` — per-user colours |
| `manifest.json` | 1 | Permissions and entry points |

---

## Entry Points

| How it starts | File | Line |
|---------------|------|------|
| Service worker boot (every spin-up) | `background.js` | 391 |
| Browser start / extension install | `background.js` | 386 |
| Auth challenge from any site | `background.js` | 160 |
| Message from popup | `background.js` | 349 |
| Popup opened | `popup.js` | 544 |

---

## Key Data Models / Types

> Read these when confused about data shapes — they ripple everywhere.

| Shape | Where defined | Notes |
|-------|--------------|-------|
| `Session` | `storage.js:6` | `{id, domain, name, username, password, color}` |
| `activeByDomain` | `storage.js:6` | `{domain → sessionId}`, one active user per domain **per profile instance** |
| `tabAssignments` | `storage.session` | `{tabId → sessionId}`, dies with the browser |
| `lastReset` | `background.js:272` | `{at, domains, removed, failed, authFlush}` — diagnostics only, not rendered |
| Backup file v1 | `backup.js:43` | `{format, version, encrypted, kdf?, iv?, data?, payload?}` |

### Storage areas — persistence matters here

| Area | Keys | Survives restart | Shared with private windows |
|------|------|------------------|------------------------------|
| `storage.local` | `sessions`, `domains`, `selectedDomain`, `preemptive`, `seenChallenges` | yes | **yes** |
| `storage.session` | `tabAssignments`, `authAttempts` | no (by design) | no |
| `INSTANCE_AREA` (`storage.js:35`) | `activeByDomain`, `lastScheme`, `ruleError`, `lastReset`, `insecureHost` | normal profile only | no |

`INSTANCE_AREA` resolves to `storage.local` in the normal profile and `storage.session` in a
private window - see *Profile isolation* below. Never read or write those keys through
`storage.local` directly; go through `readActiveByDomain()` / `writeActiveByDomain()` /
`readInstanceState()`. `test/wiring.test.mjs` fails the build if a diagnostic key is written
straight to `storage.local` again.

### Profile isolation (`"incognito": "split"`)

The manifest asks Chrome for **split** incognito, so a private window runs a *second,
independent instance* of the extension: its own service worker, its own
`declarativeNetRequest` session rules, its own `onAuthRequired` listener, its own cookie
store, and its own `storage.session`. Switching users in a private window therefore cannot
touch the normal window - which was the bug this replaced.

`storage.local` is still shared across both instances, deliberately, so the user list and
domain list do not have to be re-entered in a private window. Anything that is *session
state* rather than *configuration* must go through `INSTANCE_AREA` instead.

`IS_INCOGNITO` (`storage.js:37`) is how either instance knows which one it is. It reads
`chrome.extension.inIncognitoContext`, available in both the service worker and the popup.
If that ever evaluates `false` inside a private window, every isolation guarantee above
silently collapses back to the old shared behaviour - check it first if this regresses.

---

## Cross-module contracts

### Popup → service worker (`chrome.runtime.sendMessage`)

Handlers are registered in one object at `background.js:355`. Adding a message means
adding it there; `test/wiring.test.mjs` fails if the popup sends something unhandled.

| Message | Sent from | Handled at |
|---------|-----------|------------|
| `{type:"switch", sessionId}` | `popup.js:151` | `background.js:356` |
| `{type:"openAs", sessionId, url}` | `popup.js:173` | `background.js:357` |

### Popup → backup module

`popup.js:1` imports `buildBackup`, `parseBackup`, `openBackup`, `mergeBackup`.
`backup.js` deliberately touches neither DOM nor `chrome.*` so it stays testable in Node.

---

## Function Dependency Index

> Before changing any function below, read its entry to know what will break.

### Service worker core

#### `syncRules()`
- **Defined**: `background.js:94`
- **Impact**: critical — 7 call sites
- **Called by**: `switchTo` (334), `openAs` (345), `tabs.onRemoved` (372), `storage.onChanged` (376), `onInstalled` (386), `onStartup` (387), worker boot (392)
- **Calls**: `getConfig` (95), `authRule` (111, 119), `basicHeader` and `isPrivateHost` via `authRule`
- **Side effects**: replaces all DNR session rules; writes `ruleError`
- **Change note**: rebuilds every rule from scratch — cheap and avoids drift. Rules are emitted **per domain**; a change here affects all environments at once.

#### `getConfig()`
- **Defined**: `background.js:62`
- **Impact**: critical — read by every entry point
- **Called by**: `syncRules` (95), `onAuthRequired` (166), `switchTo` (327)
- **Calls**: `chrome.storage.local.get`, `chrome.storage.session.get`, `readActiveByDomain`
- **Side effects**: none
- **Change note**: merges local and session storage into one object, then overrides `activeByDomain` with this instance's own copy — that override is what keeps a private window off the normal window's user. The shape lives in `storage.js:6` and is imported by both the worker and the popup — add new keys there, not locally. `test/wiring.test.mjs` fails if either file redeclares `DEFAULTS`.

#### `clearSiteData(domains, { flushAuthCache })`
- **Defined**: `background.js:236`
- **Impact**: high — the only destructive path left
- **Called by**: `switchTo` (306)
- **Calls**: `chrome.cookies.getAll({domain})`, `cookieUrl` (250), `chrome.cookies.remove`, `hostInScope` (245), `originsFor`
- **Side effects**: deletes the target domain's cookies and web storage; writes `lastReset`
- **Change note**: the guarantee is that **nothing outside `domains` is read, written or
  deleted**. Cookies deliberately do NOT go through `browsingData.remove`: that call is
  global without `origins`, and its `origins` filter is exact-origin, so it would miss
  `.k2.corp.com` and every subdomain cookie. Per-cookie removal is the only way to hit
  exactly the set `hostInScope` defines. Never add `cache: true` — that type ignores
  `origins` entirely and would clear every site. `test/wiring.test.mjs` fails the build on
  any `browsingData.remove` lacking an `origins` filter, on `cache: true`, and on any
  reappearance of a cookie snapshot.

#### `needsAuthFlush(preemptive)`
- **Defined**: `background.js:293`
- **Impact**: high — decides whether siblings get signed out
- **Called by**: `switchTo` (306)
- **Side effects**: none (reads `ruleError`)
- **Change note**: `cookies: true` is the only lever that drops Chrome's HTTP auth cache
  (`DATA_TYPE_COOKIES` triggers `ClearHttpAuthCache`), and for cookies Chrome widens
  `origins` to the **registrable domain** — so flushing `k2.corp.com` also signs the user
  out of `jira.corp.com`. That cost is only worth paying when the DNR header is not doing
  the job: pre-emptive off, or `ruleError` set. Must be called **after** `syncRules()` so
  `ruleError` is current. Widening this to always-true is a regression, not a simplification.

#### `switchTo(sessionId)`
- **Defined**: `background.js:299`
- **Impact**: high — the extension's main action
- **Called by**: message handler (356) ← `popup.js:151`
- **Calls**: `getConfig` (300), `writeActiveByDomain` (304), `syncRules` (305), `needsAuthFlush` (306), `clearSiteData` (306), `reloadTabsIn` (307)
- **Side effects**: writes `activeByDomain` **to this instance only**; clears cookies; reloads tabs
- **Change note**: scoped twice over — to `session.domain`, and to the calling profile instance. Widening either breaks a guarantee: the first that switching on UAT leaves DEV signed in, the second that switching in a private window leaves the normal window alone.

#### `migrate()`
- **Defined**: `background.js:27`
- **Impact**: high — runs before everything
- **Called by**: worker boot (391)
- **Side effects**: rewrites `sessions`, writes `activeByDomain`, removes `activeSessionId`
- **Change note**: must stay idempotent; it runs on every worker spin-up, not just on update. No-ops in the private instance — it rewrites shared `storage.local`, which the normal profile owns.

#### `onAuthRequired` listener
- **Defined**: `background.js:160`
- **Impact**: critical — the primary mechanism
- **Calls**: `getConfig` (166), `domainForHost` (181), `noteChallenge` (185), `isPrivateHost` (194), `alreadyAttempted` (204)
- **Side effects**: writes `lastScheme`; writes `seenChallenges` (normal profile only); supplies credentials
- **Change note**: registered `asyncBlocking`. Returning without calling `callback` hangs the request. Under split incognito each instance only sees its own profile's challenges, and that is what makes per-profile credentials possible at all: `details` carries no incognito flag and `details.tabId` is `-1` for subresources, so a single shared instance could not tell them apart.

### Popup

#### `render()`
- **Defined**: `popup.js:223`
- **Impact**: critical — the only render path
- **Called by**: `load()` (50) — and `load()` is called after every mutation
- **Calls**: `renderDomainPicker` (230), `renderDomains` (231), `userColor`, `buildRow` (309), `currentDomain`
- **Side effects**: full DOM rebuild; sets `--user` custom property
- **Change note**: there is no partial rendering. Any state change goes through `load()` → `render()`.

#### `currentDomain()`
- **Defined**: `popup.js:40`
- **Impact**: critical — every user-facing list is filtered by it
- **Called by**: `render` (224), `targetUrl` (321), `active-edit` handler, add/edit submit
- **Side effects**: none
- **Change note**: falls back to `domains[0]` when `selectedDomain` is unset or stale (e.g. after the selected domain is deleted).

#### `openUserForm(session)`
- **Defined**: `popup.js:203`
- **Impact**: high
- **Called by**: `buildRow` edit button, `#add-toggle`, `#active-edit`
- **Change note**: `session = null` means add, otherwise edit. `closeUserForm()` calls `form.reset()`, so the submit handler must read field values **before** closing.

### Backup

#### `mergeBackup(current, payload, newId)`
- **Defined**: `backup.js:99`
- **Impact**: high — the only write path for imports
- **Called by**: `popup.js:487` (`applyImport`)
- **Side effects**: none (pure) — the caller persists the result
- **Change note**: dedupes on domain + NUL separator + username (see `identity` in `backup.js`). Never overwrites an existing user. `newId` is injectable purely so tests can be deterministic.

#### `buildBackup(state, passphrase)` / `openBackup(file, passphrase)`
- **Defined**: `backup.js:43` / `backup.js:78`
- **Impact**: high
- **Called by**: `popup.js:428` / `popup.js:458, 475`
- **Side effects**: none
- **Change note**: any change to the file format needs a `version` bump — `parseBackup` (55) rejects unknown versions rather than guessing. Ids are stripped on export and regenerated on import.

---

## Not covered here

- `popup.css` — presentation only; `test/wiring.test.mjs` verifies every class used in
  markup or JS actually has a rule.
- `test/*.mjs` — the suites themselves. `background.test.mjs` runs `background.js` in a
  `node:vm` with stubbed `chrome.*` APIs.
