import { config } from '../config.js';
import { pool } from '../db.js';
import { runBackup, runRetention } from '../services/maintenance.js';
import { runCatalogSync, syncStats } from '../services/sync.js';

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
    const mb = (result.bytes / 1024 / 1024).toFixed(1);
    log(`бэкап базы: ${result.file} (${mb} МБ), старых бэкапов удалено — ${result.pruned}`);
  } catch (err) {
    fail('не удалось сделать бэкап', err);
  }
};

const sync = async () => {
  try {
    const outcomes = await runCatalogSync();
    for (const result of outcomes) {
      if (!result.ok) {
        log(`каталог: «${result.query}» — Perek недоступен, повторим позже`);
        continue;
      }
      log(`каталог: «${result.query}» — добавлено продуктов: ${result.found}`);
    }
    if (outcomes.length) {
      const stats = await syncStats();
      log(`каталог: запросов ${stats.total}, ждут ${stats.pending}, ошибок ${stats.failed}`);
    }
  } catch (err) {
    fail('не удалось пополнить каталог', err);
  }
};

const main = async () => {
  // Разовый запуск: node backend/dist/scripts/maintenance.js --once
  if (process.argv.includes('--once')) {
    await retention();
    await sync();
    await backup();
    await pool.end();
    return;
  }

  log(
    `старт: чистка истории раз в ${config.maintenance.retentionIntervalHours} ч, ` +
      `бэкап раз в ${config.backup.intervalHours} ч, ` +
      `каталог раз в ${config.perek.syncIntervalMinutes} мин`,
  );
  if (!config.perek.apiKey) {
    log('PEREK_API_KEY не задан: очередь каталога будет копиться до появления ключа');
  }
  await retention();
  await sync();
  await backup();

  setInterval(() => void retention(), config.maintenance.retentionIntervalHours * 3_600_000);
  setInterval(() => void sync(), config.perek.syncIntervalMinutes * 60_000);
  setInterval(() => void backup(), config.backup.intervalHours * 3_600_000);
};

const stop = () => {
  void pool.end().then(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await main();
