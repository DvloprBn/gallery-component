'use client';

/**
 * Página de error global (fallo no capturado en cualquier ruta). Es
 * deliberadamente mínima y sin dependencias — reemplaza a la de Next para
 * que el `next build` no dependa de nada del árbol de componentes.
 *
 * @param props.reset - Reintenta renderizar el segmento que falló.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0b0b0f', color: '#f5f5f7' }}>
        <main style={{ maxWidth: '40rem', margin: '0 auto', padding: '4rem 1.5rem' }}>
          <h1>Algo salió mal</h1>
          <p style={{ opacity: 0.7 }}>Ocurrió un error inesperado al mostrar esta página.</p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
