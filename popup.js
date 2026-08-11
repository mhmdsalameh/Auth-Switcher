const $ = (sel) => document.querySelector(sel);
const DEFAULTS = {
  sessions: [], domains: [], activeSessionId: null,
  preemptive: false, lastScheme: null, ruleError: null, lastReset: null
};

let state = DEFAULTS;

const send = (msg) => chrome.runtime.sendMessage(msg);

function normalizeDomain(line) {
  return line
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

const SCHEME_NOTES = {
  basic: "Detected <strong>Basic</strong> auth. You can enable pre-emptive credentials in settings for faster switching.",
  digest: "Detected <strong>Digest</strong> auth. Keep pre-emptive credentials off.",
  ntlm: "Detected <strong>NTLM</strong>. Keep pre-emptive credentials off — switching clears the auth cache for you.",
  negotiate: "Detected <strong>Negotiate/Kerberos</strong>. Keep pre-emptive credentials off — switching clears the auth cache for you."
};

async function load() {
  state = await chrome.storage.local.get(DEFAULTS);
  render();
}

function render() {
  $("#domains").value = state.domains.join("\n");
  $("#preemptive").checked = state.preemptive;
  $("#no-domain").hidden = state.domains.length > 0;

  if (state.lastReset) {
    const { restored, lost } = state.lastReset;
    $("#reset-hint").textContent = lost
      ? `Last clear: ${restored} cookies restored, ${lost} could not be (those sites need a re-login).`
      : `Last clear: all ${restored} other-site cookies restored.`;
  }

  const el = $("#scheme-note");
  if (state.ruleError) {
    el.hidden = false;
    el.classList.add("warn");
    el.textContent = `Pre-emptive header rejected by Chrome (${state.ruleError}). Falling back to challenge-response.`;
  } else {
    const note = SCHEME_NOTES[state.lastScheme];
    el.hidden = !note;
    el.classList.remove("warn");
    if (note) el.innerHTML = note;
  }

  const list = $("#sessions");
  list.textContent = "";

  if (!state.sessions.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No sessions yet.";
    list.append(li);
    return;
  }

  for (const s of state.sessions) {
    const li = document.createElement("li");
    li.className = "session" + (s.id === state.activeSessionId ? " active" : "");
    li.title = "Switch to this session";

    const dot = document.createElement("span");
    dot.className = "dot";

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = s.name;
    const user = document.createElement("div");
    user.className = "user";
    user.textContent = s.username;
    meta.append(name, user);

    const actions = document.createElement("div");
    actions.className = "actions";

    const openBtn = document.createElement("button");
    openBtn.className = "icon";
    openBtn.textContent = "↗";
    openBtn.title = "Open a new tab pinned to this session";
    openBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await send({ type: "openAs", sessionId: s.id, url: await targetUrl() });
      window.close();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "icon";
    delBtn.textContent = "✕";
    delBtn.title = "Delete";
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sessions = state.sessions.filter((x) => x.id !== s.id);
      const activeSessionId = state.activeSessionId === s.id ? null : state.activeSessionId;
      await chrome.storage.local.set({ sessions, activeSessionId });
      await load();
    });

    actions.append(openBtn, delBtn);
    li.append(dot, meta, actions);
    li.addEventListener("click", async () => {
      await send({ type: "switch", sessionId: s.id });
      window.close();
    });
    list.append(li);
  }
}

async function targetUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const host = new URL(tab.url).hostname;
    if (state.domains.some((d) => host === d || host.endsWith("." + d))) return tab.url;
  } catch { /* fall through to the configured domain */ }
  return `https://${state.domains[0] ?? ""}`;
}

// ---- wiring ----------------------------------------------------------------

$("#settings-toggle").addEventListener("click", () => {
  $("#settings").hidden = !$("#settings").hidden;
});

$("#domains").addEventListener("change", async (e) => {
  const domains = [...new Set(e.target.value.split("\n").map(normalizeDomain).filter(Boolean))];
  await chrome.storage.local.set({ domains });
  await load();
});

$("#preemptive").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ preemptive: e.target.checked });
});

$("#reset-auth").addEventListener("click", async (e) => {
  e.target.disabled = true;
  e.target.textContent = "Clearing…";
  await send({ type: "resetAuth" });
  await load();
  e.target.disabled = false;
  e.target.textContent = "Clear auth cache now";
});

$("#add-toggle").addEventListener("click", () => {
  $("#add-toggle").hidden = true;
  $("#add-form").hidden = false;
  $("#name").focus();
});

$("#add-cancel").addEventListener("click", () => {
  $("#add-form").reset();
  $("#add-form").hidden = true;
  $("#add-toggle").hidden = false;
});

$("#add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const session = {
    id: crypto.randomUUID(),
    name: $("#name").value.trim(),
    username: $("#username").value,
    password: $("#password").value
  };
  const sessions = [...state.sessions, session];
  const activeSessionId = state.activeSessionId ?? session.id;
  await chrome.storage.local.set({ sessions, activeSessionId });
  $("#add-form").reset();
  $("#add-form").hidden = true;
  $("#add-toggle").hidden = false;
  await load();
});

load();
