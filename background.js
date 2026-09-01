// Per-request auth injection + session switching for HTTP-auth protected sites.
//
// Two cooperating mechanisms:
//   1. declarativeNetRequest injects "Authorization: Basic ..." pre-emptively, so the
//      server never issues a 401 and Chrome's HTTP auth cache is never consulted.
//      This is what makes switching deterministic, and what makes per-tab sessions possible.
//   2. webRequest.onAuthRequired answers any challenge that still gets through
//      (Digest and NTLM cannot be pre-empted with a static header).

import {
  STORAGE_DEFAULTS,
  IS_INCOGNITO,
  INSTANCE_AREA,
  readActiveByDomain,
  writeActiveByDomain
} from "./storage.js";
import { domainsOf } from "./backup.js";

const ALL_RESOURCE_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"
];

// preemptive defaults off: it only suits Basic auth, and sending an unsolicited
// Authorization header breaks NTLM/Negotiate sites outright.
//
// Two shape changes have happened to a stored user:
//   v1 → v2: one flat list with a single global activeSessionId, no per-user domain.
//   v2 → v3: the `domain` string became a `domains` list, so one set of credentials can
//            serve sibling sites (k2.corp.com and k2test.corp.com are the same account).
// Both run here, and this must stay idempotent — it runs on every worker spin-up.
async function migrate() {
  if (IS_INCOGNITO) return;
  const stored = await chrome.storage.local.get(["sessions", "domains", "activeSessionId"]);
  const sessions = stored.sessions ?? [];

  const needsV2 = stored.activeSessionId !== undefined;
  const needsV3 = sessions.some((s) => !Array.isArray(s.domains));
  if (!needsV2 && !needsV3) return;

  const home = stored.domains?.[0] ?? null;
  const activeByDomain = (await chrome.storage.local.get({ activeByDomain: {} })).activeByDomain;
  if (stored.activeSessionId && home) activeByDomain[home] ??= stored.activeSessionId;

  await chrome.storage.local.set({
    // `domain` is dropped rather than kept in sync: two fields meaning the same thing is
    // how they drift. domainsOf() is what reads a record that has not been through here yet.
    sessions: sessions.map(({ domain, ...rest }) => {
      const owned = domainsOf({ ...rest, domain: domain ?? home });
      return { ...rest, domains: owned };
    }),
    activeByDomain
  });
  await chrome.storage.local.remove("activeSessionId");
}

function domainForHost(host, domains) {
  const h = host.toLowerCase();
  return domains.find((d) => h === d || h.endsWith("." + d)) ?? null;
}

// Basic auth is base64, i.e. cleartext on the wire. Over plain http on the public internet
// that is an interception waiting to happen — but intranet hosts served over http are this
// extension's whole reason to exist, so those keep working.
function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return true;
  if (!h.includes(".")) return true; // single-label intranet name, e.g. "k2server"
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".intranet")) return true;
  if (/^127\.|^10\.|^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

async function getConfig() {
  const local = await chrome.storage.local.get(STORAGE_DEFAULTS);
  const { tabAssignments = {} } = await chrome.storage.session.get("tabAssignments");
  return { ...local, activeByDomain: await readActiveByDomain(), tabAssignments };
}

function basicHeader({ username, password }) {
  // RFC 7617: UTF-8 encode the credentials before base64.
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return "Basic " + btoa(String.fromCharCode(...bytes));
}

function authRule(id, priority, session, domains, condExtra) {
  const condition = { requestDomains: domains, resourceTypes: ALL_RESOURCE_TYPES, ...condExtra };
  // Anchored at the start of the URL, so the header is only ever attached over TLS.
  // Skipped for intranet hosts, which are routinely http-only.
  if (!domains.every(isPrivateHost)) condition.urlFilter = "|https://";

  return {
    id,
    priority,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "Authorization", operation: "set", value: basicHeader(session) }
      ]
    },
    condition
  };
}

