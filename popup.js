import {
  buildBackup, parseBackup, openBackup, mergeBackup, normalizeDomain, domainsOf
} from "./backup.js";
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

// Hand the work to the worker and return immediately.
//
// The worker holds the message channel open until switchTo() has finished — waking the
// service worker, syncing rules, clearing the domain, then reloading its tabs. Awaiting all
// of that before reacting left the UI looking like the click had not registered for a
// second or two. Nothing here needs the result: the worker writes activeByDomain early in
// the switch, and the storage listener at the bottom of this file repaints when it lands.
//
// The rejection is swallowed on purpose. If this view is ever torn down mid-flight the
// worker's sendResponse has nowhere to go and surfaces as "message port closed", which is
// expected here rather than a failure.
function fireAndForget(msg) {
  send(msg).catch(() => {});
}

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

// Schemes that negotiate over the Authorization header itself, so a static value set by
// the pre-emptive rule overwrites the handshake and login can never complete.
const UNPREEMPTABLE = new Set(["digest", "ntlm", "negotiate"]);

// The managed site the active tab is on. Deliberately panel-local rather than stored:
// `selectedDomain` lives in storage.local, which is shared with the private-window instance
// and with every other window's panel, so writing browsing activity there would drag all of
// them around in lockstep.
let tabDomain = null;
// A pick from the dropdown. Outranks the tab, but only until the tab moves to a *different*
// managed site — staying put while you configure another environment is the point of
// picking by hand, and having it survive forever would just recreate the original problem.
let pinnedDomain = null;

// The site the panel is showing, most specific source first. Falls back to the first
// configured domain when everything else is unset or stale (e.g. after one is deleted).
function currentDomain() {
  for (const candidate of [pinnedDomain, tabDomain, state.selectedDomain]) {
    if (candidate && state.domains.includes(candidate)) return candidate;
  }
  return state.domains[0] ?? null;
}

// Maps the active tab onto a configured site, subdomains included — the same rule
// `domainForHost()` and `hostInScope()` use in the worker, so the panel can't disagree with
// it about what counts as "this site".
async function tabSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const host = new URL(tab.url).hostname.toLowerCase();
    return state.domains.find((d) => host === d || host.endsWith("." + d)) ?? null;
  } catch {
    // No active tab, or a chrome:// / new-tab URL that won't parse.
    return null;
  }
}

// Returns whether the shown site actually moved, so callers can skip a pointless repaint.
async function followTab() {
  const site = await tabSite();
  // An unmanaged tab leaves the panel exactly where it was. Blanking it every time someone
  // checks their mail would be worse than not following at all.
  if (!site) return false;

  const moved = site !== tabDomain;
  tabDomain = site;
  if (moved) pinnedDomain = null;
  return moved;
}

async function load() {
  state = { ...(await chrome.storage.local.get(STORAGE_DEFAULTS)), ...(await readInstanceState()) };
  state.activeByDomain = await readActiveByDomain();
  await followTab();
  render();
}

