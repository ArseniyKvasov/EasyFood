# Оплата через Т-Банк

Схема интеграции подписки Plus. В прототипе оплата имитируется, здесь описано, что нужно
для реальных списаний.

## Потоки

```
Клиент ──POST /api/checkout──► Бэкенд ──Init──► Т-Банк
                                   ◄── PaymentId, PaymentURL
Клиент ◄── redirect ───────────────┘
Клиент ── 3-DS на стороне банка ──► Т-Банк
Т-Банк ── webhook ──► Бэкенд (подтверждение, активация)
```

Оплата инициируется только на сервере: сумма и период берутся из тарифа, а не из запроса
клиента. Иначе подписку за 1 ₽ можно оформить правкой тела запроса.

## Первый платёж

```http
POST /api/checkout
{ "plan": "year" }
```

Бэкенд:

1. Проверяет, что пользователь авторизован и тариф активен не был.
2. Создаёт `payments` со статусом `pending` и своим `order_id`.
3. Вызывает Init у Т-Банка: сумма 199000 копеек, `OrderId`, `Description`, `NotificationURL`,
   `SuccessURL`, `FailURL`, `Receipt` (позиция «Подписка BiteBalance, 12 месяцев»).
4. Возвращает клиенту `PaymentURL`.
5. Клиент уходит на страницу банка, возвращается на `SuccessURL`. Статус на этом шаге
   ещё не доверенный: активация только по вебхуку.

## Вебхук

Т-Банк присылает `POST` с `TerminalKey`, `OrderId`, `Success`, `Status`, `PaymentId`, `Token`.
Проверяем подпись: конкатенация значений полей в алфавитном порядке плюс пароль терминала,
sha256. Без этого любой может прислать «оплачено».

Статусы: `CONFIRMED` — активируем подписку, `REJECTED` — помечаем неудачу,`REFUNDED` — снимаем доступ.
Обработчик идемпотентен: повторный вебхук не продлевает подписку дважды.

## Рекуррентные списания

1. При первой оплате сохраняем `RebillId` из ответа.
2. За сутки до окончания периода ставим задачу на списание.
3. Вызываем Charge с `RebillId` и новой суммой.
4. За 3 дня до списания отправляем письмо и push по оферте.
5. Успех продлевает подписку, неудача запускает dunning: повтор через 24 и 72 часа,
   затем приостановка доступа и письмо «оплата не прошла».

## Модель данных

```sql
create table subscriptions (
  user_id      bigint primary key references users(id) on delete cascade,
  plan         text not null check (plan in ('month','year')),
  status       text not null,            -- trial|active|past_due|canceled
  rebill_id    text,
  started_at   timestamptz not null,
  current_end  timestamptz not null,
  cancel_at    timestamptz,
  updated_at   timestamptz not null default now()
);

create table payments (
  id          bigserial primary key,
  user_id     bigint not null references users(id),
  order_id    text not null unique,
  payment_id  text unique,
  amount      integer not null,          -- копейки
  status      text not null,             -- pending|confirmed|rejected|refunded
  receipt_url text,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
```

## Что проверять перед запуском

- тестовый терминал: успешная оплата, отказ, 3-DS, таймаут;
- повторный вебхук не дублирует активацию;
- подпись отбрасывает поддельный запрос;
- возврат уменьшает `current_end` и снимает доступ;
- чеки приходят на почту и содержат верную сумму;
- отмена в интерфейсе прекращает будущие списания, доступ живёт до конца периода.
