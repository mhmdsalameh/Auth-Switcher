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

for (const p of ["storage", "tabs", "cookies", "browsingData", "unlimitedStorage",
                 "webRequest", "webRequestAuthProvider", "declarativeNetRequest"]) {
  if (!manifest.permissions.includes(p)) fail.push(`manifest missing "${p}" permission`);
}

// Chrome refuses to load an extension whose description exceeds 132 characters.
if ((manifest.description ?? "").length > 132) {
  fail.push(`manifest description is ${manifest.description.length} chars, max is 132`);
}

for (const f of [manifest.background.service_worker, manifest.action.default_popup,
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
// Goes through INSTANCE_AREA, not storage.local: a private window's cookies must never
// be written to disk, let alone restored into the normal profile.
if (!/INSTANCE_AREA\.set\(\{ \[SNAPSHOT_KEY\]/.test(bg)) fail.push("cookie snapshot no longer persisted");
if (/storage\.local\.set\(\{ \[SNAPSHOT_KEY\]/.test(bg)) fail.push("cookie snapshot bypasses INSTANCE_AREA");

// Diagnostics written from the incognito instance must not land in shared storage.local.
for (const key of ["lastScheme", "ruleError", "lastReset"]) {
  if (new RegExp(`storage\\.local\\.set\\(\\{\\s*${key}`).test(bg)) {
    fail.push(`${key} bypasses INSTANCE_AREA — leaks private-window activity to disk`);
  }
}

const clearBody = bg.slice(bg.indexOf("async function clearAuthCache"));
const snapshotAt = clearBody.indexOf("SNAPSHOT_KEY");
const removeAt = clearBody.indexOf("browsingData.remove");
if (snapshotAt === -1 || removeAt === -1 || snapshotAt > removeAt) {
  fail.push("snapshot must be persisted BEFORE cookies are cleared");
}

if (fail.length) {
  console.error("  FAIL\n" + fail.map((f) => "        " + f).join("\n"));
  process.exit(1);
}
console.log(`  PASS  manifest, ${ids.length} DOM ids, ${usedClasses.size} CSS classes, messages [${sent}], 10 regression guards`);
