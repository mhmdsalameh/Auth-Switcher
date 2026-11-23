// In-memory chrome.* for driving popup.html in a plain browser tab (/sdlc-test e2e).
// Load it as an init script before popup.js, and serve the repo root over https (crypto.subtle
// needs a secure context) — Playwright's route.fulfill({ path }) does both without a server.
// The seed defaults to the users in docs/sdlc/bulk-link/design/mockup.html; put another seed in
// sessionStorage "__seed" and reload to start from a different state. Every set() is recorded in
// window.__writes so a test can assert the write order (spec R7, R14).
(() => {
  const seed = JSON.parse(sessionStorage.getItem("__seed") || "null") || {
    domains: ["k2.corp.com", "k2test.corp.com", "k2dev.corp.com"],
    sessions: [
      { id: "a", name: "Approver", username: "CORP\\k2approver", password: "x", color: "#e0a33e", domains: ["k2.corp.com", "k2test.corp.com"] },
      { id: "r", name: "Requester", username: "CORP\\k2requester", password: "x", color: "#4a9eff", domains: ["k2.corp.com"] },
      { id: "m", name: "Admin", username: "CORP\\k2admin", password: "x", color: "#5bbd7a", domains: ["k2.corp.com"] },
      { id: "f", name: "Finance lead", username: "CORP\\fin.lead", password: "x", color: "#d47ba8", domains: ["k2test.corp.com"] },
      { id: "v", name: "Viewer", username: "CORP\\k2viewer", password: "x", color: "#a98cf0", domains: ["k2dev.corp.com"] },
      { id: "s", name: "Old", username: "CORP\\old", password: "x", color: "#9d9d9d", domains: ["gone.corp.com"] }
    ],
    activeByDomain: { "k2.corp.com": "a", "k2test.corp.com": "f" },
    selectedDomain: "k2.corp.com"
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const listeners = [];
  window.__writes = [];
  const area = (name, data) => ({
    async get(keys) {
      if (keys == null) return clone(data);
      if (typeof keys === "string") return keys in data ? { [keys]: clone(data[keys]) } : {};
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, clone(data[k])]));
      return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in data ? clone(data[k]) : d]));
    },
    async set(obj) {
      window.__writes.push({ area: name, keys: Object.keys(obj) });
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data[k], newValue: clone(v) };
        data[k] = clone(v);
      }
      listeners.forEach((l) => l(changes, name));
    }
  });
  window.__local = clone(seed);
  window.__messages = [];
  window.chrome = {
    extension: { inIncognitoContext: false },
    runtime: { sendMessage: async (m) => { window.__messages.push(m); return {}; } },
    storage: {
      local: area("local", window.__local),
      session: area("session", {}),
      onChanged: { addListener: (l) => listeners.push(l) }
    },
    tabs: {
      query: async () => [{ id: 1, url: "https://k2.corp.com/app" }],
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    windows: { getCurrent: async () => ({ id: 1 }) },
    sidePanel: { close: async () => {} }
  };
})();
