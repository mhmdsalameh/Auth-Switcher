# Chrome Web Store submission pack

Everything the dashboard asks for, written out so it can be pasted in rather than
improvised at 11pm. Visibility: **Unlisted** to start.

> Unlisted is not a lighter review. Chrome's distribution docs state that *all visibility
> settings have the same policy requirements and go through the same review process.*
> Unlisted only removes the listing from search and browse; anyone with the URL can install.
> You can switch to Public later from the same dashboard dropdown — the item ID and install
> URL stay the same, and the change triggers a fresh review at the public bar.

---

## Listing

**Name**
`Auth Switcher - HTTP Multi-Login`

**Short description** (132 char limit — this is 94)
`Hold several HTTP-auth logins for one site and switch between them without restarting Chrome.`

**Category**: Developer Tools
**Language**: English

**Detailed description**

```
Sites protected by HTTP authentication — the credential box Chrome itself draws, not a
login form on the page — are painful to test with more than one account. Chrome keeps
those credentials in an in-memory auth cache that closing the tab does not clear, that
"clear browsing data" does not clear, and that normally survives until you fully restart
the browser.

Auth Switcher holds as many logins as you need for a site and switches between them in
one click.

• Works with Basic, Digest, NTLM and Negotiate
• Multiple sites, each with its own set of users and its own signed-in user — switching
  on UAT leaves DEV alone
• Private windows run their own independent session, so you can hold two users at once
• Switching does not sign you out of your other sites: your cookies elsewhere are
  preserved across the clear that switching requires
• Encrypted export/import (AES-256-GCM) to move your users to another machine
• No server, no analytics, no telemetry, no remote code — nothing leaves your browser

Built for QA and test accounts on internal tools: IIS, K2, and anything else that uses
the browser's own credential prompt.

IMPORTANT: credentials are stored unencrypted in Chrome's extension storage, readable by
anyone with access to your Chrome profile directory. This is a QA tool. Do not put
credentials in it that would matter if they leaked.

Not affiliated with, endorsed by, or produced by Nintex or K2 Software, Inc.
```

**Homepage URL**
`https://mhmdsalameh.github.io/Auth-Switcher/`

**Privacy policy URL**
`https://mhmdsalameh.github.io/Auth-Switcher/privacy.html`

> Requires GitHub Pages: repo **Settings → Pages → Source: Deploy from a branch →
> `main` / `/docs` → Save**. Live about a minute later.
>
> Fallback that works without Pages, already reachable:
> `https://github.com/mhmdsalameh/Auth-Switcher/blob/main/PRIVACY.md`
> It renders fine and is accepted, but it is GitHub's UI around a source file rather than
> a page of your own — the Pages URL is the better look on a store listing.

**Screenshots** — `store/screenshots/`, 1280×800, upload in this order. The store shows the
first image largest and most often, so the fullest screen leads and the empty state is last.

| # | File | Says |
|---|------|------|
| 1 | `01-switch.png` | Switch between logins instantly |
| 2 | `02-per-site.png` | Each site tracks its own signed-in user |
| 3 | `03-domains.png` | Credentials go only where you say |
| 4 | `04-backup.png` | Encrypted backup and restore |
| 5 | `05-empty.png` | No server, no telemetry, nothing to configure |

Every capture uses `demo.test` and throwaway accounts. No internal hostname appears in any
of them — check that again if you ever re-shoot these.

---

## Single purpose

> Store and supply HTTP authentication credentials for user-configured sites, so a tester
> can switch between multiple logins on the same site without restarting the browser.

Every permission below traces to that one sentence. Keep it that way — a second unrelated
feature is what turns a single-purpose extension into a rejected one.

---

## Permission justifications

Paste each into the matching box. Reviewers are looking for a specific feature, not a
restatement of what the API does.

**`webRequest` + `webRequestAuthProvider`**
```
The extension's core function is answering HTTP authentication challenges. In Manifest V3,
webRequest.onAuthRequired with webRequestAuthProvider is the only supported way to supply
credentials to a challenge programmatically. The listener supplies credentials only for
domains the user has explicitly configured; challenges from any other host are passed
through untouched.
```

**`declarativeNetRequest`**
```
Optional feature, off by default. For Basic-auth sites the user may enable pre-emptive
mode, which attaches the Authorization header via a session rule so the server never
issues a 401. This makes switching deterministic. Rules are generated only for
user-configured domains and are anchored to https:// for any public host.
```

**`cookies`**
```
Switching users requires clearing Chrome's HTTP auth cache. Chrome exposes no origin-
scoped API for that cache; a global cookie clear is the only available lever. To avoid
signing the user out of every unrelated site, the extension reads the user's cookies,
performs the clear, then immediately writes back every cookie outside the configured
domains. Reading them is the only way to restore them.
```

