'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { ADMIN_ROLES } from '@/lib/auth';
import { RequireAuth } from '@/components/RequireAuth';
import { INTENDED_USE_LABEL as USE_LABEL } from '@/lib/intended-use';

export default function LicenseRequestsPage() {
  return (
    <RequireAuth roles={ADMIN_ROLES}>
      <Inner />
    </RequireAuth>
  );
}

/** Estado de la solicitud. */
const STATUS_LABEL: Record<string, string> = {
  new: 'Nueva',
  quoted: 'Cotizada',
  accepted: 'Aceptada',
  declined: 'Rechazada',
  fulfilled: 'Entregada',
};

/** Estado de la entrega de una licencia ya emitida. */
const DELIVERY_LABEL: Record<string, string> = {
  pending: 'sin descargar',
  used: 'descargada',
  expired: 'caducada sin descargar',
};

/** Estados desde los que todavía se puede (re)cotizar — igual que el backend. */
const QUOTABLE = new Set(['new', 'quoted']);

/** La licencia ya emitida de una solicitud, si la hay. */
interface LicenseInfo {
  licenseId: string;
  issuedAt: string;
  deliveryStatus: 'pending' | 'used' | 'expired';
  deliveryExpiresAt: string;
}

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
  license: LicenseInfo | null;
}

/**
 * Bandeja de solicitudes de licencia. Fase 12a (lectura) + 12b (cotizar) +
 * 12c (aceptar → emite la licencia y envía el enlace de entrega de un solo
 * uso por correo). Quien "acepta" aquí es el gestor, confirmando que el
 * cliente aceptó los términos por el canal que hayan usado.
 */
function Inner() {
  const [requests, setRequests] = useState<LicenseRequest[] | null>(null);
  const [openQuoteId, setOpenQuoteId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  // Registro de licencias emitidas (Fase 12d): mismos datos, filtrados a las
  // solicitudes que ya tienen una licencia — no hay un endpoint aparte.
  const [view, setView] = useState<'pending' | 'issued'>('pending');

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

  const accept = async (id: string) => {
    if (!confirm('¿Aceptar esta solicitud? Se emitirá la licencia y se enviará el enlace de descarga.')) {
      return;
    }
    setAcceptingId(id);
    setAcceptError(null);
    try {
      await apiFetch(`/license-requests/${id}/accept`, { method: 'POST' });
      await load();
    } catch (err) {
      setAcceptError(err instanceof ApiError ? err.message : 'No se pudo aceptar la solicitud.');
    } finally {
      setAcceptingId(null);
    }
  };

  const issued = requests?.filter((r) => r.license !== null) ?? [];
  const visible = requests === null ? null : view === 'issued' ? issued : requests;

  return (
    <main className="panel">
      <div className="panel-head">
        <h1>{view === 'issued' ? 'Licencias emitidas' : 'Solicitudes de licencia'}</h1>
        <a href="/studio" className="link-button">
          ← Gestor
        </a>
      </div>

      <div className="inline-form" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className={view === 'pending' ? undefined : 'link-button'}
          onClick={() => setView('pending')}
        >
          Solicitudes
        </button>
        <button
          type="button"
          className={view === 'issued' ? undefined : 'link-button'}
          onClick={() => setView('issued')}
        >
          Licencias emitidas{requests ? ` (${issued.length})` : ''}
        </button>
      </div>

      {visible === null ? (
        <p className="page-note">Cargando…</p>
      ) : visible.length === 0 ? (
        <p className="muted">
          {view === 'issued' ? 'Todavía no se ha emitido ninguna licencia.' : 'Todavía no hay solicitudes.'}
        </p>
      ) : (
        <>
          <p className="muted">
            {visible.length} {visible.length === 1 ? (view === 'issued' ? 'licencia' : 'solicitud') : (view === 'issued' ? 'licencias' : 'solicitudes')}
          </p>
          <ul className="album-list">
            {visible.map((r) => (
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

                  {r.license ? (
                    <p className="hint" style={{ marginTop: '0.4rem' }}>
                      Licencia emitida {new Date(r.license.issuedAt).toLocaleDateString()} ·
                      entrega {DELIVERY_LABEL[r.license.deliveryStatus]}
                    </p>
                  ) : null}

                  <div className="inline-form wrap" style={{ marginTop: '0.5rem' }}>
                    {QUOTABLE.has(r.status) ? (
                      <button
                        type="button"
                        className="link-button"
                        style={{ fontSize: '0.8rem' }}
                        onClick={() =>
                          setOpenQuoteId((cur) => (cur === r.requestId ? null : r.requestId))
                        }
                      >
                        {r.quotedPrice ? 'Recotizar' : 'Cotizar'}{' '}
                        {openQuoteId === r.requestId ? '▲' : '▾'}
                      </button>
                    ) : null}
                    {r.status === 'quoted' ? (
                      <button
                        type="button"
                        style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }}
                        disabled={acceptingId === r.requestId}
                        onClick={() => void accept(r.requestId)}
                      >
                        {acceptingId === r.requestId ? 'Emitiendo…' : 'Aceptar y emitir licencia'}
                      </button>
                    ) : null}
                  </div>
                  {acceptingId === null && acceptError ? (
                    <p className="form-error">{acceptError}</p>
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
