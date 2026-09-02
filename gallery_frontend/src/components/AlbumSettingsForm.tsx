'use client';

import { useState } from 'react';
import {
  FONT_FAMILIES,
  LAYOUTS,
  MOTION_PRESETS,
  VISIBILITIES,
  type AlbumRow,
} from '@/lib/studio-types';

/** Valores del formulario — la forma que se manda a la API (`theme` como objeto). */
export interface AlbumFormValues {
  title: string;
  description: string;
  visibility: (typeof VISIBILITIES)[number];
  layout: (typeof LAYOUTS)[number];
  theme: {
    colors: { bg: string; fg: string; accent: string };
    typography: { fontFamily: (typeof FONT_FAMILIES)[number]; scale: number };
    layout: { gap: number; radius: number; maxColumns: number };
    motion: { preset: (typeof MOTION_PRESETS)[number]; stagger: number; durationMs: number };
  };
}

const DEFAULTS: AlbumFormValues = {
  title: '',
  description: '',
  visibility: 'private',
  layout: 'masonry',
  theme: {
    colors: { bg: '#0b0b0f', fg: '#f5f5f7', accent: '#ff5d3a' },
    typography: { fontFamily: 'system', scale: 1 },
    layout: { gap: 12, radius: 8, maxColumns: 3 },
    motion: { preset: 'fade-up', stagger: 60, durationMs: 400 },
  },
};

/** Construye los valores iniciales a partir de un álbum existente (o los defaults). */
function fromAlbum(album?: AlbumRow): AlbumFormValues {
  if (!album) return structuredClone(DEFAULTS);
  const t = (album.theme ?? {}) as AlbumFormValues['theme'];
  return {
    title: album.title,
    description: album.description ?? '',
    visibility: album.visibility,
    layout: album.layout,
    theme: {
      colors: { ...DEFAULTS.theme.colors, ...t.colors },
      typography: { ...DEFAULTS.theme.typography, ...t.typography },
      layout: { ...DEFAULTS.theme.layout, ...t.layout },
      motion: { ...DEFAULTS.theme.motion, ...t.motion },
    },
  };
}

/**
 * Formulario completo de un álbum: título, descripción, visibilidad, layout y
 * **todos** los tokens del tema, expuestos de una vez (nada de "crear y luego
 * ir a buscar dónde se edita").
 *
 * @param props.album - Álbum a editar; omitir para el modo "crear".
 * @param props.submitLabel - Texto del botón.
 * @param props.onSubmit - Recibe los valores; debe lanzar si la API falla.
 */
export function AlbumSettingsForm({
  album,
  submitLabel,
  onSubmit,
}: {
  album?: AlbumRow;
  submitLabel: string;
  onSubmit: (values: AlbumFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<AlbumFormValues>(() => fromAlbum(album));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = (updater: (draft: AlbumFormValues) => void) => {
    setValues((current) => {
      const draft = structuredClone(current);
      updater(draft);
      return draft;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit(values);
      if (!album) setValues(structuredClone(DEFAULTS));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };

  const t = values.theme;

  return (
    <form onSubmit={submit} className="album-form">
      <div className="field-grid">
        <label className="span-2">
          Título
          <input
            required
            maxLength={150}
            value={values.title}
            onChange={(e) => patch((d) => (d.title = e.target.value))}
          />
        </label>
        <label className="span-2">
          Descripción
          <textarea
            rows={2}
            maxLength={2000}
            value={values.description}
            onChange={(e) => patch((d) => (d.description = e.target.value))}
          />
        </label>
        <label>
          Visibilidad
          <select
            value={values.visibility}
            onChange={(e) =>
              patch((d) => (d.visibility = e.target.value as AlbumFormValues['visibility']))
            }
          >
            <option value="private">Privada (solo yo)</option>
            <option value="unlisted">Por enlace (no listada)</option>
            <option value="public">Pública</option>
          </select>
        </label>
        <label>
          Layout
          <select
            value={values.layout}
            onChange={(e) =>
              patch((d) => (d.layout = e.target.value as AlbumFormValues['layout']))
            }
          >
            {LAYOUTS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="theme-fieldset">
        <legend>Tema</legend>
        <div className="field-grid">
          <label>
            Fondo
            <input
              type="color"
              value={t.colors.bg}
              onChange={(e) => patch((d) => (d.theme.colors.bg = e.target.value))}
            />
          </label>
          <label>
            Texto
            <input
              type="color"
              value={t.colors.fg}
              onChange={(e) => patch((d) => (d.theme.colors.fg = e.target.value))}
            />
          </label>
          <label>
            Acento
            <input
              type="color"
              value={t.colors.accent}
              onChange={(e) => patch((d) => (d.theme.colors.accent = e.target.value))}
            />
          </label>
          <label>
            Tipografía
            <select
              value={t.typography.fontFamily}
              onChange={(e) =>
                patch(
                  (d) =>
                    (d.theme.typography.fontFamily = e.target
                      .value as (typeof FONT_FAMILIES)[number]),
                )
              }
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label>
            Columnas ({t.layout.maxColumns})
            <input
              type="range"
              min={1}
              max={6}
              value={t.layout.maxColumns}
              onChange={(e) =>
                patch((d) => (d.theme.layout.maxColumns = Number(e.target.value)))
              }
            />
          </label>
          <label>
            Separación ({t.layout.gap}px)
            <input
              type="range"
              min={0}
              max={48}
              value={t.layout.gap}
              onChange={(e) =>
                patch((d) => (d.theme.layout.gap = Number(e.target.value)))
              }
            />
          </label>
          <label>
            Radio ({t.layout.radius}px)
            <input
              type="range"
              min={0}
              max={32}
              value={t.layout.radius}
              onChange={(e) =>
                patch((d) => (d.theme.layout.radius = Number(e.target.value)))
              }
            />
          </label>
          <label>
            Animación
            <select
              value={t.motion.preset}
              onChange={(e) =>
                patch(
                  (d) =>
                    (d.theme.motion.preset = e.target
                      .value as (typeof MOTION_PRESETS)[number]),
                )
              }
            >
              {MOTION_PRESETS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <button type="submit" disabled={busy}>
        {submitLabel}
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