**`browsingData`**
```
Performs the cookie clear described above, which is what drops the HTTP auth cache and
makes a switch take effect. Also clears localStorage, IndexedDB, cache storage and service
workers for the user's configured domains only, so the previous user's session state does
not leak into the next one.
```

**`storage` + `unlimitedStorage`**
```
Stores the user's list of logins and domains, and the temporary cookie snapshot taken
during a switch. unlimitedStorage is required because that snapshot can contain thousands
of cookies on an established profile and would otherwise exceed the storage quota, which
would abort the switch.
```

**`tabs`**
```
After a switch, reloads only the tabs on the affected domain so they re-authenticate as
the new user. Also reads the active tab's URL for the "use this site" shortcut when adding
a domain. Tab contents are never read or injected into.
```

**Host permission `<all_urls>`**
```
This permission is used to put the user's cookies back after a switch. It is not used to
access the sites those cookies belong to.

Switching accounts requires clearing Chrome's HTTP auth cache. Chrome provides no API to
clear that cache for a single origin. The only mechanism that clears it is
chrome.browsingData.remove with cookies:true, and that call is global: it deletes every
cookie in the profile, for every site, and it does so whether or not the extension holds
host permissions.

So the extension reads all cookies first, performs the clear, and immediately writes back
every cookie belonging to a site the user did not configure. The user stays signed in to
their email, their issue tracker, and everything else.

chrome.cookies.getAll only returns cookies for origins the extension holds host access
to. This produces an asymmetry that is the entire reason for the broad permission:

  - browsingData.remove deletes everything, regardless of host permissions.
  - cookies.getAll can only read, and therefore only restore, what it has access to.

With a narrower host permission the destructive half of that pair would still run at full
scope while the recovery half could only cover the user's own configured domains. The
result would be that every unrelated session the user has is destroyed on every switch,
with no way to recover it. The broad permission is what makes the feature safe, not what
makes it risky.

Scope limits, all enforced in code:
  - Credentials are only ever supplied to domains the user explicitly added. Every other
    host is passed through untouched.
  - Cookies outside those domains are only read in order to be written back unchanged,
    within the same operation. They are never inspected, transmitted or retained.
  - No page content is read. No scripts are injected. No content scripts are declared.
  - The extension makes no network requests of its own and contacts no server.
```

---

## Test instructions for the reviewer

**The dashboard field is capped at 500 characters.** Paste this (497):

```
No login: this holds credentials for OTHER sites. Use httpbin.org, which issues a real 401.
1. Popup > gear > add domain: httpbin.org
2. Add user Alice / alice / wonderland
3. Add user Bob / bob / builder
4. Select Alice, open httpbin.org/basic-auth/alice/wonderland
5. Select Bob, open httpbin.org/basic-auth/bob/builder
Both load with no prompt; the body names the user. Chrome caches the first login till restart, so step 5 is the feature.
Full: mhmdsalameh.github.io/Auth-Switcher/testing.html
```

The long version below is published at
`https://mhmdsalameh.github.io/Auth-Switcher/testing.html` (`docs/testing.html`), which is
what that last line points at. Keep the two in sync if either changes.

The extension has no account and no login of its own, so there is nothing to hand over —
but a reviewer cannot exercise it without a site that issues an HTTP auth challenge.
httpbin.org is used below because the accepted credentials are part of the URL, so two
different accounts can be created on one host, and the response body names whichever
account authenticated. That makes the result visible rather than inferred.

