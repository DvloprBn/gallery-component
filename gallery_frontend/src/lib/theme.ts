import type { CSSProperties } from 'react';
import type { GalleryTheme } from './gallery-schema';

/** Familias tipográficas permitidas (el `theme` solo elige entre estas). */
const FONT_STACKS: Record<string, string> = {
  system:
    'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
};

/**
 * Traduce el objeto `theme` de un álbum a **CSS custom properties**.
 *
 * Nunca se inyecta un valor del `theme` crudo en un `<style>` — solo se
 * asignan variables ya acotadas por el esquema Zod. El componente de galería
 * las consume (`var(--g-bg)`, etc.); si una falta, cae al default del CSS.
 *
 * @param theme - El `theme` ya validado del álbum.
 * @returns Un objeto de estilo con las variables `--g-*` definidas.
 */
export function themeToCssVars(theme: GalleryTheme): CSSProperties {
  const vars: Record<string, string> = {};

  if (theme.colors?.bg) vars['--g-bg'] = theme.colors.bg;
  if (theme.colors?.fg) vars['--g-fg'] = theme.colors.fg;
  if (theme.colors?.accent) vars['--g-accent'] = theme.colors.accent;

  if (theme.typography?.fontFamily) {
    vars['--g-font'] = FONT_STACKS[theme.typography.fontFamily];
  }
  if (theme.typography?.scale) {
    vars['--g-scale'] = String(theme.typography.scale);
  }

  if (theme.layout?.gap !== undefined) vars['--g-gap'] = `${theme.layout.gap}px`;
  if (theme.layout?.radius !== undefined)
    vars['--g-radius'] = `${theme.layout.radius}px`;
  if (theme.layout?.maxColumns !== undefined)
    vars['--g-max-columns'] = String(theme.layout.maxColumns);

  return vars as CSSProperties;
}

/** Preset de animación efectivo del tema (default `fade-up`). */
export function motionPreset(theme: GalleryTheme): 'fade-up' | 'fade' | 'zoom' | 'none' {
  return theme.motion?.preset ?? 'fade-up';
}

/** Retardo escalonado entre elementos, en segundos (default 0.06). */
export function motionStagger(theme: GalleryTheme): number {
  return (theme.motion?.stagger ?? 60) / 1000;
}

/** Duración de la animación de entrada, en segundos (default 0.4). */
export function motionDuration(theme: GalleryTheme): number {
  return (theme.motion?.durationMs ?? 400) / 1000;
}
