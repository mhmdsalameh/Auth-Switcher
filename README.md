# Auth Switcher — HTTP Multi-Login

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

Because Chrome caches the result, switching sessions clears the HTTP auth cache, clears
web storage for your domains, and reloads matching tabs.

**Optional — pre-emptive** (`Send credentials pre-emptively`, off by default). A
`declarativeNetRequest` rule attaches `Authorization: Basic …` to every request for your
domains, so the server never sends a `401`. Faster and fully deterministic, but **Basic
auth only** — an unsolicited Authorization header breaks the NTLM/Negotiate handshake and
login will fail outright. Only turn this on if the popup reports Basic.

### Basic auth is never sent over plain http to a public host

Basic puts the password on the wire in base64, which is not encryption. Over `http://` on a
routable domain, anyone on the path can read it — so the extension refuses, on both paths:
the pre-emptive rule is anchored to `https://`, and the challenge handler declines and lets
Chrome's own dialog take over. The popup says which host was withheld from.

Intranet addresses are exempt, because http-only internal tools are the whole point:
loopback, `10.x`, `192.168.x`, `172.16–31.x`, single-label names like `k2server`, and
`.local` / `.internal` / `.intranet`. Digest, NTLM and Negotiate are never restricted —
none of them put the password on the wire.

### Why clearing the auth cache doesn't log you out of everything

Chrome exposes no origin-scoped way to drop the HTTP auth cache — the only lever is a
global cookie clear. So before clearing, the extension snapshots every cookie **outside**
your configured domains and writes it back immediately afterwards. You stay logged into
Gmail, Jira, and everything else.

A small number can fail to restore (unusual attribute combinations); those sites need a
re-login. The count is recorded under `lastReset` for diagnostics — read it from the
extension's storage if you need it; it is not surfaced in the UI.

While a switch is in flight, that snapshot — every cookie you hold for every other site —
is written to extension storage so it can survive the service worker being killed. In a
normal window that storage is on disk and unencrypted, which is strictly weaker than
Chrome's own cookie store. It is deleted as soon as the cookies are restored.

The snapshot is written **before** the clear, so if Chrome terminates the service worker
mid-operation the cookies are restored on the next spin-up rather than lost. If the
snapshot cannot be written at all, the clear is abandoned instead of leaving you with no
way back.

## Private windows are a separate session

A private (incognito) window runs its **own** signed-in user, independent of your normal
windows. Switch to Approver in a private window and your normal window stays on whoever it
was — and vice versa. That gives you two live users at once without the ↗ button's
stateless-site caveat, because Chrome gives private windows their own cookie jar and their
own HTTP auth cache.

The status bar in the popup shows `private` so you can tell which session you are looking
at.

Your **users and domains are shared** with private windows — you do not have to re-add
them. Only the active selection is separate. Nothing a private window *does* is written to
disk: its active user, its cookie snapshot and its diagnostics all live in session memory
and vanish when the last private window closes.

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
- **Import…** merges rather than replaces. A user already present for the same domain and
  username is skipped and never overwritten, so re-importing the same file is harmless.

Ids are regenerated on import, and domains from the file are added to your list. Only
users and domains travel — not the auth cache or per-tab pins, which are machine-specific.

Remember unpacked extensions key their storage to the folder path, so an export is also
the only way to survive moving this folder.

## Tests

```
npm test
```

23 checks. A static wiring pass (manifest, DOM ids, CSS classes, message contracts,
regression guards) plus two suites: the backup crypto/merge path, and `background.js`
executed in a VM with stubbed Chrome APIs — covering the destructive cookie path (crash
recovery, the retry cap, the abort-on-unwritable-snapshot guard, hostOnly/SameSite
round-tripping) and the refusal to send Basic credentials over plain http.

## Install

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Pin the extension

## Setup

1. Open the site once and let the sign-in prompt appear, then click the extension → gear icon.
   The host that asked for credentials is offered there — click **Add**. Failing that, use
   **This site** to take the current tab's domain, or type it. Subdomains are included
   automatically.
2. **Add user** for each test account. Users belong to the domain tab that's selected.
3. Click any user to switch to them.

Each domain gets its own tab and its own set of users, and tracks its own signed-in user.
Switching on UAT clears and reloads only UAT — your DEV and PROD sessions are untouched.

## Which scheme am I on?

After one login attempt, the popup tells you (Basic / Digest / NTLM / Negotiate). To check
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
| `background.js` | `onAuthRequired` handler, DNR rule sync, switching, auth cache clear |
| `storage.js` | Canonical storage shape, profile isolation (`INSTANCE_AREA`) |
| `backup.js` | Export/import crypto, merge, domain normalization |
| `popup.html/.css/.js` | Session list and settings UI |
| `test/` | `npm test` — static wiring checks plus a VM-stubbed worker suite |
