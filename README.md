# Auth Switcher - HTTP Multi-Login

Hold several logins for the same HTTP-auth protected site and switch between them without
restarting Chrome. Built for QA work on internal tools — IIS, K2, and anything else that
uses the browser's own credential prompt.

Made by **Mohammad Salameh**.

> Not affiliated with, endorsed by, or produced by Nintex or K2 Software, Inc. "K2" is
> named only to describe a system this tool works with.

## Why closing the tab didn't work

The login you described — a popup that isn't part of the page HTML — is Chrome's native
credential dialog, triggered by a `401` with a `WWW-Authenticate` header. It is **not** a
cookie login.

Chrome stores those credentials in an in-memory **HTTP auth cache**, keyed by origin. That
cache is not cleared by closing tabs, and not cleared by "Clear browsing data → Cached
images and files". It normally survives until the browser is fully restarted. That is
exactly the behaviour you were fighting.

## How this works

**Default path — challenge-response.** `webRequest.onAuthRequired` answers the credential
prompt with the active session's credentials. Works for Basic, Digest and NTLM.

Because Chrome caches the result, switching sessions clears that domain's cookies and web
storage, reloads matching tabs, and flushes the HTTP auth cache when nothing else can make
the switch take effect.

**Optional — pre-emptive** (`Send credentials pre-emptively`, off by default). A
`declarativeNetRequest` rule attaches `Authorization: Basic …` to every request for your
domains, so the server never sends a `401`. Faster and fully deterministic, but **Basic
auth only** — an unsolicited Authorization header breaks the NTLM/Negotiate handshake and
login will fail outright. Only turn this on if the side panel reports Basic.

### Basic auth is never sent over plain http to a public host

Basic puts the password on the wire in base64, which is not encryption. Over `http://` on a
routable domain, anyone on the path can read it — so the extension refuses, on both paths:
the pre-emptive rule is anchored to `https://`, and the challenge handler declines and lets
Chrome's own dialog take over. The side panel says which host was withheld from.

Intranet addresses are exempt, because http-only internal tools are the whole point:
loopback, `10.x`, `192.168.x`, `172.16–31.x`, single-label names like `k2server`, and
`.local` / `.internal` / `.intranet`. Digest, NTLM and Negotiate are never restricted —
none of them put the password on the wire.

### What a switch actually deletes

A switch touches **only the domain you are switching on**. Nothing is snapshotted, nothing
is restored, and no other site's cookies are read at all.

1. Cookies for that domain and its subdomains are removed one by one via
   `chrome.cookies.remove`. The read is scoped with `cookies.getAll({ domain })`, so
   cookies belonging to sites you did not configure are never even loaded.
2. The HTTP cache, `localStorage`, IndexedDB, CacheStorage and service workers are
   cleared for that domain's origins only.
3. Chrome's HTTP auth cache is flushed **only when it is the thing standing in your way**
   — see below.

Earlier versions cleared every cookie in the profile and wrote the out-of-scope ones back
afterwards. That is gone. It was also the cause of a real bug: a site that rotates its
session cookie could have the restored value already invalidated server-side, so you were
signed out even though the restore "succeeded".

### The auth-cache flush, and what it costs

`browsingData.remove` with `cookies: true` is the only call in the extension API that drops
Chrome's in-memory HTTP auth cache — `DATA_TYPE_COOKIES` is what triggers
`ClearHttpAuthCache` internally. With an `origins` filter that flush is **scoped**, not
global.

It is not free, though. For cookies Chrome widens `origins` to the **registrable domain**
(eTLD+1), deliberately, matching `Clear-Site-Data` semantics. Flushing `k2.corp.com`
therefore also signs you out of `jira.corp.com`. Unrelated sites are untouched, but
siblings under the same registrable domain are not.

So the flush is conditional. In pre-emptive mode the DNR rule attaches an explicit
`Authorization` header, and Chrome adds cached credentials first and then merges the
request's own headers over the top — a same-named header overwrites, so the explicit header
wins and the cache is irrelevant. When pre-emptive is on and its rule installed cleanly, no
flush is issued. When pre-emptive is off, or Chrome rejected the rule, the cache is the only
thing answering and the flush is the only way to make the switch take effect.

`lastReset` records what happened (`removed`, `failed`, `authFlush`) for diagnostics. It is
not surfaced in the UI.

## The UI is a side panel

The extension opens in Chrome's **side panel**, not a toolbar popup. Click the toolbar icon
to open it; it stays open while you click around the page and while you switch tabs, and
closes only via the panel's own close button or the toolbar icon.

This is deliberate and not a preference. Chrome documents that an action popup "automatically
close[s] when the user focuses on some portion of the browser outside of the popup" and that
"there is no way to keep the popup open after the user has clicked away" — a Chromium feature
request for a lock API was rejected. A side panel is the only surface that survives losing
focus, so the panel is what makes a switch observable: it stays up and repaints to the new
active user instead of vanishing on click.

## Private windows are a separate session

A private (incognito) window runs its **own** signed-in user, independent of your normal
windows. Switch to Approver in a private window and your normal window stays on whoever it
was — and vice versa. That gives you two live users at once without the ↗ button's
stateless-site caveat, because Chrome gives private windows their own cookie jar and their
own HTTP auth cache.

The status bar in the side panel shows `private` so you can tell which session you are looking
at.

Your **users and domains are shared** with private windows — you do not have to re-add
them. Only the active selection is separate. Nothing a private window *does* is written to
disk: its active user and its diagnostics live in session memory and vanish when the last
private window closes.

