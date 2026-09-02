'use client';

export const dynamic = 'force-dynamic';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

/**
 * Alta pública. Al registrarse la sesión queda iniciada (el backend fija las
 * cookies) y se redirige al Studio.
 */
export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch('/auth/register', { method: 'POST', body: form });
      await refresh();
      router.push('/studio');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la cuenta.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-card">
      <h1>Crear cuenta</h1>
      <form onSubmit={submit} className="stack">
        <label>
          Nombre
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          Correo
          <input
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <span className="hint">
            Mínimo 10 caracteres, con una mayúscula, una minúscula y un dígito.
          </span>
        </label>
        <button type="submit" disabled={busy}>
          Crear cuenta
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
    </main>
  );
}
