'use client';

export const dynamic = 'force-dynamic';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

type Step = 'email' | 'password' | '2fa';

/** Respuesta de `POST /auth/login/step2` o `/auth/login/2fa`. */
type LoginResult =
  | { next: 'done' }
  | { next: '2fa'; challenge: string }
  | { next: 'password' };

/**
 * Login en 3 pasos, en pantallas separadas (correo → contraseña → 2FA si la
 * cuenta lo tiene activo). Reproduce la UX de los proveedores grandes.
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextUrl = params.get('next') ?? '/studio';
  const { refresh } = useAuth();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = async () => {
    await refresh();
    router.push(nextUrl);
  };

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch('/auth/login/step1', { method: 'POST', body: { email } });
      setStep('password');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error inesperado.');
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await apiFetch<LoginResult>('/auth/login/step2', {
        method: 'POST',
        body: { email, password },
      });
      if (result.next === '2fa') {
        setChallenge(result.challenge);
        setStep('2fa');
      } else {
        await done();
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Correo o contraseña incorrectos.',
      );
    } finally {
      setBusy(false);
    }
  };

  const submit2fa = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch<LoginResult>('/auth/login/2fa', {
        method: 'POST',
        body: { challenge, code },
      });
      await done();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Código incorrecto.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-card">
      <h1>Entrar</h1>

      {step === 'email' && (
        <form onSubmit={submitEmail} className="stack">
          <label>
            Correo
            <input
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Siguiente
          </button>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={submitPassword} className="stack">
          <p className="muted">{email}</p>
          <label>
            Contraseña
            <input
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Entrar
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setStep('email');
              setPassword('');
              setError(null);
            }}
          >
            ← Cambiar de correo
          </button>
        </form>
      )}

      {step === '2fa' && (
        <form onSubmit={submit2fa} className="stack">
          <p className="muted">
            Introduce el código de 6 dígitos de tu app de autenticación (o un
            código de recuperación).
          </p>
          <label>
            Código
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Verificar
          </button>
        </form>
      )}

      {error && <p className="form-error">{error}</p>}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="auth-card"><h1>Entrar</h1></main>}>
      <LoginForm />
    </Suspense>
  );
}