// Rebuilds the full session-rule set from scratch. Cheap, and avoids drift.
async function syncRules() {
  const { sessions, domains, activeByDomain, tabAssignments, preemptive } = await getConfig();
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existing.map((r) => r.id);
  const addRules = [];

  if (preemptive && domains.length) {
    let id = 1;
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const assignedTabIds = [];

    for (const [tabId, sessionId] of Object.entries(tabAssignments)) {
      const session = byId.get(sessionId);
      const owned = domainsOf(session);
      if (!owned.length) continue;
      assignedTabIds.push(Number(tabId));
      // A pinned tab carries this user across every site they are configured for, so
      // following a link from k2 to k2test stays the same identity.
      //
      // One rule per domain rather than one rule listing them all: authRule's https-only
      // anchor applies to the whole rule, so a user spanning an http-only intranet host and
      // a public one would otherwise have to either drop the anchor or lock the intranet
      // host out of pre-emptive mode. Split, each domain gets the anchor it needs.
      for (const domain of owned) {
        addRules.push(authRule(id++, 2, session, [domain], { tabIds: [Number(tabId)] }));
      }
    }

    // One rule per domain, each carrying that domain's own signed-in user. Keyed by domain
    // rather than by user, so a user configured for several domains is only served on the
    // ones where they are actually the active one.
    for (const domain of domains) {
      const active = byId.get(activeByDomain[domain]);
      if (!active) continue;
      const extra = assignedTabIds.length ? { excludedTabIds: assignedTabIds } : {};
      addRules.push(authRule(id++, 1, active, [domain], extra));
    }
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
    await INSTANCE_AREA.set({ ruleError: null });
  } catch (e) {
    // Chrome refuses modifyHeaders rules it considers unsafe. Surface it instead of
    // failing silently — onAuthRequired still covers us, just less deterministically.
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
    await INSTANCE_AREA.set({ ruleError: String(e.message ?? e) });
  }
}

// ---- Challenge fallback (Digest / NTLM / anything not pre-empted) -----------

// Tracks requestIds we have already answered once. Held in storage.session rather than
// module scope: MV3 terminates the worker aggressively, and losing this mid-handshake
// would let us re-answer with the same rejected password in a loop.
async function alreadyAttempted(requestId) {
  const { authAttempts = {} } = await chrome.storage.session.get("authAttempts");
  const now = Date.now();
  for (const [id, ts] of Object.entries(authAttempts)) {
    if (now - ts > 60_000) delete authAttempts[id];
  }
  const seen = authAttempts[requestId] !== undefined;
  authAttempts[requestId] = now;
  await chrome.storage.session.set({ authAttempts });
  return seen;
}

// Most-recent-first list of hosts that challenged us while out of scope, offered in the
// popup as a one-click way to configure the domain. Capped so it stays a suggestion.
async function noteChallenge(host) {
  // A private window's browsing must not surface as a suggestion in the normal one.
  if (IS_INCOGNITO) return;
  const { seenChallenges = [] } = await chrome.storage.local.get("seenChallenges");
  if (seenChallenges[0] === host) return;
  const next = [host, ...seenChallenges.filter((h) => h !== host)].slice(0, 3);
  await chrome.storage.local.set({ seenChallenges: next });
}

