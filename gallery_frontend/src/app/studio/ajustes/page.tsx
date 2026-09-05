'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useRef, useState } from 'react';
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

/** Los campos de identidad/contacto — el hero, la marca de agua y los derechos se manejan aparte. */
type TextFields = Omit<Site, 'hero' | 'watermark' | 'rights'>;

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

/** Campos editables de la marca de agua (Fase 11, D9). */
interface WatermarkFields {
  watermarkText: string;
  watermarkOpacity: number;
  watermarkPlacement: 'tiled' | 'corner';
}

const EMPTY_WATERMARK: WatermarkFields = {
  watermarkText: '',
  watermarkOpacity: 0.35,
  watermarkPlacement: 'tiled',
};

/** Campos editables del registro de derechos por defecto (Fase 11, D10). */
interface RightsFields {
  rightsHolder: string;
  creator: string;
  creditLine: string;
  rightsStatement: string;
  defaultLicenseTerms: string;
  licensorUrl: string;
}

const EMPTY_RIGHTS: RightsFields = {
  rightsHolder: '',
  creator: '',
  creditLine: '',
  rightsStatement: '',
  defaultLicenseTerms: '',
  licensorUrl: '',
};

/** Una imagen candidata a hero (de una colección pública). */
interface HeroOption {
  mediaId: string;
  label: string;
  thumbUrl: string | null;
}

/** Progreso de `POST /site/watermark/regenerate`, tal como lo devuelve el backend. */
interface RegenStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  processed: number;
  skipped: number;
  total: number;
  error: string | null;
}

/**
 * Editor de la identidad del sitio: nombre, declaración, texto de «Sobre»,
 * contacto, hero, **marca de agua** y **derechos por defecto** (Fase 11).
 * Lee `GET /site` para precargar y guarda con `PATCH /site`.
 */