async function selectDomain(domain) {
  query = ""; // a filter carried across domains would look like missing users
  pinnedDomain = domain;
  // Still stored, so a panel opened on an unmanaged tab comes back to the last hand-picked
  // site rather than to whichever domain happens to sort first.
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
  // Explains on hover why the selection just moved on its own.
  select.title = selected === tabDomain && selected !== pinnedDomain
    ? `${selected} — following the active tab`
    : selected;
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
  // A user configured for several sites is worth marking: editing or deleting them from
  // here reaches beyond the site currently on screen.
  const sites = domainsOf(session);
  if (sites.length > 1) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `${sites.length} sites`;
    badge.title = `Signs in to ${sites.join(", ")}`;
    name.append(badge);
  }

  meta.append(name, user);
  main.append(dot, meta);
  main.addEventListener("click", () => {
    // The panel names the site it is showing. A user who serves several must only be
    // switched on the one in view — the worker would otherwise clear cookies and reload
    // tabs on a site nobody was looking at.
    fireAndForget({ type: "switch", sessionId: session.id, domain: currentDomain() });
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

  // The ↗ pin is delivered entirely by the tab-scoped DNR rule, which syncRules builds only
  // in pre-emptive mode. Without that rule Chrome answers from its auth cache before any 401,
  // onAuthRequired never runs, its tabAssignments lookup is never reached, and the new tab
  // silently opens as whoever is already signed in. A button that returns the wrong user is
  // worse than no button.
  const canPin = state.preemptive && !state.ruleError;

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "icon-btn";
  openBtn.textContent = "↗";
  openBtn.title = `Open a new tab as ${session.name}`;
  openBtn.setAttribute("aria-label", `Open a new tab as ${session.name}`);
  openBtn.addEventListener("click", async () => {
    // targetUrl() is a single tabs.query and must resolve before the message is built.
    const url = await targetUrl();
    fireAndForget({ type: "openAs", sessionId: session.id, url });
  });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "icon-btn";
  delBtn.textContent = "✕";
  // Say so up front when the row is shared — it is not obvious from a list scoped to one site.
  delBtn.title = sites.length > 1
    ? `Remove ${session.name} from all ${sites.length} sites`
    : `Remove ${session.name}`;
  delBtn.setAttribute("aria-label", delBtn.title);
  delBtn.addEventListener("click", async () => {
    const sessions = state.sessions.filter((x) => x.id !== session.id);
    const activeByDomain = { ...state.activeByDomain };
    // This user may be the signed-in one on several sites; none of them may be left
    // pointing at an id that no longer exists.
    for (const [d, id] of Object.entries(activeByDomain)) {
      if (id === session.id) delete activeByDomain[d];
    }
    await chrome.storage.local.set({ sessions });
    await writeActiveByDomain(activeByDomain);
    await load();
  });

  actions.append(editBtn, ...(canPin ? [openBtn] : []), delBtn);
  li.append(main, actions);
  return li;
}

// View state. Settings is a separate page, not a panel stacked above the users.
let settingsOpen = false;
let formOpen = false;
// The form doubles as add and edit; editingId null means we are adding.
let editingId = null;
// Sites ticked in the open user form, and whether the picker is expanded. Held here rather
// than read back off the checkboxes because render() rebuilds them.
let formDomains = new Set();
let choiceOpen = false;

// The sites the form is offering, in the configured order — never the raw Set, so the list
// and the summary can't disagree about ordering.
function chosenDomains() {
  return state.domains.filter((d) => formDomains.has(d));
}

function openUserForm(session = null) {
  editingId = session?.id ?? null;
  formOpen = true;
  settingsOpen = false;
  choiceOpen = false;
  const domain = currentDomain();
  // Editing keeps the user's own sites. Adding starts on the site being viewed, which is
  // the one the person is thinking about — ticking more is the deliberate act.
  formDomains = new Set(session ? domainsOf(session) : domain ? [domain] : []);
  $("#form-title").textContent = session ? "Edit user" : "Add user";
  $("#form-submit").textContent = session ? "Save changes" : "Save user";
  $("#name").value = session?.name ?? "";
  $("#username").value = session?.username ?? "";
  $("#password").value = session?.password ?? "";
  hidePasswords();
  render();
  $("#name").focus();
}

function closeUserForm() {
  editingId = null;
  formOpen = false;
  choiceOpen = false;
  formDomains = new Set();
  $("#add-form").reset();
  hidePasswords();
  render();
}

// ---- Password reveal -------------------------------------------------------

// Inline SVG rather than an eye emoji: 👁 renders through Segoe UI Emoji on Windows, which
// paints its own colours and ignores the muted-grey .icon-btn treatment every other control
// here uses. `currentColor` inherits it instead.
const EYE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M1 8 Q4 3.4 8 3.4 T15 8 Q12 12.6 8 12.6 T1 8 Z"/><circle cx="8" cy="8" r="2"/></svg>';
const EYE_OFF = EYE.replace("</svg>", '<path d="M2.5 13.5 13.5 2.5"/></svg>');

// Builds the button, wires it, and hands back a reset. Passwords here are QA credentials
// shown over someone's shoulder as often as not, so revealing is never sticky: every reset
// puts the field back to dots rather than leaving one visible for whoever opens the panel
// next. form.reset() restores an input's *value*, not its type, so this has to be explicit.
function addReveal(input) {
  const btn = document.createElement("button");
  btn.type = "button";
  // Borrows .icon-btn for the muted/hover/focus treatment; .pw-toggle only positions it.
  btn.className = "icon-btn pw-toggle";

  const paint = () => {
    const shown = input.type === "text";
    btn.innerHTML = shown ? EYE_OFF : EYE;
    btn.title = shown ? "Hide password" : "Show password";
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-pressed", String(shown));
  };

  btn.addEventListener("click", () => {
    input.type = input.type === "password" ? "text" : "password";
    paint();
    input.focus(); // the click stole focus from the field being typed into
  });

  paint();
  input.after(btn);
  return () => {
    input.type = "password";
    paint();
  };
}

const reveals = [$("#password"), $("#export-pass"), $("#import-pass")].map((el) => addReveal(el));
const hidePasswords = () => reveals.forEach((reset) => reset());

// Summary and caret only. Split out from the list rebuild below so ticking a box can
// refresh the summary without destroying the checkbox that currently has focus.
function renderChoiceSummary() {
  const picked = chosenDomains();
  const summary = $("#domain-choice-summary");
  // Empty is a real state — the CSS prompts for a pick rather than showing a blank field.
  summary.textContent =
    picked.length > 1 ? `${picked[0]}  +${picked.length - 1}` : picked[0] ?? "";
  summary.title = picked.join(", ");
  $("#domain-choice-toggle").setAttribute("aria-expanded", String(choiceOpen));
}

function renderDomainChoice() {
  const block = $("#domain-choice");
  // One site means nothing to choose, and the form stays exactly as it was before.
  block.hidden = state.domains.length < 2;
  if (block.hidden) return;

  renderChoiceSummary();

  const list = $("#domain-choice-list");
  list.hidden = !choiceOpen;
  list.textContent = "";
  if (!choiceOpen) return;

  for (const domain of state.domains) {
    const li = document.createElement("li");
    li.className = "choice-item";

    const row = document.createElement("label");
    row.className = "choice-row";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = formDomains.has(domain);
    box.addEventListener("change", () => {
      if (box.checked) formDomains.add(domain);
      else formDomains.delete(domain);
      renderChoiceSummary();
    });

    const mark = document.createElement("span");
    mark.className = "choice-box";

    const name = document.createElement("span");
    name.className = "choice-name";
    name.textContent = domain;

    row.append(box, mark, name);
    li.append(row);
    list.append(li);
  }
}

function render() {
  const domain = currentDomain();
  const mine = state.sessions.filter((s) => domainsOf(s).includes(domain));
  const active = mine.find((s) => s.id === state.activeByDomain[domain]) ?? null;

  renderDomainPicker();
  renderDomains();
  renderDomainChoice();

  document.documentElement.style.setProperty("--user", userColor(active) ?? "#9d9d9d");
  $("#active-name").textContent = active ? active.name : "Nobody";
  $("#active-user").textContent = active ? active.username : "Pick a user below";
  // The active user is kept out of the list below, so it needs its own edit affordance.
  $("#active-edit").hidden = !active;

  // Editing the signed-in user changes the password everywhere they sign in, so the
  // shared-site count belongs here too, not only on the rows below.
  const activeSites = active ? domainsOf(active) : [];
  const activeBadge = $("#active-badge");
  activeBadge.hidden = activeSites.length < 2;
  if (!activeBadge.hidden) {
    activeBadge.textContent = `${activeSites.length} sites`;
    activeBadge.title = `Signs in to ${activeSites.join(", ")}`;
  }

  // Settings and the user list are separate pages — never both at once.
  $("#settings").hidden = !settingsOpen;
  $("#nav-title").hidden = !settingsOpen;
  // ✕ is reserved for #panel-close; a second ✕ here would read as "close the panel" too.
  $("#settings-toggle").textContent = settingsOpen ? "←" : "⚙";
  $("#settings-toggle").title = settingsOpen ? "Back" : "Settings";

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
  } else if (state.preemptive && UNPREEMPTABLE.has(state.lastScheme)) {
    note.hidden = false;
    note.classList.add("msg-warn");
    note.textContent =
      `Pre-emptive is on but this site uses ${state.lastScheme.toUpperCase()} — login will fail. Turn it off.`;
    note.title =
      "These schemes negotiate over the Authorization header. The pre-emptive rule sets " +
      "that header on every request, overwriting the handshake, so authentication never " +
      "completes and the password prompt repeats.";
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

// The panel outlives every tab switch, so it follows the active tab instead of making the
// site be re-picked by hand each time.
//
// Never while a form is open. The add/edit form is bound to the site it was opened on and
// its submit handler resolves `currentDomain()` at save time, so letting the site move
// underneath would file the user against whatever tab happened to be in front. The next tab
// event after the form closes picks the change back up.
async function syncToTab() {
  if (formOpen || settingsOpen) return;
  if (!(await followTab())) return;
  query = ""; // a filter carried across sites would look like missing users
  render();
}

chrome.tabs.onActivated.addListener(syncToTab);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  // Fires for title, favicon and status too; only a navigation can change the site.
  if (changeInfo.url) syncToTab();
});

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

