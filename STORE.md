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
Required for two reasons, both structural rather than convenience.

First, cookie preservation. Switching users requires clearing Chrome's HTTP auth cache,
and Chrome offers no origin-scoped API for it — browsingData.remove is global. To avoid
signing the user out of every unrelated site, the extension must read all cookies, perform
the clear, and write the out-of-scope ones back. chrome.cookies.getAll only returns
cookies for origins the extension holds host access to, so narrower permissions would let
the clear proceed while making the restore impossible, silently destroying every other
session the user has.

Second, the webRequest.onAuthRequired listener must be registered with its URL filter at
service-worker startup, before the user has configured any domain, and must keep working
as they add more.

Credentials are only ever supplied to domains the user explicitly configured. All other
hosts are passed through untouched. No page content is read and no scripts are injected.
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
- [ ] Screenshots (1280×800 or 640×400, at least one). **Use fake domains.** The demo
      masking on the `demo/mask-domains` branch produces exactly this.
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
