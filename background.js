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
  SNAPSHOT_KEY,
  IS_INCOGNITO,
  INSTANCE_AREA,
  readActiveByDomain,
  writeActiveByDomain
} from "./storage.js";

const ALL_RESOURCE_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"
];

// preemptive defaults off: it only suits Basic auth, and sending an unsolicited
// Authorization header breaks NTLM/Negotiate sites outright.
// v1 stored a flat session list with one global activeSessionId.
async function migrate() {
  if (IS_INCOGNITO) return;
  const stored = await chrome.storage.local.get(["sessions", "domains", "activeSessionId"]);
  const sessions = stored.sessions ?? [];
  if (stored.activeSessionId === undefined && sessions.every((s) => s.domain)) return;

  const home = stored.domains?.[0] ?? null;
  const activeByDomain = (await chrome.storage.local.get({ activeByDomain: {} })).activeByDomain;
  if (stored.activeSessionId && home) activeByDomain[home] ??= stored.activeSessionId;

  await chrome.storage.local.set({
    sessions: sessions.map((s) => ({ ...s, domain: s.domain ?? home })),
    activeByDomain
  });
  await chrome.storage.local.remove("activeSessionId");
}

function domainForHost(host, domains) {
  const h = host.toLowerCase();
  return domains.find((d) => h === d || h.endsWith("." + d)) ?? null;
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
  return {
    id,
    priority,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "Authorization", operation: "set", value: basicHeader(session) }
      ]
    },
    condition: { requestDomains: domains, resourceTypes: ALL_RESOURCE_TYPES, ...condExtra }
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
      if (!session?.domain) continue;
      assignedTabIds.push(Number(tabId));
      addRules.push(authRule(id++, 2, session, [session.domain], { tabIds: [Number(tabId)] }));
    }

    // One rule per domain, each carrying that domain's own signed-in user.
    for (const domain of domains) {
      const active = byId.get(activeByDomain[domain]);
      if (!active) continue;
      const extra = assignedTabIds.length ? { excludedTabIds: assignedTabIds } : {};
      addRules.push(authRule(id++, 1, active, [domain], extra));
    }
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
    await chrome.storage.local.set({ ruleError: null });
  } catch (e) {
    // Chrome refuses modifyHeaders rules it considers unsafe. Surface it instead of
    // failing silently — onAuthRequired still covers us, just less deterministically.
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
    await chrome.storage.local.set({ ruleError: String(e.message ?? e) });
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
      await chrome.storage.local.set({ lastScheme: details.scheme.toLowerCase() });
    }

    let host;
    try {
      host = new URL(details.url).hostname;
    } catch {
      return callback({});
    }
    const domain = domainForHost(host, domains);
    if (!domain) {
      // We know exactly which host is asking for credentials, so the popup can offer it
      // rather than making the user type a domain correctly from memory.
      await noteChallenge(host);
      return callback({});
    }

    // Answering the same request twice means the credentials were rejected.
    // Let the native dialog appear rather than looping.
    if (await alreadyAttempted(details.requestId)) return callback({});

    const sessionId = tabAssignments[details.tabId] ?? activeByDomain[domain];
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return callback({});

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

// chrome.cookies.set is not a straight round-trip of chrome.cookies.get — hostOnly is
// expressed by *omitting* domain, and a few attribute combinations are rejected.
function toSetDetails(c) {
  const details = {
    url: cookieUrl(c),
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    storeId: c.storeId
  };
  if (!c.hostOnly) details.domain = c.domain;
  if (c.expirationDate) details.expirationDate = c.expirationDate;
  if (c.partitionKey) details.partitionKey = c.partitionKey;
  // SameSite=None is only valid on a Secure cookie.
  if (c.sameSite && c.sameSite !== "unspecified") {
    details.sameSite = c.sameSite === "no_restriction" && !c.secure ? "lax" : c.sameSite;
  }
  return details;
}

const MAX_RESTORE_ATTEMPTS = 3;

