/**
 * Usos que se pueden solicitar al licenciar una foto — debe coincidir con
 * `INTENDED_USES` en `gallery_backend/src/licensing/dto/license-request.dto.ts`.
 * Único origen de la etiqueta en español: la usan tanto el formulario público
 * (lightbox) como la bandeja del gestor, para que no se desalineen.
 */
export const INTENDED_USES = ['editorial', 'commercial', 'social', 'print'] as const;

export type IntendedUse = (typeof INTENDED_USES)[number];

export const INTENDED_USE_LABEL: Record<string, string> = {
  editorial: 'Editorial',
  commercial: 'Comercial',
  social: 'Redes sociales',
  print: 'Impresión',
};
