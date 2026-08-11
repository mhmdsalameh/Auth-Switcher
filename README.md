# K2 Multi-Session

Switch between multiple logins on an HTTP-auth protected site (K2, IIS, internal tools)
without restarting Chrome.

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

### Why clearing the auth cache doesn't log you out of everything

Chrome exposes no origin-scoped way to drop the HTTP auth cache — the only lever is a
global cookie clear. So before clearing, the extension snapshots every cookie **outside**
your configured domains and writes it back immediately afterwards. You stay logged into
Gmail, Jira, and everything else.

The settings panel reports how many cookies were restored after each clear. A small number
can fail to restore (unusual attribute combinations); those sites need a re-login.

## Install

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Pin the extension

## Setup

1. Click the extension → gear icon → enter your site domain (e.g. `k2.mycompany.com`),
   one per line. Subdomains are included automatically.
2. **+ Add session** for each test user.
3. Click any session to switch to it.

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
- Passwords are stored unencrypted in `chrome.storage.local`, readable by anyone with
  access to your Chrome profile directory. **QA accounts only — never real credentials.**
- Credentials are sent to every configured domain. Keep the domain list tight.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest, permissions |
| `background.js` | `onAuthRequired` handler, DNR rule sync, switching, auth cache clear |
| `popup.html/.css/.js` | Session list and settings UI |
