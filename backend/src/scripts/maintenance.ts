import { config } from '../config.js';
import { pool } from '../db.js';
import { runBackfill } from '../services/backfill.js';
import { cleanupUploads, runBackup, runRetention } from '../services/maintenance.js';

const log = (msg: string) => console.log(`[maintenance] ${msg}`);
const fail = (msg: string, err: unknown) =>
  console.error(`[maintenance] ${msg}: ${(err as Error).message ?? err}`);

const retention = async () => {
  try {
    const removed = await runRetention();
    if (removed) log(`история: удалено записей старше ${config.maintenance.historyRetentionDays} дн. — ${removed}`);
  } catch (err) {
    fail('не удалось почистить историю', err);
  }
};

const backup = async () => {
  try {
    const result = await runBackup();
    if (!result) return;
    const mb = (result.bytes / 1024 / 1024).toFixed(1);
    log(`бэкап базы: ${result.key} (${mb} МБ), старых бэкапов удалено — ${result.pruned}`);
  } catch (err) {
    fail('не удалось сделать бэкап', err);
  }
};

const uploads = async () => {
  try {
    const removed = await cleanupUploads();
    if (removed) log(`фото: удалено старых картинок — ${removed}`);
  } catch (err) {
    fail('не удалось почистить фото', err);
  }
};

const backfill = async () => {
  try {
    const result = await runBackfill();
    if (!result) return;
    log(
      `каталог: «${result.query}» — добавлено ${result.added}, просмотрено ${result.scanned}` +
        `${result.done ? ', запрос закрыт' : ''}`,
    );
  } catch (err) {
    fail('не удалось пополнить каталог', err);
  }
};

const main = async () => {
  // Разовый запуск: node backend/dist/scripts/maintenance.js --once
  if (process.argv.includes('--once')) {
    await retention();
    await uploads();
    await backfill();
    await backup();
    await pool.end();
    return;
  }

  log(
    `старт: чистка истории раз в ${config.maintenance.retentionIntervalHours} ч, ` +
      `чистка фото раз в ${config.maintenance.uploadCleanupIntervalHours} ч, ` +
      `бэкап раз в ${config.maintenance.backupIntervalHours} ч, ` +
      `пополнение каталога раз в ${config.nutriapix.backfillIntervalHours} ч`,
  );
  await retention();
  await uploads();
  await backfill();
  await backup();

  setInterval(() => void retention(), config.maintenance.retentionIntervalHours * 3_600_000);
  setInterval(() => void uploads(), config.maintenance.uploadCleanupIntervalHours * 3_600_000);
  setInterval(() => void backfill(), config.nutriapix.backfillIntervalHours * 3_600_000);
  setInterval(() => void backup(), config.maintenance.backupIntervalHours * 3_600_000);
};

const stop = () => {
  void pool.end().then(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await main();
