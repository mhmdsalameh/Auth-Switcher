// Runs background.js in a VM with stubbed Chrome APIs so the destructive cookie path
// can be exercised without a browser. Node has no chrome.* — everything below is a fake.
import vm from "node:vm";
import fs from "node:fs";
import assert from "node:assert/strict";

// background.js is an ES module, but vm.Script runs classic scripts. Inline every module it
// imports and drop the import lines, so the real source still executes verbatim. Anything
// background.js starts importing has to be added here or it is simply undefined at runtime.
const SHARED = ["../storage.js", "../backup.js"]
  .map((f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/^export /gm, ""))
  .join("\n");
const SRC =
  SHARED +
  "\n" +
  fs.readFileSync(new URL("../background.js", import.meta.url), "utf8")
    // Multi-line too — a single-line-only regex leaves the tail of a braced import behind
    // and the VM dies on a syntax error that looks nothing like the real cause.
    .replace(/^import\s+[\s\S]*?from\s+"[^"]*";?[ \t]*$/gm, "");

function makeChrome({ localStore = {}, sessionStore = {}, cookies = [] } = {}) {
  const calls = {
    browsingDataRemove: [], cookieRemoveFails: false, getAllQueries: [],
    rules: [], onAuthRequired: null
  };

  const area = (store) => ({
    async get(query) {
      if (query == null) return structuredClone(store);
      if (typeof query === "string") {
        return query in store ? { [query]: structuredClone(store[query]) } : {};
      }
      if (Array.isArray(query)) {
        const out = {};
        for (const k of query) if (k in store) out[k] = store[k];
        return structuredClone(out);
      }
      const out = { ...query };
      for (const k of Object.keys(query)) if (k in store) out[k] = store[k];
      return structuredClone(out);
    },
    async set(obj) { Object.assign(store, structuredClone(obj)); },
    async remove(key) { delete store[key]; },
    onChanged: { addListener() {} }
  });

  const chrome = {
    storage: { local: area(localStore), session: area(sessionStore) },
    cookies: {
      // Mirrors Chrome: the `domain` filter matches that domain and its subdomains.
      async getAll(query = {}) {
        calls.getAllQueries.push(structuredClone(query));
        const d = query.domain;
        const match = (c) => {
          const h = c.domain.replace(/^\./, "");
          return !d || h === d || h.endsWith("." + d);
        };
        return structuredClone(cookies.filter(match));
      },
      async remove({ url, name }) {
        if (calls.cookieRemoveFails) return null; // Chrome returns null on failure
        const host = new URL(url).hostname;
        const i = cookies.findIndex(
          (c) => c.name === name && c.domain.replace(/^\./, "") === host
        );
        if (i === -1) return null;
        cookies.splice(i, 1);
        return { url, name };
      }
    },
    browsingData: {
      async remove(opts, types) {
        calls.browsingDataRemove.push({ opts, types });
        if (types.cookies && !opts.origins) cookies.length = 0; // the global wipe we must never do
      }
    },
    declarativeNetRequest: {
      async getSessionRules() { return []; },
      async updateSessionRules(opts) { calls.rules.push(opts); }
    },
    webRequest: {
      onAuthRequired: { addListener(fn) { calls.onAuthRequired = fn; } }
    },
    tabs: { async query() { return []; }, async reload() {}, async create() { return { id: 1 }; }, onRemoved: { addListener() {} } },
    sidePanel: {
      async setPanelBehavior(opts) { calls.panelBehavior = opts; }
    },
    runtime: { onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } }
  };
  return { chrome, calls, cookies, localStore, sessionStore };
}

// Boots a fresh "service worker" over the given backing stores, then drains the
// microtask queue so the module-level auto-recovery has finished before we assert.
async function boot(env) {
  const ctx = vm.createContext({
    chrome: env.chrome, console: { warn() {}, log() {}, error() {} },
    TextEncoder, btoa, URL, setTimeout, structuredClone, Date, Promise, JSON
  });
  new vm.Script(SRC).runInContext(ctx);
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return ctx;
}

const seed = () => [
  { domain: "k2.corp.com", hostOnly: true, name: "SESSID", value: "a", path: "/", secure: true, httpOnly: true, sameSite: "lax", storeId: "0" },
  { domain: ".gmail.com", hostOnly: false, name: "SID", value: "b", path: "/", secure: true, httpOnly: true, sameSite: "no_restriction", storeId: "0" },
  { domain: "jira.corp.com", hostOnly: true, name: "JSESSIONID", value: "c", path: "/", secure: false, httpOnly: false, sameSite: "unspecified", storeId: "0" }
];

