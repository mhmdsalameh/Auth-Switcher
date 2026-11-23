#!/usr/bin/env node
'use strict';
// CI check that the navigation docs keep up with the repo's structure. Read-only.
//   node repo-docs-check.cjs [--root <dir>] [--json]
// Areas come from `areas:` in .sdlc/config.yaml; without it, from tracked files: a top-level folder with a
// build manifest is an area, and so is a second-level folder with a manifest under a top-level folder
// that has none (packages/orders, apps/web).
// Errors: a configured area that does not exist; an area with no CLAUDE.md; an area no CODEMAP.md
// "Modules" row covers (row Path equal to the area or inside it); two docs/adr/ files with the same
// number (parallel branches both took the next one).
// Warnings: no areas found; areas but no CODEMAP.md; a CODEMAP.md row whose path does not exist.
// Exit: 0 clean or warnings only, 1 errors, 2 usage.
// Self-contained (Node built-ins only): /sdlc-init copies it to .sdlc/bin/ so CI runs it without ~/.claude.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const read = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isPlaceholder = (s) => /<[a-z][^<>\n]*>/i.test(s);

// `areas:` from the flat config: a block list ("  - x") or an inline list ("[a, b]").
function configAreas(file) {
  if (!fs.existsSync(file)) return [];
  const lines = read(file).split('\n').map((l) => l.replace(/\s+#.*$/, ''));
  const i = lines.findIndex((l) => /^areas:/.test(l));
  if (i < 0) return [];
  const inline = /^areas:\s*\[(.*)\]\s*$/.exec(lines[i]);
  const raw = inline ? inline[1].split(',') : [];
  if (!inline) for (let j = i + 1; j < lines.length; j++) {
    const m = /^\s+-\s*(.+?)\s*$/.exec(lines[j]);
    if (m) raw.push(m[1]); else if (lines[j].trim()) break;
  }
  return raw.map((s) => s.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean);
}

// Body of the first heading matching re (outside code fences), up to the next heading of the same or higher level.
function section(text, re) {
  const out = [];
  let level = 0;
  let fence = false;
  for (const l of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const h = !fence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h && level && h[1].length <= level) break;
    if (level) out.push(l);
    else if (h && re.test(h[2])) level = h[1].length;
  }
  return level ? out.join('\n') : null;
}

function firstTable(body) {
  const lines = body.split('\n');
  const i = lines.findIndex((l, k) => /^\s*\|/.test(l) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[k + 1] || '') && /-/.test(lines[k + 1] || ''));
  if (i < 0) return null;
  const rows = [];
  for (let k = i + 2; k < lines.length && /^\s*\|/.test(lines[k]); k++) rows.push(cells(lines[k]));
  return { header: cells(lines[i]), rows };
}

const MANIFEST = /^(package\.json|pyproject\.toml|setup\.py|requirements\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|composer\.json|Gemfile|mix\.exs|pubspec\.yaml|Package\.swift|.+\.(csproj|fsproj|vbproj))$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'vendor', 'coverage', 'target', 'venv', '__pycache__']);

const norm = (s) => String(s).replace(/`/g, '').replace(/\\/g, '/').trim().replace(/^\.\//, '').replace(/\/+$/, '');

function trackedFiles(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.split('\0').filter(Boolean) : null;
}

function detectAreas(files) {
  const withManifest = new Set();
  for (const f of files) {
    const parts = f.split('/');
    if (parts.length < 2 || parts.length > 3 || !MANIFEST.test(parts[parts.length - 1])) continue;
    if (parts.slice(0, -1).some((p) => p.startsWith('.') || SKIP_DIRS.has(p))) continue;
    withManifest.add(parts.slice(0, -1).join('/'));
  }
  return [...withManifest].filter((d) => !d.includes('/') || !withManifest.has(d.split('/')[0])).sort();
}

function codemapRows(file) {
  const body = section(read(file), /^modules$/i);
  const t = body && firstTable(body);
  if (!t) return [];
  const cp = t.header.findIndex((h) => /^path$/i.test(h));
  if (cp < 0) return [];
  return t.rows.flatMap((r) => (r[cp] || '').split(/[;,]/).map(norm))
    .filter((p) => p && p !== '-' && !isPlaceholder(p));
}

function check(root) {
  const errors = [];
  const warnings = [];
  const configured = configAreas(path.join(root, '.sdlc', 'config.yaml'));
  let areas;
  let source;
  if (configured.length) {
    areas = configured.map(norm).filter(Boolean);
    source = '.sdlc/config.yaml areas';
  } else {
    const files = trackedFiles(root);
    if (!files) return { errors: ['not a git repository: ' + root], warnings, areas: [], source: null };
    areas = detectAreas(files);
    source = 'manifests';
  }
  if (!areas.length) warnings.push('no areas found: list the top-level areas under `areas:` in .sdlc/config.yaml');

  const codemap = path.join(root, 'CODEMAP.md');
  const rows = fs.existsSync(codemap) ? codemapRows(codemap) : null;
  if (areas.length && rows === null) warnings.push('no CODEMAP.md at the repo root (run /codemap)');

  for (const a of areas) {
    if (!fs.existsSync(path.join(root, a))) { errors.push(`${a}: area listed in .sdlc/config.yaml does not exist`); continue; }
    if (!fs.existsSync(path.join(root, a, 'CLAUDE.md'))) errors.push(`${a}: no CLAUDE.md (seed it from templates/area-CLAUDE.md)`);
    if (rows && !rows.some((p) => p === a || p.startsWith(a + '/'))) errors.push(`${a}: no CODEMAP.md Modules row has a Path in this area`);
  }
  for (const p of rows || []) {
    if (/[*?]/.test(p)) continue;
    if (!fs.existsSync(path.join(root, p))) warnings.push(`CODEMAP.md: Modules row path "${p}" does not exist`);
  }
  errors.push(...adrDuplicates(path.join(root, 'docs', 'adr')));
  return { errors, warnings, areas, source };
}

function adrDuplicates(dir) {
  if (!fs.existsSync(dir)) return [];
  const byNum = new Map();
  for (const f of fs.readdirSync(dir).sort()) {
    const m = /^(\d+)-.+\.md$/i.exec(f);
    if (m) byNum.set(Number(m[1]), [...(byNum.get(Number(m[1])) || []), f]);
  }
  return [...byNum.values()].filter((files) => files.length > 1)
    .map((files) => `docs/adr: ${files.join(', ')} share one number - renumber the later one to the next free number after merging main`);
}

function main(argv) {
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    else if (argv[i] === '--root' && argv[i + 1]) root = path.resolve(argv[++i]);
    else { console.error('usage: repo-docs-check.cjs [--root <dir>] [--json]'); return 2; }
  }
  const r = check(root);
  if (json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`repo-docs: ${r.areas.length} area(s)${r.source ? ` from ${r.source}` : ''}: ${r.areas.join(', ') || '-'}`);
    for (const e of r.errors) console.log('error: ' + e);
    for (const w of r.warnings) console.log('warning: ' + w);
    console.log(`repo-docs: ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
  }
  return r.errors.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { check, detectAreas, codemapRows, main };
