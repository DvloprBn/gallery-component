/** 404 — lo dispara `notFound()` en `/g/[slug]` cuando el álbum no existe o no hay acceso. */
export default function NotFound() {
  return (
    <main className="shell">
      <h1>No encontrada</h1>
      <p className="muted">
        Esta galería no existe, es privada, o el enlace de acceso ya no es válido.
      </p>
      <p>
        <a href="/">← Volver al inicio</a>
      </p>
    </main>
  );
}