chrome.webRequest.onAuthRequired.addListener(
  async (details, callback) => {
    if (details.isProxy) return callback({});

    const { sessions, domains, activeByDomain, tabAssignments } = await getConfig();

    // Record the scheme so the popup can tell the user what they're actually up against.
    if (details.scheme) {
      await INSTANCE_AREA.set({ lastScheme: details.scheme.toLowerCase() });
    }

    let url;
    try {
      url = new URL(details.url);
    } catch {
      return callback({});
    }
    const host = url.hostname;
    const domain = domainForHost(host, domains);
    if (!domain) {
      // We know exactly which host is asking for credentials, so the popup can offer it
      // rather than making the user type a domain correctly from memory.
      await noteChallenge(host);
      return callback({});
    }

    // Basic hands the password over in base64. Refuse to do that unencrypted to a public
    // host and let Chrome's own dialog take over, so the choice is at least a conscious one.
    // Digest/NTLM/Negotiate never put the password on the wire, so they are left alone.
    if (
      details.scheme?.toLowerCase() === "basic" &&
      url.protocol === "http:" &&
      !isPrivateHost(host)
    ) {
      await INSTANCE_AREA.set({ insecureHost: host });
      return callback({});
    }

    // Answering the same request twice means the credentials were rejected.
    // Let the native dialog appear rather than looping.
    if (await alreadyAttempted(details.requestId)) return callback({});

    const sessionId = tabAssignments[details.tabId] ?? activeByDomain[domain];
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return callback({});

    await INSTANCE_AREA.set({ insecureHost: null });
    callback({
      authCredentials: { username: session.username, password: session.password }
    });
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

// ---- Switching -------------------------------------------------------------

function originsFor(domains) {
  return domains.flatMap((d) => [`https://${d}`, `http://${d}`]);
}

function hostInScope(host, domains) {
  const h = host.replace(/^\./, "").toLowerCase();
  return domains.some((d) => h === d || h.endsWith("." + d));
}

function cookieUrl(c) {
  return `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path}`;
}

// Everything the selected domain owns, and nothing else.
//
// This deliberately does NOT use browsingData.remove for cookies. That call is global
// whenever `origins` is omitted, and its origins filter matches an exact origin rather
// than the domain tree — it would miss `.k2.corp.com` and every subdomain cookie. Reading
// and removing per cookie is the only way to hit exactly the same set `hostInScope`
// defines, which is what lets us promise no other site is ever touched.
async function clearSiteData(domains, { flushAuthCache = false } = {}) {
  if (!domains.length) return;

  // Scoped read: `domain` matches that domain and its subdomains, so no cookie belonging
  // to an unrelated site is ever even read, let alone written to extension storage.
  const found = await Promise.all(
    domains.map((d) => chrome.cookies.getAll({ domain: d }).catch(() => []))
  );
  const mine = found.flat().filter((c) => hostInScope(c.domain, domains));

  const results = await Promise.allSettled(
    mine.map((c) => {
      const details = { url: cookieUrl(c), name: c.name, storeId: c.storeId };
      // A partitioned cookie is only removable by naming its partition.
      if (c.partitionKey) details.partitionKey = c.partitionKey;
      return chrome.cookies.remove(details);
    })
  );
  const removed = results.filter((r) => r.status === "fulfilled" && r.value).length;

  // Every type here honours `origins` (Chrome documents the filter as supported for
  // "cookies, storage and cache"), so this call only ever reaches the target domain.
  // Anything added later must be checked against that list — a type that ignores `origins`
  // would silently turn this into a profile-wide wipe.
  const types = {
    cache: true, localStorage: true, cacheStorage: true, indexedDB: true, serviceWorkers: true
  };

  // `cookies: true` is the only lever in the whole extension API that drops Chrome's
  // in-memory HTTP auth cache: DATA_TYPE_COOKIES is what triggers ClearHttpAuthCache, and
  // with an origins filter that clear is scoped rather than global.
  //
  // The cost: for cookies (and therefore for the auth cache) Chrome widens `origins` to the
  // *registrable domain*, deliberately, matching Clear-Site-Data. Flushing k2.corp.com also
  // signs the user out of jira.corp.com. So we only pay it when it is the only thing that
  // can make the switch take effect — see needsAuthFlush().
  if (flushAuthCache) types.cookies = true;

  await chrome.browsingData.remove({ origins: originsFor(domains) }, types);

  await INSTANCE_AREA.set({
    lastReset: {
      at: Date.now(), domains: [...domains], removed,
      failed: mine.length - removed, authFlush: flushAuthCache
    }
  });
}

async function reloadTabsIn(domains) {
  if (!domains.length) return;
  const tabs = await chrome.tabs.query({ url: domains.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]) });
  await Promise.all(tabs.map((t) => chrome.tabs.reload(t.id, { bypassCache: true })));
}

