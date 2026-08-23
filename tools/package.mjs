// Builds the Chrome Web Store zip from committed content, then verifies the archive is
// actually loadable rather than merely tidy.
//
//     npm run package
//
// Builds from HEAD, not the working tree — an uncommitted file that never reaches the zip
// is a rejection you find out about a day later. Anything dirty is refused up front.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8", ...opts }).trim();

// Files the extension never loads at runtime have no business in the package.
const EXCLUDE = [
  ":!test", ":!tools", ":!docs", ":!store", ":!*.md", ":!LICENSE",
  ":!package.json", ":!package-lock.json", ":!.gitignore", ":!icons/source.jpg"
];

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const zipName = `auth-switcher-${manifest.version}.zip`;
const zipPath = path.join(root, "..", zipName);

const dirty = run("git", ["status", "--porcelain"]);
if (dirty) {
  console.error("Working tree is dirty — the zip is built from HEAD, so these would be missing:\n" + dirty);
  process.exit(1);
}

fs.rmSync(zipPath, { force: true });
run("git", ["archive", "--format=zip", "-o", zipPath, "HEAD", ...EXCLUDE]);

// ---- verify ---------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "auth-switcher-pkg-"));
run("unzip", ["-q", zipPath, "-d", tmp]);

const fail = [];
const has = (f) => fs.existsSync(path.join(tmp, f));
const read = (f) => fs.readFileSync(path.join(tmp, f), "utf8");

if (!has("manifest.json")) fail.push("no manifest.json in the archive");
const packed = JSON.parse(read("manifest.json"));

for (const f of [packed.background?.service_worker, packed.side_panel?.default_path]) {
  if (!f) fail.push("manifest is missing a service worker or side panel entry");
  else if (!has(f)) fail.push(`manifest references ${f}, which is not in the archive`);
}

for (const [size, f] of Object.entries({ ...packed.icons, ...packed.action?.default_icon })) {
  if (!has(f)) fail.push(`icon ${size} points at ${f}, which is not in the archive`);
}

// A module that fails to resolve is a silent no-op at runtime, not a load error.
for (const file of fs.readdirSync(tmp).filter((f) => f.endsWith(".js"))) {
  for (const [, spec] of read(file).matchAll(/from\s+"(\.\/[^"]+)"/g)) {
    if (!has(spec.slice(2))) fail.push(`${file} imports ${spec}, which is not in the archive`);
  }
}

const html = has("popup.html") ? read("popup.html") : "";
for (const [, ref] of html.matchAll(/(?:src|href)="(?!https?:|data:|#)([^"]+)"/g)) {
  if (!has(ref)) fail.push(`popup.html references ${ref}, which is not in the archive`);
}

// Chrome rejects a repeat version, so catch the stale-bump case before upload.
const tags = run("git", ["tag", "--list"]).split("\n").filter(Boolean);
if (tags.includes(`v${packed.version}`)) {
  fail.push(`v${packed.version} is already tagged — bump manifest.json before uploading`);
}

fs.rmSync(tmp, { recursive: true, force: true });

if (fail.length) {
  console.error("  FAIL\n" + fail.map((f) => "        " + f).join("\n"));
  process.exit(1);
}

const kb = (fs.statSync(zipPath).size / 1024).toFixed(1);
const count = run("unzip", ["-l", zipPath]).match(/(\d+) files?$/m)?.[1] ?? "?";
console.log(`  PASS  ${zipName} — ${count} files, ${kb} KB, built from ${run("git", ["rev-parse", "--short", "HEAD"])}`);
console.log(`        ${path.resolve(zipPath)}`);
