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
import {
  IMAGE_STATUSES,
  IMAGE_STATUS_LABEL,
  type AlbumRow,
  type ImageDto,
  type ImageRights,
  type ImageStatus,
  type ShareTokenRow,
} from '@/lib/studio-types';

/** Los seis campos de derechos, siempre juntos (el backend reemplaza el JSON completo). */
const RIGHTS_FIELDS: { key: keyof ImageRights; label: string }[] = [
  { key: 'rightsHolder', label: 'Titular' },
  { key: 'creator', label: 'Autor' },
  { key: 'creditLine', label: 'Crédito' },
  { key: 'rightsStatement', label: 'Aviso de derechos' },
  { key: 'licenseTerms', label: 'Término de licencia' },
  { key: 'licensorUrl', label: 'URL del licenciante' },
];

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
    return <p className="page-note">Colección no encontrada.</p>;
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
            Ver colección ↗
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
          Borrar esta colección
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

/**
 * Rejilla de imágenes: curar (estado de publicación, individual y en bloque),
 * editar alt/pie, elegir portada, borrar y reordenar arrastrando.
 *
 * La curación es el eje de la Fase 10b: se sube en ancho y solo la selección
 * `published` se ve en la galería pública.
 */
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [rightsOpenId, setRightsOpenId] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    setOrder(images);
    setSelected(new Set());
  }, [images]);

  const counts = order.reduce(
    (acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }),
    {} as Record<ImageStatus, number>,
  );

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

  /**
   * Guarda el registro de derechos de una imagen — el backend reemplaza el
   * objeto `rights` completo, así que siempre se manda el borrador entero
   * (nunca un campo suelto, o se perderían los demás).
   */
  const saveRights = async (id: string, rights: ImageRights) => {
    const updated = await apiFetch<ImageDto>(`/images/${id}`, {
      method: 'PATCH',
      body: { rights },
    });
    setOrder((cur) => cur.map((i) => (i.imageId === id ? updated : i)));
  };

  /** Borra el override — la imagen vuelve a heredar todo de `site.rights`. */
  const clearRights = async (id: string) => {
    const updated = await apiFetch<ImageDto>(`/images/${id}`, {
      method: 'PATCH',
      body: { rights: null },
    });
    setOrder((cur) => cur.map((i) => (i.imageId === id ? updated : i)));
  };

  const setStatus = async (id: string, status: ImageStatus) => {
    // Optimista: pinta el cambio y confirma contra el servidor.
    setOrder((cur) => cur.map((i) => (i.imageId === id ? { ...i, status } : i)));
    await apiFetch(`/images/${id}`, { method: 'PATCH', body: { status } }).catch(
      () => onChange(),
    );
  };

  const bulkStatus = async (status: ImageStatus) => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await apiFetch(`/albums/${albumId}/images/status`, {
        method: 'POST',
        body: { imageIds: [...selected], status },
      });
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  const toggleSel = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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
    <div className="stack" style={{ maxWidth: 'none', gap: '1rem' }}>
      <div className="img-toolbar">
        <span className="muted">
          {(['published', 'draft', 'archived'] as ImageStatus[])
            .map((s) => `${counts[s] ?? 0} ${IMAGE_STATUS_LABEL[s].toLowerCase()}`)
            .join(' · ')}
        </span>
        {selected.size > 0 && (
          <span className="img-bulk">
            <strong>{selected.size} seleccionada{selected.size === 1 ? '' : 's'}:</strong>
            {IMAGE_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => void bulkStatus(s)}
              >
                {IMAGE_STATUS_LABEL[s]}
              </button>
            ))}
            <button
              type="button"
              className="link-button"
              onClick={() => setSelected(new Set())}
            >
              limpiar
            </button>
          </span>
        )}
      </div>

      <ol className="img-grid">
        {order.map((image, index) => (
          <li
            key={image.imageId}
            className={`img-card img-card--${image.status}${
              selected.has(image.imageId) ? ' is-selected' : ''
            }`}
            draggable
            onDragStart={() => (dragFrom.current = index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(index)}
          >
            <label className="img-select">
              <input
                type="checkbox"
                checked={selected.has(image.imageId)}
                onChange={() => toggleSel(image.imageId)}
              />
            </label>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.urls.thumb ?? image.urls.small} alt={image.altText ?? ''} />
            <select
              className="img-meta"
              value={image.status}
              onChange={(e) => void setStatus(image.imageId, e.target.value as ImageStatus)}
            >
              {IMAGE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {IMAGE_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
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
            <button
              type="button"
              className="link-button"
              style={{ fontSize: '0.76rem' }}
              onClick={() =>
                setRightsOpenId((cur) => (cur === image.imageId ? null : image.imageId))
              }
            >
              Derechos {rightsOpenId === image.imageId ? '▲' : '▾'}
              {Object.keys(image.rights ?? {}).length > 0 ? ' •' : ''}
            </button>
            {rightsOpenId === image.imageId ? (
              <RightsEditor
                initial={image.rights ?? {}}
                onSave={(r) => saveRights(image.imageId, r)}
                onClear={() => clearRights(image.imageId)}
              />
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Editor del registro de derechos de UNA imagen (Fase 11, D10) — solo los
 * campos que se quieran sobreescribir sobre los del sitio; los vacíos
 * heredan. Se guarda como un objeto completo (nunca campo por campo).
 */
function RightsEditor({
  initial,
  onSave,
  onClear,
}: {
  initial: ImageRights;
  onSave: (rights: ImageRights) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ImageRights>(initial);
  const [busy, setBusy] = useState(false);
  const hasOverride = Object.values(initial).some((v) => v);

  return (
    <div className="img-rights">
      <p className="hint">Vacío = hereda el valor por defecto del sitio.</p>
      {RIGHTS_FIELDS.map(({ key, label }) => (
        <input
          key={key}
          className="img-meta"
          placeholder={label}
          value={draft[key] ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        />
      ))}
      <div className="img-actions">
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(draft);
            } finally {
              setBusy(false);
            }
          }}
        >
          Guardar derechos
        </button>
        {hasOverride ? (
          <button
            type="button"
            className="link-button danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onClear();
                setDraft({});
              } finally {
                setBusy(false);
              }
            }}
          >
            Restablecer
          </button>
        ) : null}
      </div>
    </div>
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
