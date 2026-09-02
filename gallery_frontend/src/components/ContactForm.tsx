'use client';

import { useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';

type Status = { kind: 'idle' | 'sending' | 'sent' } | { kind: 'error'; message: string };

/**
 * Formulario de contacto público. Envía a `POST /contact` (que responde 202 y
 * guarda el mensaje). Incluye un campo trampa `website` — oculto a las personas,
 * tentador para los bots: si llega relleno, el backend descarta el mensaje en
 * silencio.
 */
export function ContactForm() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [form, setForm] = useState({
    name: '',
    email: '',
    message: '',
    website: '', // honeypot
  });

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: 'sending' });
    try {
      await apiFetch('/contact', { method: 'POST', body: form });
      setStatus({ kind: 'sent' });
      setForm({ name: '', email: '', message: '', website: '' });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.status === 429
            ? 'Demasiados intentos. Espera un minuto y vuelve a probar.'
            : err.message
          : 'No se pudo enviar. Inténtalo de nuevo.';
      setStatus({ kind: 'error', message });
    }
  };

  if (status.kind === 'sent') {
    return (
      <p className="form-ok contact-form__done">
        Gracias por escribir. Te responderé en cuanto pueda.
      </p>
    );
  }

  return (
    <form className="contact-form stack" onSubmit={submit}>
      <label>
        Nombre
        <input
          required
          maxLength={150}
          value={form.name}
          onChange={set('name')}
          autoComplete="name"
        />
      </label>
      <label>
        Correo
        <input
          required
          type="email"
          maxLength={255}
          value={form.email}
          onChange={set('email')}
          autoComplete="email"
        />
      </label>
      <label>
        Mensaje
        <textarea
          required
          rows={6}
          minLength={10}
          maxLength={4000}
          value={form.message}
          onChange={set('message')}
        />
      </label>

      {/* Campo trampa: fuera de pantalla y fuera del orden de tabulación. */}
      <div className="hp-field" aria-hidden="true">
        <label>
          No rellenar
          <input
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={set('website')}
          />
        </label>
      </div>

      <button type="submit" disabled={status.kind === 'sending'}>
        {status.kind === 'sending' ? 'Enviando…' : 'Enviar'}
      </button>
      {status.kind === 'error' ? (
        <p className="form-error">{status.message}</p>
      ) : null}
    </form>
  );
}
