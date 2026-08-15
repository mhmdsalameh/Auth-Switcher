import { buildBackup, parseBackup, openBackup, mergeBackup, normalizeDomain } from "./backup.js";
import {
  STORAGE_DEFAULTS,
  INSTANCE_DEFAULTS,
  IS_INCOGNITO,
  readActiveByDomain,
  writeActiveByDomain,
  readInstanceState
} from "./storage.js";

const $ = (sel) => document.querySelector(sel);

const PALETTE = ["#e0a33e", "#4a9eff", "#5bbd7a", "#d47ba8", "#a98cf0", "#e0705c"];

// Copied, not aliased — render() reads state constantly and must never mutate the shared shape.
let state = { ...STORAGE_DEFAULTS, ...INSTANCE_DEFAULTS };

// Search is deliberately not persisted: a filter left over from last time would hide users.
const SEARCH_MIN = 5; // only worth the clutter once the list scans badly
let query = "";

const send = (msg) => chrome.runtime.sendMessage(msg);

function userColor(session) {
  if (session?.color) return session.color;
  if (!session) return null;
  let h = 0;
  for (const ch of session.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const SCHEME_NOTES = {
  basic: "<strong>Basic</strong> auth — pre-emptive mode is safe to enable.",
  digest: "<strong>Digest</strong> auth — keep pre-emptive off.",
  ntlm: "<strong>NTLM</strong> — keep pre-emptive off.",
  negotiate: "<strong>Negotiate</strong> — keep pre-emptive off."
};

// The tab the popup is showing. Falls back to the first domain if unset or stale.
function currentDomain() {
  if (state.selectedDomain && state.domains.includes(state.selectedDomain)) {
    return state.selectedDomain;
  }
  return state.domains[0] ?? null;
}

async function load() {
  state = { ...(await chrome.storage.local.get(STORAGE_DEFAULTS)), ...(await readInstanceState()) };
  state.activeByDomain = await readActiveByDomain();
  render();
}

async function selectDomain(domain) {
  query = ""; // a filter carried across domains would look like missing users
  await chrome.storage.local.set({ selectedDomain: domain });
  await load();
}

function renderDomainPicker() {
  const select = $("#domain-select");
  const has = state.domains.length > 0;

  select.hidden = settingsOpen || !has;
  $("#domain-empty").hidden = settingsOpen || has;
  if (!has) return;

  const selected = currentDomain();
  select.textContent = "";
  for (const domain of state.domains) {
    const option = document.createElement("option");
    option.value = domain;
    option.textContent = domain;
    option.selected = domain === selected;
    select.append(option);
  }
  select.title = selected;
}

function renderDomains() {
  const list = $("#domain-chips");
  list.textContent = "";

  if (!state.domains.length) {
    const li = document.createElement("li");
    li.className = "chips-empty";
    li.textContent = "None yet — credentials are never sent.";
    list.append(li);
  }

  for (const domain of state.domains) {
    const li = document.createElement("li");
    li.className = "chip";
    li.append(document.createTextNode(domain));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-remove";
    remove.textContent = "✕";
    remove.title = `Remove ${domain}`;
    remove.setAttribute("aria-label", `Remove ${domain}`);
    remove.addEventListener("click", () => setDomains(state.domains.filter((d) => d !== domain)));
    li.append(remove);
    list.append(li);
  }

  const suggestion = state.seenChallenges.find(
    (h) => !state.domains.some((d) => h === d || h.endsWith("." + d))
  );
  $("#detected").hidden = !suggestion;
  if (suggestion) $("#detected-host").textContent = suggestion;
}

async function setDomains(next) {
  const domains = [...new Set(next.map(normalizeDomain).filter(Boolean))];
  await chrome.storage.local.set({ domains });
  await load();
}

async function addDomain(raw) {
  const domain = normalizeDomain(raw ?? "");
  if (!domain || state.domains.includes(domain)) return false;
  await setDomains([...state.domains, domain]);
  await selectDomain(domain);
  return true;
}

function buildRow(session) {
  const li = document.createElement("li");
  li.className = "row";

  const main = document.createElement("button");
  main.type = "button";
  main.className = "row-main";
  main.title = `Switch to ${session.name}`;

  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = userColor(session);

  const meta = document.createElement("span");
  meta.className = "row-meta";
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = session.name;
  const user = document.createElement("span");
  user.className = "row-user";
  user.textContent = session.username;
  meta.append(name, user);
  main.append(dot, meta);
  main.addEventListener("click", async () => {
    await send({ type: "switch", sessionId: session.id });
    window.close();
  });

  const actions = document.createElement("span");
  actions.className = "row-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "icon-btn";
  editBtn.textContent = "✎";
  editBtn.title = `Edit ${session.name}`;
  editBtn.setAttribute("aria-label", `Edit ${session.name}`);
  editBtn.addEventListener("click", () => openUserForm(session));

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "icon-btn";
  openBtn.textContent = "↗";
  openBtn.title = `Open a new tab as ${session.name}`;
  openBtn.setAttribute("aria-label", `Open a new tab as ${session.name}`);
  openBtn.addEventListener("click", async () => {
    await send({ type: "openAs", sessionId: session.id, url: await targetUrl() });
    window.close();
  });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "icon-btn";
  delBtn.textContent = "✕";
  delBtn.title = `Remove ${session.name}`;
  delBtn.setAttribute("aria-label", `Remove ${session.name}`);
  delBtn.addEventListener("click", async () => {
    const sessions = state.sessions.filter((x) => x.id !== session.id);
    const activeByDomain = { ...state.activeByDomain };
    if (activeByDomain[session.domain] === session.id) delete activeByDomain[session.domain];
    await chrome.storage.local.set({ sessions });
    await writeActiveByDomain(activeByDomain);
    await load();
  });

  actions.append(editBtn, openBtn, delBtn);
  li.append(main, actions);
  return li;
}

// View state. Settings is a separate page, not a panel stacked above the users.
let settingsOpen = false;
let formOpen = false;
// The form doubles as add and edit; editingId null means we are adding.
let editingId = null;

function openUserForm(session = null) {
  editingId = session?.id ?? null;
  formOpen = true;
  settingsOpen = false;
  $("#form-title").textContent = session ? "Edit user" : "Add user";
  $("#form-submit").textContent = session ? "Save changes" : "Save user";
  $("#name").value = session?.name ?? "";
  $("#username").value = session?.username ?? "";
  $("#password").value = session?.password ?? "";
  render();
  $("#name").focus();
}

function closeUserForm() {
  editingId = null;
  formOpen = false;
  $("#add-form").reset();
  render();
}

function render() {
  const domain = currentDomain();
  const mine = state.sessions.filter((s) => s.domain === domain);
  const active = mine.find((s) => s.id === state.activeByDomain[domain]) ?? null;

  renderDomainPicker();
  renderDomains();

  document.documentElement.style.setProperty("--user", userColor(active) ?? "#9d9d9d");
  $("#active-name").textContent = active ? active.name : "Nobody";
  $("#active-user").textContent = active ? active.username : "Pick a user below";
  // The active user is kept out of the list below, so it needs its own edit affordance.
  $("#active-edit").hidden = !active;

  // Settings and the user list are separate pages — never both at once.
  $("#settings").hidden = !settingsOpen;
  $("#nav-title").hidden = !settingsOpen;
  $("#settings-toggle").textContent = settingsOpen ? "✕" : "⚙";
  $("#settings-toggle").title = settingsOpen ? "Close settings" : "Settings";

  $("#preemptive").checked = state.preemptive;
  $("#no-domain").hidden = settingsOpen || state.domains.length > 0;
  $("#active-block").hidden = settingsOpen || !domain;
  $("#rack-head").hidden = settingsOpen || !domain;
  $("#add-form").hidden = settingsOpen || !formOpen;
  $("#add-toggle").hidden = settingsOpen || !domain || formOpen;
  $("#status-bar").hidden = settingsOpen;

  const note = $("#scheme-note");
  // Ranked by urgency: a withheld password explains a failed login, a rejected rule only
  // explains slower switching.
  if (state.insecureHost) {
    note.hidden = false;
    note.classList.add("msg-warn");
    note.textContent = `Withheld credentials from ${state.insecureHost} — Basic auth over plain http.`;
    note.title =
      "The password would have gone out unencrypted. Use https, or an intranet address.";
  } else if (state.ruleError) {
    note.hidden = false;
    note.classList.add("msg-warn");
    note.textContent = "Pre-emptive header rejected — using challenge-response.";
    note.title = state.ruleError;
  } else {
    const text = SCHEME_NOTES[state.lastScheme];
    note.hidden = !text;
    note.classList.remove("msg-warn");
    if (text) note.innerHTML = text;
  }

  const rows = $("#sessions");
  rows.textContent = "";
  const others = mine.filter((s) => s.id !== active?.id);

  // Resolve the search field first: it can clear the query, and the list below must
  // reflect that in the same pass. Visibility keys off the *unfiltered* count, so the
  // field can't vanish out from under someone mid-search.
  const search = $("#user-search");
  search.hidden = settingsOpen || !domain || others.length < SEARCH_MIN;
  if (search.hidden) query = "";
  if (search.value !== query) search.value = query;

  const q = query.trim().toLowerCase();
  const matches = q
    ? others.filter(
        (s) => s.name.toLowerCase().includes(q) || s.username.toLowerCase().includes(q)
      )
    : others;

  if (settingsOpen || !domain) {
    rows.hidden = true;
  } else {
    rows.hidden = false;
    if (!others.length) {
      const li = document.createElement("li");
      li.className = "rows-empty";
      li.textContent = mine.length
        ? "Add another user to switch between them."
        : `No users for ${domain} yet.`;
      rows.append(li);
    } else if (!matches.length) {
      const li = document.createElement("li");
      li.className = "rows-empty";
      // "other" matters: the signed-in user is deliberately not in this list.
      li.textContent = `No other users match "${query.trim()}".`;
      rows.append(li);
    } else {
      matches.forEach((s) => rows.append(buildRow(s)));
    }
  }

  const bits = [domain ?? "no domain"];
  if (IS_INCOGNITO) bits.push("private");
  if (state.lastScheme) bits.push(state.lastScheme.toUpperCase());
  bits.push(`${mine.length} user${mine.length === 1 ? "" : "s"}`);
  $("#status-bar").textContent = bits.join("  ·  ");
}

async function targetUrl() {
  const domain = currentDomain();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const host = new URL(tab.url).hostname;
    if (domain && (host === domain || host.endsWith("." + domain))) return tab.url;
  } catch { /* fall through to the selected domain */ }
  return `https://${domain ?? ""}`;
}

// ---- wiring ----------------------------------------------------------------

$("#domain-select").addEventListener("change", (e) => selectDomain(e.target.value));

$("#user-search").addEventListener("input", (e) => {
  query = e.target.value;
  render();
});

$("#user-search").addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !query) return;
  e.preventDefault(); // don't let Escape close the popup with a filter still applied
  query = "";
  render();
});

