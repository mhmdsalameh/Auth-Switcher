// Static checks that catch the mistakes the VM tests can't: manifest/permission drift,
// popup.js referencing DOM ids that don't exist, and messages nothing handles.
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const html = read("popup.html");
const js = read("popup.js");
const bg = read("background.js");

const fail = [];

for (const p of ["storage", "tabs", "cookies", "browsingData", "sidePanel",
                 "webRequest", "webRequestAuthProvider", "declarativeNetRequest"]) {
  if (!manifest.permissions.includes(p)) fail.push(`manifest missing "${p}" permission`);
}

if (!manifest.side_panel?.default_path) fail.push("side_panel.default_path missing");
if (manifest.action?.default_popup) {
  fail.push("action.default_popup is back — it claims the icon click and the side panel never opens");
}
if (!/setPanelBehavior\(\{ openPanelOnActionClick: true \}\)/.test(bg)) {
  fail.push("setPanelBehavior missing — the toolbar icon would do nothing");
}
// The panel outlives a switch: it may only close on the user's explicit request, never as
// a side effect of switching. window.close() is allowed solely as closePanel()'s fallback
// for Chrome 144, where sidePanel.close() rejects on a global panel.
if (!/id="panel-close"/.test(html)) fail.push("close button missing from the side panel");
if (!/\$\("#panel-close"\)\.addEventListener/.test(js)) fail.push("close button is not wired");
if (!/chrome\.sidePanel\.close\(/.test(js)) fail.push("closePanel must use sidePanel.close()");
const closeBody = js.slice(js.indexOf("async function closePanel"), js.indexOf("$(\"#panel-close\")"));
if ((js.match(/window\.close\(\)/g) ?? []).length !== (closeBody.match(/window\.close\(\)/g) ?? []).length) {
  fail.push("window.close() outside closePanel — the panel must not dismiss itself");
}

// Chrome refuses to load an extension whose description exceeds 132 characters.
if ((manifest.description ?? "").length > 132) {
  fail.push(`manifest description is ${manifest.description.length} chars, max is 132`);
}

for (const f of [manifest.background.service_worker, manifest.side_panel?.default_path,
                 "popup.css", "popup.js"]) {
  if (!fs.existsSync(new URL(f, root))) fail.push(`manifest/HTML references missing file: ${f}`);
}

// The store rejects a submission with no 128px icon, and a missing icon file is a silent
// load failure rather than an error.
for (const size of [16, 32, 48, 128]) {
  for (const [where, set] of [["icons", manifest.icons], ["action.default_icon", manifest.action.default_icon]]) {
    const f = set?.[size];
    if (!f) fail.push(`manifest ${where} is missing the ${size}px entry`);
    else if (!fs.existsSync(new URL(f, root))) fail.push(`${where}[${size}] points at a missing file: ${f}`);
  }
}

// A bad relative import in an MV3 module script fails silently at runtime.
for (const [file, src] of [["popup.js", js], ["background.js", bg]]) {
  for (const [, spec] of src.matchAll(/from "(\.\/[^"]+)"/g)) {
    if (!fs.existsSync(new URL(spec.slice(2), root))) {
      fail.push(`${file} imports missing module: ${spec}`);
    }
  }
}
// A module service worker only works if the manifest says so.
if (bg.includes("import ") && manifest.background.type !== "module") {
  fail.push('background.js uses imports but manifest background.type is not "module"');
}

const ids = [...new Set([...js.matchAll(/\$\("#([\w-]+)"\)/g)].map((m) => m[1]))];
const missingIds = ids.filter((id) => !html.includes(`id="${id}"`));
if (missingIds.length) fail.push("popup.js references missing DOM ids: " + missingIds);

const sent = [...new Set([...js.matchAll(/type: "(\w+)"/g)].map((m) => m[1]))];
const handled = [...bg.matchAll(/^\s{4}(\w+): \(\)/gm)].map((m) => m[1]);
const unhandled = sent.filter((t) => !handled.includes(t));
if (unhandled.length) fail.push("popup sends messages nothing handles: " + unhandled);