// Writes back whatever is left in the persisted snapshot. Idempotent: re-setting a cookie
// that already exists is a harmless overwrite, so running this twice costs nothing.
// Only cookies that still failed are kept, so retries shrink monotonically.
async function restoreSnapshot() {
  const { [SNAPSHOT_KEY]: snap } = await INSTANCE_AREA.get(SNAPSHOT_KEY);
  if (!snap?.cookies?.length) {
    if (snap) await INSTANCE_AREA.remove(SNAPSHOT_KEY);
    return { restored: 0, lost: 0 };
  }

  const attempts = (snap.attempts ?? 0) + 1;
  const results = await Promise.allSettled(snap.cookies.map((d) => chrome.cookies.set(d)));
  const failed = snap.cookies.filter(
    (_, i) => results[i].status === "rejected" || !results[i].value
  );

  if (failed.length && attempts < MAX_RESTORE_ATTEMPTS) {
    await INSTANCE_AREA.set({ [SNAPSHOT_KEY]: { cookies: failed, attempts } });
  } else {
    // Give up rather than retry a permanently invalid cookie on every startup forever.
    await INSTANCE_AREA.remove(SNAPSHOT_KEY);
  }
  return { restored: snap.cookies.length - failed.length, lost: failed.length };
}

// Chrome exposes no origin-scoped way to drop the HTTP auth cache — clearing cookies
// globally is the only lever. So we snapshot every out-of-scope cookie first and write
// it back afterwards, which keeps the user logged into every other site.
async function clearAuthCache(domains) {
  let preserved = [];
  try {
    const all = await chrome.cookies.getAll({});
    preserved = all.filter((c) => !hostInScope(c.domain, domains)).map(toSetDetails);
  } catch (e) {
    console.warn("cookie snapshot failed, skipping clear to avoid data loss", e);
    return;
  }

  // Persist before the destructive step. If the worker is terminated between the clear
  // and the restore, the next spin-up picks the snapshot back up instead of losing every
  // login. If this write fails we must NOT clear — there would be no way back.
  try {
    await INSTANCE_AREA.set({ [SNAPSHOT_KEY]: { cookies: preserved, attempts: 0 } });
  } catch (e) {
    await chrome.storage.local.set({
      lastReset: { at: Date.now(), restored: 0, lost: 0, aborted: String(e.message ?? e) }
    });
    return;
  }

  await chrome.browsingData.remove({}, { cookies: true });

  const { restored, lost } = await restoreSnapshot();
  await chrome.storage.local.set({ lastReset: { at: Date.now(), restored, lost } });
}

async function clearSiteState(domains) {
  if (!domains.length) return;
  await chrome.browsingData.remove(
    { origins: originsFor(domains) },
    { localStorage: true, cacheStorage: true, indexedDB: true, serviceWorkers: true }
  );
}

async function reloadTabsIn(domains) {
  if (!domains.length) return;
  const tabs = await chrome.tabs.query({ url: domains.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]) });
  await Promise.all(tabs.map((t) => chrome.tabs.reload(t.id, { bypassCache: true })));
}

// Switching always drops the auth cache — that is the whole point of the extension, and
// with cookie preservation it is cheap enough to do unconditionally.
async function switchTo(sessionId) {
  const { sessions, activeByDomain } = await getConfig();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session?.domain) return;

  // Scoped to this user's own domain, so other environments keep their sessions.
  const scope = [session.domain];
  await writeActiveByDomain({ ...activeByDomain, [session.domain]: sessionId });
  await syncRules();
  await clearSiteState(scope);
  await clearAuthCache(scope);
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    switch: () => switchTo(msg.sessionId),
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

chrome.runtime.onInstalled.addListener(syncRules);
chrome.runtime.onStartup.addListener(syncRules);

// Runs on every worker spin-up, not just browser start: if a previous clear was cut short
// by the worker being terminated, restoreSnapshot is what puts the cookies back.
migrate()
  .then(syncRules)
  .then(restoreSnapshot)
  .catch((e) => console.warn("startup recovery failed", e));
