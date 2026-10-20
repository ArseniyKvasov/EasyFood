import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { IconLeaf } from './Icons';

type Props = {
  onAuthed: (username: string) => void;
};

type Mode = 'login' | 'register';

export function AuthScreen({ onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await api.login({ username, password })
          : await api.register({ username, password });
      onAuthed(res.username);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось выполнить вход');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <div className="auth">
      <div className="auth__card card">
        <div className="card-body">
          <div className="auth__brand">
            <span className="brand__mark">
              <IconLeaf size={20} />
            </span>
            <span className="auth__title">EasyFood</span>
          </div>

          <h1 className="auth__heading">
            {mode === 'login' ? 'Вход в аккаунт' : 'Создание аккаунта'}
          </h1>
          <p className="hint mb-4">
            {mode === 'login'
              ? 'Введите логин и пароль, чтобы продолжить вести дневник питания.'
              : 'Придумайте логин и пароль — под ними будут храниться ваши записи.'}
          </p>

          <form onSubmit={submit} noValidate>
            <label className="form-label" htmlFor="auth-user">
              Логин
            </label>
            <input
              id="auth-user"
              className="form-control mb-3"
              value={username}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="ivan"
              onChange={(e) => setUsername(e.target.value)}
              required
            />

            <label className="form-label" htmlFor="auth-pass">
              Пароль
            </label>
            <input
              id="auth-pass"
              className="form-control mb-3"
              type="password"
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && <div className="alert alert-danger">{error}</div>}

            <button
              className="btn btn-primary btn-lg w-100"
              type="submit"
              disabled={busy || !username || !password}
            >
              {busy ? (
                <>
                  <span className="spinner" />
                  Подождите…
                </>
              ) : mode === 'login' ? (
                'Войти'
              ) : (
                'Зарегистрироваться'
              )}
            </button>
          </form>

          <div className="auth__switch">
            {mode === 'login' ? (
              <>
                Нет аккаунта?{' '}
                <button type="button" className="auth__link" onClick={() => switchMode('register')}>
                  Зарегистрироваться
                </button>
              </>
            ) : (
              <>
                Уже есть аккаунт?{' '}
                <button type="button" className="auth__link" onClick={() => switchMode('login')}>
                  Войти
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
