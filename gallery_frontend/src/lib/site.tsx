'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch } from './api-client';
import type { Site } from './api';

/**
 * Identidad del sitio para los Client Components (el chrome: cabecera y pie).
 * Los Server Components la piden directamente con `fetchSite()`; este contexto
 * existe solo para que la cabecera muestre el nombre sin volver a pedirlo en
 * cada navegación.
 */
const SiteContext = createContext<Site | null>(null);

/** Valores neutros mientras carga o si `/site` falla — el chrome nunca queda vacío. */
const FALLBACK: Site = {
  siteTitle: 'Estudio',
  ownerName: 'Estudio',
  tagline: '',
  bio: '',
  aboutBody: '',
  contactEmail: '',
  contactIntro: '',
  instagram: '',
  hero: null,
  watermark: {
    hasAsset: false,
    previewUrl: null,
    text: '',
    opacity: 0.35,
    placement: 'tiled',
  },
  rights: {
    rightsHolder: '',
    creator: '',
    creditLine: '',
    rightsStatement: '',
    licenseTerms: '',
    licensorUrl: '',
    noticeText: '',
  },
};

/**
 * Provee la identidad del sitio a la app. Puede recibir un valor inicial desde
 * el servidor (evita el parpadeo); si no, lo pide al montar.
 *
 * @param props.initial - Ajustes ya resueltos en el servidor (opcional).
 * @param props.children - Árbol de la app.
 */
export function SiteProvider({
  initial,
  children,
}: {
  initial?: Site | null;
  children: ReactNode;
}) {
  const [site, setSite] = useState<Site | null>(initial ?? null);

  useEffect(() => {
    if (site) return;
    apiFetch<Site>('/site')
      .then(setSite)
      .catch(() => setSite(FALLBACK));
  }, [site]);

  return (
    <SiteContext.Provider value={site ?? FALLBACK}>
      {children}
    </SiteContext.Provider>
  );
}

/**
 * Hook de identidad del sitio.
 *
 * @returns Los ajustes del sitio (nunca `null` — cae a valores neutros).
 */
export function useSite(): Site {
  return useContext(SiteContext) ?? FALLBACK;
}