A private window opens on whatever user your normal window is currently signed in as, then
diverges from there once you switch.

> Requires **Allow in Incognito** for the extension (`chrome://extensions` → Details) — you
> have to tick it yourself; nothing can turn it on for you. Once it is on, `"incognito":
> "split"` in the manifest is what makes Chrome run a second, fully independent copy of the
> extension for private browsing rather than one shared copy serving both. Leave the box
> unticked and the extension simply does not run in private windows at all.

## Moving to another browser or laptop

Settings &#9881; → **Backup**.

- **Export…** asks for a passphrase and downloads `auth-switcher-users-YYYY-MM-DD.json`. With a
  passphrase the file is AES-256-GCM encrypted, key derived by PBKDF2-SHA256 (600k
  iterations, random salt) — safe to send over email, Teams or a USB stick. Leave the
  passphrase blank and **the file contains your passwords in plain text**.
- **Import…** merges rather than replaces. A user is skipped and never overwritten when one
  is already here with the same username covering every site the file lists for them, so
  re-importing the same file is harmless. A file that names a site you don't cover yet is
  new information, so that user is added rather than dropped.

Ids are regenerated on import, and domains from the file are added to your list. Only
users and domains travel — not the auth cache or per-tab pins, which are machine-specific.

Remember unpacked extensions key their storage to the folder path, so an export is also
the only way to survive moving this folder.

## Tests

```
npm test
```

40 checks. A static wiring pass (manifest, DOM ids, CSS classes, message contracts, 27
regression guards) plus two suites: the backup crypto/merge path, and `background.js`
executed in a VM with stubbed Chrome APIs — covering the scoped clear (only the target
domain is touched, other sites' cookies are never read, subdomains are included, the
auth-cache flush stays conditional), the refusal to send Basic credentials over plain
http, and the guarantee that switching a user shared across sites only ever disturbs the
one the panel is showing.

## Install

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Pin the extension

## Setup

1. Open the site once and let the sign-in prompt appear, then click the extension → gear icon.
   The host that asked for credentials is offered there — click **Add**. Failing that, use
   **This site** to take the current tab's domain, or type it. Subdomains are included
   automatically.
2. **Add user** for each test account. A new user starts on the domain tab that's selected.
3. Click any user to switch to them.

Each domain gets its own tab and its own set of users, and tracks its own signed-in user.
Switching on UAT clears and reloads only UAT — your DEV and PROD sessions are untouched.

### The site picker follows your tabs

The panel moves itself to whichever configured site the active tab is on, so switching from
a DEV tab to a UAT one brings up UAT's users without touching the dropdown. Three things
keep that from being annoying:

- A tab on a site you don't manage changes nothing — the panel stays where it was.
- Picking from the dropdown by hand wins until you move to a *different* managed site, so
  you can sit on DEV and configure UAT.
- It never moves while the add/edit form is open, so a user can't be saved against the
  wrong site.

### One account, several sites

Sibling sites are often the same account — `k2.corp.com` and `k2test.corp.com` usually take
the same login. Once you have more than one domain configured, the add/edit user form grows
a **Sites this user can sign in to** picker: tick every site the account works on and the
user appears under each of them, so there is no copy-pasting a password between tabs. A
shared user is marked with a `2 sites` badge, and editing or deleting one there changes it
everywhere.

Switching still only ever touches the site you are looking at. Signing in as that user on
`k2test` leaves whoever is signed in on `k2` exactly where they were — each site keeps
tracking its own active user.

## Which scheme am I on?

After one login attempt, the side panel tells you (Basic / Digest / NTLM / Negotiate). To check
manually: DevTools → Network → the `401` request → Response Headers → `WWW-Authenticate`.

- **Basic** → you may optionally enable pre-emptive credentials for faster switching.
- **Digest / NTLM / Negotiate** → leave pre-emptive off. Switching handles the cache
  clearing for you; no manual step.

## The ↗ button (multiple sessions at once)

Pins a new tab to a specific session, so tab A and tab B send different credentials
simultaneously.

**This only holds if the site is stateless.** If it issues its own session cookie after
auth, both tabs share that cookie and collapse back to one user — cookies are per-profile
in Chrome and cannot be scoped to a tab. Treat it as a bonus; the switcher is the reliable
path.

## Limits

- **Negotiate/Kerberos with SSO configured** (`AuthServerAllowlist` policy) never prompts
  and never fires `onAuthRequired`. No extension can intercept it. Use separate Chrome
  profiles or `runas /netonly` instead.
- Passwords are stored unencrypted in `chrome.storage.local` (shared with private windows), readable by anyone with
  access to your Chrome profile directory. **QA accounts only — never real credentials.**
- Credentials are sent to every configured domain **and all of its subdomains**. Keep the
  domain list tight and specific.
- Any *other* extension you have installed with `webRequest` and permission on the same
  host can read the `Authorization` header this one injects. That is inherent to how Chrome
  exposes requests to extensions — installing this means trusting your other extensions too.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest, permissions |
| `background.js` | `onAuthRequired` handler, DNR rule sync, switching, scoped site-data clear, side-panel behavior |
| `storage.js` | Canonical storage shape, profile isolation (`INSTANCE_AREA`) |
| `backup.js` | Export/import crypto, merge, domain normalization |
| `popup.html/.css/.js` | Session list and settings UI |
| `test/` | `npm test` — static wiring checks plus a VM-stubbed worker suite |