function Inner() {
  const [fields, setFields] = useState<TextFields>(EMPTY);
  const [watermarkFields, setWatermarkFields] = useState<WatermarkFields>(EMPTY_WATERMARK);
  const [rightsFields, setRightsFields] = useState<RightsFields>(EMPTY_RIGHTS);
  const [heroId, setHeroId] = useState<string>('');
  const [currentHero, setCurrentHero] = useState<Site['hero']>(null);
  const [watermark, setWatermark] = useState<Site['watermark'] | null>(null);
  const [options, setOptions] = useState<HeroOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<
    { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [regen, setRegen] = useState<RegenStatus | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const loadSite = async () => {
    const site = await apiFetch<Site>('/site');
    const { hero, watermark: wm, rights, ...text } = site;
    setFields(text);
    setWatermarkFields({
      watermarkText: wm.text,
      watermarkOpacity: wm.opacity,
      watermarkPlacement: wm.placement,
    });
    setRightsFields({
      rightsHolder: rights.rightsHolder,
      creator: rights.creator,
      creditLine: rights.creditLine,
      rightsStatement: rights.rightsStatement,
      defaultLicenseTerms: rights.licenseTerms,
      licensorUrl: rights.licensorUrl,
    });
    setHeroId(hero?.mediaId ?? '');
    setCurrentHero(hero);
    setWatermark(wm);
    return site;
  };

  useEffect(() => {
    void (async () => {
      await loadSite();
      setLoaded(true);

      // Reúne el contenido de todas las colecciones públicas como candidatas a hero.
      try {
        const collections = await apiFetch<
          { slug: string; title: string }[]
        >('/galleries');
        const perCollection = await Promise.all(
          collections.map(async (c) => {
            const g = await apiFetch<{
              media: { mediaId: string; urls: Record<string, string> }[];
            }>(`/g/${c.slug}`);
            return g.media.map((m, i) => ({
              mediaId: m.mediaId,
              label: `${c.title} — #${i + 1}`,
              thumbUrl: m.urls.thumb ?? m.urls.small ?? null,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set =
    (key: keyof TextFields) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFields((f) => ({ ...f, [key]: event.target.value }));

  const setRight =
    (key: keyof RightsFields) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setRightsFields((f) => ({ ...f, [key]: event.target.value }));

  const preview = useMemo(
    () => options.find((o) => o.mediaId === heroId)?.thumbUrl ?? currentHero?.urls.thumb ?? null,
    [options, heroId, currentHero],
  );

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: 'saving' });
    try {
      const updated = await apiFetch<Site>('/site', {
        method: 'PATCH',
        body: {
          ...fields,
          ...watermarkFields,
          ...rightsFields,
          heroMediaId: heroId === '' ? null : heroId,
        },
      });
      setCurrentHero(updated.hero);
      setWatermark(updated.watermark);
      setStatus({ kind: 'saved' });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'No se pudo guardar.',
      });
    }
  };

  const uploadLogo = async (file: File) => {
    setLogoBusy(true);
    setLogoError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const updated = await apiFetch<Site>('/site/watermark', {
        method: 'POST',
        body: form,
      });
      setWatermark(updated.watermark);
    } catch (err) {
      setLogoError(err instanceof ApiError ? err.message : 'No se pudo subir el logo.');
    } finally {
      setLogoBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    setLogoError(null);
    try {
      const updated = await apiFetch<Site>('/site/watermark', { method: 'DELETE' });
      setWatermark(updated.watermark);
    } catch (err) {
      setLogoError(err instanceof ApiError ? err.message : 'No se pudo quitar el logo.');
    } finally {
      setLogoBusy(false);
    }
  };

  const regenerate = async () => {
    const started = await apiFetch<RegenStatus>('/site/watermark/regenerate', {
      method: 'POST',
    });
    setRegen(started);
    const poll = async () => {
      const current = await apiFetch<RegenStatus>('/site/watermark/regenerate');
      setRegen(current);
      if (current.status === 'running') {
        setTimeout(() => void poll(), 3000);
      }
    };
    setTimeout(() => void poll(), 3000);
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
              <input maxLength={120} value={fields.siteTitle} onChange={set('siteTitle')} />
            </label>
            <label>
              Nombre del autor
              <input maxLength={120} value={fields.ownerName} onChange={set('ownerName')} />
            </label>
            <label className="span-2">
              Declaración (tagline)
              <input maxLength={200} value={fields.tagline} onChange={set('tagline')} />
            </label>
            <label className="span-2">
              Bio breve (portada)
              <textarea rows={3} maxLength={600} value={fields.bio} onChange={set('bio')} />
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
            <span className="hint">Separa los párrafos con una línea en blanco.</span>
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
              <input maxLength={200} value={fields.instagram} onChange={set('instagram')} />
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
                style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }}
              />
            ) : null}
            <label style={{ flex: 1, minWidth: '16rem' }}>
              Foto de portada
              <select value={heroId} onChange={(e) => setHeroId(e.target.value)}>
                <option value="">— Sin hero (degradado) —</option>
                {options.map((o) => (
                  <option key={o.mediaId} value={o.mediaId}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="hint">Solo fotos de colecciones públicas.</span>
            </label>
          </div>
        </section>

        <section className="panel-section">
          <h2>Marca de agua</h2>
          <p className="hint" style={{ marginBottom: '1rem' }}>
            Se estampa en el servidor sobre <strong>todas</strong> las fotos de colecciones
            públicas — nunca se puede quitar desde el navegador. El original de alta resolución
            nunca se sirve en público.
          </p>

          <div className="inline-form wrap" style={{ marginBottom: '1rem' }}>
            {watermark?.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={watermark.previewUrl}
                alt="Logo de marca de agua"
                style={{
                  width: 96,
                  height: 96,
                  objectFit: 'contain',
                  borderRadius: 8,
                  background: 'var(--surface-2)',
                }}
              />
            ) : (
              <span className="hint">Sin logo — se usa el texto de abajo.</span>
            )}
            <div className="stack" style={{ gap: '0.5rem' }}>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={logoBusy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadLogo(file);
                }}
              />
              {watermark?.hasAsset ? (
                <button
                  type="button"
                  className="link-button danger"
                  disabled={logoBusy}
                  onClick={() => void removeLogo()}
                >
                  Quitar logo (volver al texto)
                </button>
              ) : null}
              {logoError ? <p className="form-error">{logoError}</p> : null}
            </div>
          </div>

          <div className="field-grid">
            <label className="span-2">
              Texto de respaldo (si no hay logo)
              <input
                maxLength={120}
                value={watermarkFields.watermarkText}
                onChange={(e) =>
                  setWatermarkFields((f) => ({ ...f, watermarkText: e.target.value }))
                }
                placeholder={`© ${fields.ownerName || 'tu nombre'}`}
              />
              <span className="hint">
                Vacío = se calcula solo como «© {fields.ownerName || 'tu nombre'}».
              </span>
            </label>
            <label>
              Opacidad ({Math.round(watermarkFields.watermarkOpacity * 100)}%)
              <input
                type="range"
                min={0.05}
                max={0.9}
                step={0.05}
                value={watermarkFields.watermarkOpacity}
                onChange={(e) =>
                  setWatermarkFields((f) => ({
                    ...f,
                    watermarkOpacity: Number(e.target.value),
                  }))
                }
              />
            </label>
            <label>
              Patrón
              <select
                value={watermarkFields.watermarkPlacement}
                onChange={(e) =>
                  setWatermarkFields((f) => ({
                    ...f,
                    watermarkPlacement: e.target.value as 'tiled' | 'corner',
                  }))
                }
              >
                <option value="tiled">Repetido en diagonal</option>
                <option value="corner">Una vez, esquina</option>
              </select>
            </label>
          </div>

          <div className="inline-form wrap" style={{ marginTop: '1.25rem' }}>
            <button type="button" onClick={() => void regenerate()} disabled={regen?.status === 'running'}>
              {regen?.status === 'running' ? 'Regenerando…' : 'Aplicar a todo lo publicado'}
            </button>
            {regen ? (
              <span className="hint">
                {regen.status === 'running' &&
                  `Procesando… ${regen.processed}/${regen.total} (${regen.skipped} sin releer)`}
                {regen.status === 'done' &&
                  `Listo: ${regen.processed} imágenes actualizadas, ${regen.skipped} sin releer.`}
                {regen.status === 'error' && `Falló: ${regen.error}`}
              </span>
            ) : (
              <span className="hint">
                Rehace la marca y los derechos de lo ya publicado con la configuración actual —
                úsalo tras cambiar el logo, el texto o los derechos.
              </span>
            )}
          </div>
        </section>

        <section className="panel-section">
          <h2>Derechos por defecto</h2>
          <p className="hint" style={{ marginBottom: '1rem' }}>
            Se incrustan como metadatos IPTC/XMP en cada archivo servido (público y bajo
            licencia) — nunca en el GPS ni el número de serie de la cámara, que siempre se
            eliminan.
          </p>
          <div className="field-grid">
            <label>
              Titular de los derechos
              <input maxLength={160} value={rightsFields.rightsHolder} onChange={setRight('rightsHolder')} />
            </label>
            <label>
              Autor / crédito (Creator)
              <input maxLength={160} value={rightsFields.creator} onChange={setRight('creator')} />
            </label>
            <label className="span-2">
              Línea de crédito
              <input maxLength={200} value={rightsFields.creditLine} onChange={setRight('creditLine')} />
            </label>
            <label className="span-2">
              Aviso de derechos
              <input
                maxLength={400}
                value={rightsFields.rightsStatement}
                onChange={setRight('rightsStatement')}
                placeholder={`© ${fields.ownerName || 'tu nombre'} ${new Date().getFullYear()}. Todos los derechos reservados.`}
              />
            </label>
            <label className="span-2">
              Término de licencia por defecto
              <textarea
                rows={2}
                maxLength={400}
                value={rightsFields.defaultLicenseTerms}
                onChange={setRight('defaultLicenseTerms')}
              />
            </label>
            <label className="span-2">
              URL del licenciante
              <input
                maxLength={300}
                value={rightsFields.licensorUrl}
                onChange={setRight('licensorUrl')}
                placeholder="https://…"
              />
            </label>
          </div>
        </section>

        <button type="submit" disabled={status.kind === 'saving'}>
          {status.kind === 'saving' ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {status.kind === 'saved' ? <p className="form-ok">Guardado.</p> : null}
        {status.kind === 'error' ? <p className="form-error">{status.message}</p> : null}
      </form>
    </main>
  );
}
