# Privacy Policy — Auth Switcher

Last updated: 15 August 2026
Contact: hammoudahsalameh@gmail.com

## The short version

This extension has no server. Nothing it stores is transmitted anywhere. There is no
analytics, no telemetry, no crash reporting, no remote code, and no third party of any kind.
Everything below happens entirely inside your own copy of Chrome.

## What it stores, and why

| Data | Why | Where it is kept |
|---|---|---|
| Usernames and passwords you type into it | To answer the HTTP authentication prompt on the sites you configure | `chrome.storage.local`, on your machine |
| The domain list you configure | To decide which sites may receive those credentials | `chrome.storage.local`, on your machine |
| Which user is currently selected per domain | To know who to sign in as | Session storage, per browser profile |
| The authentication scheme a site asked for (Basic / Digest / NTLM / Negotiate) | To warn you when a setting is unsafe for your site | Session storage, per browser profile |
| Hosts that prompted for credentials but are not configured | To offer them as a one-click suggestion. Capped at 3, most recent first | `chrome.storage.local`, on your machine |

## How your credentials are used

Credentials are sent to one place: the site you configured them for, as the answer to that
site's own HTTP authentication challenge. They are never sent anywhere else, never sent to
the developer, and never sent to any third party.

Two restrictions are enforced in code:

- Credentials are only ever offered to a domain in your configured list, or a subdomain of
  one. Everything else is ignored.
- Basic authentication is refused over unencrypted `http://` to a public host, because Basic
  puts the password on the wire in a trivially reversible encoding. Intranet addresses are
  exempt, since internal http-only tools are the reason this extension exists.

## What a switch deletes

Switching users deletes data for **the domain you are switching on, and nothing else**.
Cookies for that domain and its subdomains are removed individually; its HTTP cache,
`localStorage`, IndexedDB, CacheStorage and service workers are cleared. Your other sites
are not touched, and their cookies are never read — the read is scoped to the target domain
at the API level.

Earlier versions worked differently: they cleared every cookie in your profile and wrote the
other sites' cookies back afterwards, which meant a copy of every cookie you held was
written to extension storage — unencrypted, on disk, in a normal window — for the seconds a
switch took. **That no longer happens.** Nothing is copied, stored or restored.

### The one exception: the auth-cache flush

Chrome's HTTP authentication cache is what keeps you signed in as the previous user, and the
only lever that drops it also deletes cookies for the whole **registrable domain**. Flushing
`k2.corp.com` therefore also signs you out of `jira.corp.com`. Sites outside that registrable
domain are never affected.

The extension only pays that cost when it has to. In pre-emptive mode the credential header
it attaches overrides the cache outright, so no flush is issued at all. The flush happens
only when pre-emptive is off, or when Chrome rejected the rule — the cases where the switch
would otherwise silently keep serving the previous user.

## Storage is not encrypted

Passwords are stored as you typed them, not encrypted. Anyone with read access to your
Chrome profile directory — another user of the same account, backup software, or malware
running as you — can read them.

This extension is built for QA and test accounts on internal systems. **Do not put
credentials in it that would matter if they leaked.**

Backup files you export are encrypted with AES-256-GCM if you set a passphrase, and are
written in plain text if you leave the passphrase blank. The export dialog says so at the
time.

## Private windows

A private window runs a separate instance with its own selected user and its own
diagnostics, neither of which is written to disk. Your saved user list
and domain list are deliberately shared with private windows so you do not have to type them
twice.

## What is never collected

No browsing history. No page content. No keystrokes. No personal information. No location.
No device identifiers. No usage statistics. The extension does not read the pages you visit;
it only sees the authentication challenges that sites issue, and only acts on the ones for
domains you configured.

## Data sharing and sale

None. There is no recipient to share with. Data is not sold, not transferred, and not used
for advertising, creditworthiness, or lending. It is not used for any purpose other than the
single feature described above.

## Deletion

Removing the extension from Chrome deletes everything it stored. Individual users and
domains can be deleted at any time from the extension's own interface.

## Permissions, and why each is needed

| Permission | Why it is required |
|---|---|
| `webRequest`, `webRequestAuthProvider` | The only way to answer an HTTP authentication challenge programmatically |
| `declarativeNetRequest` | Optional pre-emptive mode: attaches the credential header so no challenge occurs |
| `cookies` | To delete the selected domain's own cookies, one by one. Other sites' cookies are never read |
| `browsingData` | To clear the selected domain's web storage, and to flush the HTTP auth cache for that domain when nothing else can make a switch take effect |
| `storage` | To hold your users and domains |
| `sidePanel` | To show the extension's UI in Chrome's side panel, which stays open when you click elsewhere. An action popup cannot |
| `tabs` | To reload the affected tabs after a switch, and to offer the current tab's domain |
| `<all_urls>` | The authentication listener must be registered before you configure any domain, so it cannot be scoped in advance. Credentials are only ever supplied to the domains you configure |

## Changes

Material changes to this policy will be published in the extension's repository alongside a
version bump.
