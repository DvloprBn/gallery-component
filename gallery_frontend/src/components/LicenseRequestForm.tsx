'use client';

import { useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { INTENDED_USES, INTENDED_USE_LABEL, type IntendedUse } from '@/lib/intended-use';

type Status = { kind: 'idle' | 'sending' | 'sent' } | { kind: 'error'; message: string };

/**
 * Formulario público para solicitar licenciar UNA foto concreta, embebido en
 * el lightbox. Envía a `POST /license-requests` (202: la solicitud queda en
 * la bandeja del gestor, que responde por correo con una cotización) — mismo
 * endpoint y mismas protecciones (honeypot, límite de envíos) que usa la
 * bandeja de gestión, `ContactForm` es el patrón que replica.
 *
 * @param props.imageId - UUID de la foto abierta en el lightbox; va oculto,
 *   nunca lo edita quien solicita.
 * @param props.onClose - Cierra el panel del formulario (lo llama el propio
 *   lightbox al cambiar de foto o al hacer clic en "Cancelar").
 */
export function LicenseRequestForm({
  imageId,
  onClose,
}: {
  imageId: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [form, setForm] = useState({
    name: '',
    email: '',
    intendedUse: 'editorial' as IntendedUse,
    message: '',
    budget: '',
    website: '', // honeypot
  });

  const set =
    (key: 'name' | 'email' | 'message' | 'budget' | 'website') =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: 'sending' });
    try {
      await apiFetch('/license-requests', { method: 'POST', body: { imageId, ...form } });
      setStatus({ kind: 'sent' });
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
      <div className="g-license-panel">
        <p className="form-ok">
          Solicitud enviada. Te responderemos por correo con una cotización.
        </p>
        <button type="button" className="link-button" onClick={onClose}>
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <form className="g-license-panel stack" onSubmit={submit}>
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <strong>Solicitar licencia de esta foto</strong>
        <button type="button" className="link-button" onClick={onClose}>
          Cancelar
        </button>
      </div>
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
        Uso previsto
        <select
          value={form.intendedUse}
          onChange={(e) =>
            setForm((f) => ({ ...f, intendedUse: e.target.value as IntendedUse }))
          }
        >
          {INTENDED_USES.map((use) => (
            <option key={use} value={use}>
              {INTENDED_USE_LABEL[use]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Cuéntame el alcance del uso
        <textarea
          required
          rows={4}
          minLength={10}
          maxLength={2000}
          value={form.message}
          onChange={set('message')}
        />
      </label>
      <label>
        Presupuesto (opcional)
        <input maxLength={200} value={form.budget} onChange={set('budget')} />
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
        {status.kind === 'sending' ? 'Enviando…' : 'Enviar solicitud'}
      </button>
      {status.kind === 'error' ? <p className="form-error">{status.message}</p> : null}
    </form>
  );
}
