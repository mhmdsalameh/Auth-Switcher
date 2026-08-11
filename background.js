// Per-request auth injection + session switching for HTTP-auth protected sites.
//
// Two cooperating mechanisms:
//   1. declarativeNetRequest injects "Authorization: Basic ..." pre-emptively, so the
//      server never issues a 401 and Chrome's HTTP auth cache is never consulted.
//      This is what makes switching deterministic, and what makes per-tab sessions possible.
//   2. webRequest.onAuthRequired answers any challenge that still gets through
//      (Digest and NTLM cannot be pre-empted with a static header).

const ALL_RESOURCE_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"
];

// preemptive defaults off: it only suits Basic auth, and sending an unsolicited
// Authorization header breaks NTLM/Negotiate sites outright.
const DEFAULTS = { sessions: [], domains: [], activeSessionId: null, preemptive: false };

async function getConfig() {
  const local = await chrome.storage.local.get(DEFAULTS);
  const { tabAssignments = {} } = await chrome.storage.session.get("tabAssignments");
  return { ...local, tabAssignments };
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
  const { sessions, domains, activeSessionId, tabAssignments, preemptive } = await getConfig();
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existing.map((r) => r.id);
  const addRules = [];

  if (preemptive && domains.length) {
    let id = 1;
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const assignedTabIds = [];

    for (const [tabId, sessionId] of Object.entries(tabAssignments)) {
      const session = byId.get(sessionId);
      if (!session) continue;
      assignedTabIds.push(Number(tabId));
      addRules.push(authRule(id++, 2, session, domains, { tabIds: [Number(tabId)] }));
    }

    const active = byId.get(activeSessionId);
    if (active) {
      // Everything not explicitly pinned to a tab uses the active session.
      const extra = assignedTabIds.length ? { excludedTabIds: assignedTabIds } : {};
      addRules.push(authRule(id++, 1, active, domains, extra));
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

const attempted = new Set(); // requestIds we have already answered once

chrome.webRequest.onAuthRequired.addListener(
  async (details, callback) => {
    if (details.isProxy) return callback({});

    const { sessions, domains, activeSessionId, tabAssignments } = await getConfig();

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
    const inScope = domains.some((d) => host === d || host.endsWith("." + d));
    if (!inScope) return callback({});

    // Answering the same request twice means the credentials were rejected.
    // Let the native dialog appear rather than looping.
    if (attempted.has(details.requestId)) return callback({});
    attempted.add(details.requestId);
    setTimeout(() => attempted.delete(details.requestId), 60_000);

    const sessionId = tabAssignments[details.tabId] ?? activeSessionId;
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

// Chrome exposes no origin-scoped way to drop the HTTP auth cache — clearing cookies
// globally is the only lever. So we snapshot every out-of-scope cookie first and write
// it back afterwards, which keeps the user logged into every other site.
async function clearAuthCache(domains) {
  let preserved = [];
  try {
    const all = await chrome.cookies.getAll({});
    preserved = all.filter((c) => !hostInScope(c.domain, domains)).map(toSetDetails);
  } catch (e) {
    console.warn("cookie snapshot failed, skipping restore", e);
  }

  await chrome.browsingData.remove({}, { cookies: true });

  const results = await Promise.allSettled(preserved.map((d) => chrome.cookies.set(d)));
  const lost = results.filter((r) => r.status === "rejected" || !r.value).length;
  await chrome.storage.local.set({
    lastReset: { at: Date.now(), restored: preserved.length - lost, lost }
  });
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
  const { domains } = await getConfig();
  await chrome.storage.local.set({ activeSessionId: sessionId });
  await syncRules();
  await clearSiteState(domains);
  await clearAuthCache(domains);
  await reloadTabsIn(domains);
}

async function resetAuth() {
  const { domains } = await getConfig();
  await clearAuthCache(domains);
  await syncRules();
  await reloadTabsIn(domains);
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
    resetAuth: () => resetAuth(),
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

chrome.runtime.onInstalled.addListener(syncRules);
chrome.runtime.onStartup.addListener(syncRules);
