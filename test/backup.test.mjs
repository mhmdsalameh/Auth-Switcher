// The crypto and merge logic run in Node directly — WebCrypto is the same API Chrome uses.
import assert from "node:assert/strict";
import { buildBackup, parseBackup, openBackup, mergeBackup, FORMAT } from "../backup.js";

const sample = {
  domains: ["k2dev.corp.com", "k2uat.corp.com"],
  sessions: [
    { id: "a", domain: "k2dev.corp.com", name: "Approver", username: "corp\\qa.app", password: "s3cret!", color: "#e0a33e" },
    { id: "b", domain: "k2uat.corp.com", name: "Manager", username: "corp\\qa.mgr", password: "p@ss wörd", color: "#4a9eff" }
  ],
  activeByDomain: { "k2dev.corp.com": "a" }
};

const roundTrip = async (state, pass) =>
  openBackup(parseBackup(JSON.stringify(await buildBackup(state, pass))), pass);

let n = 0;
const tests = {
  async "encrypted backup round-trips, passwords intact"() {
    const out = await roundTrip(sample, "correct horse");
    assert.deepEqual(out.domains, sample.domains);
    assert.equal(out.sessions.length, 2);
    assert.equal(out.sessions[0].password, "s3cret!");
    assert.equal(out.sessions[1].password, "p@ss wörd", "non-ASCII passwords survive");
  },

  async "encrypted file leaks nothing in the clear"() {
    const text = JSON.stringify(await buildBackup(sample, "correct horse"));
    for (const secret of ["s3cret!", "corp\\qa.app", "Approver", "k2dev.corp.com"]) {
      assert.ok(!text.includes(secret), `"${secret}" must not appear in the ciphertext`);
    }
  },

  async "wrong passphrase is rejected, not silently mangled"() {
    const file = parseBackup(JSON.stringify(await buildBackup(sample, "right")));
    await assert.rejects(() => openBackup(file, "wrong"), /Wrong passphrase/);
  },

  async "a missing passphrase on an encrypted file is explained"() {
    const file = parseBackup(JSON.stringify(await buildBackup(sample, "right")));
    await assert.rejects(() => openBackup(file), /needs a passphrase/);
  },

  async "unencrypted backup round-trips"() {
    const out = await roundTrip(sample, "");
    assert.equal(out.sessions[0].password, "s3cret!");
  },

  async "ids are not exported"() {
    const file = await buildBackup(sample, "");
    assert.ok(file.payload.sessions.every((s) => !("id" in s)), "ids are regenerated on import");
  },

  async "foreign and corrupt files are refused"() {
    assert.throws(() => parseBackup("{not json"), /valid JSON/);
    assert.throws(() => parseBackup('{"format":"something-else"}'), /isn't an Auth Switcher/);
    assert.throws(() => parseBackup(`{"format":"${FORMAT}","version":9}`), /version 9/);
    // Files written before the rename must still open.
    assert.equal(parseBackup('{"format":"k2-multi-session","version":1}').version, 1);
  },

  async "import merges without duplicating existing users"() {
    const current = {
      domains: ["k2dev.corp.com"],
      sessions: [{ id: "x", domain: "k2dev.corp.com", name: "Approver", username: "corp\\qa.app", password: "old" }],
      activeByDomain: { "k2dev.corp.com": "x" }
    };
    const result = mergeBackup(current, await roundTrip(sample, ""), () => `new-${++n}`);

    assert.equal(result.added, 1, "only the genuinely new user is added");
    assert.equal(result.skipped, 1, "the duplicate is skipped");
    assert.deepEqual(result.domains, ["k2dev.corp.com", "k2uat.corp.com"]);
    assert.equal(result.sessions.find((s) => s.username === "corp\\qa.app").password, "old",
      "an existing user is never overwritten");
    assert.equal(result.activeByDomain["k2dev.corp.com"], "x", "existing active user is preserved");
    assert.ok(result.activeByDomain["k2uat.corp.com"], "a newly imported domain gets an active user");
  },

  async "importing into an empty install restores everything"() {
    const empty = { domains: [], sessions: [], activeByDomain: {} };
    const result = mergeBackup(empty, await roundTrip(sample, "pw"), () => `new-${++n}`);
    assert.equal(result.added, 2);
    assert.equal(result.domains.length, 2);
    assert.equal(Object.keys(result.activeByDomain).length, 2);
  },

  async "a user's full site list survives a round trip"() {
    const shared = {
      domains: ["k2.corp.com", "k2test.corp.com"],
      sessions: [{
        id: "a", domains: ["k2.corp.com", "k2test.corp.com"],
        name: "QA", username: "corp\\qa", password: "p", color: "#e0a33e"
      }],
      activeByDomain: {}
    };
    const out = await roundTrip(shared, "pw");
    assert.deepEqual(out.sessions[0].domains, ["k2.corp.com", "k2test.corp.com"]);

    const back = mergeBackup({ domains: [], sessions: [], activeByDomain: {} }, out, () => `new-${++n}`);
    assert.deepEqual(back.sessions[0].domains, ["k2.corp.com", "k2test.corp.com"],
      "both sites survive the import, not just the first");
    assert.equal(back.activeByDomain["k2.corp.com"], back.sessions[0].id);
    assert.equal(back.activeByDomain["k2test.corp.com"], back.sessions[0].id,
      "a multi-site user is the default on every site they serve");
  },

  async "an exported file still opens in a build that predates multi-site users"() {
    const file = await buildBackup({
      domains: ["k2.corp.com"],
      sessions: [{ id: "a", domains: ["k2.corp.com", "k2test.corp.com"], name: "QA", username: "u", password: "p" }]
    }, "");
    // An older reader only knows `domain`. It must find something rather than drop the user.
    assert.equal(file.payload.sessions[0].domain, "k2.corp.com");
  },

  async "a backup written before multi-site users still imports"() {
    const empty = { domains: [], sessions: [], activeByDomain: {} };
    const result = mergeBackup(empty, {
      domains: ["k2.corp.com"],
      sessions: [{ domain: "k2.corp.com", name: "Old", username: "u", password: "p" }]
    }, () => `new-${++n}`);

    assert.equal(result.added, 1);
    assert.deepEqual(result.sessions[0].domains, ["k2.corp.com"], "the lone site becomes a list");
    assert.ok(!("domain" in result.sessions[0]), "and the superseded field does not come with it");
  },

  async "re-importing a user after their sites were widened keeps the widening"() {
    const current = {
      domains: ["k2.corp.com"],
      sessions: [{ id: "x", domains: ["k2.corp.com"], name: "QA", username: "u", password: "p" }],
      activeByDomain: { "k2.corp.com": "x" }
    };
    // Same username, but the file knows about a site this install does not cover yet.
    const widened = mergeBackup(current, {
      domains: ["k2.corp.com", "k2test.corp.com"],
      sessions: [{ domains: ["k2.corp.com", "k2test.corp.com"], name: "QA", username: "u", password: "p" }]
    }, () => `new-${++n}`);
    assert.equal(widened.added, 1, "a site we don't cover yet is new information, not a duplicate");

    // The same file a second time now finds a user that already covers both sites.
    const again = mergeBackup(widened, {
      domains: ["k2.corp.com", "k2test.corp.com"],
      sessions: [{ domains: ["k2.corp.com", "k2test.corp.com"], name: "QA", username: "u", password: "p" }]
    }, () => `new-${++n}`);
    assert.equal(again.added, 0, "importing twice must not keep piling up copies");
    assert.equal(again.skipped, 1);
  },

  async "malformed entries inside a payload are dropped"() {
    const empty = { domains: [], sessions: [], activeByDomain: {} };
    const result = mergeBackup(empty, {
      domains: ["ok.corp.com"],
      sessions: [{ domain: "ok.corp.com", name: "Fine", username: "u", password: "p" }, { name: "no domain" }, null]
    }, () => `new-${++n}`);
    assert.equal(result.added, 1);
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
