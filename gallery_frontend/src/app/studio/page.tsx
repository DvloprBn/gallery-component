'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
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

function StudioInner() {
  const [albums, setAlbums] = useState<AlbumRow[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () =>
    apiFetch<AlbumRow[]>('/albums').then(setAlbums).catch(() => setAlbums([]));

  useEffect(() => {
    void load();
  }, []);

  const create = async (values: AlbumFormValues) => {
    await apiFetch('/albums', { method: 'POST', body: values });
    setCreating(false);
    await load();
  };

  return (
    <main className="panel">
      <div className="panel-head">
        <h1>Studio</h1>
        <button type="button" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancelar' : 'Nuevo álbum'}
        </button>
      </div>

      {creating && (
        <section className="panel-section">
          <h2>Nuevo álbum</h2>
          <AlbumSettingsForm submitLabel="Crear álbum" onSubmit={create} />
        </section>
      )}

      {albums === null ? (
        <p className="page-note">Cargando…</p>
      ) : albums.length === 0 ? (
        <p className="muted">Todavía no tienes álbumes. Crea el primero.</p>
      ) : (
        <ul className="album-list">
          {albums.map((album) => (
            <li key={album.album_id} className="album-list__item">
              <Link href={`/studio/${album.album_id}`} className="album-list__main">
                <strong>{album.title}</strong>
                <span className="muted">
                  {album.image_count}{' '}
                  {album.image_count === 1 ? 'imagen' : 'imágenes'} ·{' '}
                  <span className={`badge badge--${album.visibility}`}>
                    {album.visibility}
                  </span>{' '}
                  · {album.layout}
                </span>
              </Link>
              {album.visibility !== 'private' && (
                <a
                  href={`/g/${album.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link-button"
                >
                  Ver galería ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
