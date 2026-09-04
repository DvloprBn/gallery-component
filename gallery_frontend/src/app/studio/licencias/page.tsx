'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
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

/** Estado de la solicitud — hoy solo se genera `new`; el resto llega con cotizar/aceptar. */
const STATUS_LABEL: Record<string, string> = {
  new: 'Nueva',
  quoted: 'Cotizada',
  accepted: 'Aceptada',
  declined: 'Rechazada',
  fulfilled: 'Entregada',
};

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
}

/**
 * Bandeja de solicitudes de licencia (Fase 12a — solo lectura). Cotizar,
 * aceptar y entregar el archivo llegan en fases posteriores; por ahora esto
 * es el punto donde el gestor ve qué está pidiendo la gente.
 */
function Inner() {
  const [requests, setRequests] = useState<LicenseRequest[] | null>(null);

  useEffect(() => {
    apiFetch<LicenseRequest[]>('/license-requests')
      .then(setRequests)
      .catch(() => setRequests([]));
  }, []);

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
                      Presupuesto: {r.budget}
                    </p>
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
