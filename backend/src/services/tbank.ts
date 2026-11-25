
import { createHash, timingSafeEqual } from 'node:crypto';
import { config, tbankNotificationUrl } from '../config.js';

/**
 * Минимальный клиент эквайринга Т-Банка (Init / GetState / Charge / Cancel).
 * Подпись: значения всех плоских полей по алфавиту ключей + пароль, sha256.
 * Вложенные объекты (Receipt, DATA) в подпись не входят.
 */

export class TbankError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Подпись запроса или вебхука. Поле Token само в подпись не входит. */
export function sign(params: Record<string, unknown>, password: string): string {
  const keys = Object.keys(params).filter(function (k) { return k !== 'Token'; }).sort();
  let raw = '';
  for (const k of keys) {
    const v = params[k];
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue;
    raw += String(v);
  }
  return createHash('sha256').update(raw + password).digest('hex');
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
    throw new TbankError('NETWORK', 'Т-Банк недоступен: ' + (err as Error).message);
  }
  let data: Json;
  try {
    data = (await res.json()) as Json;
  } catch {
    throw new TbankError('BAD_RESPONSE', 'Т-Банк вернул не JSON');
  }
  if (data.Success !== true) {
    throw new TbankError(String(data.ErrorCode || 'FAILED'), String(data.Message || data.Details || 'Операция отклонена банком'));
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

export type InitResult = { paymentUrl: string; paymentId: string };

/** Первый платёж подписки: одностадийный, с Recurrent=Y чтобы получить RebillId. */
export async function initPayment(input: {
  amount: number;
  orderId: string;
  description: string;
  customerKey: string;
  email: string;
  plan: string;
  userId: number;
}): Promise<InitResult> {
  const params: Json = {
    Amount: input.amount,
    OrderId: input.orderId,
    Description: input.description,
    PayType: 'O',
    Recurrent: 'Y',
    CustomerKey: input.customerKey,
    NotificationURL: notificationUrl(),
    DATA: { plan: input.plan, user_id: String(input.userId) },
  };
  if (config.tbank.successUrl) params.SuccessURL = config.tbank.successUrl;
  if (config.tbank.failUrl) params.FailURL = config.tbank.failUrl;
  if (input.email) params.Receipt = receipt(input.email, input.description, input.amount);
  const data = await call('Init', params);
  if (typeof data.PaymentURL !== 'string' || typeof data.PaymentId !== 'string') {
    throw new TbankError('BAD_RESPONSE', 'Т-Банк не вернул ссылку на оплату');
  }
  return { paymentUrl: data.PaymentURL, paymentId: data.PaymentId };
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
