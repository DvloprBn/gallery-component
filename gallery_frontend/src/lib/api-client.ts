/**
 * Cliente HTTP para peticiones desde el NAVEGADOR (Client Components).
 *
 * La sesión vive en cookies httpOnly que el JS no puede leer, así que todas
 * las peticiones van con `credentials: 'include'` para que el navegador las
 * adjunte. En desarrollo la API está en otro puerto (mismo sitio → las
 * cookies `SameSite=lax` viajan igual); en producción es el mismo origen
 * bajo `/api`.
 */
const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');

/** Error de una respuesta no-2xx, con el mensaje que devolvió la API. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Hace una petición a la API y devuelve el JSON ya parseado.
 *
 * @param path - Ruta de la API (p. ej. `/auth/me`).
 * @param init - Opciones de `fetch`. Si `body` es un objeto plano se
 *        serializa a JSON automáticamente; un `FormData` se manda tal cual.
 * @returns El cuerpo de la respuesta parseado como JSON (o `undefined` si es 204).
 * @throws ApiError si la respuesta no es 2xx (con el mensaje de la API).
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
): Promise<T> {
  const isFormData =
    typeof FormData !== 'undefined' && init.body instanceof FormData;

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    body: isFormData
      ? (init.body as FormData)
      : init.body
        ? JSON.stringify(init.body)
        : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data
        ? Array.isArray((data as { message: unknown }).message)
          ? ((data as { message: string[] }).message.join(' '))
          : String((data as { message: unknown }).message)
        : null) ?? `Error ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}
