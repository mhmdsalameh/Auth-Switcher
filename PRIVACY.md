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
| A temporary copy of your browser cookies | See "The cookie snapshot" below | Session or local storage, deleted immediately after use |

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

## The cookie snapshot

Switching users requires clearing Chrome's HTTP authentication cache. Chrome offers no way
to clear that cache for one site, so the only available lever clears cookies for everything.
To avoid signing you out of every other site you use, the extension copies your other
cookies, performs the clear, and writes them straight back.

That copy exists only for the seconds a switch takes, and is deleted as soon as the cookies
are restored. It is written to extension storage rather than held in memory so that it can
survive Chrome shutting the extension's background process down mid-switch — without that,
an unlucky moment would lose every login you have. It is never transmitted anywhere.

**In a normal window this copy is written to disk unencrypted while it exists.** In a private
window it is held in memory only.

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

A private window runs a separate instance with its own selected user, its own cookie
snapshot, and its own diagnostics, none of which are written to disk. Your saved user list
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
| `cookies` | To copy and restore your other sites' cookies around the required clear |
| `browsingData` | To clear the HTTP authentication cache, which is what makes switching work |
| `storage`, `unlimitedStorage` | To hold your users and domains, and the temporary cookie snapshot |
| `tabs` | To reload the affected tabs after a switch, and to offer the current tab's domain |
| `<all_urls>` | The authentication listener must be registered before you configure any domain, so it cannot be scoped in advance. Credentials are only ever supplied to the domains you configure |

## Changes

Material changes to this policy will be published in the extension's repository alongside a
version bump.