$("#settings-toggle").addEventListener("click", () => {
  settingsOpen = !settingsOpen;
  if (settingsOpen) {
    // Don't leave a half-filled user form behind the settings page.
    editingId = null;
    formOpen = false;
    $("#add-form").reset();
  }
  render();
});

const domainInput = $("#domain-input");

async function commitDomainInput() {
  if (await addDomain(domainInput.value)) domainInput.value = "";
}

domainInput.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter" && e.key !== "," && e.key !== " ") return;
  e.preventDefault();
  await commitDomainInput();
  domainInput.focus();
});
// Commit on blur too, so a typed-but-unconfirmed domain isn't silently discarded.
domainInput.addEventListener("blur", commitDomainInput);

$("#use-current").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await addDomain(new URL(tab.url).hostname);
  } catch {
    domainInput.placeholder = "That tab has no site to add";
  }
});

$("#detected-add").addEventListener("click", async () => {
  await addDomain($("#detected-host").textContent);
});

$("#preemptive").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ preemptive: e.target.checked });
});

// ---- Backup ----------------------------------------------------------------

let pendingImport = null; // a parsed, still-encrypted file awaiting its passphrase

function backupStatus(text, isError = false) {
  const el = $("#backup-status");
  el.textContent = text;
  el.style.color = isError ? "#e0705c" : "";
}

