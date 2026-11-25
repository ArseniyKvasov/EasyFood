
import nodemailer, { type Transporter } from 'nodemailer';
import { config, mailEnabled } from '../config.js';

/** Письма: чеки, предупреждения о списании, неудачи. Без SMTP — тихо пропускаем. */

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!mailEnabled()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    });
  }
  return transporter;
}

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!to || !mailEnabled()) return false;
  try {
    const t = getTransporter();
    if (!t) return false;
    await t.sendMail({ from: config.mail.from, to: to, subject: subject, text: text });
    return true;
  } catch (err) {
    console.error('[mail] send failed', (err as Error).message);
    return false;
  }
}

export const money = (kopecks: number): string => {
  const rub = Math.floor(kopecks / 100);
  const kop = String(kopecks % 100).padStart(2, '0');
  return kop === '00' ? rub + ' \u20BD' : rub + ',' + kop + ' \u20BD';
};

export const planName = (plan: string): string => (plan === 'year' ? 'Plus на год' : 'Plus на месяц');
