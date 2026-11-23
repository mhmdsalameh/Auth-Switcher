// links.js is pure, so it runs in Node directly. Every test name carries the spec R-ID it proves
// (docs/sdlc/bulk-link/spec.md).
import assert from "node:assert/strict";
import { linkUsers, unlinkUsers, deleteUsers, addSiteWithUsers } from "../links.js";
import { buildBackup, parseBackup, openBackup, mergeBackup } from "../backup.js";

const user = (id, domains, extra = {}) =>
  ({ id, domains, name: id.toUpperCase(), username: id, password: "p", ...extra });

// Frozen all the way down: a transform that writes into its input throws instead of passing.
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

const sitesOf = (sessions, id) => sessions.find((s) => s.id === id)?.domains;

const tests = {
  "R1 link adds sites, keeps others and stale ones"() {
    const state = deepFreeze({
      domains: ["x", "y"],
      sessions: [user("a", ["x", "stale"]), user("b", ["x", "y"]), user("d", ["x"])],
      activeByDomain: {}
    });
    const { sessions, notApplied } = linkUsers(state, ["a", "b"], ["y"]);
    assert.deepEqual(sitesOf(sessions, "a"), ["x", "stale", "y"]);
    assert.deepEqual(sitesOf(sessions, "b"), ["x", "y"], "a site already held is not added twice");
    assert.equal(sessions.find((s) => s.id === "d"), state.sessions[2], "a user not chosen is untouched");
    assert.deepEqual(notApplied, []);
  },

  "R1 new sites are appended in configured order, whatever order they were picked in"() {
    const state = deepFreeze({ domains: ["x", "y", "z"], sessions: [user("a", ["y"])], activeByDomain: {} });
    assert.deepEqual(sitesOf(linkUsers(state, ["a"], ["z", "x"]).sessions, "a"), ["y", "x", "z"]);
  },

  "R1 unknown ids are skipped"() {
    const state = deepFreeze({ domains: ["x"], sessions: [user("a", ["x"])], activeByDomain: {} });
    const { sessions } = linkUsers(state, ["ghost"], ["x"]);
    assert.deepEqual(sessions, state.sessions);
  },

  "R1 a legacy single-site record is read through domainsOf and rewritten as a list"() {
    const state = deepFreeze({
      domains: ["x", "y"],
      sessions: [{ id: "a", domain: "x", name: "A", username: "a", password: "p" }],
      activeByDomain: {}
    });
    const [a] = linkUsers(state, ["a"], ["y"]).sessions;
    assert.deepEqual(a.domains, ["x", "y"]);
    assert.ok(!("domain" in a), "the superseded field is dropped on the way past");
  },

  "R2 non-configured site not applied, reported in notApplied"() {
    const state = deepFreeze({ domains: ["x", "y"], sessions: [user("a", ["x"])], activeByDomain: {} });
    const { sessions, notApplied } = linkUsers(state, ["a"], ["z"]);
    assert.deepEqual(sitesOf(sessions, "a"), ["x"]);
    assert.deepEqual(notApplied, ["z"]);
  },

  "R2 sites are compared after normalizeDomain"() {
    const state = deepFreeze({ domains: ["y.corp.com"], sessions: [user("a", [])], activeByDomain: {} });
    const { sessions, notApplied } = linkUsers(state, ["a"], ["https://Y.corp.com:443/path"]);
    assert.deepEqual(sitesOf(sessions, "a"), ["y.corp.com"]);
    assert.deepEqual(notApplied, []);
  },

  "R3 link and addSiteWithUsers leave activeByDomain unchanged"() {
    const state = deepFreeze({
      domains: ["x", "y"],
      sessions: [user("a", ["x"]), user("b", ["x"]), user("c", ["y"])],
      activeByDomain: { y: "c" }
    });
    const linked = linkUsers(state, ["a", "b"], ["y"]);
    assert.ok(!("activeByDomain" in linked), "link never proposes a signed-in user");
    const added = addSiteWithUsers(state, "z", ["a", "b"]);
    assert.ok(!("activeByDomain" in added), "nor does adding a site with users");
  },

  "R3 import extra sites adopt no signed-in user"() {
    const current = deepFreeze({ domains: ["x", "y"], sessions: [], activeByDomain: {} });
    const merged = mergeBackup(current, {
      domains: ["x"], sessions: [{ domains: ["x"], name: "C", username: "c", password: "p" }]
    }, () => "c");
    const { sessions } = linkUsers(merged, [...merged.addedIds, ...merged.matchedIds], ["y"]);
    assert.deepEqual(sitesOf(sessions, "c"), ["x", "y"]);
    assert.equal(merged.activeByDomain.y, undefined, "y still has nobody signed in");
  },

  "R4 unlink removes only chosen sites"() {
    const state = deepFreeze({
      domains: ["x", "y"],
      sessions: [user("a", ["x", "y"]), user("b", ["x", "y"]), user("d", ["x", "y"])],
      activeByDomain: {}
    });
    const { sessions, orphans } = unlinkUsers(state, ["a", "b"], ["y"], { deleteOrphans: false });
    assert.deepEqual(sitesOf(sessions, "a"), ["x"]);
    assert.deepEqual(sitesOf(sessions, "b"), ["x"]);
    assert.deepEqual(sitesOf(sessions, "d"), ["x", "y"]);
    assert.deepEqual(orphans, []);
  },

  "R4 unlink of a site not held is a no-op"() {
    const state = deepFreeze({ domains: ["x", "y"], sessions: [user("a", ["x", "stale"])], activeByDomain: { x: "a" } });
    const out = unlinkUsers(state, ["a"], ["y"], { deleteOrphans: true });
    assert.equal(out.sessions[0], state.sessions[0]);
    assert.deepEqual(out.activeByDomain, { x: "a" });
    assert.deepEqual(out.orphans, []);
  },

  "R5 orphans = users with no live site left (stale counts as none)"() {
    const state = deepFreeze({
      domains: ["x", "y"],
      sessions: [user("a", ["x"]), user("b", ["x", "y"]), user("s", ["x", "stale"])],
      activeByDomain: {}
    });
    const { orphans } = unlinkUsers(state, ["a", "b", "s"], ["x"], { deleteOrphans: false });
    assert.deepEqual(orphans, ["a", "s"]);
  },

  "R5 deleteOrphans deletes them in the same result"() {
    const state = deepFreeze({
      domains: ["x", "y"],
      sessions: [user("a", ["x"]), user("b", ["x", "y"])],
      activeByDomain: {}
    });
    const { sessions, orphans } = unlinkUsers(state, ["a", "b"], ["x"], { deleteOrphans: true });
    assert.deepEqual(orphans, ["a"]);
    assert.deepEqual(sessions.map((s) => s.id), ["b"]);
    assert.deepEqual(sitesOf(sessions, "b"), ["y"]);
  },

  "R6 keep orphans still unlinks the others"() {
    const state = deepFreeze({
      domains: ["x", "y"],
      sessions: [user("a", ["x"]), user("b", ["x", "y"])],
      activeByDomain: {}
    });
    const { sessions, orphans } = unlinkUsers(state, ["a", "b"], ["x"], { deleteOrphans: false });
    assert.deepEqual(orphans, ["a"]);
    assert.equal(sessions[0], state.sessions[0], "the kept user is not touched at all");
    assert.deepEqual(sitesOf(sessions, "b"), ["y"]);
  },

  "R6 all orphans kept changes nothing"() {
    const state = deepFreeze({
      domains: ["x"],
      sessions: [user("a", ["x"]), user("b", ["x"])],
      activeByDomain: { x: "a" }
    });
    const out = unlinkUsers(state, ["a", "b"], ["x"], { deleteOrphans: false });
    assert.deepEqual(out.orphans, ["a", "b"]);
    assert.deepEqual(out.sessions, state.sessions);
    assert.deepEqual(out.activeByDomain, state.activeByDomain);
  },

  "R7 unlinking or deleting the signed-in user clears that site, no successor"() {
    const state = deepFreeze({
      domains: ["x", "y"],
      sessions: [user("a", ["x", "y"]), user("b", ["x"])],
      activeByDomain: { x: "a", y: "a" }
    });
    const unlinked = unlinkUsers(state, ["a"], ["x"], { deleteOrphans: false });
    assert.deepEqual(unlinked.activeByDomain, { y: "a" }, "x has nobody; b is not promoted");

    const lastSite = unlinkUsers(state, ["a"], ["x", "y"], { deleteOrphans: true });
    assert.deepEqual(lastSite.activeByDomain, {}, "a deleted user is signed in nowhere");

    const deleted = deleteUsers(state, ["a"]);
    assert.deepEqual(deleted.activeByDomain, {});
  },

  "R8 import links every imported user to picked extra sites"() {
    const current = deepFreeze({ domains: ["x", "y"], sessions: [], activeByDomain: {} });
    let i = 0;
    const merged = mergeBackup(current, {
      domains: ["x"],
      sessions: [
        { domains: ["x"], name: "C", username: "c", password: "p" },
        { domains: ["x"], name: "D", username: "d", password: "p" }
      ]
    }, () => `n${++i}`);
    const { sessions } = linkUsers(merged, [...merged.addedIds, ...merged.matchedIds], ["y"]);
    assert.deepEqual(sessions.map((s) => s.domains), [["x", "y"], ["x", "y"]]);
  },

  "R8 extra sites offered from merged domains"() {
    const current = deepFreeze({ domains: ["x"], sessions: [], activeByDomain: {} });
    const merged = mergeBackup(current, {
      domains: ["x", "w"], sessions: [{ domains: ["x"], name: "C", username: "c", password: "p" }]
    }, () => "c");
    assert.deepEqual(merged.domains, ["x", "w"], "a site the file adds is on offer");
    const { sessions, notApplied } = linkUsers(merged, merged.addedIds, ["w"]);
    assert.deepEqual(sitesOf(sessions, "c"), ["x", "w"]);
    assert.deepEqual(notApplied, []);
  },

  async "R8 encrypted file same result"() {
    const exported = { domains: ["x"], sessions: [user("c", ["x"])] };
    const file = parseBackup(JSON.stringify(await buildBackup(exported, "pw")));
    const payload = await openBackup(file, "pw");
    const merged = mergeBackup({ domains: ["x", "y"], sessions: [], activeByDomain: {} }, payload, () => "c");
    const { sessions } = linkUsers(merged, merged.addedIds, ["y"]);
    assert.deepEqual(sitesOf(sessions, "c"), ["x", "y"]);
  },

  "R9 matched existing user gets extra sites, no duplicate"() {
    const current = deepFreeze({ domains: ["x", "y"], sessions: [user("e", ["x"])], activeByDomain: {} });
    const merged = mergeBackup(current, {
      domains: ["x"], sessions: [{ domains: ["x"], name: "E", username: "e", password: "p" }]
    }, () => "dup");
    const { sessions } = linkUsers(merged, [...merged.addedIds, ...merged.matchedIds], ["y"]);
    assert.equal(sessions.length, 1, "no second E");
    assert.deepEqual(sitesOf(sessions, "e"), ["x", "y"]);
  },

  "R10 no extra sites equals mergeBackup result"() {
    const current = deepFreeze({ domains: ["x"], sessions: [user("e", ["x"])], activeByDomain: {} });
    const merged = mergeBackup(current, {
      domains: ["x"], sessions: [{ domains: ["x"], name: "C", username: "c", password: "p" }]
    }, () => "c");
    const { sessions } = linkUsers(merged, [...merged.addedIds, ...merged.matchedIds], []);
    assert.deepEqual(sessions, merged.sessions);
  },

  "R11 addSiteWithUsers configures site and links chosen users only"() {
    const state = deepFreeze({
      domains: ["x"],
      sessions: [user("a", ["x"]), user("b", ["x"]), user("d", ["x"])],
      activeByDomain: { x: "a" }
    });
    const { domains, sessions } = addSiteWithUsers(state, " Z.corp.com/ ", ["a", "b"]);
    assert.deepEqual(domains, ["x", "z.corp.com"]);
    assert.deepEqual(sitesOf(sessions, "a"), ["x", "z.corp.com"]);
    assert.deepEqual(sitesOf(sessions, "b"), ["x", "z.corp.com"]);
    assert.deepEqual(sitesOf(sessions, "d"), ["x"]);
  },

  "R11 no users chosen adds site only"() {
    const state = deepFreeze({ domains: ["x"], sessions: [user("a", ["x"])], activeByDomain: {} });
    const { domains, sessions } = addSiteWithUsers(state, "z", []);
    assert.deepEqual(domains, ["x", "z"]);
    assert.deepEqual(sessions, state.sessions);
  },

  "R11 a site already configured is not added twice"() {
    const state = deepFreeze({ domains: ["x"], sessions: [user("a", [])], activeByDomain: {} });
    const { domains, sessions } = addSiteWithUsers(state, "x", ["a"]);
    assert.deepEqual(domains, ["x"]);
    assert.deepEqual(sitesOf(sessions, "a"), ["x"]);
  },

  "R12 deleteUsers removes users and their activeByDomain entries"() {
    const state = deepFreeze({
      domains: ["x", "y"],
      sessions: [user("a", ["x"]), user("b", ["y"]), user("d", ["x", "y"])],
      activeByDomain: { x: "a", y: "d" }
    });
    const { sessions, activeByDomain } = deleteUsers(state, ["a", "b"]);
    assert.deepEqual(sessions.map((s) => s.id), ["d"]);
    assert.deepEqual(activeByDomain, { y: "d" });
  },

  "R14 1,000 users x 20 sites under 50 ms per transform"() {
    const domains = Array.from({ length: 20 }, (_, i) => `s${i}.corp.com`);
    const sessions = Array.from({ length: 1000 }, (_, i) => user(`u${i}`, domains.slice(0, 10)));
    const state = deepFreeze({ domains, sessions, activeByDomain: Object.fromEntries(domains.map((d) => [d, "u0"])) });
    const ids = sessions.map((s) => s.id);
    const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
    const timings = {
      link: time(() => linkUsers(state, ids, domains)),
      unlink: time(() => unlinkUsers(state, ids, domains.slice(0, 9), { deleteOrphans: true })),
      orphanAll: time(() => unlinkUsers(state, ids, domains, { deleteOrphans: true })),
      delete: time(() => deleteUsers(state, ids)),
      addSite: time(() => addSiteWithUsers(state, "new.corp.com", ids))
    };
    for (const [name, ms] of Object.entries(timings)) {
      assert.ok(ms < 50, `${name} took ${ms.toFixed(1)} ms`);
    }
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