function showBackupForm(which) {
  $("#export-form").hidden = which !== "export";
  $("#import-form").hidden = which !== "import";
}

function downloadJson(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

$("#export-btn").addEventListener("click", () => {
  showBackupForm("export");
  $("#export-pass").focus();
  backupStatus(`${state.sessions.length} users, ${state.domains.length} domains.`);
});

$("#export-cancel").addEventListener("click", () => {
  $("#export-form").reset();
  showBackupForm(null);
});

$("#export-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const passphrase = $("#export-pass").value;
  try {
    const file = await buildBackup(state, passphrase);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(JSON.stringify(file, null, 2), `auth-switcher-users-${stamp}.json`);
    backupStatus(passphrase ? "Exported, encrypted." : "Exported. Passwords are in the clear.");
  } catch (err) {
    backupStatus(String(err.message ?? err), true);
  }
  $("#export-form").reset();
  showBackupForm(null);
});

$("#import-btn").addEventListener("click", () => {
  showBackupForm(null);
  $("#import-file").click();
});

$("#import-file").addEventListener("change", async (e) => {
  const [file] = e.target.files;
  e.target.value = ""; // let the same file be picked again after a failure
  if (!file) return;

  try {
    const parsed = parseBackup(await file.text());
    if (parsed.encrypted) {
      pendingImport = parsed;
      showBackupForm("import");
      $("#import-pass").focus();
      backupStatus("This backup is encrypted.");
      return;
    }
    await applyImport(await openBackup(parsed));
  } catch (err) {
    backupStatus(String(err.message ?? err), true);
  }
});