// Switching always drops the auth cache — that is the whole point of the extension, and
// with cookie preservation it is cheap enough to do unconditionally.
// A pre-emptive Authorization header beats the auth cache outright: Chrome adds the cached
// credentials first, then merges the request's own headers over the top, and a same-named
// header overwrites. So when the DNR rule is actually live there is nothing to flush. When
// it is not — pre-emptive off, or Chrome rejected the rule — the cache is the only thing
// answering, and without a flush the switch silently keeps serving the previous user.
async function needsAuthFlush(preemptive) {
  if (!preemptive) return true;
  const { ruleError } = await INSTANCE_AREA.get({ ruleError: null });
  return !!ruleError;
}

async function switchTo(sessionId, domain = null) {
  const { sessions, activeByDomain, preemptive } = await getConfig();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return;

  // A user can serve several sites, and each site tracks its own signed-in user. The panel
  // names the one it is showing; switching every site this user covers would clear cookies
  // and reload tabs on a site the user was not even looking at.
  //
  // A named site is checked against this user's own list rather than trusted, and a site
  // they do not serve is refused outright rather than quietly redirected to another one —
  // that only happens when the panel is out of sync with storage, and guessing which site
  // was meant would clear the wrong one's cookies. No site named at all is the older
  // message shape, which predates multi-site users and can only have meant their first.
  const owned = domainsOf(session);
  const target = domain == null ? owned[0] : domain;
  if (!target || !owned.includes(target)) return;

  // Scoped to that one domain, so other environments keep their sessions.
  const scope = [target];
  await writeActiveByDomain({ ...activeByDomain, [target]: sessionId });
  await syncRules();
  await clearSiteData(scope, { flushAuthCache: await needsAuthFlush(preemptive) });
  await reloadTabsIn(scope);
}

async function openAs(sessionId, url) {
  const tab = await chrome.tabs.create({ url });
  const { tabAssignments = {} } = await chrome.storage.session.get("tabAssignments");
  tabAssignments[tab.id] = sessionId;
  await chrome.storage.session.set({ tabAssignments });
  await syncRules();
  await chrome.tabs.reload(tab.id, { bypassCache: true });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Nothing outside this extension can reach onMessage today (no content scripts, no
  // externally_connectable). This guard is here so that stays true if either is ever added
  // — openAs binds a tab to a stored credential set and must never be web-reachable.
  if (sender.id !== chrome.runtime.id) return false;

  const handlers = {
    switch: () => switchTo(msg.sessionId, msg.domain),
    openAs: () => openAs(msg.sessionId, msg.url),
    sync: () => syncRules()
  };
  const run = handlers[msg.type];
  if (!run) return false;
  run().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
  return true; // keep the channel open for the async response
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { tabAssignments = {} } = await chrome.storage.session.get("tabAssignments");
  if (tabAssignments[tabId] === undefined) return;
  delete tabAssignments[tabId];
  await chrome.storage.session.set({ tabAssignments });
  await syncRules();
});

chrome.storage.local.onChanged.addListener((changes) => {
  if (changes.sessions || changes.domains || changes.preemptive) syncRules();
});

// The popup writes the active user to this instance's own area; in a private window that is
// storage.session, which the local listener above never sees.
if (IS_INCOGNITO) {
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.activeByDomain) syncRules();
  });
}

// The UI is a side panel, not an action popup: Chrome closes a popup the moment focus
// leaves it and documents that as unavoidable ("there is no way to keep the popup open
// after the user has clicked away"). A side panel stays put until it is closed. With no
// default_popup in the manifest, this is what makes the toolbar icon open the panel.
async function enableSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    console.warn("side panel behavior could not be set", e);
  }
}

chrome.runtime.onInstalled.addListener(() => { syncRules(); enableSidePanel(); });
chrome.runtime.onStartup.addListener(() => { syncRules(); enableSidePanel(); });

migrate()
  .then(syncRules)
  .then(enableSidePanel)
  .catch((e) => console.warn("startup sync failed", e));
