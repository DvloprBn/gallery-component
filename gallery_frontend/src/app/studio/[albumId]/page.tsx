'use client';

export const dynamic = 'force-dynamic';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { RequireAuth } from '@/components/RequireAuth';
import {
  AlbumSettingsForm,
  type AlbumFormValues,
} from '@/components/AlbumSettingsForm';
import type { AlbumRow, ImageDto, ShareTokenRow } from '@/lib/studio-types';

export default function AlbumManagePage() {
  return (
    <RequireAuth>
      <Manage />
    </RequireAuth>
  );
}

function Manage() {
  const { albumId } = useParams<{ albumId: string }>();
  const router = useRouter();

  const [album, setAlbum] = useState<AlbumRow | null>(null);
  const [images, setImages] = useState<ImageDto[]>([]);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, imgs] = await Promise.all([
        apiFetch<AlbumRow>(`/albums/${albumId}`),
        apiFetch<ImageDto[]>(`/albums/${albumId}/images`),
      ]);
      setAlbum(a);
      setImages(imgs);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setNotFound(true);
      }
    }
  }, [albumId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (notFound) {
    return <p className="page-note">Álbum no encontrado.</p>;
  }
  if (!album) {
    return <p className="page-note">Cargando…</p>;
  }

  const saveSettings = async (values: AlbumFormValues) => {
    await apiFetch(`/albums/${albumId}`, { method: 'PATCH', body: values });
    await load();
  };

  const deleteAlbum = async () => {
    if (!confirm(`¿Borrar "${album.title}" y todas sus imágenes?`)) return;
    await apiFetch(`/albums/${albumId}`, { method: 'DELETE' });
    router.push('/studio');
  };

  return (
    <main className="panel">
      <div className="panel-head">
        <h1>{album.title}</h1>
        {album.visibility !== 'private' && (
          <a href={`/g/${album.slug}`} target="_blank" rel="noreferrer" className="link-button">
            Ver galería ↗
          </a>
        )}
      </div>

      <section className="panel-section">
        <h2>Subir imágenes</h2>
        <Uploader albumId={albumId} onDone={load} />
      </section>

      <section className="panel-section">
        <h2>Imágenes ({images.length})</h2>
        <ImageGrid
          albumId={albumId}
          images={images}
          coverId={album.cover_image_id}
          onChange={load}
        />
      </section>

      <section className="panel-section">
        <h2>Ajustes</h2>
        <AlbumSettingsForm album={album} submitLabel="Guardar cambios" onSubmit={saveSettings} />
      </section>

      <section className="panel-section">
        <h2>Enlaces de compartir</h2>
        <ShareLinks albumId={albumId} slug={album.slug} />
      </section>

      <section className="panel-section danger-zone">
        <h2>Zona peligrosa</h2>
        <button type="button" className="danger" onClick={deleteAlbum}>
          Borrar este álbum
        </button>
      </section>
    </main>
  );
}

