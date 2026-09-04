import type { RightsFields } from './rights-metadata.service';

/** El subconjunto de `RightsFields` que una imagen puede sobreescribir. */
export type RightsPartial = Partial<RightsFields>;

/** Tope de longitud por campo — igual que las columnas de `site_settings`. */
const MAX_LENGTHS: Record<keyof RightsFields, number> = {
  rightsHolder: 160,
  creator: 160,
  creditLine: 200,
  rightsStatement: 400,
  licenseTerms: 400,
  licensorUrl: 300,
};

/**
 * Proyecta un valor arbitrario (lo que llega en `PATCH /images/:id`) a un
 * objeto de derechos seguro: **solo** las claves conocidas, todo lo demás se
 * descarta; cada valor se trunca a su tope. Es la única puerta de entrada de
 * `images.rights` — nunca se guarda el JSON crudo del cliente.
 *
 * @param input - Lo que venga en el body (ya pasó `@IsObject()` del DTO).
 * @returns Un objeto con solo los campos conocidos, saneado.
 */
export function sanitizeRightsPartial(input: unknown): RightsPartial {
  if (!input || typeof input !== 'object') return {};
  const out: RightsPartial = {};
  for (const key of Object.keys(MAX_LENGTHS) as (keyof RightsFields)[]) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      out[key] = value.slice(0, MAX_LENGTHS[key]);
    }
  }
  return out;
}

/**
 * Resuelve los derechos efectivos de una imagen: cada campo vacío en su
 * registro propio cae al valor por defecto del sitio.
 *
 * @param siteDefaults - `SiteService.getRightsDefaults()`.
 * @param imageRights - `images.rights` (columna `Json?`, puede ser `null`).
 * @returns Los seis campos, siempre con algo (aunque sea cadena vacía).
 */
export function resolveRights(
  siteDefaults: RightsFields,
  imageRights: unknown,
): RightsFields {
  const override = sanitizeRightsPartial(imageRights);
  return {
    rightsHolder: override.rightsHolder || siteDefaults.rightsHolder,
    creator: override.creator || siteDefaults.creator,
    creditLine: override.creditLine || siteDefaults.creditLine,
    rightsStatement: override.rightsStatement || siteDefaults.rightsStatement,
    licenseTerms: override.licenseTerms || siteDefaults.licenseTerms,
    licensorUrl: override.licensorUrl || siteDefaults.licensorUrl,
  };
}
