import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { query } from '../db.js';

/** Дата в формате YYYY-MM-DD по локальному времени сервера. */
const localDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Чистит историю дневника: записи старше retentionDays дней удаляются.
 * Возвращает количество удалённых строк.
 */
export async function runRetention(
  days = config.maintenance.historyRetentionDays,
): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows = await query<{ id: string }>(
    `DELETE FROM entries WHERE day < $1::date RETURNING id`,
    [localDate(cutoff)],
  );
  return rows.length;
}

/** Папка с дампами — создаётся при первом бэкапе. */
const backupDir = (): string => resolve(process.cwd(), config.backup.dir);

/** Сжимает дамп базы и кладёт его в папку бэкапов. Возвращает размер файла. */
const dumpToFile = async (file: string): Promise<number> => {
  const dump = spawn(
    'pg_dump',
    [
      '--dbname',
      config.databaseUrl,
      '--no-owner',
      '--no-privileges',
      '--clean',
      '--if-exists',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let stderr = '';
  dump.stderr.on('data', (c: Buffer) => {
    stderr += c.toString();
  });

  // Слушаем close до пайплайна: иначе событие можно пропустить и зависнуть.
  const closed = new Promise<number>((resolve) => {
    dump.on('close', (code) => resolve(code ?? 1));
  });

  try {
    await pipeline(dump.stdout, createGzip({ level: 9 }), createWriteStream(file));
  } catch (err) {
    throw new Error(`pg_dump failed: ${stderr.trim() || (err as Error).message}`);
  }

  const code = await closed;
  if (code !== 0) {
    throw new Error(`pg_dump exited with ${code}: ${stderr.trim()}`);
  }

  const { size } = await stat(file);
  if (size === 0) throw new Error('pg_dump produced an empty file');
  return size;
};

/** Удаляет бэкапы старше BACKUP_KEEP_DAYS дней. */
const pruneBackups = async (dir: string): Promise<number> => {
  const cutoff = Date.now() - config.backup.keepDays * 86_400_000;
  let removed = 0;
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.sql.gz')) continue;
    const file = join(dir, name);
    const info = await stat(file);
    if (info.mtimeMs >= cutoff) continue;
    await rm(file);
    removed += 1;
  }
  return removed;
};

export type BackupResult = {
  file: string;
  bytes: number;
  pruned: number;
};

/**
 * Бэкап базы в локальную папку: pg_dump → gzip → файл.
 * Старые дампы сверх BACKUP_KEEP_DAYS удаляются.
 */
export async function runBackup(): Promise<BackupResult> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(dir, `bitebalance-${stamp}.sql.gz`);
  const bytes = await dumpToFile(file);
  const pruned = await pruneBackups(dir);
  return { file, bytes, pruned };
}