```
The extension itself has no account, no login and no server, so there are no credentials
to provide for it. It stores credentials for OTHER sites.

To test it you need a site that issues an HTTP authentication challenge. httpbin.org
provides one publicly, and the credentials it accepts are part of the URL, so you can
create two separate accounts on the same host. The response body names whichever account
authenticated, so the result is directly visible.

Takes about two minutes.

SETUP
1. Install and pin the extension. Click its toolbar icon.
2. Click the gear icon to open Settings.
3. In "Site domains", type: httpbin.org
   Press Enter. It appears as a chip.
4. Click the gear again to leave Settings.

ADD TWO ACCOUNTS
5. Click "Add user". Enter:
      Label:    Alice
      Username: alice
      Password: wonderland
   Save.
6. Click "Add user" again. Enter:
      Label:    Bob
      Username: bob
      Password: builder
   Save.

VERIFY THE FIRST ACCOUNT
7. The popup shows "Signed in as" one of the two. Click the other name to make Alice the
   active user, then open this URL in a tab:

      https://httpbin.org/basic-auth/alice/wonderland

   Expected: the page loads WITHOUT Chrome showing a credential prompt, and the body is
      { "authenticated": true, "user": "alice" }
   The extension answered the 401 challenge on your behalf.

VERIFY SWITCHING
8. Open the extension popup and click "Bob".
   The popup closes, the tab reloads, and the popup now reads "Signed in as Bob".
9. Open this URL:

      https://httpbin.org/basic-auth/bob/builder

   Expected: loads without a prompt, body is
      { "authenticated": true, "user": "bob" }

   This is the core feature. Without the extension, Chrome caches the first set of
   credentials for httpbin.org in memory and reuses them until the browser is fully
   restarted, so the second account could not be reached in the same session.

VERIFY OTHER SESSIONS SURVIVE THE SWITCH
10. Before switching, sign in to any unrelated site (any site where you have a session).
11. Switch users in the extension, then reload that unrelated site.
    Expected: you are still signed in there.

    Switching clears Chrome's HTTP auth cache, and the only API that does so clears all
    cookies globally. The extension snapshots every cookie outside the configured domains
    and restores it immediately afterwards. This step demonstrates that the broad host
    permission is used for restoring the user's sessions, not for accessing those sites.

OPTIONAL - Digest authentication
12. Add domain httpbin.org (already added) and a user with username "digestuser" and
    password "digestpass", then open:

      https://httpbin.org/digest-auth/auth/digestuser/digestpass

    Expected: authenticates without a prompt. Digest is handled by the same listener.

OPTIONAL - private window isolation
13. Enable "Allow in Incognito" for the extension at chrome://extensions -> Details.
    Open a private window, open the popup there and switch to a different user than the
    one selected in your normal window.
    Expected: each window keeps its own signed-in user independently.

NOTES
- The extension deliberately refuses to send Basic credentials over plain http:// to a
  public host, because Basic is reversible base64. Intranet addresses are exempt. All the
  test URLs above are https, so this does not interfere.
- No credentials, cookies or browsing data are transmitted anywhere. The extension makes
  no network requests of its own.
```

---

## Data usage disclosures

Tick **Authentication information** — Chrome's policy names "logins, passwords, and
authentication cookies" explicitly, and this extension stores exactly that.

Do not tick: PII, health, financial, personal communications, location, web history, or
user activity. None are collected.

Three required certifications, all of which are true here:
- Not being sold to third parties
- Not being used or transferred for any purpose unrelated to the single purpose
- Not being used or transferred to determine creditworthiness or for lending

**Remote code**: No. Everything executes from the packaged files; there is no `eval`, no
remote script, no WASM fetched at runtime.

> Note the policy tightening effective 1 Aug 2026: data collection must be *strictly
> necessary* to the single purpose and prominently disclosed. Re-read
> developer.chrome.com/blog/cws-policy-updates-2026 at submission time in case it moved
> again.

---

## Before you upload

- [x] ~~Regenerate the icon.~~ Done — key with a circulating swap arrow, no lettering,
      no trademark. Source art kept at `icons/source.jpg`; rebuild with
      `python tools/make-icons.py icons/source.jpg`.
- [x] ~~Screenshots.~~ Done — five at 1280×800 in `store/screenshots/`, upload in filename
      order. Raw popup captures are in `store/raw/`; re-compose with
      `python tools/make-screenshots.py` after any UI change.
- [ ] Privacy policy hosted at a public URL and pasted into the dashboard.
- [ ] Zip the extension without `test/`, `tools/`, `.git`, `*.md`, `package.json`.
- [ ] Bump `version` in `manifest.json` on every re-upload — the store rejects a repeat.
- [ ] Load the zip unpacked one last time and do a real switch. The suite covers logic,
      not Chrome's actual behaviour.

**Packaging command**

```
git archive --format=zip -o ../auth-switcher-1.1.0.zip HEAD \
  ':!test' ':!tools' ':!docs' ':!*.md' ':!LICENSE' ':!package.json' ':!.gitignore' \
  ':!icons/source.jpg'
```

`icons/source.jpg` is the 1024px master art — it is excluded because shipping a 60 KB
image the extension never loads is exactly the kind of thing that draws a question.

---

## Known findings, disclosed deliberately

These are in `PRIVACY.md` and the README rather than hidden. If a reviewer raises them,
the honest answer is already written down.

| Finding | Status |
|---|---|
| Credentials stored unencrypted at rest | Disclosed in listing, privacy policy and UI. Encrypting behind a user passphrase is the fix if this ever goes public. |
| Cookie snapshot written to disk unencrypted during a switch | Disclosed. Fix is `storage.session` + `chrome.alarms` for crash recovery. |
| Pre-emptive DNR rules lack `initiatorDomains` (CSRF amplifier) | Open. Needs two rules — navigations unrestricted, subresources initiator-scoped — and real browser testing. Only applies when pre-emptive is enabled, which is off by default. |
| Any other extension with `webRequest` can read the injected header | Inherent to Chrome's model. Documented in the README. |
