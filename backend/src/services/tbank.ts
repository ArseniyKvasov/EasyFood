
import { createHash, timingSafeEqual } from 'node:crypto';
import { config, tbankNotificationUrl } from '../config.js';

/**
 * Минимальный клиент эквайринга Т-Банка (Init / GetState / Charge / Cancel).
 * Подпись: значения всех плоских полей по алфавиту ключей + пароль, sha256.
 * Вложенные объекты (Receipt, DATA) в подпись не входят.
 */

export class TbankError extends Error {
  code: string;
  /** Полный ответ банка — для логов и поддержки. */
  response?: Record<string, unknown>;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Подпись запроса или вебхука.
 *
 * Пароль терминала — такое же поле конкатенации, как и остальные, и участвует
 * в сортировке: «Password» стоит между «OrderId» и «PayType», а не в самом
 * конце. Иначе подпись не сходится и банк отвечает 204 «Неверный токен».
 * Вложенные объекты (Receipt, DATA) и сам Token в подпись не входят.
 */
export function sign(params: Record<string, unknown>, password: string): string {
  const payload: Record<string, unknown> = {};
  for (const k of Object.keys(params)) {
    if (k === 'Token') continue;
    const v = params[k];
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue;
    payload[k] = v;
  }
  payload.Password = password;
  const raw = Object.keys(payload)
    .sort()
    .map(function (k) { return String(payload[k]); })
    .join('');
  return createHash('sha256').update(raw).digest('hex');
}

export function verifyWebhook(body: Record<string, unknown>): boolean {
  if (typeof body.Token !== 'string' || !body.Token) return false;
  const expected = sign(body, config.tbank.password);
  const a = Buffer.from(body.Token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Json = Record<string, unknown>;

async function call(method: string, params: Json): Promise<Json> {
  const body: Json = { TerminalKey: config.tbank.terminalKey };
  for (const k of Object.keys(params)) body[k] = params[k];
  body.Token = sign(body, config.tbank.password);
  let res: Response;
  try {
    res = await fetch(config.tbank.baseUrl + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    // fetch failed сам по себе ничего не объясняет: достаём код причины
    // (ENOTFOUND / ECONNREFUSED / ETIMEDOUT / CERT_*) и адрес, куда шли.
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const code = cause?.code || 'NETWORK';
    const detail = cause?.message || (err as Error).message;
    throw new TbankError(
      code,
      'Т-Банк недоступен (' + config.tbank.baseUrl + '): ' + code + ' — ' + detail,
    );
  }
  let data: Json;
  try {
    data = (await res.json()) as Json;
  } catch {
    throw new TbankError('BAD_RESPONSE', 'Т-Банк вернул не JSON');
  }
  if (data.Success !== true) {
    // Details от банка часто указывает конкретное поле — кладём его в текст,
    // а весь ответ сохраняем, чтобы было что показать поддержке.
    const message = String(data.Message || 'Операция отклонена банком');
    const details = data.Details ? String(data.Details) : '';
    const err = new TbankError(String(data.ErrorCode || 'FAILED'), details ? message + ' (' + details + ')' : message);
    (err as TbankError & { response?: Json }).response = data;
    throw err;
  }
  return data;
}

const receipt = (email: string, name: string, amount: number): Json => ({
  Email: email,
  Taxation: config.tbank.taxation,
  Items: [
    {
      Name: name,
      Price: amount,
      Quantity: 1,
      Amount: amount,
      Tax: 'none',
      PaymentMethod: 'full_payment',
      PaymentObject: 'service',
    },
  ],
});

export type InitResult = { paymentUrl: string; paymentId: string; variant: string };

/**
 * Первый платёж подписки: одностадийный, с Recurrent=Y чтобы получить RebillId.
 *
 * Банк отвечает 204 «Неверные параметры», когда терминал не принимает
 * какое-то необязательное поле: чек 54-ФЗ, Recurrent, DATA. Вместо того чтобы
 * гадать, какие опции включены у конкретного магазина, пробуем наборы по
 * убыванию: сначала полный, затем без чека, без рекуррента и минимальный.
 * Успешный вариант пишем в лог — по нему видно, на чём терминал остановился.
 */
export async function initPayment(input: {
  amount: number;
  orderId: string;
  description: string;
  customerKey: string;
  email: string;
  plan: string;
  userId: number;
}): Promise<InitResult> {
  const common: Json = {
    Amount: input.amount,
    OrderId: input.orderId,
    Description: input.description,
    PayType: 'O',
    NotificationURL: notificationUrl(),
  };
  if (config.tbank.successUrl) common.SuccessURL = config.tbank.successUrl;
  if (config.tbank.failUrl) common.FailURL = config.tbank.failUrl;

  const hasEmail = Boolean(input.email && input.email.includes('@'));

  const variants: { name: string; params: Json }[] = [];
  const push = (name: string, extra: Json): void => {
    variants.push({ name: name, params: { ...common, ...extra } });
  };

  if (hasEmail) {
    push('полный: чек, рекуррент, DATA', {
      Recurrent: 'Y',
      CustomerKey: input.customerKey,
      DATA: { plan: input.plan, user_id: String(input.userId) },
      Receipt: receipt(input.email, input.description, input.amount),
    });
  }
  push('без чека', {
    Recurrent: 'Y',
    CustomerKey: input.customerKey,
    DATA: { plan: input.plan, user_id: String(input.userId) },
  });
  push('без чека и рекуррента', {
    CustomerKey: input.customerKey,
    DATA: { plan: input.plan, user_id: String(input.userId) },
  });
  push('минимальный', {});

  let lastError: TbankError | null = null;
  for (const variant of variants) {
    try {
      const data = await call('Init', variant.params);
      if (typeof data.PaymentURL !== 'string' || typeof data.PaymentId !== 'string') {
        throw new TbankError('BAD_RESPONSE', 'Т-Банк не вернул ссылку на оплату');
      }
      return { paymentUrl: data.PaymentURL, paymentId: data.PaymentId, variant: variant.name };
    } catch (err) {
      lastError = err instanceof TbankError ? err : new TbankError('FAILED', (err as Error).message);
      // 204 — «неверные параметры»: пробуем более простой набор.
      // Остальные коды (ключи, терминал) повтором не лечатся.
      if (lastError.code !== '204') throw lastError;
    }
  }
  throw lastError ?? new TbankError('FAILED', 'Init не удался');
}

export const notificationUrl = (): string => tbankNotificationUrl();

/** Статус платежа в банке — сверка, если вебхук не пришёл. */
export async function getState(paymentId: string): Promise<Json> {
  return call('GetState', { PaymentId: paymentId });
}

/** Рекуррентное списание по сохранённому RebillId. Возвращает новый PaymentId. */
export async function charge(input: {
  paymentId: string;
  rebillId: string;
  amount: number;
  orderId: string;
  ip?: string;
}): Promise<string> {
  const params: Json = {
    PaymentId: input.paymentId,
    RebillId: input.rebillId,
    Amount: input.amount,
    OrderId: input.orderId,
  };
  if (input.ip) params.IP = input.ip;
  const data = await call('Charge', params);
  if (typeof data.PaymentId !== 'string') throw new TbankError('BAD_RESPONSE', 'Charge не вернул PaymentId');
  return data.PaymentId;
}

/** Полный возврат подтверждённого платежа. */
export async function cancelPayment(paymentId: string): Promise<void> {
  await call('Cancel', { PaymentId: paymentId });
}
