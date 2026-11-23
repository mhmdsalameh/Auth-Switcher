// storage.js reads chrome.* when it loads, so each instance (normal / private window) is imported
// fresh under its own stub. The stub records every write in order.
import assert from "node:assert/strict";

let load = 0;
async function instance({ incognito }) {
  const writes = [];
  const area = (name) => ({
    async get(q) { return typeof q === "object" && q ? { ...q } : {}; },
    async set(obj) { writes.push({ area: name, keys: Object.keys(obj) }); }
  });
  globalThis.chrome = {
    extension: { inIncognitoContext: incognito },
    storage: { local: area("local"), session: area("session") }
  };
  const mod = await import(`../storage.js?instance=${++load}`);
  return { mod, writes };
}

const users = (n) => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, domains: ["x"] }));

const tests = {
  async "R7 writeChange writes activeByDomain before sessions"() {
    for (const incognito of [false, true]) {
      const { mod, writes } = await instance({ incognito });
      await mod.writeChange({ activeByDomain: {}, sessions: users(2) });
      assert.deepEqual(writes, [
        { area: incognito ? "session" : "local", keys: ["activeByDomain"] },
        { area: "local", keys: ["sessions"] }
      ], incognito ? "private window" : "normal window");
    }
  },

  async "R14 one sessions write for N = 1, 2, 50"() {
    for (const n of [1, 2, 50]) {
      const { mod, writes } = await instance({ incognito: false });
      await mod.writeChange({ activeByDomain: {}, sessions: users(n) });
      assert.equal(writes.filter((w) => w.keys.includes("sessions")).length, 1, `N = ${n}`);
      assert.equal(writes.filter((w) => w.keys.includes("activeByDomain")).length, 1, `N = ${n}`);
    }
  },

  async "R14 domains and sessions in one set call"() {
    const { mod, writes } = await instance({ incognito: false });
    await mod.writeChange({ domains: ["x", "z"], sessions: users(3) });
    assert.deepEqual(writes, [{ area: "local", keys: ["sessions", "domains"] }],
      "no activeByDomain write when none is given");
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