$("#import-cancel").addEventListener("click", () => {
  pendingImport = null;
  $("#import-form").reset();
  showBackupForm(null);
  backupStatus("Import cancelled.");
});

$("#import-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!pendingImport) return;
  try {
    const payload = await openBackup(pendingImport, $("#import-pass").value);
    pendingImport = null;
    $("#import-form").reset();
    showBackupForm(null);
    await applyImport(payload);
  } catch (err) {
    backupStatus(String(err.message ?? err), true);
    $("#import-pass").select();
  }
});

async function applyImport(payload) {
  const { domains, sessions, activeByDomain, added, skipped } = mergeBackup(state, payload);
  await chrome.storage.local.set({ domains, sessions });
  await writeActiveByDomain(activeByDomain);
  await load();
  backupStatus(
    skipped ? `Imported ${added} users, skipped ${skipped} already here.` : `Imported ${added} users.`
  );
}

$("#add-toggle").addEventListener("click", () => openUserForm());
$("#add-cancel").addEventListener("click", closeUserForm);

$("#active-edit").addEventListener("click", () => {
  const active = state.sessions.find((s) => s.id === state.activeByDomain[currentDomain()]);
  if (active) openUserForm(active);
});

$("#add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const domain = currentDomain();
  if (!domain) return;

  // Read before closing — closeUserForm resets the fields.
  const name = $("#name").value.trim();
  const username = $("#username").value;
  const password = $("#password").value;

  if (editingId) {
    const sessions = state.sessions.map(
      (s) => (s.id === editingId ? { ...s, name, username, password } : s)
    );
    closeUserForm();
    await chrome.storage.local.set({ sessions });
    await load();
    return;
  }

  // Keep colours distinct within a domain; they only need to disambiguate side by side.
  const used = new Set(state.sessions.filter((s) => s.domain === domain).map((s) => s.color));
  const session = {
    id: crypto.randomUUID(),
    domain,
    name,
    username,
    password,
    color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[used.size % PALETTE.length]
  };

  const activeByDomain = { ...state.activeByDomain };
  activeByDomain[domain] ??= session.id;

  closeUserForm();
  await chrome.storage.local.set({ sessions: [...state.sessions, session] });
  await writeActiveByDomain(activeByDomain);
  await load();
});

load();
