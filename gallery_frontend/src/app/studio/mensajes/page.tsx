'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { ADMIN_ROLES } from '@/lib/auth';
import { RequireAuth } from '@/components/RequireAuth';

export default function MessagesPage() {
  return (
    <RequireAuth roles={ADMIN_ROLES}>
      <Inner />
    </RequireAuth>
  );
}

/** Un mensaje de contacto, tal como lo devuelve `GET /contact/messages`. */
interface Message {
  messageId: string;
  name: string;
  email: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

/**
 * Bandeja de contacto: los mensajes enviados desde `/contacto`, con marca de
 * leído/no leído y borrado. Solo lectura para el visitante — el backend exige
 * rol administrativo en cada operación.
 */
function Inner() {
  const [messages, setMessages] = useState<Message[] | null>(null);

  const load = () =>
    apiFetch<Message[]>('/contact/messages')
      .then(setMessages)
      .catch(() => setMessages([]));

  useEffect(() => {
    void load();
  }, []);

  const toggleRead = async (m: Message) => {
    await apiFetch(`/contact/messages/${m.messageId}`, {
      method: 'PATCH',
      body: { read: !m.isRead },
    });
    await load();
  };

  const remove = async (m: Message) => {
    if (!confirm(`¿Borrar el mensaje de ${m.name}?`)) return;
    await apiFetch(`/contact/messages/${m.messageId}`, { method: 'DELETE' });
    await load();
  };

  const unread = messages?.filter((m) => !m.isRead).length ?? 0;

  return (
    <main className="panel">
      <div className="panel-head">
        <h1>Mensajes</h1>
        <a href="/studio" className="link-button">
          ← Gestor
        </a>
      </div>

      {messages === null ? (
        <p className="page-note">Cargando…</p>
      ) : messages.length === 0 ? (
        <p className="muted">La bandeja está vacía.</p>
      ) : (
        <>
          <p className="muted">
            {messages.length}{' '}
            {messages.length === 1 ? 'mensaje' : 'mensajes'}
            {unread > 0 ? ` · ${unread} sin leer` : ''}
          </p>
          <ul className="album-list">
            {messages.map((m) => (
              <li
                key={m.messageId}
                className={`album-list__item${m.isRead ? ' row--muted' : ''}`}
              >
                <div className="album-list__main" style={{ cursor: 'default' }}>
                  <strong>
                    {m.name}{' '}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      &lt;{m.email}&gt;
                    </span>
                  </strong>
                  <span className="muted">
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                  <p style={{ margin: '0.5rem 0 0', whiteSpace: 'pre-wrap' }}>
                    {m.body}
                  </p>
                </div>
                <div className="stack" style={{ gap: '0.35rem' }}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => void toggleRead(m)}
                  >
                    {m.isRead ? 'Marcar no leído' : 'Marcar leído'}
                  </button>
                  <button
                    type="button"
                    className="link-button danger"
                    onClick={() => void remove(m)}
                  >
                    Borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
