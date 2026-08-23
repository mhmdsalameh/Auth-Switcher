// Runs background.js in a VM with stubbed Chrome APIs so the destructive cookie path
// can be exercised without a browser. Node has no chrome.* — everything below is a fake.
import vm from "node:vm";
import fs from "node:fs";
import assert from "node:assert/strict";

// background.js is an ES module, but vm.Script runs classic scripts. Inline the shared
// module and drop the import so the real source still executes verbatim.
const SHARED = fs
  .readFileSync(new URL("../storage.js", import.meta.url), "utf8")
  .replace(/^export /gm, "");
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

    assert.equal(env.localStore.sessions[0].domain, "k2.corp.com");
    assert.deepEqual(env.localStore.activeByDomain, { "k2.corp.com": "s1" });
    assert.ok(!("activeSessionId" in env.localStore), "the old key is removed");
  },

  async "migration leaves already-migrated data alone"() {
    const env = makeChrome({
      localStore: {
        domains: ["k2.corp.com"],
        sessions: [{ id: "s1", domain: "k2.corp.com", name: "A", username: "u", password: "p" }],
        activeByDomain: { "k2.corp.com": "s1" }
      }
    });
    await boot(env);
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