/** Subida de varios archivos, uno tras otro, con estado por archivo. */
function Uploader({ albumId, onDone }: { albumId: string; onDone: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<{ name: string; state: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    const list = Array.from(files);
    setRows(list.map((f) => ({ name: f.name, state: 'en cola' })));

    for (let i = 0; i < list.length; i++) {
      setRows((r) => r.map((x, idx) => (idx === i ? { ...x, state: 'subiendo…' } : x)));
      const form = new FormData();
      form.append('file', list[i]);
      try {
        await apiFetch(`/albums/${albumId}/images`, { method: 'POST', body: form });
        setRows((r) => r.map((x, idx) => (idx === i ? { ...x, state: 'ok' } : x)));
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'error';
        setRows((r) => r.map((x, idx) => (idx === i ? { ...x, state: msg } : x)));
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
    await onDone();
  };

  return (
    <div className="stack">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        disabled={busy}
        onChange={(e) => void onFiles(e.target.files)}
      />
      {rows.length > 0 && (
        <ul className="upload-status">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`}>
              <span>{r.name}</span> <span className="muted">{r.state}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Rejilla de imágenes: editar alt/pie, portada, borrar, reordenar arrastrando. */
function ImageGrid({
  albumId,
  images,
  coverId,
  onChange,
}: {
  albumId: string;
  images: ImageDto[];
  coverId: string | null;
  onChange: () => Promise<void>;
}) {
  const [order, setOrder] = useState<ImageDto[]>(images);
  const dragFrom = useRef<number | null>(null);

  useEffect(() => setOrder(images), [images]);

  const persistOrder = async (next: ImageDto[]) => {
    setOrder(next);
    await apiFetch(`/albums/${albumId}/images/reorder`, {
      method: 'POST',
      body: { orderedIds: next.map((i) => i.imageId) },
    }).catch(() => onChange());
  };

  const onDrop = (to: number) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null || from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void persistOrder(next);
  };

  const updateMeta = async (id: string, patch: { altText?: string; caption?: string }) => {
    await apiFetch(`/images/${id}`, { method: 'PATCH', body: patch });
  };

  const setCover = async (id: string) => {
    await apiFetch(`/albums/${albumId}`, { method: 'PATCH', body: { coverImageId: id } });
    await onChange();
  };

  const remove = async (id: string) => {
    if (!confirm('¿Borrar esta imagen?')) return;
    await apiFetch(`/images/${id}`, { method: 'DELETE' });
    await onChange();
  };

  if (order.length === 0) {
    return <p className="muted">Sube algunas imágenes para empezar.</p>;
  }

  return (
    <ol className="img-grid">
      {order.map((image, index) => (
        <li
          key={image.imageId}
          className="img-card"
          draggable
          onDragStart={() => (dragFrom.current = index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDrop(index)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.urls.thumb ?? image.urls.small} alt={image.altText ?? ''} />
          <input
            className="img-meta"
            placeholder="Texto alternativo"
            defaultValue={image.altText ?? ''}
            onBlur={(e) => void updateMeta(image.imageId, { altText: e.target.value })}
          />
          <input
            className="img-meta"
            placeholder="Pie de foto"
            defaultValue={image.caption ?? ''}
            onBlur={(e) => void updateMeta(image.imageId, { caption: e.target.value })}
          />
          <div className="img-actions">
            <button
              type="button"
              className="link-button"
              disabled={coverId === image.imageId}
              onClick={() => void setCover(image.imageId)}
            >
              {coverId === image.imageId ? 'Portada' : 'Hacer portada'}
            </button>
            <button
              type="button"
              className="link-button danger"
              onClick={() => void remove(image.imageId)}
            >
              Borrar
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Crear / listar / revocar enlaces de compartir. */
function ShareLinks({ albumId, slug }: { albumId: string; slug: string }) {
  const [tokens, setTokens] = useState<ShareTokenRow[]>([]);
  const [minutes, setMinutes] = useState('');
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  const load = () =>
    apiFetch<ShareTokenRow[]>(`/albums/${albumId}/share-tokens`)
      .then(setTokens)
      .catch(() => setTokens([]));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId]);

  const create = async () => {
    const body = minutes ? { expiresInMinutes: Number(minutes) } : {};
    const res = await apiFetch<{ url: string }>(`/albums/${albumId}/share-tokens`, {
      method: 'POST',
      body,
    });
    setLastUrl(res.url);
    setMinutes('');
    await load();
  };

  const revoke = async (id: string) => {
    await apiFetch(`/albums/${albumId}/share-tokens/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div className="stack">
      <p className="muted">
        Cualquiera con un enlace válido puede ver la galería (
        <code>/g/{slug}?token=…</code>), aunque el álbum sea privado.
      </p>
      <div className="inline-form">
        <input
          type="number"
          min={5}
          placeholder="Caduca en (min) — opcional"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
        <button type="button" onClick={() => void create()}>
          Crear enlace
        </button>
      </div>
      {lastUrl && (
        <p className="form-ok">
          Nuevo enlace (cópialo ahora): <code>{lastUrl}</code>
        </p>
      )}
      {tokens.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Creado</th>
              <th>Caduca</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.shareTokenId}>
                <td>{new Date(t.createdAt).toLocaleString()}</td>
                <td>{t.expiresAt ? new Date(t.expiresAt).toLocaleString() : 'nunca'}</td>
                <td>{t.revoked ? 'revocado' : 'activo'}</td>
                <td>
                  {!t.revoked && (
                    <button
                      type="button"
                      className="link-button danger"
                      onClick={() => void revoke(t.shareTokenId)}
                    >
                      Revocar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
