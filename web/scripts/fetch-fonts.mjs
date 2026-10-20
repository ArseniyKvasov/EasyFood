#!/usr/bin/env node
/**
 * Скачивает Montserrat (latin + cyrillic) в web/public/fonts, чтобы контейнер
 * не зависел от Google Fonts во время работы.
 *
 *   node web/scripts/fetch-fonts.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/fonts');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const FAMILY = 'Montserrat:wght@400..700';

const WANTED = [
  { file: 'montserrat-latin.woff2', subset: 'latin' },
  { file: 'montserrat-cyrillic.woff2', subset: 'cyrillic' },
];

async function main() {
  await mkdir(outDir, { recursive: true });

  const cssUrl = `https://fonts.googleapis.com/css2?family=${FAMILY}&display=swap`;
  const css = await (await fetch(cssUrl, { headers: { 'User-Agent': UA } })).text();

  // Каждый @font-face в ответе — отдельное подмножество с юникод-диапазоном.
  const blocks = css.split('@font-face').slice(1);
  const bySubset = new Map();

  for (const block of blocks) {
    const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    const range = block.match(/unicode-range:\s*([^;]+);/)?.[1] ?? '';
    if (!url) continue;

    const subset =
      range.includes('U+0301') || range.includes('U+0400') ? 'cyrillic' : 'latin';
    if (!bySubset.has(subset)) bySubset.set(subset, { url, range });
  }

  for (const { file, subset } of WANTED) {
    const found = bySubset.get(subset);
    if (!found) {
      console.warn(`[fonts] подмножество ${subset} не найдено в ответе Google Fonts`);
      continue;
    }
    const buf = Buffer.from(await (await fetch(found.url)).arrayBuffer());
    await writeFile(resolve(outDir, file), buf);
    console.log(`[fonts] ${file} — ${(buf.length / 1024).toFixed(1)} КБ`);
  }

  console.log('[fonts] готово');
}

main().catch((err) => {
  console.error('[fonts] не удалось скачать шрифты:', err.message);
  process.exit(1);
});
