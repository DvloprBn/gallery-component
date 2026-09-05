'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { ADMIN_ROLES, useAuth } from '@/lib/auth';
import { RequireAuth } from '@/components/RequireAuth';
import {
  AlbumSettingsForm,
  type AlbumFormValues,
} from '@/components/AlbumSettingsForm';
import type { AlbumRow } from '@/lib/studio-types';

export default function StudioPage() {
  return (
    <RequireAuth>
      <StudioInner />
    </RequireAuth>
  );
}

/**
 * Gestor del sitio: la lista de colecciones del usuario y el alta de una nueva.
 * Los roles administrativos ven además los accesos a los ajustes de identidad
 * del sitio y a la bandeja de contacto.
 */
function StudioInner() {
  const { me } = useAuth();
  const [albums, setAlbums] = useState<AlbumRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<{ messages: number; requests: number } | null>(null);

  const isAdmin = me != null && ADMIN_ROLES.includes(me.roleName);

  const load = () =>
    apiFetch<AlbumRow[]>('/albums').then(setAlbums).catch(() => setAlbums([]));

  useEffect(() => {
    void load();
  }, []);

  // Cuántas cosas esperan atención en las dos bandejas — para no tener que
  // abrir ambas solo para saber si hay algo nuevo (Fase 12d).
  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([
      apiFetch<{ isRead: boolean }[]>('/contact/messages').catch(() => []),
      apiFetch<{ status: string }[]>('/license-requests').catch(() => []),
    ]).then(([messages, requests]) => {
      setPending({
        messages: messages.filter((m) => !m.isRead).length,
        requests: requests.filter((r) => r.status === 'new').length,
      });
    });
  }, [isAdmin]);

  const create = async (values: AlbumFormValues) => {
    await apiFetch('/albums', { method: 'POST', body: values });
    setCreating(false);
    await load();
  };

  return (
    <main className="panel">
      <div className="panel-head">
        <h1>Gestor del sitio</h1>
        <button type="button" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancelar' : 'Nueva colección'}
        </button>
      </div>

      {isAdmin && (
        <nav className="admin-links">
          <Link href="/studio/ajustes">Ajustes del sitio →</Link>
          <Link href="/studio/mensajes">
            Mensajes →{pending && pending.messages > 0 ? ` (${pending.messages} sin leer)` : ''}
          </Link>
          <Link href="/studio/licencias">
            Solicitudes de licencia →{pending && pending.requests > 0 ? ` (${pending.requests} nueva${pending.requests === 1 ? '' : 's'})` : ''}
          </Link>
        </nav>
      )}

      {creating && (
        <section className="panel-section">
          <h2>Nueva colección</h2>
          <AlbumSettingsForm submitLabel="Crear colección" onSubmit={create} />
        </section>
      )}

      {albums === null ? (
        <p className="page-note">Cargando…</p>
      ) : albums.length === 0 ? (
        <p className="muted">Todavía no tienes colecciones. Crea la primera.</p>
      ) : (
        <ul className="album-list">
          {albums.map((album) => (
            <li key={album.album_id} className="album-list__item">
              <Link href={`/studio/${album.album_id}`} className="album-list__main">
                <strong>{album.title}</strong>
                <span className="muted">
                  {album.media_count}{' '}
                  {album.media_count === 1 ? 'fotografía' : 'fotografías'} ·{' '}
                  <span className={`badge badge--${album.visibility}`}>
                    {album.visibility}
                  </span>{' '}
                  · {album.layout}
                  {album.featured && album.visibility === 'public' ? (
                    <>
                      {' '}
                      · <span className="badge badge--public">portada</span>
                    </>
                  ) : null}
                </span>
              </Link>
              {album.visibility !== 'private' && (
                <a
                  href={`/g/${album.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link-button"
                >
                  Ver colección ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