// sidePanel.close() landed in Chrome 141 and the manifest floor is 144, so it is always
// present. It requires a tabId or windowId, and on 144 closing a *global* panel through it
// rejects — that was only relaxed in 145. This panel is registered globally, so the
// fallback is the load-bearing path on 144: closing the page closes the panel with it.
// Scoped to this window on purpose; a broadcast close would shut the panel in other windows.
async function closePanel() {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.close({ windowId: win.id });
  } catch {
    window.close();
  }
}

$("#panel-close").addEventListener("click", closePanel);

$("#settings-toggle").addEventListener("click", () => {
  settingsOpen = !settingsOpen;
  if (settingsOpen) {
    // Don't leave a half-filled user form behind the settings page.
    editingId = null;
    formOpen = false;
    choiceOpen = false;
    formDomains = new Set();
    $("#add-form").reset();
    hidePasswords();
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
  // Both the conflict warning and the ↗ buttons key off this, so re-render rather than
  // making the user close and reopen the popup to find out it broke their login.
  await load();
});

// ---- Backup ----------------------------------------------------------------

let pendingImport = null; // a parsed, still-encrypted file awaiting its passphrase

function backupStatus(text, isError = false) {
  const el = $("#backup-status");
  el.textContent = text;
  el.style.color = isError ? "#e0705c" : "";
}

function showBackupForm(which) {
  hidePasswords();
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

  // With a single site configured the picker is hidden, so the site on screen is the answer.
  const chosen = state.domains.length < 2 ? [domain] : chosenDomains();
  if (!chosen.length) {
    // A user with nowhere to sign in would save successfully and then appear in no list at
    // all. Open the picker on the empty field rather than letting that happen quietly.
    choiceOpen = true;
    renderDomainChoice();
    $("#domain-choice-toggle").focus();
    return;
  }

  // Read before closing — closeUserForm resets the fields.
  const name = $("#name").value.trim();
  const username = $("#username").value;
  const password = $("#password").value;

  const activeByDomain = { ...state.activeByDomain };

  if (editingId) {
    const sessions = state.sessions.map((s) => {
      if (s.id !== editingId) return s;
      // Drop any pre-multi-domain `domain` on the way past: two fields meaning the same
      // thing is how they drift apart.
      const { domain: _legacy, ...rest } = s;
      return { ...rest, name, username, password, domains: chosen };
    });

    // Untick a site this user was signed in on and that site must not be left pointing at
    // someone who no longer serves it.
    for (const [d, id] of Object.entries(activeByDomain)) {
      if (id === editingId && !chosen.includes(d)) delete activeByDomain[d];
    }
    // Newly ticked sites with nobody signed in adopt this user, matching what adding does.
    for (const d of chosen) activeByDomain[d] ??= editingId;

    closeUserForm();
    await chrome.storage.local.set({ sessions });
    await writeActiveByDomain(activeByDomain);
    await load();
    return;
  }

  // Keep colours distinct among the users this one will sit beside; they only need to
  // disambiguate side by side, so any site in common is enough to count as a clash.
  const used = new Set(
    state.sessions
      .filter((s) => domainsOf(s).some((d) => chosen.includes(d)))
      .map((s) => s.color)
  );
  const session = {
    id: crypto.randomUUID(),
    domains: chosen,
    name,
    username,
    password,
    color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[used.size % PALETTE.length]
  };

  for (const d of chosen) activeByDomain[d] ??= session.id;

  closeUserForm();
  await chrome.storage.local.set({ sessions: [...state.sessions, session] });
  await writeActiveByDomain(activeByDomain);
  await load();
});

$("#domain-choice-toggle").addEventListener("click", () => {
  choiceOpen = !choiceOpen;
  // Not a full render(): that rebuilds the whole panel, and the picker is the only thing
  // that changed. Keeps the half-typed password fields untouched.
  renderDomainChoice();
});

// The side panel stays open across a switch, so it has to follow state the worker changes
// underneath it — otherwise it keeps showing the previous active user. Only the keys a
// switch actually touches trigger a repaint, and never while a form is open: render()
// rebuilds the DOM wholesale and would discard whatever the user is part-way through typing.
const REPAINT_KEYS = ["activeByDomain", "sessions", "domains", "selectedDomain", "ruleError"];

chrome.storage.onChanged.addListener((changes) => {
  if (formOpen || settingsOpen) return;
  if (REPAINT_KEYS.some((k) => k in changes)) load();
});

load();
