import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, s3Enabled } from '../config.js';
import { query } from '../db.js';
import { listKeys, objectKey, putObject, removeObject } from './s3.js';

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

/** Сжимает дамп базы и льёт в S3. */
const dumpToS3 = async (key: string): Promise<number> => {
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

  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });

  try {
    await pipeline(dump.stdout, createGzip({ level: 9 }), sink);
  } catch (err) {
    throw new Error(`pg_dump failed: ${stderr.trim() || (err as Error).message}`);
  }

  const code = await new Promise<number>((resolve) => {
    dump.on('close', (c) => resolve(c ?? 1));
  });
  if (code !== 0) {
    throw new Error(`pg_dump exited with ${code}: ${stderr.trim()}`);
  }

  const body = Buffer.concat(chunks);
  if (body.length === 0) throw new Error('pg_dump produced an empty file');
  await putObject(key, body, 'application/gzip');
  return body.length;
};

/** Удаляет бэкапы старше S3_BACKUP_KEEP_DAYS дней. */
const pruneBackups = async (): Promise<number> => {
  const prefix = `${config.s3.backupLocation}/`;
  const cutoff = Date.now() - config.s3.backupKeepDays * 86_400_000;
  const objects = await listKeys(prefix);
  let removed = 0;
  for (const obj of objects) {
    if (obj.modified.getTime() >= cutoff) continue;
    await removeObject(obj.key);
    removed += 1;
  }
  return removed;
};

export type BackupResult = {
  key: string;
  bytes: number;
  pruned: number;
};

/**
 * Бэкап базы в S3: pg_dump → gzip → объект в бакете.
 * Старые бэкапы сверх S3_BACKUP_KEEP_DAYS удаляются.
 */
export async function runBackup(): Promise<BackupResult | null> {
  if (!s3Enabled()) {
    console.warn('[backup] S3 не настроен — бэкап пропущен');
    return null;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const key = objectKey(config.s3.backupLocation, `easyfood-${stamp}.sql.gz`);
  const bytes = await dumpToS3(key);
  const pruned = await pruneBackups();
  return { key, bytes, pruned };
};

/**
 * Удаляет картинки, которые дольше S3_UPLOAD_KEEP_HOURS пролежали в бакете.
 *
 * Обычно фото удаляется сразу после того, как из него сделали продукт, —
 * этот проход страхует случаи, когда пользователь бросил распознавание
 * или у него отвалилась сеть. Порог считаем заранее (минус интервал
 * чистки), чтобы картинка гарантированно исчезла за S3_UPLOAD_KEEP_HOURS,
 * а не позже.
 */
export async function cleanupUploads(): Promise<number> {
  if (!s3Enabled()) return 0;

  const keepHours = config.s3.uploadKeepHours;
  const sweepHours = config.maintenance.uploadCleanupIntervalHours;
  const cutoffHours = Math.max(1, keepHours - sweepHours);
  const cutoff = Date.now() - cutoffHours * 3_600_000;

  const objects = await listKeys(`${config.s3.location}/`);
  let removed = 0;
  for (const obj of objects) {
    if (obj.modified.getTime() >= cutoff) continue;
    await removeObject(obj.key);
    removed += 1;
  }
  return removed;
};