// Every class used in the markup or built in JS must actually exist in the stylesheet.
const css = read("popup.css");
const usedClasses = new Set([
  ...[...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)),
  ...[...js.matchAll(/className = "([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/))
].filter(Boolean));
const orphanClasses = [...usedClasses].filter((c) => !new RegExp(`\\.${c}\\b`).test(css));
if (orphanClasses.length) fail.push("classes with no styles: " + orphanClasses);

// Visibility is driven entirely by the hidden attribute, but author rules that set
// display beat the UA stylesheet's [hidden] { display: none }. Without this rule an
// element like .rack-head { display: flex } silently refuses to hide.
if (!/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(css)) {
  fail.push("popup.css must force [hidden] { display: none !important }");
}

// Regressions we have already fixed once.
const shared = read("storage.js");
if (!/preemptive: false/.test(shared)) fail.push("shared defaults lost preemptive: false");
if (/preemptive: true/.test(shared + bg + js)) fail.push("preemptive must default to false (breaks NTLM)");
if (/const DEFAULTS =/.test(bg + js)) {
  fail.push("storage defaults are duplicated again — import them from storage.js");
}
if (/id="preemptive" checked/.test(html)) fail.push("preemptive checkbox still checked in HTML");
if (/const attempted = new Set/.test(bg)) fail.push("auth retry guard back in worker memory");
// The whole point of this design: no other site's cookies are ever read, stored or wiped.
if (/SNAPSHOT_KEY|cookieSnapshot/.test(bg)) fail.push("cookie snapshot is back — other sites must never be touched");
if (/unlimitedStorage/.test(JSON.stringify(manifest))) fail.push("unlimitedStorage back without a snapshot to justify it");

// Diagnostics written from the incognito instance must not land in shared storage.local.
for (const key of ["lastScheme", "ruleError", "lastReset"]) {
  if (new RegExp(`storage\\.local\\.set\\(\\{\\s*${key}`).test(bg)) {
    fail.push(`${key} bypasses INSTANCE_AREA — leaks private-window activity to disk`);
  }
}

// A global browsingData cookie clear is what logged people out of rotating-cookie sites.
// Scan code only — comments below quote these very patterns.
const bgCode = bg.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const removeCalls = bgCode.match(/browsingData\.remove\([\s\S]*?\);/g) ?? [];
if (!removeCalls.length) fail.push("no browsingData.remove found — guard is looking at the wrong thing");
for (const call of removeCalls) {
  if (!/origins:/.test(call)) fail.push("browsingData.remove without an origins filter is global");
  // `cache` is origin-scoped like the rest, but only while the origins filter is present —
  // which the check above already enforces for every call.
}

// The auth-cache flush is the one destructive step left. It must stay behind the flag, so a
// switch that does not need it cannot sign the user out of sibling subdomains.
if (!/if \(flushAuthCache\) types\.cookies = true;/.test(bgCode)) {
  fail.push("auth-cache flush must stay conditional on flushAuthCache");
}
if (/cookies:\s*true/.test(bgCode)) fail.push("unconditional cookies:true — flush must go through the flag");

// A user's sites are a list. Reading a `.domain` field off one again would work for a
// single-site user and silently ignore every extra site on a shared one.
const jsCode = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
if (/\b(session|s|active|user)\.domain\b/.test(bgCode + jsCode)) {
  fail.push("a user's sites must be read through domainsOf(), not a `.domain` field");
}

// Switching is scoped to the site the panel is showing. If the message stops carrying it,
// the worker falls back to the user's first site and clears the wrong one's cookies.
if (!/type: "switch"[\s\S]{0,120}domain:/.test(js)) {
  fail.push("the switch message must name the site the panel is showing");
}
if (!/switch: \(\) => switchTo\(msg\.sessionId, msg\.domain\)/.test(bgCode)) {
  fail.push("the worker must pass the panel's site through to switchTo");
}

// The panel follows the active tab. Without both listeners the selector quietly goes back
// to needing a manual pick on every switch.
for (const [event, why] of [["onActivated", "tab activation"], ["onUpdated", "in-tab navigation"]]) {
  if (!new RegExp(`chrome\\.tabs\\.${event}\\.addListener`).test(js)) {
    fail.push(`panel no longer follows ${why}`);
  }
}
// Following must never move the site under an open form: the submit handler resolves
// currentDomain() at save time, so a user would be filed against the wrong site.
const syncBody = js.slice(js.indexOf("async function syncToTab"), js.indexOf("chrome.tabs.onActivated"));
if (!/formOpen/.test(syncBody)) {
  fail.push("tab-following must be suppressed while a form is open");
}

const clearBody = bgCode.slice(bgCode.indexOf("async function clearSiteData"));
if (!/cookies\.getAll\(\{ domain: /.test(clearBody)) {
  fail.push("cookie read must be scoped to the target domain, not getAll({})");
}

if (fail.length) {
  console.error("  FAIL\n" + fail.map((f) => "        " + f).join("\n"));
  process.exit(1);
}
console.log(`  PASS  manifest, ${ids.length} DOM ids, ${usedClasses.size} CSS classes, messages [${sent}], 27 regression guards`);
