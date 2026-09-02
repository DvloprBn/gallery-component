'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { RequireAuth } from '@/components/RequireAuth';

export default function CuentaPage() {
  return (
    <RequireAuth>
      <CuentaInner />
    </RequireAuth>
  );
}

function CuentaInner() {
  const { me, refresh } = useAuth();

  return (
    <main className="panel">
      <h1>Mi cuenta</h1>
      <p className="muted">
        {me?.email} — rol <strong>{me?.roleName}</strong>
      </p>

      <section className="panel-section">
        <h2>Contraseña</h2>
        <ChangePasswordForm />
      </section>

      <section className="panel-section">
        <h2>Verificación en dos pasos (2FA)</h2>
        <TwoFactorPanel enabled={me?.totpEnabled ?? false} onChange={refresh} />
      </section>
    </main>
  );
}

/** Formulario de cambio de contraseña. */
function ChangePasswordForm() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await apiFetch('/auth/me/password', { method: 'PATCH', body: form });
      setForm({ currentPassword: '', newPassword: '' });
      setMsg({ ok: true, text: 'Contraseña actualizada. Las demás sesiones se cerraron.' });
    } catch (err) {
      setMsg({
        ok: false,
        text: err instanceof ApiError ? err.message : 'No se pudo cambiar.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack">
      <label>
        Contraseña actual
        <input
          type="password"
          autoComplete="current-password"
          required
          value={form.currentPassword}
          onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
        />
      </label>
      <label>
        Contraseña nueva
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={form.newPassword}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
        />
      </label>
      <button type="submit" disabled={busy}>
        Cambiar contraseña
      </button>
      {msg && (
        <p className={msg.ok ? 'form-ok' : 'form-error'}>{msg.text}</p>
      )}
    </form>
  );
}

/** Activación / desactivación de 2FA. */
function TwoFactorPanel({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: () => Promise<void>;
}) {
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(
    null,
  );
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startSetup = async () => {
    setError(null);
    setBusy(true);
    try {
      const data = await apiFetch<{ qrDataUrl: string; secret: string }>(
        '/two-factor/setup',
        { method: 'POST' },
      );
      setSetup(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await apiFetch<{ recoveryCodes: string[] }>(
        '/two-factor/confirm-setup',
        { method: 'POST', body: { code } },
      );
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setCode('');
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Código incorrecto.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch('/two-factor/disable', {
        method: 'POST',
        body: { password: disablePassword },
      });
      setDisablePassword('');
      setRecoveryCodes(null);
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo desactivar.');
    } finally {
      setBusy(false);
    }
  };

  if (recoveryCodes) {
    return (
      <div className="stack">
        <p className="form-ok">
          2FA activado. Guarda estos códigos de recuperación — no se volverán a
          mostrar. Cada uno sirve una sola vez.
        </p>
        <ul className="recovery-codes">
          {recoveryCodes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setRecoveryCodes(null)}>
          Entendido
        </button>
      </div>
    );
  }

  if (enabled) {
    return (
      <form onSubmit={disable} className="stack">
        <p className="form-ok">El 2FA está activo en esta cuenta.</p>
        <label>
          Confirma tu contraseña para desactivarlo
          <input
            type="password"
            autoComplete="current-password"
            required
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
          />
        </label>
        <button type="submit" className="danger" disabled={busy}>
          Desactivar 2FA
        </button>
        {error && <p className="form-error">{error}</p>}
      </form>
    );
  }

  if (setup) {
    return (
      <form onSubmit={confirm} className="stack">
        <p className="muted">
          Escanea este código con tu app de autenticación y escribe el código de
          6 dígitos que muestre.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={setup.qrDataUrl} alt="Código QR para 2FA" width={200} height={200} />
        <p className="hint">
          ¿No puedes escanear? Introduce esta clave manualmente:{' '}
          <code>{setup.secret}</code>
        </p>
        <label>
          Código de 6 dígitos
          <input
            inputMode="numeric"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          Activar 2FA
        </button>
        {error && <p className="form-error">{error}</p>}
      </form>
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        Añade una segunda capa de seguridad con una app de autenticación
        (Google Authenticator, Authy, 1Password…).
      </p>
      <button type="button" onClick={startSetup} disabled={busy}>
        Activar 2FA
      </button>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