// Two sibling sites sharing one set of credentials — the case the multi-domain work exists
// for — plus a third site that user has nothing to do with.
const multiSite = () => {
  const cookie = (domain, name) => ({
    domain, hostOnly: true, name, value: "1", path: "/",
    secure: true, httpOnly: true, sameSite: "lax", storeId: "0"
  });
  return makeChrome({
    cookies: [cookie("k2.corp.com", "LIVE"), cookie("k2test.corp.com", "TEST"),
              cookie("jira.corp.com", "OTHER")],
    localStore: {
      domains: ["k2.corp.com", "k2test.corp.com", "jira.corp.com"],
      sessions: [
        { id: "shared", domains: ["k2.corp.com", "k2test.corp.com"], name: "QA", username: "qa", password: "p" },
        { id: "solo", domains: ["k2.corp.com"], name: "Admin", username: "adm", password: "p" }
      ],
      activeByDomain: { "k2.corp.com": "solo" }
    }
  });
};

// Credential boundary (spec R13): user a is linked to x only unless aSites says otherwise;
// user b is linked to y. Both sites configured unless `domains` says otherwise.
const boundary = ({ aSites = ["x.corp.com"], domains = ["x.corp.com", "y.corp.com"],
                    activeByDomain = {}, tabAssignments, preemptive = false } = {}) => {
  const env = makeChrome({
    localStore: {
      domains, preemptive, activeByDomain,
      sessions: [
        { id: "a", domains: aSites, name: "A", username: "a", password: "pa" },
        { id: "b", domains: ["y.corp.com"], name: "B", username: "b", password: "pb" }
      ]
    }
  });
  if (tabAssignments) env.sessionStore.tabAssignments = tabAssignments;
  return env;
};

const challenge = (env, url, tabId) => new Promise((resolve) => {
  env.calls.onAuthRequired(
    { url, scheme: "basic", requestId: String(Math.random()), tabId, isProxy: false },
    resolve
  );
});

