'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { ADMIN_ROLES } from '@/lib/auth';
import { RequireAuth } from '@/components/RequireAuth';
import type { Site } from '@/lib/api';

export default function SiteSettingsPage() {
  return (
    <RequireAuth roles={ADMIN_ROLES}>
      <Inner />
    </RequireAuth>
  );
}

/** Los campos de texto editables — el hero se maneja aparte. */
type TextFields = Omit<Site, 'hero'>;

const EMPTY: TextFields = {
  siteTitle: '',
  ownerName: '',
  tagline: '',
  bio: '',
  aboutBody: '',
  contactEmail: '',
  contactIntro: '',
  instagram: '',
};

/** Una imagen candidata a hero (de una colección pública). */
interface HeroOption {
  imageId: string;
  label: string;
  thumbUrl: string | null;
}

/**
 * Editor de la identidad del sitio: nombre, declaración, texto de «Sobre»,
 * datos de contacto y la imagen del hero de la portada. Lee `GET /site` para
 * precargar y guarda con `PATCH /site`.
 */
function Inner() {
  const [fields, setFields] = useState<TextFields>(EMPTY);
  const [heroId, setHeroId] = useState<string>('');
  const [currentHero, setCurrentHero] = useState<Site['hero']>(null);
  const [options, setOptions] = useState<HeroOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<
    { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  useEffect(() => {
    void (async () => {
      const site = await apiFetch<Site>('/site');
      const { hero, ...text } = site;
      setFields(text);
      setHeroId(hero?.imageId ?? '');
      setCurrentHero(hero);
      setLoaded(true);

      // Reúne las imágenes de todas las colecciones públicas como candidatas.
      try {
        const collections = await apiFetch<
          { slug: string; title: string }[]
        >('/galleries');
        const perCollection = await Promise.all(
          collections.map(async (c) => {
            const g = await apiFetch<{
              images: { imageId: string; urls: Record<string, string> }[];
            }>(`/g/${c.slug}`);
            return g.images.map((img, i) => ({
              imageId: img.imageId,
              label: `${c.title} — #${i + 1}`,
              thumbUrl: img.urls.thumb ?? img.urls.small ?? null,
            }));
          }),
        );
        setOptions(perCollection.flat());
      } catch {
        setOptions([]);
      }
    })().catch(() =>
      setStatus({ kind: 'error', message: 'No se pudieron cargar los ajustes.' }),
    );
  }, []);

  const set =
    (key: keyof TextFields) =>
    (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) =>
      setFields((f) => ({ ...f, [key]: event.target.value }));

  const preview = useMemo(
    () => options.find((o) => o.imageId === heroId)?.thumbUrl ?? currentHero?.urls.thumb ?? null,
    [options, heroId, currentHero],
  );

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: 'saving' });
    try {
      const updated = await apiFetch<Site>('/site', {
        method: 'PATCH',
        body: { ...fields, heroImageId: heroId === '' ? null : heroId },
      });
      setCurrentHero(updated.hero);
      setStatus({ kind: 'saved' });
    } catch (err) {
      setStatus({
        kind: 'error',
        message:
          err instanceof ApiError ? err.message : 'No se pudo guardar.',
      });
    }
  };

  if (!loaded) {
    return <p className="page-note">Cargando…</p>;
  }

  return (
    <main className="panel">
      <div className="panel-head">
        <h1>Ajustes del sitio</h1>
        <a href="/" className="link-button" target="_blank" rel="noreferrer">
          Ver portada ↗
        </a>
      </div>

      <form className="album-form" onSubmit={save}>
        <section className="panel-section">
          <h2>Identidad</h2>
          <div className="field-grid">
            <label>
              Título del sitio
              <input
                maxLength={120}
                value={fields.siteTitle}
                onChange={set('siteTitle')}
              />
            </label>
            <label>
              Nombre del autor
              <input
                maxLength={120}
                value={fields.ownerName}
                onChange={set('ownerName')}
              />
            </label>
            <label className="span-2">
              Declaración (tagline)
              <input
                maxLength={200}
                value={fields.tagline}
                onChange={set('tagline')}
              />
            </label>
            <label className="span-2">
              Bio breve (portada)
              <textarea
                rows={3}
                maxLength={600}
                value={fields.bio}
                onChange={set('bio')}
              />
            </label>
          </div>
        </section>

        <section className="panel-section">
          <h2>Página «Sobre»</h2>
          <label>
            Texto largo
            <textarea
              rows={10}
              maxLength={8000}
              value={fields.aboutBody}
              onChange={set('aboutBody')}
            />
            <span className="hint">
              Separa los párrafos con una línea en blanco.
            </span>
          </label>
        </section>

        <section className="panel-section">
          <h2>Contacto</h2>
          <div className="field-grid">
            <label>
              Correo de contacto
              <input
                type="email"
                maxLength={255}
                value={fields.contactEmail}
                onChange={set('contactEmail')}
              />
            </label>
            <label>
              Instagram (usuario o URL)
              <input
                maxLength={200}
                value={fields.instagram}
                onChange={set('instagram')}
              />
            </label>
            <label className="span-2">
              Introducción del formulario
              <textarea
                rows={3}
                maxLength={600}
                value={fields.contactIntro}
                onChange={set('contactIntro')}
              />
            </label>
          </div>
        </section>

        <section className="panel-section">
          <h2>Imagen del hero</h2>
          <div className="inline-form wrap">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt=""
                style={{
                  width: 96,
                  height: 96,
                  objectFit: 'cover',
                  borderRadius: 8,
                }}
              />
            ) : null}
            <label style={{ flex: 1, minWidth: '16rem' }}>
              Foto de portada
              <select value={heroId} onChange={(e) => setHeroId(e.target.value)}>
                <option value="">— Sin hero (degradado) —</option>
                {options.map((o) => (
                  <option key={o.imageId} value={o.imageId}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="hint">
                Solo fotos de colecciones públicas.
              </span>
            </label>
          </div>
        </section>

        <button type="submit" disabled={status.kind === 'saving'}>
          {status.kind === 'saving' ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {status.kind === 'saved' ? (
          <p className="form-ok">Guardado.</p>
        ) : null}
        {status.kind === 'error' ? (
          <p className="form-error">{status.message}</p>
        ) : null}
      </form>
    </main>
  );
}
