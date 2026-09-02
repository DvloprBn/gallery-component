/**
 * Landing temporal de la Fase 1.
 *
 * Solo confirma que el frontend levanta y que toma la URL de la API del
 * entorno. Se reemplaza en la Fase 4 (galería pública) — ver
 * DOCUMENTO_VIVO_ARQUITECTURA.md §1.8.
 */
export default function HomePage() {
  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3050';

  return (
    <main className="shell">
      <h1>Galería</h1>
      <p>
        Esqueleto de la Fase 1 (núcleo / infraestructura). El backend expone
        su estado en <code>{apiBase}/health</code>.
      </p>
      <p className="muted">
        Las siguientes fases construyen: identidad, subida segura de
        imágenes, galería pública, personalización y animaciones.
      </p>
    </main>
  );
}