const tests = {
  async "the selected domain's http cache is cleared, scoped to its origins"() {
    const env = makeChrome({ cookies: seed() });
    await (await boot(env)).clearSiteData(["k2.corp.com"]);

    const withCache = env.calls.browsingDataRemove.filter((r) => r.types.cache);
    assert.equal(withCache.length, 1, "the domain's own cache must actually be cleared");
    assert.deepEqual(withCache[0].opts.origins, ["https://k2.corp.com", "http://k2.corp.com"]);
  },

  async "only the selected domain is touched"() {
    const env = makeChrome({ cookies: seed() });
    const ctx = await boot(env);
    await ctx.clearSiteData(["k2.corp.com"]);

    const names = env.cookies.map((c) => c.name).sort();
    assert.deepEqual(names, ["JSESSIONID", "SID"], "other sites must be left completely alone");
    assert.equal(env.localStore.lastReset.removed, 1);
    assert.equal(env.localStore.lastReset.failed, 0);
  },

  async "no global cookie wipe is ever issued"() {
    const env = makeChrome({ cookies: seed() });
    const ctx = await boot(env);
    await ctx.clearSiteData(["k2.corp.com"], { flushAuthCache: true });

    assert.ok(env.calls.browsingDataRemove.length > 0, "a clear was issued");
    for (const { opts, types } of env.calls.browsingDataRemove) {
      assert.ok(Array.isArray(opts.origins) && opts.origins.length, "must always be origin-scoped");
    }
    assert.equal(env.cookies.length, 2, "the origins-scoped flush must not wipe the profile");
  },

  async "the auth cache is only flushed when the DNR header cannot do the job"() {
    const ctx = await boot(makeChrome());
    assert.equal(await ctx.needsAuthFlush(false), true, "pre-emptive off: cache is the only answer");
    assert.equal(await ctx.needsAuthFlush(true), false, "live DNR header overrides the cache");

    // Set after boot: syncRules() clears ruleError on every successful spin-up.
    const broken = makeChrome();
    const brokenCtx = await boot(broken);
    broken.localStore.ruleError = "rule rejected";
    assert.equal(await brokenCtx.needsAuthFlush(true), true, "rejected rule means no header is sent");
  },

  async "the flush is skipped entirely when pre-emptive is live"() {
    const env = makeChrome({ cookies: seed() });
    await (await boot(env)).clearSiteData(["k2.corp.com"], { flushAuthCache: false });

    for (const { types } of env.calls.browsingDataRemove) {
      assert.ok(!types.cookies, "no flush means sibling subdomains keep their cookies");
    }
    assert.equal(env.localStore.lastReset.authFlush, false);
  },

  async "other sites' cookies are never even read"() {
    const env = makeChrome({ cookies: seed() });
    await (await boot(env)).clearSiteData(["k2.corp.com"]);

    assert.ok(env.calls.getAllQueries.length > 0, "getAll was called");
    for (const q of env.calls.getAllQueries) {
      assert.equal(q.domain, "k2.corp.com", "every read must be scoped to the target domain");
    }
  },

  async "nothing is snapshotted or restored"() {
    const env = makeChrome({ cookies: seed() });
    await (await boot(env)).clearSiteData(["k2.corp.com"]);

    assert.ok(!("cookieSnapshot" in env.localStore), "no cookie snapshot may be written to disk");
  },

  async "subdomain cookies of the target domain are cleared too"() {
    const env = makeChrome({
      cookies: [
        ...seed(),
        { domain: ".k2.corp.com", hostOnly: false, name: "WIDE", value: "d", path: "/", secure: true, httpOnly: true, sameSite: "lax", storeId: "0" },
        { domain: "uat.k2.corp.com", hostOnly: true, name: "SUB", value: "e", path: "/", secure: true, httpOnly: true, sameSite: "lax", storeId: "0" }
      ]
    });
    await (await boot(env)).clearSiteData(["k2.corp.com"]);

    assert.deepEqual(env.cookies.map((c) => c.name).sort(), ["JSESSIONID", "SID"]);
  },

  async "a cookie that refuses to delete is reported, not retried forever"() {
    const env = makeChrome({ cookies: seed() });
    env.calls.cookieRemoveFails = true;
    await (await boot(env)).clearSiteData(["k2.corp.com"]);

    assert.equal(env.localStore.lastReset.removed, 0);
    assert.equal(env.localStore.lastReset.failed, 1);
    assert.ok(!("cookieSnapshot" in env.localStore));
  },

  async "v1 flat sessions migrate onto the first domain"() {
    const env = makeChrome({
      localStore: {
        domains: ["k2.corp.com"],
        sessions: [{ id: "s1", name: "Approver", username: "corp\\qa", password: "p" }],
        activeSessionId: "s1"
      }
    });
    await boot(env);

    assert.deepEqual(env.localStore.sessions[0].domains, ["k2.corp.com"]);
    assert.deepEqual(env.localStore.activeByDomain, { "k2.corp.com": "s1" });
    assert.ok(!("activeSessionId" in env.localStore), "the old key is removed");
  },

  async "v2 single-domain users migrate to a domain list"() {
    const env = makeChrome({
      localStore: {
        domains: ["k2.corp.com", "k2test.corp.com"],
        sessions: [{ id: "s1", domain: "k2test.corp.com", name: "A", username: "u", password: "p" }],
        activeByDomain: { "k2test.corp.com": "s1" }
      }
    });
    await boot(env);

    const [user] = env.localStore.sessions;
    assert.deepEqual(user.domains, ["k2test.corp.com"], "the one domain becomes a one-item list");
    assert.ok(!("domain" in user), "the superseded field is dropped, not left to drift");
    assert.deepEqual(env.localStore.activeByDomain, { "k2test.corp.com": "s1" },
      "who is signed in where is untouched");
  },

  async "migration leaves already-migrated data alone"() {
    const env = makeChrome({
      localStore: {
        domains: ["k2.corp.com", "k2test.corp.com"],
        sessions: [{
          id: "s1", domains: ["k2.corp.com", "k2test.corp.com"],
          name: "A", username: "u", password: "p"
        }],
        activeByDomain: { "k2.corp.com": "s1" }
      }
    });
    await boot(env);
    // Runs on every worker spin-up, so a second pass must not disturb a v3 record.
    assert.deepEqual(env.localStore.sessions[0].domains, ["k2.corp.com", "k2test.corp.com"]);
    assert.deepEqual(env.localStore.activeByDomain, { "k2.corp.com": "s1" });
  },

  async "switching a user only disturbs that user's own domain"() {
    const cookie = (domain, name) => ({
      domain, hostOnly: true, name, value: "1", path: "/",
      secure: true, httpOnly: true, sameSite: "lax", storeId: "0"
    });
    const env = makeChrome({
      cookies: [cookie("k2dev.corp.com", "DEV"), cookie("k2uat.corp.com", "UAT")],
      localStore: {
        domains: ["k2dev.corp.com", "k2uat.corp.com"],
        sessions: [
          { id: "d1", domain: "k2dev.corp.com", name: "Dev", username: "du", password: "p" },
          { id: "u1", domain: "k2uat.corp.com", name: "Uat", username: "uu", password: "p" }
        ],
        activeByDomain: {}
      }
    });
    await (await boot(env)).switchTo("u1");

    assert.deepEqual(env.localStore.activeByDomain, { "k2uat.corp.com": "u1" });
    assert.deepEqual(env.cookies.map((c) => c.name), ["DEV"],
      "the other environment must keep its session");
  },

  // The whole point of multi-domain users: one credential set, several sibling sites, but
  // switching still only ever disturbs the site the panel was showing.
  async "switching a multi-site user only touches the site the panel named"() {
    const env = multiSite();
    await (await boot(env)).switchTo("shared", "k2test.corp.com");

    assert.deepEqual(env.localStore.activeByDomain,
      { "k2.corp.com": "solo", "k2test.corp.com": "shared" },
      "only the named site changes hands");
    assert.deepEqual(env.cookies.map((c) => c.name).sort(), ["LIVE", "OTHER"],
      "the site nobody was looking at keeps its session");
  },

  async "a site the user does not serve cannot widen the switch"() {
    const env = multiSite();
    // A stale panel, or anything else that got a message onto the channel, naming a site
    // this user has nothing to do with. It must not become the scope of a cookie wipe.
    await (await boot(env)).switchTo("shared", "jira.corp.com");

    assert.deepEqual(env.localStore.activeByDomain, { "k2.corp.com": "solo" },
      "an unserved site is never signed in to, and no other site is switched instead");
    assert.deepEqual(env.cookies.map((c) => c.name).sort(), ["LIVE", "OTHER", "TEST"],
      "the request is refused outright, so nothing is cleared anywhere");
  },

  async "a switch with no site named falls back to the user's first"() {
    const env = multiSite();
    await (await boot(env)).switchTo("shared");

    assert.equal(env.localStore.activeByDomain["k2.corp.com"], "shared");
    assert.deepEqual(env.cookies.map((c) => c.name).sort(), ["OTHER", "TEST"],
      "only the fallback site is cleared");
  },

  async "a multi-site user is only served where they are the active one"() {
    const env = multiSite();
    env.localStore.preemptive = true;
    const ctx = await boot(env);
    await ctx.switchTo("shared", "k2test.corp.com");

    const { addRules } = env.calls.rules.at(-1);
    const served = addRules.map((r) => [r.condition.requestDomains[0], r.action.requestHeaders[0].value]);
    const forTest = served.filter(([d]) => d === "k2test.corp.com");
    const forLive = served.filter(([d]) => d === "k2.corp.com");

    assert.equal(forTest.length, 1, "the site just switched gets exactly one rule");
    assert.notEqual(forTest[0][1], forLive[0]?.[1],
      "the other site keeps its own signed-in user's header, not this one's");
  },

  async "a pinned tab carries its user across every site that user serves"() {
    const env = multiSite();
    env.localStore.preemptive = true;
    env.sessionStore.tabAssignments = { 7: "shared" };
    await boot(env);

    const { addRules } = env.calls.rules.at(-1);
    const pinned = addRules.filter((r) => r.condition.tabIds?.includes(7));
    assert.deepEqual([...pinned.map((r) => r.condition.requestDomains[0])].sort(),
      ["k2.corp.com", "k2test.corp.com"],
      "both of the user's sites are covered in that tab");
    // One rule per domain, because the https-only anchor applies to a whole rule and an
    // intranet site in the same list would otherwise lose pre-emptive mode.
    assert.ok(pinned.every((r) => r.condition.requestDomains.length === 1),
      "each site gets its own rule so it can carry its own scheme anchor");
  },

  async "challenged hosts are recorded most-recent-first, deduped and capped"() {
    const env = makeChrome();
    const ctx = await boot(env);
    for (const h of ["a.corp.com", "b.corp.com", "a.corp.com", "c.corp.com", "d.corp.com"]) {
      await ctx.noteChallenge(h);
    }
    assert.deepEqual(env.localStore.seenChallenges, ["d.corp.com", "c.corp.com", "a.corp.com"]);
  },

  async "pre-emptive rules are https-only on public hosts, unrestricted on intranet ones"() {
    const ctx = await boot(makeChrome());
    const session = { username: "u", password: "p" };

    const publicRule = ctx.authRule(1, 1, session, ["k2.corp.com"], {});
    assert.equal(publicRule.condition.urlFilter, "|https://",
      "a public host must never receive Basic credentials over plain http");

    for (const intranet of ["k2server", "localhost", "10.0.0.5", "192.168.1.9", "k2.local"]) {
      const rule = ctx.authRule(1, 1, session, [intranet], {});
      assert.equal(rule.condition.urlFilter, undefined,
        `${intranet} is intranet and is routinely http-only — it must keep working`);
    }
  },

  async "Basic credentials are withheld from a public host over plain http"() {
    const env = makeChrome({
      localStore: {
        domains: ["k2.corp.com"],
        sessions: [{ id: "s1", domain: "k2.corp.com", name: "A", username: "u", password: "secret" }],
        activeByDomain: { "k2.corp.com": "s1" }
      }
    });
    await boot(env);

    const answer = (url, scheme) => new Promise((resolve) => {
      env.calls.onAuthRequired(
        { url, scheme, requestId: String(Math.random()), tabId: -1, isProxy: false },
        resolve
      );
    });

    // Objects built inside the VM have a foreign prototype, so compare keys, not shapes.
    assert.deepEqual(Object.keys(await answer("http://k2.corp.com/x", "basic")), [],
      "the password must not go out in the clear");
    assert.equal(env.localStore.insecureHost, "k2.corp.com", "and the popup must be told why");

    const overTls = await answer("https://k2.corp.com/x", "basic");
    assert.equal(overTls.authCredentials.password, "secret", "https is still answered");
    assert.equal(env.localStore.insecureHost, null, "the warning clears once a login succeeds");

    const digest = await answer("http://k2.corp.com/x", "digest");
    assert.equal(digest.authCredentials.password, "secret",
      "digest never puts the password on the wire, so http is fine");
  },

  async "R13 pinned tab gets no credentials on a site its user lacks"() {
    const env = boundary({ tabAssignments: { 5: "a" }, activeByDomain: { "y.corp.com": "b" } });
    await boot(env);
    const reply = await challenge(env, "https://y.corp.com/", 5);
    assert.deepEqual(Object.keys(reply), [], "no credentials, and no fallback to y's signed-in user");
  },

  async "R13 signed-in user not linked to the site gets none"() {
    const env = boundary({ activeByDomain: { "y.corp.com": "a" } });
    await boot(env);
    assert.deepEqual(Object.keys(await challenge(env, "https://y.corp.com/", -1)), []);
  },

  async "R13 pinned user linked to the site still answered"() {
    const env = boundary({ tabAssignments: { 5: "a" }, aSites: ["x.corp.com", "y.corp.com"] });
    await boot(env);
    const reply = await challenge(env, "https://y.corp.com/", 5);
    assert.equal(reply.authCredentials.username, "a");
  },

  async "R13 a site no longer configured is never answered, even for a linked user"() {
    const env = boundary({ activeByDomain: { "x.corp.com": "a" }, domains: ["y.corp.com"] });
    await boot(env);
    assert.deepEqual(Object.keys(await challenge(env, "https://x.corp.com/", -1)), []);
  },

  async "R13 syncRules pinned rules skip stale sites"() {
    const env = boundary({ preemptive: true, tabAssignments: { 5: "a" }, aSites: ["x.corp.com", "stale.corp.com"] });
    await boot(env);
    const pinned = env.calls.rules.at(-1).addRules.filter((r) => r.condition.tabIds?.includes(5));
    assert.deepEqual([...pinned.map((r) => r.condition.requestDomains[0])], ["x.corp.com"]);
  },

  async "R13 syncRules no active rule for an unlinked signed-in user"() {
    const env = boundary({ preemptive: true, activeByDomain: { "x.corp.com": "a", "y.corp.com": "a" } });
    await boot(env);
    const sites = [...env.calls.rules.at(-1).addRules.map((r) => r.condition.requestDomains[0])];
    assert.deepEqual(sites, ["x.corp.com"], "a's rule on x only; y gets no header");
  },

  async "auth retry guard survives worker termination"() {
    const env = makeChrome();
    assert.equal(await (await boot(env)).alreadyAttempted("req-1"), false, "first challenge is answered");
    assert.equal(await (await boot(env)).alreadyAttempted("req-1"), true, "second is refused after a restart");
  }
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${name}\n        ${e.message}`);
  }
}
console.log(failed ? `\n${failed} failing` : `\nAll ${Object.keys(tests).length} passing`);
process.exit(failed ? 1 : 0);
