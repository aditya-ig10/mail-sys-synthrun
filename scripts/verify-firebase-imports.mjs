// Guards against a repeat of the 2026-09-15 outage: mail-app-clean.js
// imported `getCountFromFirestore`, which firebase 10.12.2 does not export,
// so the whole module died at link time and the app stuck at "loading".
// Usage: node scripts/verify-firebase-imports.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['mail-app-clean.js', 'settings/index.html', 'login/index.html', 'reset-password/index.html'];

function collectFiles() {
  const out = [];
  for (const entry of SCAN) {
    const full = join(root, entry);
    try {
      if (statSync(full).isFile()) out.push(full);
    } catch { console.warn(`skip (missing): ${entry}`); }
  }
  return out;
}

function parseImports(source) {
  // import { a, b as c } from 'https://www.gstatic.com/firebasejs/<v>/<mod>.js'
  const re = /import\s*\{([^}]+)\}\s*from\s*['"](https:\/\/www\.gstatic\.com\/firebasejs\/[^'"]+)['"]/g;
  const found = [];
  let m;
  while ((m = re.exec(source))) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      // `ref as storageRef` imports the export named `ref`.
      const parts = s.split(/\s+as\s+/);
      return parts[0].trim();
    });
    found.push({ url: m[2], names });
  }
  return found;
}

function parseExports(source) {
  const names = new Set();
  const re = /export\s*\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(source))) {
    for (const part of m[1].split(',')) {
      const pieces = part.trim().split(/\s+as\s+/);
      if (!pieces[0]) continue;
      names.add((pieces.length > 1 ? pieces[1] : pieces[0]).trim());
    }
  }
  return names;
}

const exportCache = new Map();
async function getExports(url) {
  if (!exportCache.has(url)) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
    exportCache.set(url, parseExports(await resp.text()));
  }
  return exportCache.get(url);
}

let failures = 0;
for (const file of collectFiles()) {
  const source = readFileSync(file, 'utf8');
  for (const { url, names } of parseImports(source)) {
    let exports;
    try {
      exports = await getExports(url);
    } catch (err) {
      console.error(`ERROR ${file}: ${err.message}`);
      failures += 1;
      continue;
    }
    for (const name of names) {
      if (!exports.has(name)) {
        console.error(`MISSING ${file}: "${name}" is not exported by ${url}`);
        failures += 1;
      }
    }
  }
}

if (failures) {
  console.error(`\n${failures} bad firebase import(s) — the app would stick at loading.`);
  process.exit(1);
}
console.log('firebase imports OK');
