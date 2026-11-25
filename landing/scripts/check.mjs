#!/usr/bin/env node
/**
 * Проверка статики BiteBalance: битые ссылки, дубли id, alt у картинок, метатеги.
 * Запуск: node scripts/check.mjs
 */
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] || new URL('..', import.meta.url).pathname);
const pages = [
  'index.html',
  'calculator/index.html',
  'onboarding/index.html',
  'legal/index.html',
  'legal/privacy.html',
  'legal/consent.html',
  'legal/offer.html'
];

/* Ссылки на внешние приложения этого же домена: /app/ живёт в другом проекте */
const EXTERNAL = ['/app/'];

const problems = [];
const rel = (p) => p.replace(root + '/', '');

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

for (const page of pages) {
  const file = join(root, page);
  if (!(await exists(file))) { problems.push('НЕТ ФАЙЛА: ' + page); continue; }
  const html = await readFile(file, 'utf8');

  // метатеги
  if (!/<title>[^<]{10,}<\/title>/.test(html)) problems.push(page + ': пустой <title>');
  if (!/name="description"/.test(html)) problems.push(page + ': нет meta description');

  // дубли id
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) problems.push(page + ': повторяющийся id="' + id + '"');
    seen.add(id);
  }

  // картинки без alt
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(m[0])) problems.push(page + ': <img> без alt -> ' + m[0].slice(0, 80));
  }

  // ссылки и ресурсы
  for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const raw = m[1];
    if (/^(https?:|mailto:|tel:|data:|#)/.test(raw)) {
      if (raw.startsWith('#')) {
        const id = raw.slice(1);
        if (id && !ids.includes(id)) problems.push(page + ': якорь ' + raw + ' не найден');
      }
      continue;
    }
    const target = raw.split('#')[0].split('?')[0];
    if (!target) continue;
    if (EXTERNAL.some((prefix) => target.startsWith(prefix))) continue;
    let abs = target.startsWith('/') ? join(root, target) : resolve(dirname(file), target);
    if (target.endsWith('/')) abs = join(abs, 'index.html');
    if (!(await exists(abs))) problems.push(page + ': битая ссылка ' + raw);
  }
}

// обязательные файлы для продакшена
for (const f of ['robots.txt', 'sitemap.xml', '404.html', 'favicon.svg']) {
  if (!(await exists(join(root, f)))) problems.push('НЕТ ФАЙЛА: ' + f);
}

if (problems.length === 0) {
  console.log('OK: ' + pages.length + ' страниц проверено, проблем нет');
} else {
  console.log('Проблемы (' + problems.length + '):');
  for (const p of problems) console.log(' - ' + p);
  process.exitCode = 1;
}
