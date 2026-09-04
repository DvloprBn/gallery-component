'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { ADMIN_ROLES } from '@/lib/auth';
import { RequireAuth } from '@/components/RequireAuth';

export default function LicenseRequestsPage() {
  return (
    <RequireAuth roles={ADMIN_ROLES}>
      <Inner />
    </RequireAuth>
  );
}

/** Los usos que se pueden solicitar, con su etiqueta en español. */
const USE_LABEL: Record<string, string> = {
  editorial: 'Editorial',
  commercial: 'Comercial',
  social: 'Redes sociales',
  print: 'Impresión',
};

/** Estado de la solicitud. `accepted`/`declined`/`fulfilled` llegan con la Fase 12c. */
const STATUS_LABEL: Record<string, string> = {
  new: 'Nueva',
  quoted: 'Cotizada',
  accepted: 'Aceptada',
  declined: 'Rechazada',
  fulfilled: 'Entregada',
};

/** Estados desde los que todavía se puede (re)cotizar — igual que el backend. */
const QUOTABLE = new Set(['new', 'quoted']);

/** Una solicitud de licencia, tal como la devuelve `GET /license-requests`. */
interface LicenseRequest {
  requestId: string;
  imageId: string;
  imageThumbUrl: string | null;
  collectionTitle: string;
  collectionSlug: string;
  requesterName: string;
  requesterEmail: string;
  intendedUse: string;
  message: string;
  budget: string | null;
  status: string;
  createdAt: string;
  quotedPrice: string | null;
  quotedConditions: string | null;
  quoteExpiresAt: string | null;
  quotedAt: string | null;
}

/**
 * Bandeja de solicitudes de licencia. Fase 12a (lectura) + Fase 12b (cotizar):
 * el gestor responde precio + condiciones + hasta cuándo es válida la oferta.
 * Emitir la licencia y entregar el archivo firmado llegan en la Fase 12c.
 */
function Inner() {
  const [requests, setRequests] = useState<LicenseRequest[] | null>(null);
  const [openQuoteId, setOpenQuoteId] = useState<string | null>(null);

  const load = () =>
    apiFetch<LicenseRequest[]>('/license-requests')
      .then(setRequests)
      .catch(() => setRequests([]));

  useEffect(() => {
    void load();
  }, []);

  const submitQuote = async (
    id: string,
    quote: { price: string; conditions: string; expiresAt: string },
  ) => {
    await apiFetch(`/license-requests/${id}`, {
      method: 'PATCH',
      body: {
        price: quote.price,
        conditions: quote.conditions || undefined,
        expiresAt: quote.expiresAt || undefined,
      },
    });
    setOpenQuoteId(null);
    await load();
  };

  return (
    <main className="panel">
      <div className="panel-head">
        <h1>Solicitudes de licencia</h1>
        <a href="/studio" className="link-button">
          ← Gestor
        </a>
      </div>

      {requests === null ? (
        <p className="page-note">Cargando…</p>
      ) : requests.length === 0 ? (
        <p className="muted">Todavía no hay solicitudes.</p>
      ) : (
        <>
          <p className="muted">
            {requests.length} {requests.length === 1 ? 'solicitud' : 'solicitudes'}
          </p>
          <ul className="album-list">
            {requests.map((r) => (
              <li key={r.requestId} className="album-list__item">
                {r.imageThumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.imageThumbUrl}
                    alt=""
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: 'cover',
                      borderRadius: 8,
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                <div className="album-list__main" style={{ cursor: 'default' }}>
                  <strong>
                    {r.requesterName}{' '}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      &lt;{r.requesterEmail}&gt;
                    </span>
                  </strong>
                  <span className="muted">
                    {r.collectionTitle} · {USE_LABEL[r.intendedUse] ?? r.intendedUse} ·{' '}
                    <span className="badge">{STATUS_LABEL[r.status] ?? r.status}</span> ·{' '}
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                  <p style={{ margin: '0.5rem 0 0', whiteSpace: 'pre-wrap' }}>{r.message}</p>
                  {r.budget ? (
                    <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                      Presupuesto del solicitante: {r.budget}
                    </p>
                  ) : null}

                  {r.quotedPrice ? (
                    <div className="license-quote">
                      <strong>Cotizado: {r.quotedPrice}</strong>
                      {r.quotedConditions ? <p>{r.quotedConditions}</p> : null}
                      <span className="hint">
                        {r.quotedAt ? `Enviada ${new Date(r.quotedAt).toLocaleString()}` : ''}
                        {r.quoteExpiresAt
                          ? ` · válida hasta ${new Date(r.quoteExpiresAt).toLocaleDateString()}`
                          : ''}
                      </span>
                    </div>
                  ) : null}

                  {QUOTABLE.has(r.status) ? (
                    <button
                      type="button"
                      className="link-button"
                      style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}
                      onClick={() =>
                        setOpenQuoteId((cur) => (cur === r.requestId ? null : r.requestId))
                      }
                    >
                      {r.quotedPrice ? 'Recotizar' : 'Cotizar'}{' '}
                      {openQuoteId === r.requestId ? '▲' : '▾'}
                    </button>
                  ) : null}

                  {openQuoteId === r.requestId ? (
                    <QuoteForm
                      initial={{
                        price: r.quotedPrice ?? '',
                        conditions: r.quotedConditions ?? '',
                        expiresAt: r.quoteExpiresAt ? r.quoteExpiresAt.slice(0, 10) : '',
                      }}
                      onSubmit={(quote) => submitQuote(r.requestId, quote)}
                    />
                  ) : null}
                </div>
                <a
                  href={`/g/${r.collectionSlug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link-button"
                >
                  Ver colección ↗
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

/** Formulario compacto para cotizar (o recotizar) una solicitud. */
function QuoteForm({
  initial,
  onSubmit,
}: {
  initial: { price: string; conditions: string; expiresAt: string };
  onSubmit: (quote: { price: string; conditions: string; expiresAt: string }) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(draft);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar la cotización.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="license-quote-form stack" onSubmit={submit}>
      <label>
        Precio
        <input
          required
          maxLength={200}
          placeholder="p. ej. $500 USD"
          value={draft.price}
          onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
        />
      </label>
      <label>
        Condiciones (alcance, exclusividad, vigencia…)
        <textarea
          rows={3}
          maxLength={1000}
          value={draft.conditions}
          onChange={(e) => setDraft((d) => ({ ...d, conditions: e.target.value }))}
        />
      </label>
      <label>
        Esta cotización es válida hasta (opcional)
        <input
          type="date"
          value={draft.expiresAt}
          onChange={(e) => setDraft((d) => ({ ...d, expiresAt: e.target.value }))}
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Enviando…' : 'Enviar cotización'}
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </form>
  );
}
