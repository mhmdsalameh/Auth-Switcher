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
    browsingDataRemove: [], cookieSetFails: false, blockSnapshotWrite: false,
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
    async set(obj) {
      if (calls.blockSnapshotWrite && "cookieSnapshot" in obj) throw new Error("QUOTA_BYTES");
      Object.assign(store, structuredClone(obj));
    },
    async remove(key) { delete store[key]; },
    onChanged: { addListener() {} }
  });

  const chrome = {
    storage: { local: area(localStore), session: area(sessionStore) },
    cookies: {
      async getAll() { return structuredClone(cookies); },
      async set(details) {
        if (calls.cookieSetFails) return null; // Chrome returns null on failure
        const host = details.domain ?? new URL(details.url).hostname;
        // Chrome upserts on (name, domain, path) rather than appending.
        const i = cookies.findIndex(
          (c) => c.name === details.name && c.domain === host && c.path === details.path
        );
        if (i !== -1) cookies.splice(i, 1);
        cookies.push({
          domain: details.domain ?? new URL(details.url).hostname,
          hostOnly: !details.domain,
          name: details.name, value: details.value, path: details.path,
          secure: !!details.secure, httpOnly: !!details.httpOnly,
          sameSite: details.sameSite ?? "unspecified", storeId: details.storeId ?? "0"
        });
        return details;
      }
    },
    browsingData: {
      async remove(opts, types) {
        calls.browsingDataRemove.push({ opts, types });
        if (types.cookies && !opts.origins) cookies.length = 0;
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
  async "in-scope cookies dropped, everything else restored"() {
    const env = makeChrome({ cookies: seed() });
    const ctx = await boot(env);
    await ctx.clearAuthCache(["k2.corp.com"]);

    const names = env.cookies.map((c) => c.name).sort();
    assert.deepEqual(names, ["JSESSIONID", "SID"], "other sites must survive, K2 must not");
    assert.equal(env.localStore.lastReset.restored, 2);
    assert.equal(env.localStore.lastReset.lost, 0);
    assert.ok(!("cookieSnapshot" in env.localStore), "snapshot cleared on success");
  },

  async "snapshot survives a worker kill and recovers on next boot"() {
    const env = makeChrome({ cookies: seed() });
    env.calls.cookieSetFails = true; // restore cannot complete
    await (await boot(env)).clearAuthCache(["k2.corp.com"]);

    assert.equal(env.cookies.length, 0, "cookies are gone at this point");
    assert.equal(env.localStore.cookieSnapshot.cookies.length, 2, "snapshot persisted before the clear");

    env.calls.cookieSetFails = false;
    await boot(env); // worker spins back up; auto-recovery runs on its own

    assert.deepEqual(env.cookies.map((c) => c.name).sort(), ["JSESSIONID", "SID"]);
    assert.ok(!("cookieSnapshot" in env.localStore), "snapshot consumed once restored");
  },

  async "hostOnly and SameSite=None are preserved through the round trip"() {
    const env = makeChrome({ cookies: seed() });
    await (await boot(env)).clearAuthCache(["k2.corp.com"]);

    const gmail = env.cookies.find((c) => c.name === "SID");
    const jira = env.cookies.find((c) => c.name === "JSESSIONID");
    assert.equal(gmail.hostOnly, false, "domain cookie must not become hostOnly");
    assert.equal(gmail.sameSite, "no_restriction");
    assert.equal(jira.hostOnly, true, "hostOnly cookie must stay hostOnly");
  },

  async "permanently failing restores give up instead of retrying forever"() {
    const env = makeChrome({ cookies: seed() });
    env.calls.cookieSetFails = true;
    await (await boot(env)).clearAuthCache(["k2.corp.com"]); // attempt 1
    assert.equal(env.localStore.cookieSnapshot.attempts, 1);

    await boot(env); // auto-recovery, attempt 2
    assert.equal(env.localStore.cookieSnapshot.attempts, 2);

    await boot(env); // auto-recovery, attempt 3 == cap
    assert.ok(!("cookieSnapshot" in env.localStore), "snapshot dropped at the attempt cap");
  },

  async "a failed snapshot write aborts before anything destructive happens"() {
    const env = makeChrome({ cookies: seed() });
    env.calls.blockSnapshotWrite = true;
    await (await boot(env)).clearAuthCache(["k2.corp.com"]);

    assert.equal(env.calls.browsingDataRemove.length, 0, "must not clear without a recovery path");
    assert.equal(env.cookies.length, 3, "nothing lost");
    assert.match(env.localStore.lastReset.aborted, /QUOTA_BYTES/);
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
