# Code Navigation Map

> Generated: 2026-08-15, line refs verified 2026-09-01. Re-run `/codemap` for full rebuild, or `/codemap update <file>` after edits.
> Stale entries are tracked in `.codemap-dirty` — run `/codemap update` to patch them.

## Project Overview

Chrome MV3 extension that lets a QA tester hold several logins for the same HTTP-auth
protected site (K2) and switch between them without restarting the browser. One set of
credentials can serve several sibling sites — `k2.corp.com` and `k2test.corp.com` are
usually the same account — while each site still tracks its own signed-in user. The core
problem it solves is Chrome's in-memory **HTTP auth cache**, which survives tab closing and
"clear cache". Vanilla JS, no build step, no dependencies. 6 source files + 3 test files,
~1.9 KLOC including tests.

## How to use this map

- **Finding code**: Go to the relevant domain section → `file:line` → open directly.
- **Before editing a function**: Read its entry in the [Function Dependency Index](#function-dependency-index) to see what callers will be affected.
- **After editing**: Run `/codemap update <changed-file>` to keep the map accurate.
- **Verifying**: `npm test` — 40 checks. The suite is the safety net, not this document.

---

## Domains

### Credential answering

> Supplies the right username/password when a site issues an HTTP auth challenge.

| File | Line | What it is |
|------|------|------------|
| `background.js` | 160 | `chrome.webRequest.onAuthRequired` listener — the primary mechanism |
| `background.js` | 162 | `alreadyAttempted()` — one-shot guard so rejected credentials don't loop |
| `background.js` | 176 | `noteChallenge()` — records out-of-scope hosts to suggest in the popup |
| `background.js` | 57 | `domainForHost()` — resolves a challenged host to its configured domain |
| `background.js` | 65 | `isPrivateHost()` — intranet test; gates cleartext-Basic refusal |

### Pre-emptive headers (optional, Basic auth only)

> Attaches `Authorization: Basic` via declarativeNetRequest so no 401 ever occurs.

| File | Line | What it is |
|------|------|------------|
| `background.js` | 107 | `syncRules()` — rebuilds all DNR session rules from scratch |
| `background.js` | 87 | `authRule()` — builds one modifyHeaders rule; adds the https-only anchor |
| `background.js` | 81 | `basicHeader()` — RFC 7617 UTF-8 + base64 encoding |
| `background.js` | 19 | `ALL_RESOURCE_TYPES` — DNR omits `main_frame` by default; this restores it |

### Session switching

> Changes the active user for one domain and clears the state that pins the old identity.

| File | Line | What it is |
|------|------|------------|
| `background.js` | 329 | `switchTo()` — the main entry; scoped to one domain |
| `background.js` | 262 | `clearSiteData()` — deletes only the target domain's cookies + web storage |
| `background.js` | 323 | `needsAuthFlush()` — decides whether the auth-cache flush is required |
| `background.js` | 251 | `cookieUrl()` — reconstructs a URL from a cookie record, for `cookies.remove` |
| `background.js` | 310 | `reloadTabsIn()` — reloads affected tabs |
| `background.js` | 355 | `openAs()` — pins a new tab to a specific user |

### Side panel UI

> Renders the domain picker, the active user, the switch list, and settings.
>
> Hosted in `chrome.sidePanel`, not an action popup. Chrome closes a popup on focus loss and
> documents that as unavoidable, so `manifest.action` deliberately has **no** `default_popup`
> — that is what lets `setPanelBehavior({openPanelOnActionClick:true})` bind the toolbar icon
> to the panel. `test/wiring.test.mjs` fails the build if `default_popup` returns, if
> `setPanelBehavior` disappears, or if `window.close()` shows up in `popup.js`.

| File | Line | What it is |
|------|------|------------|
| `popup.js` | 436 | `render()` — single render entry, called only from `load()` |
| `popup.js` | 122 | `renderDomainPicker()` — domain dropdown |
| `popup.js` | 145 | `renderDomains()` — domain chips + detected-host suggestion |
| `popup.js` | 193 | `buildRow()` — one user row with edit/open/delete |
| `popup.js` | 307 | `openUserForm()` — shared add/edit form |
| `popup.js` | 351 | `addReveal()` — show/hide toggle for a password field |
| `popup.js` | 394 | `renderDomainChoice()` — the multi-site picker; hidden below 2 domains |
| `popup.js` | 384 | `renderChoiceSummary()` — summary only, so ticking a box keeps focus |
| `popup.js` | 303 | `chosenDomains()` — the ticked sites, in configured order |
| `popup.js` | 72 | `currentDomain()` — manual pick → active tab → stored, first domain last |
| `popup.js` | 82 | `tabSite()` — maps the active tab onto a configured site |
| `popup.js` | 94 | `followTab()` — moves the panel to the tab's site; reports whether it moved |
| `popup.js` | 575 | `syncToTab()` — tab-event entry; suppressed while a form is open |
| `popup.html` | 1 | Side panel markup (also the `side_panel.default_path`) |
| `popup.css` | 10 | Styles; the --user custom property is set per active user from JS |

### Following the active tab

> The panel moves itself to whichever configured site the active tab is on.

`chrome.tabs.onActivated` and `onUpdated` (filtered to `changeInfo.url`) both call
`syncToTab()` (`popup.js:575`). Three rules make it liveable:

- **An unmanaged tab changes nothing.** `followTab()` returns early when the active tab is
  not on a configured site, so checking your mail does not blank the panel.
- **A manual pick wins until the tab moves.** `selectDomain()` sets `pinnedDomain`, which
  outranks the tab until the tab lands on a *different* managed site. That is what lets you
  configure UAT while looking at DEV.
- **It never fires while a form is open.** The add/edit form is bound to the site it was
  opened on and its submit handler resolves `currentDomain()` at save time, so moving the
  site underneath would file the user against the wrong one. `wiring.test.mjs` fails the
  build if that guard, or either listener, disappears.

Host matching is `host === d || host.endsWith("." + d)` — the same rule `domainForHost()`
and `hostInScope()` use in the worker, so the panel cannot disagree with it about what
counts as "this site".

The trade-off: after *cancelling* a form, `tabDomain` can be one tab-switch stale until the
next tab event or mutation. Re-detecting on cancel was not worth an extra `tabs.query` on a
path the user is already leaving.

### Backup (export / import)

> Encrypted transfer of users and domains between machines.

| File | Line | What it is |
|------|------|------------|
| `backup.js` | 67 | `buildBackup()` — AES-GCM + PBKDF2, or plaintext if no passphrase |
| `backup.js` | 90 | `parseBackup()` — format/version validation |
| `backup.js` | 104 | `openBackup()` — decrypt (iteration count is read from the file, so old files still open) |
| `backup.js` | 132 | `mergeBackup()` — non-destructive merge; a duplicate is a same-username user already covering every site |
| `backup.js` | 36 | `deriveKey()` — PBKDF2-SHA256, 600k iterations |
| `backup.js` | 11 | `normalizeDomain()` — the only sanitizer for anything entering the domain allowlist |

---

## Shared / Infrastructure

| File | Line | What it is |
|------|------|------------|
| `storage.js` | 6 | `STORAGE_DEFAULTS` — **single** canonical shape of shared `storage.local` |
| `storage.js` | 17 | `INSTANCE_DEFAULTS` — per-instance diagnostics; never shared across profiles |
| `storage.js` | 33 | `IS_INCOGNITO` — which profile instance this code is running in |
| `storage.js` | 35 | `INSTANCE_AREA` — storage area that must not cross the profile boundary |
| `storage.js` | 56 | `readInstanceState()` — the popup's read path for the diagnostics |
| `background.js` | 75 | `getConfig()` — reads local + session storage together |
| `background.js` | 32 | `migrate()` — v1 (flat sessions) → v2 (per-domain) → v3 (`domain` → `domains` list) |
| `background.js` | 246 | `hostInScope()` — domain matching, used by cookie filtering |
| `backup.js` | 11 | `normalizeDomain()` — strips scheme/path/port, lowercases (moved here from `popup.js`) |
| `backup.js` | 28 | `domainsOf()` — **the only** way to read a user's sites; tolerates the old `domain` field |
| `popup.js` | 15 | `PALETTE` — per-user colours |
| `manifest.json` | 1 | Permissions and entry points |

---

## Entry Points

| How it starts | File | Line |
|---------------|------|------|
| Service worker boot (every spin-up) | `background.js` | 391 |
| Browser start / extension install | `background.js` | 386 |
| Auth challenge from any site | `background.js` | 160 |
| Message from popup | `background.js` | 349 |
| Side panel opened | `popup.js` | end of file (`load()`) |
| Worker state changed while panel is open | `popup.js` | `storage.onChanged` repaint listener |

---

## Key Data Models / Types

> Read these when confused about data shapes — they ripple everywhere.

| Shape | Where defined | Notes |
|-------|--------------|-------|
| `Session` | `storage.js:6` | `{id, domains[], name, username, password, color}` — `domains` is a **list**: one account often serves sibling sites. Read it via `domainsOf()` (`backup.js:28`), never as a field |
| `activeByDomain` | `storage.js:6` | `{domain → sessionId}`, one active user per domain **per profile instance**. Still keyed by domain even for a multi-site user, which is what keeps a switch scoped to one site |
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

Handlers are registered in one object at `background.js:370`. Adding a message means
adding it there; `test/wiring.test.mjs` fails if the popup sends something unhandled.

| Message | Sent from | Handled at |
|---------|-----------|------------|
| `{type:"switch", sessionId, domain}` | `popup.js:231` | `background.js:371` |
| `{type:"openAs", sessionId, url}` | `popup.js:261` | `background.js:372` |

### Popup → backup module

`popup.js:1` imports `buildBackup`, `parseBackup`, `openBackup`, `mergeBackup`.
`backup.js` deliberately touches neither DOM nor `chrome.*` so it stays testable in Node.

---

## Function Dependency Index

> Before changing any function below, read its entry to know what will break.

### Service worker core

#### `syncRules()`
- **Defined**: `background.js:107`
- **Impact**: critical — 7 call sites
- **Called by**: `switchTo` (350), `openAs` (360), `sync` message (373), `tabs.onRemoved` (386), `storage.onChanged` (390, 397), `onInstalled` (413), `onStartup` (414), worker boot (416)
- **Calls**: `getConfig` (108), `domainsOf` (126), `authRule` (131, 142), `basicHeader` and `isPrivateHost` via `authRule`
- **Side effects**: replaces all DNR session rules; writes `ruleError`
- **Change note**: rebuilds every rule from scratch — cheap and avoids drift. Rules are emitted **per domain**; a change here affects all environments at once.

#### `getConfig()`
- **Defined**: `background.js:75`
- **Impact**: critical — read by every entry point
- **Called by**: `syncRules` (108), `onAuthRequired` (189), `switchTo` (330)
- **Calls**: `chrome.storage.local.get`, `chrome.storage.session.get`, `readActiveByDomain`
- **Side effects**: none
- **Change note**: merges local and session storage into one object, then overrides `activeByDomain` with this instance's own copy — that override is what keeps a private window off the normal window's user. The shape lives in `storage.js:6` and is imported by both the worker and the popup — add new keys there, not locally. `test/wiring.test.mjs` fails if either file redeclares `DEFAULTS`.

#### `clearSiteData(domains, { flushAuthCache })`
- **Defined**: `background.js:262`
- **Impact**: high — the only destructive path left
- **Called by**: `switchTo` (351)
- **Calls**: `chrome.cookies.getAll({domain})`, `cookieUrl` (274), `chrome.cookies.remove`, `hostInScope` (270), `originsFor`
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
- **Defined**: `background.js:323`
- **Impact**: high — decides whether siblings get signed out
- **Called by**: `switchTo` (351)
- **Side effects**: none (reads `ruleError`)
- **Change note**: `cookies: true` is the only lever that drops Chrome's HTTP auth cache
  (`DATA_TYPE_COOKIES` triggers `ClearHttpAuthCache`), and for cookies Chrome widens
  `origins` to the **registrable domain** — so flushing `k2.corp.com` also signs the user
  out of `jira.corp.com`. That cost is only worth paying when the DNR header is not doing
  the job: pre-emptive off, or `ruleError` set. Must be called **after** `syncRules()` so
  `ruleError` is current. Widening this to always-true is a regression, not a simplification.

#### `switchTo(sessionId, domain)`
- **Defined**: `background.js:329`
- **Impact**: high — the extension's main action
- **Called by**: message handler (371) ← `popup.js:231`
- **Calls**: `getConfig` (330), `domainsOf` (341), `writeActiveByDomain` (349), `syncRules` (350), `needsAuthFlush` (351), `clearSiteData` (351), `reloadTabsIn` (352)
- **Side effects**: writes `activeByDomain` **to this instance only**; clears cookies; reloads tabs
- **Change note**: scoped twice over — to the **one** site named by the panel, and to the calling profile instance. Widening either breaks a guarantee: the first that switching on UAT leaves DEV signed in, the second that switching in a private window leaves the normal window alone. A user can serve several sites, so `domain` decides which one; it is checked against that user's own list and **refused** if absent rather than redirected to another site, because guessing would clear the wrong site's cookies. `domain == null` is the pre-multi-site message shape and falls back to the user's first site. `wiring.test.mjs` fails the build if the popup stops sending the site or the worker stops forwarding it.

#### `migrate()`
- **Defined**: `background.js:32`
- **Impact**: high — runs before everything
- **Called by**: worker boot (416)
- **Side effects**: rewrites `sessions`, writes `activeByDomain`, removes `activeSessionId`
- **Change note**: must stay idempotent; it runs on every worker spin-up, not just on update. No-ops in the private instance — it rewrites shared `storage.local`, which the normal profile owns. Two shape changes live here: **v1→v2** (flat list + global `activeSessionId` → per-domain) and **v2→v3** (`domain` string → `domains` list). v3 drops the old `domain` key rather than keeping both in sync; `domainsOf()` is what reads a record the popup sees before this has run.

#### `onAuthRequired` listener
- **Defined**: `background.js:185`
- **Impact**: critical — the primary mechanism
- **Calls**: `getConfig` (189), `domainForHost` (203), `noteChallenge` (207), `isPrivateHost` (217), `alreadyAttempted` (225)
- **Side effects**: writes `lastScheme`; writes `seenChallenges` (normal profile only); supplies credentials
- **Change note**: registered `asyncBlocking`. Returning without calling `callback` hangs the request. Under split incognito each instance only sees its own profile's challenges, and that is what makes per-profile credentials possible at all: `details` carries no incognito flag and `details.tabId` is `-1` for subresources, so a single shared instance could not tell them apart.

### Popup

#### `render()`
- **Defined**: `popup.js:436`
- **Impact**: critical — the only render path
- **Called by**: `load()` (71) — and `load()` is called after every mutation
- **Calls**: `renderDomainPicker` (441), `renderDomains` (442), `renderDomainChoice` (443), `userColor`, `buildRow` (543), `currentDomain` (437)
- **Side effects**: full DOM rebuild; sets `--user` custom property
- **Change note**: there is no partial rendering, with one deliberate exception: ticking a site in the picker calls `renderChoiceSummary()` and the picker's own toggle calls `renderDomainChoice()`, because a full rebuild would destroy the checkbox that currently has focus and the half-typed fields around it. Everything else goes through `load()` → `render()`.

#### `currentDomain()`
- **Defined**: `popup.js:72`
- **Impact**: critical — every user-facing list is filtered by it
- **Called by**: `render` (437), `buildRow` (231), `openUserForm` (312), `targetUrl` (555), `active-edit` handler (777), add/edit submit (783), `syncToTab` (575)
- **Side effects**: none
- **Change note**: resolves three sources in order — `pinnedDomain` (a pick from the dropdown), `tabDomain` (the site the active tab is on), then the stored `selectedDomain` — falling back to `domains[0]` when all are unset or stale (e.g. after the selected domain is deleted). The first two are **panel-local module state, never stored**: `selectedDomain` lives in shared `storage.local`, so writing browsing activity there would drag every other window's panel — and the private-window instance — around in lockstep. A pick outranks the tab only until the tab moves to a *different* managed site; making it permanent would recreate the manual-switching problem following was added to solve.

#### `openUserForm(session)`
- **Defined**: `popup.js:307`
- **Impact**: high
- **Called by**: `buildRow` edit button, `#add-toggle`, `#active-edit`
- **Change note**: `session = null` means add, otherwise edit. `closeUserForm()` calls `form.reset()`, so the submit handler must read field values **before** closing. The ticked sites live in the module-level `formDomains` Set rather than in the checkboxes, because `render()` rebuilds them; `form.reset()` does not clear it, so `closeUserForm()` and the settings toggle both empty it by hand. Saving with nothing ticked is refused — a user with no site would save and then appear in no list at all. The password field's reveal toggle (`addReveal`, `popup.js:351`) is reset to dots here and everywhere else a form is opened, closed or swapped: `form.reset()` restores an input's value but **not** its type, so a revealed password would otherwise still be on screen for whoever opens the panel next.

### Backup

#### `mergeBackup(current, payload, newId)`
- **Defined**: `backup.js:132`
- **Impact**: high — the only write path for imports
- **Called by**: `popup.js:764` (`applyImport`)
- **Side effects**: none (pure) — the caller persists the result
- **Change note**: dedupes via `covered()` (`backup.js:125`) — an incoming user is a duplicate only when one is already here with the same username covering **every** site the incoming record names. Same username plus a site not yet covered is new information and is added, so re-importing after widening a user elsewhere does not silently discard the widening. Never overwrites an existing user. `newId` is injectable purely so tests can be deterministic.

#### `buildBackup(state, passphrase)` / `openBackup(file, passphrase)`
- **Defined**: `backup.js:67`
- **Impact**: high
- **Called by**: `popup.js:705` / `popup.js:735, 752`
- **Side effects**: none
- **Change note**: a change to the file format needs a `version` bump — `parseBackup` rejects unknown versions rather than guessing. The `domain` → `domains` change deliberately did **not** bump it: export writes `domains` *and* a legacy `domain` holding the first site, so a file from here still opens in an older build (degraded to one site) instead of importing as zero users. Ids are stripped on export and regenerated on import.

---

## Not covered here

- `popup.css` — presentation only; `test/wiring.test.mjs` verifies every class used in
  markup or JS actually has a rule.
- `test/*.mjs` — the suites themselves. `background.test.mjs` runs `background.js` in a
  `node:vm` with stubbed `chrome.*` APIs.
