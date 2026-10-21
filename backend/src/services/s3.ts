import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config, s3Enabled } from '../config.js';

let client: S3Client | null = null;

const s3 = (): S3Client => {
  if (!client) {
    client = new S3Client({
      region: config.s3.region,
      ...(config.s3.endpointUrl ? { endpoint: config.s3.endpointUrl } : {}),
      forcePathStyle: config.s3.forcePathStyle,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
      // Часть S3-совместимых хранилищ не понимает новые заголовки
      // контрольных сумм и aws-chunked — считаем их только когда требуют.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return client;
};

export { s3Enabled };

/** Ключ объекта внутри бакета. */
export const objectKey = (...parts: string[]): string =>
  parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');

/** Папка пользователя в бакете — чужие объекты по ключу не отдаём. */
export const userPrefix = (userId: number): string =>
  objectKey(config.s3.location, String(userId));

/** Ключ принадлежит пользователю? */
export const isUserKey = (userId: number, key: string): boolean =>
  key.startsWith(`${userPrefix(userId)}/`);

/**
 * Подписанная ссылка на загрузку: браузер кладёт файл прямо в S3,
 * минуя сервер приложения.
 */
export const presignUpload = async (
  key: string,
  contentType: string,
  expiresIn = config.s3.signedUrlExpire,
): Promise<string> =>
  getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, ContentType: contentType }),
    { expiresIn },
  );

/**
 * Подписанная ссылка на чтение: по ней ИИ-провайдер забирает картинку
 * напрямую из хранилища.
 */
export const presignDownload = async (
  key: string,
  expiresIn = config.s3.signedUrlExpire,
): Promise<string> =>
  getSignedUrl(s3(), new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }), { expiresIn });

/** Загрузка объекта с сервера (бэкапы базы). */
export const putObject = async (
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> => {
  await s3().send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
};

/** Список ключей в префиксе — нужно для чистки старых бэкапов. */
export const listKeys = async (prefix: string): Promise<{ key: string; modified: Date }[]> => {
  const out: { key: string; modified: Date }[] = [];
  let token: string | undefined;

  do {
    const res = await s3().send(
      new ListObjectsV2Command({
        Bucket: config.s3.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      out.push({ key: obj.Key, modified: obj.LastModified ?? new Date(0) });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  return out;
};

export const removeObject = async (key: string): Promise<void> => {
  await s3().send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
};
