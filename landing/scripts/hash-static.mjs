#!/usr/bin/env node
/**
 * Хэширование статики лендинга: name.js -> name.<sha8>.js + правки ссылок.
 *
 *   node scripts/hash-static.mjs <dir>   (in-place, для build-контекста)
 *
 * Что делает:
 *   - собирает ссылки на ассеты из *.html ((src|href|content|srcset),
 *     относительные и абсолютные; query-строки вроде ?v= сбрасываются),
 *   - переименовывает файлы в name.<первые 8 hex sha256>.ext,
 *   - правит ссылки в html, иконки в manifest.webmanifest,
 *   - обновляет precache-список и версию кэша в sw.js (сам sw.js НЕ
 *     переименовывается: регистрируется литеральной строкой '/sw.js'),
 *   - удаляет оригиналы, печатает таблицу замен в лог сборки.
 *
 * Каталоги preview/, docs/, scripts/, deploy/ не трогает (их всё равно
 * выкидывает Dockerfile). Повторный прогон по уже хэшированной копии —
 * no-op: голых ссылок не остаётся.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const HASH_EXTS = new Set(['js', 'css', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'ico', 'webmanifest', 'woff2', 'json']);
/** Уже хэшированное имя (наше .abcd1234. и vite -AbC123Xy): не трогаем. */
const HASHED_RE = /[-.][0-9A-Za-z]{8}\.[a-z0-9]+$/;
const NO_HASH = new Set(['sw.js']);
const SKIP_DIRS = new Set(['preview', 'docs', 'scripts', 'deploy', '.git', 'node_modules', '.github']);

const root = resolve(process.argv[2] || '');
if (!root || !statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error('usage: node scripts/hash-static.mjs <dir>');
  process.exit(1);
}

const toPosix = (p) => p.split(sep).join('/');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(join(dir, e.name), out);
    } else if (e.isFile()) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

const files = walk(root);
const htmlFiles = files.filter((f) => f.endsWith('.html'));

/** Чистый путь ассета из ссылки: query/hash отбрасываются, origin — тоже. */
function cleanRef(ref) {
  let s = ref.trim();
  if (!s || s.startsWith('#') || s.startsWith('data:') || s.startsWith('mailto:')) return null;
  if (/^(https?:)?\/\//.test(s)) {
    try {
      const u = new URL(s, 'http://local');
      if (u.origin !== 'http://local' && !u.pathname) return null;
      s = u.pathname;
    } catch {
      return null;
    }
  }
  s = s.split('#')[0].split('?')[0];
  if (!s) return null;
  const ext = s.split('.').pop().toLowerCase();
  if (!HASH_EXTS.has(ext)) return null;
  return s;
}

function resolveRef(refPath, fromDir) {
  const abs = refPath.startsWith('/') ? join(root, refPath.slice(1)) : resolve(fromDir, refPath);
  const norm = resolve(abs);
  if (!norm.startsWith(root + sep) && norm !== root) return null;
  if (!existsSync(norm) || !statSync(norm).isFile()) return null;
  if (HASHED_RE.test(norm.split(sep).pop())) return null;
  if (NO_HASH.has(norm.split(sep).pop())) return null;
  return norm;
}

const targets = new Map();
function need(refPath, fromDir) {
  const clean = cleanRef(refPath);
  if (!clean) return null;
  const abs = resolveRef(clean, fromDir);
  if (!abs) return null;
  if (!targets.has(abs)) {
    const content = readFileSync(abs);
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
    const dot = abs.lastIndexOf('.');
    targets.set(abs, abs.slice(0, dot) + '.' + hash + abs.slice(dot));
  }
  return targets.get(abs);
}

