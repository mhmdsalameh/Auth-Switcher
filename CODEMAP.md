# Code Navigation Map

> Generated: 2026-08-11. Re-run `/codemap` for full rebuild, or `/codemap update <file>` after edits.
> Stale entries are tracked in `.codemap-dirty` — run `/codemap update` to patch them.

## Project Overview

Chrome MV3 extension that lets a QA tester hold several logins for the same HTTP-auth
protected site (K2) and switch between them without restarting the browser. The core
problem it solves is Chrome's in-memory **HTTP auth cache**, which survives tab closing and
"clear cache". Vanilla JS, no build step, no dependencies. 7 source files, ~1.8 KLOC
including tests.

## How to use this map

- **Finding code**: Go to the relevant domain section → `file:line` → open directly.
- **Before editing a function**: Read its entry in the [Function Dependency Index](#function-dependency-index) to see what callers will be affected.
- **After editing**: Run `/codemap update <changed-file>` to keep the map accurate.
- **Verifying**: `npm test` — 20 tests. The suite is the safety net, not this document.

---

## Domains

### Credential answering

> Supplies the right username/password when a site issues an HTTP auth challenge.

| File | Line | What it is |
|------|------|------------|
| `background.js` | 132 | `chrome.webRequest.onAuthRequired` listener — the primary mechanism |
| `background.js` | 111 | `alreadyAttempted()` — one-shot guard so rejected credentials don't loop |
| `background.js` | 125 | `noteChallenge()` — records out-of-scope hosts to suggest in the popup |
| `background.js` | 36 | `domainForHost()` — resolves a challenged host to its configured domain |

### Pre-emptive headers (optional, Basic auth only)

> Attaches `Authorization: Basic` via declarativeNetRequest so no 401 ever occurs.

| File | Line | What it is |
|------|------|------------|
| `background.js` | 68 | `syncRules()` — rebuilds all DNR session rules from scratch |
| `background.js` | 53 | `authRule()` — builds one modifyHeaders rule |
| `background.js` | 47 | `basicHeader()` — RFC 7617 UTF-8 + base64 encoding |
| `background.js` | 12 | `ALL_RESOURCE_TYPES` — DNR omits `main_frame` by default; this restores it |

### Session switching

> Changes the active user for one domain and clears the state that pins the old identity.

| File | Line | What it is |
|------|------|------------|
| `background.js` | 284 | `switchTo()` — the main entry; scoped to one domain |
| `background.js` | 240 | `clearAuthCache()` — global cookie clear with out-of-scope preservation |
| `background.js` | 268 | `clearSiteState()` — localStorage/IDB/SW for the target domain |
| `background.js` | 276 | `reloadTabsIn()` — reloads affected tabs |
| `background.js` | 300 | `openAs()` — pins a new tab to a specific user |

### Cookie snapshot / crash recovery

> Makes the destructive global cookie clear survive service-worker termination.

| File | Line | What it is |
|------|------|------------|
| `background.js` | 215 | `restoreSnapshot()` — idempotent write-back, capped retries |
| `background.js` | 210 | `MAX_RESTORE_ATTEMPTS` — retry cap (`SNAPSHOT_KEY` lives in `storage.js`) |
| `background.js` | 190 | `toSetDetails()` — `cookies.get` → `cookies.set` shape conversion |
| `background.js` | 184 | `cookieUrl()` — reconstructs a URL from a cookie record |

### Popup UI

> Renders the domain picker, the active user, the switch list, and settings.

| File | Line | What it is |
|------|------|------------|
| `popup.js` | 223 | `render()` — single render entry, called only from `load()` |
| `popup.js` | 60 | `renderDomainPicker()` — domain dropdown |
| `popup.js` | 80 | `renderDomains()` — domain chips + detected-host suggestion |
| `popup.js` | 128 | `buildRow()` — one user row with edit/open/delete |
| `popup.js` | 203 | `openUserForm()` — shared add/edit form |
| `popup.js` | 42 | `currentDomain()` — selected tab, falling back to first domain |
| `popup.html` | 1 | Popup markup |
| `popup.css` | 10 | Styles; the --user custom property is set per active user from JS |

### Backup (export / import)

> Encrypted transfer of users and domains between machines.

| File | Line | What it is |
|------|------|------------|
| `backup.js` | 32 | `buildBackup()` — AES-GCM + PBKDF2, or plaintext if no passphrase |
| `backup.js` | 55 | `parseBackup()` — format/version validation |
| `backup.js` | 67 | `openBackup()` — decrypt |
| `backup.js` | 88 | `mergeBackup()` — non-destructive merge, dedupe by domain+username |
| `backup.js` | 10 | `deriveKey()` — PBKDF2-SHA256, 250k iterations |

---

## Shared / Infrastructure

| File | Line | What it is |
|------|------|------------|
| `storage.js` | 6 | `STORAGE_DEFAULTS` — **single** canonical shape of `storage.local` |
| `storage.js` | 20 | `SNAPSHOT_KEY` — kept out of the defaults on purpose |
| `background.js` | 41 | `getConfig()` — reads local + session storage together |
| `background.js` | 20 | `migrate()` — v1 (flat sessions) → v2 (per-domain) |
| `background.js` | 179 | `hostInScope()` — domain matching, used by cookie filtering |
| `popup.js` | 25 | `normalizeDomain()` — strips scheme/path/port, lowercases |
| `popup.js` | 6 | `PALETTE` — per-user colours |
| `manifest.json` | 1 | Permissions and entry points |

---

## Entry Points

| How it starts | File | Line |
|---------------|------|------|
| Service worker boot (every spin-up) | `background.js` | 338 |
| Browser start / extension install | `background.js` | 333 |
| Auth challenge from any site | `background.js` | 132 |
| Message from popup | `background.js` | 309 |
| Popup opened | `popup.js` | 533 |

---

## Key Data Models / Types

> Read these when confused about data shapes — they ripple everywhere.

| Shape | Where defined | Notes |
|-------|--------------|-------|
| `Session` | `storage.js:6` | `{id, domain, name, username, password, color}` |
| `activeByDomain` | `storage.js:6` | `{domain → sessionId}`, one active user per domain |
| `tabAssignments` | `storage.session` | `{tabId → sessionId}`, dies with the browser |
| `cookieSnapshot` | `storage.js:20`, shape at `background.js:215` | `{cookies: SetDetails[], attempts: number}` |
| Backup file v1 | `backup.js:32` | `{format, version, encrypted, kdf?, iv?, data?, payload?}` |

### Storage areas — persistence matters here

| Area | Keys | Survives restart |
|------|------|------------------|
| `storage.local` | `sessions`, `domains`, `activeByDomain`, `selectedDomain`, `preemptive`, `lastScheme`, `ruleError`, `lastReset`, `seenChallenges`, `cookieSnapshot` | yes |
| `storage.session` | `tabAssignments`, `authAttempts` | no (by design) |

---

## Cross-module contracts

### Popup → service worker (`chrome.runtime.sendMessage`)

Handlers are registered in one object at `background.js:310`. Adding a message means
adding it there; `test/wiring.test.mjs` fails if the popup sends something unhandled.

| Message | Sent from | Handled at |
|---------|-----------|------------|
| `{type:"switch", sessionId}` | `popup.js:152` | `background.js:311` |
| `{type:"openAs", sessionId, url}` | `popup.js:174` | `background.js:312` |

### Popup → backup module

`popup.js:1` imports `buildBackup`, `parseBackup`, `openBackup`, `mergeBackup`.
`backup.js` deliberately touches neither DOM nor `chrome.*` so it stays testable in Node.

---

## Function Dependency Index

> Before changing any function below, read its entry to know what will break.

### Service worker core

#### `syncRules()`
- **Defined**: `background.js:68`
- **Impact**: critical — 7 call sites
- **Called by**: `switchTo` (294), `openAs` (305), `tabs.onRemoved` (326), `storage.onChanged` (330), `onInstalled` (333), `onStartup` (334), worker boot (339)
- **Calls**: `getConfig` (71), `authRule` (85, 93), `basicHeader` via `authRule`
- **Side effects**: replaces all DNR session rules; writes `ruleError`
- **Change note**: rebuilds every rule from scratch — cheap and avoids drift. Rules are emitted **per domain**; a change here affects all environments at once.

#### `getConfig()`
- **Defined**: `background.js:41`
- **Impact**: critical — read by every entry point
- **Called by**: `syncRules` (69), `onAuthRequired` (136), `switchTo` (285)
- **Calls**: `chrome.storage.local.get`, `chrome.storage.session.get`
- **Side effects**: none
- **Change note**: merges local and session storage into one object. The shape lives in `storage.js:6` and is imported by both the worker and the popup — add new keys there, not locally. `test/wiring.test.mjs` fails if either file redeclares `DEFAULTS`.

#### `clearAuthCache(domains)`
- **Defined**: `background.js:240`
- **Impact**: high — destructive
- **Called by**: `switchTo` (296)
- **Calls**: `hostInScope` (247), `toSetDetails` (247), `restoreSnapshot` (267)
- **Side effects**: **clears every cookie in Chrome**, then restores out-of-scope ones
- **Change note**: the snapshot must be persisted *before* `browsingData.remove`. `test/wiring.test.mjs` asserts that ordering; if the write fails the clear is abandoned deliberately.

#### `restoreSnapshot()`
- **Defined**: `background.js:215`
- **Impact**: high
- **Called by**: `clearAuthCache` (267), worker boot (351)
- **Side effects**: writes cookies; clears or decrements the stored snapshot
- **Change note**: idempotent by design — re-setting an existing cookie is a harmless overwrite. Runs on **every** worker spin-up, which is the crash-recovery path.

#### `switchTo(sessionId)`
- **Defined**: `background.js:284`
- **Impact**: high — the extension's main action
- **Called by**: message handler (321) ← `popup.js:152`
- **Calls**: `getConfig` (288), `syncRules` (297), `clearSiteState` (298), `clearAuthCache` (299), `reloadTabsIn` (300)
- **Side effects**: writes `activeByDomain`; clears cookies; reloads tabs
- **Change note**: scoped to `session.domain` only. Widening that scope would break the guarantee that switching on UAT leaves DEV signed in — covered by a test.

#### `migrate()`
- **Defined**: `background.js:20`
- **Impact**: high — runs before everything
- **Called by**: worker boot (349)
- **Side effects**: rewrites `sessions`, writes `activeByDomain`, removes `activeSessionId`
- **Change note**: must stay idempotent; it runs on every worker spin-up, not just on update.

#### `onAuthRequired` listener
- **Defined**: `background.js:132`
- **Impact**: critical — the primary mechanism
- **Calls**: `getConfig` (138), `domainForHost` (151), `noteChallenge` (155), `alreadyAttempted` (161)
- **Side effects**: writes `lastScheme` and `seenChallenges`; supplies credentials
- **Change note**: registered `asyncBlocking`. Returning without calling `callback` hangs the request.

### Popup

#### `render()`
- **Defined**: `popup.js:223`
- **Impact**: critical — the only render path
- **Called by**: `load()` (50) — and `load()` is called after every mutation
- **Calls**: `renderTabs` (226), `renderDomains` (227), `userColor`, `buildRow` (284), `currentDomain`
- **Side effects**: full DOM rebuild; sets `--user` custom property
- **Change note**: there is no partial rendering. Any state change goes through `load()` → `render()`.

#### `currentDomain()`
- **Defined**: `popup.js:42`
- **Impact**: critical — every user-facing list is filtered by it
- **Called by**: `render` (222), `targetUrl` (295), `active-edit` handler, add/edit submit
- **Side effects**: none
- **Change note**: falls back to `domains[0]` when `selectedDomain` is unset or stale (e.g. after the selected domain is deleted).

#### `openUserForm(session)`
- **Defined**: `popup.js:203`
- **Impact**: high
- **Called by**: `buildRow` edit button, `#add-toggle`, `#active-edit`
- **Change note**: `session = null` means add, otherwise edit. `closeUserForm()` calls `form.reset()`, so the submit handler must read field values **before** closing.

### Backup

#### `mergeBackup(current, payload, newId)`
- **Defined**: `backup.js:88`
- **Impact**: high — the only write path for imports
- **Called by**: `popup.js:446` (`applyImport`)
- **Side effects**: none (pure) — the caller persists the result
- **Change note**: dedupes on domain + NUL separator + username (see `identity` in `backup.js`). Never overwrites an existing user. `newId` is injectable purely so tests can be deterministic.

#### `buildBackup(state, passphrase)` / `openBackup(file, passphrase)`
- **Defined**: `backup.js:32` / `backup.js:67`
- **Impact**: high
- **Called by**: `popup.js:387` / `popup.js:420, 437`
- **Side effects**: none
- **Change note**: any change to the file format needs a `version` bump — `parseBackup` (55) rejects unknown versions rather than guessing. Ids are stripped on export and regenerated on import.

---

## Not covered here

- `popup.css` — presentation only; `test/wiring.test.mjs` verifies every class used in
  markup or JS actually has a rule.
- `test/*.mjs` — the suites themselves. `background.test.mjs` runs `background.js` in a
  `node:vm` with stubbed `chrome.*` APIs.
