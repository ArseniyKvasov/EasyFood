import { YANDEX_SIGN_IN_URL } from '../api';
import { IconLeaf } from './Icons';

type Props = {
  /** Код ошибки из ?auth_error=… — сервер возвращает его после неудачного входа. */
  error?: string | null;
};

const ERROR_MESSAGES: Record<string, string> = {
  cancelled: 'Вход отменён. Нажмите кнопку и попробуйте ещё раз.',
  denied: 'Яндекс не предоставил доступ к аккаунту.',
  cookie: 'Браузер не передал cookie входа. Разрешите cookie для сайта и попробуйте снова.',
  state: 'Сессия входа истекла. Попробуйте войти ещё раз.',
  code: 'Яндекс не вернул код подтверждения. Попробуйте ещё раз.',
  token: 'Яндекс не подтвердил вход. Попробуйте ещё раз.',
  profile: 'Не удалось получить профиль Яндекса. Попробуйте ещё раз.',
  config: 'Вход через Яндекс не настроен на сервере.',
  internal: 'Не удалось выполнить вход. Попробуйте ещё раз.',
};

export function AuthScreen({ error }: Props) {
  const message = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.internal) : null;

  return (
    <div className="auth">
      <div className="auth__card card">
        <div className="card-body">
          <div className="auth__brand">
            <span className="brand__mark">
              <IconLeaf size={20} />
            </span>
            <span className="auth__title">BiteBalance</span>
          </div>

          <h1 className="auth__heading">Вход в дневник</h1>
          <p className="hint mb-4">
            Дневник питания привязан к аккаунту Яндекс ID - под ним хранятся ваши записи,
            продукты и настройки.
          </p>

          {message && <div className="alert alert-danger">{message}</div>}

          <a className="yandex-btn" href={YANDEX_SIGN_IN_URL}>
            <span className="yandex-btn__mark" aria-hidden="true">
              Я
            </span>
            <span>Войти с Яндексом</span>
          </a>

          <p className="auth__note">
            Регистрация не нужна: при первом входе аккаунт создастся сам.
          </p>
        </div>
      </div>
    </div>
  );
}