/** Новая ссылка тем же стилем (относительная/абсолютная/с origin). */
function rewriteRef(original, fromDir, hashedAbs) {
  let origin = '';
  let s = original.trim();
  const m = s.match(/^(https?:\/\/[^/]+)(\/.*)$/);
  if (m) {
    origin = m[1];
    s = m[2];
  }
  const absolute = s.startsWith('/');
  const noQuery = s.split('#')[0].split('?')[0];
  let rel = toPosix(relative(fromDir, hashedAbs));
  if (absolute) {
    rel = '/' + toPosix(relative(root, hashedAbs));
  }
  return origin + rel;
}

function rewriteAttr(text, fromDir, attr) {
  const re = new RegExp(attr + '="([^"]+)"', 'g');
  return text.replace(re, (full, ref) => {
    const hashed = need(ref, fromDir);
    if (!hashed) return full;
    return attr + '="' + rewriteRef(ref, fromDir, hashed) + '"';
  });
}

function rewriteSrcset(text, fromDir) {
  return text.replace(/srcset="([^"]+)"/g, (full, set) => {
    const parts = set.split(',').map((p) => {
      const t = p.trim().split(/\s+/);
      const hashed = need(t[0], fromDir);
      if (!hashed) return p;
      t[0] = rewriteRef(t[0], fromDir, hashed);
      return t.join(' ');
    });
    return 'srcset="' + parts.join(', ') + '"';
  });
}

// 1) html: src/href/content/srcset
for (const f of htmlFiles) {
  const dir = dirname(f);
  let text = readFileSync(f, 'utf8');
  text = rewriteAttr(text, dir, 'src');
  text = rewriteAttr(text, dir, 'href');
  text = rewriteAttr(text, dir, 'content');
  text = rewriteSrcset(text, dir);
  writeFileSync(f, text);
}

// 2) manifest: "src": "..."
const manifest = join(root, 'manifest.webmanifest');
if (existsSync(manifest)) {
  const dir = dirname(manifest);
  const text = readFileSync(manifest, 'utf8').replace(/"src"\s*:\s*"([^"]+)"/g, (full, ref) => {
    const hashed = need(ref, dir);
    if (!hashed) return full;
    return full.slice(0, full.indexOf(ref)) + rewriteRef(ref, dir, hashed) + '"';
  });
  writeFileSync(manifest, text);
}

// 3) sw.js: precache-список + версия кэша
const sw = join(root, 'sw.js');
if (existsSync(sw)) {
  const dir = dirname(sw);
  let text = readFileSync(sw, 'utf8');
  text = text.replace(/'((?:\/|\.)[^']*)'/g, (full, ref) => {
    const hashed = need(ref, dir);
    if (!hashed) return full;
    return "'" + rewriteRef(ref, dir, hashed) + "'";
  });
  if (targets.size) {
    const mapHash = createHash('sha256')
      .update(JSON.stringify([...targets.entries()].map(([a, b]) => [toPosix(relative(root, a)), toPosix(relative(root, b))]).sort()))
      .digest('hex').slice(0, 8);
    text = text.replace(/(CACHE\s*=\s*')[^']*(')/, '$1bb-' + mapHash + '$2');
  }
  writeFileSync(sw, text);
}

// 3b) css: url(...) — шрифты и картинки, на которые ссылаются стили
const cssFiles = files.filter((f) => f.endsWith('.css'));
for (const f of cssFiles) {
  const dir = dirname(f);
  const text = readFileSync(f, 'utf8').replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (full, ref) => {
    if (/^(data:|#)/.test(ref)) return full;
    const hashed = need(ref, dir);
    if (!hashed) return full;
    return 'url("' + rewriteRef(ref, dir, hashed) + '")';
  });
  writeFileSync(f, text);
}

// 4) переименовать файлы
for (const [abs, hashed] of targets) {
  renameSync(abs, hashed);
}

const rows = [...targets.entries()]
  .map(([a, b]) => toPosix(relative(root, a)) + ' -> ' + toPosix(relative(root, b)))
  .sort();
console.log('hash-static: ' + rows.length + ' files');
for (const r of rows) console.log('  ' + r);
