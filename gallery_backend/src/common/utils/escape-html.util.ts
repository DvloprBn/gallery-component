/**
 * Escapa los cinco caracteres que permiten inyectar HTML/atributos.
 *
 * Se usa antes de interpolar texto libre de un usuario (nombre, título de
 * álbum, pie de foto) dentro del HTML de un correo transaccional o de un
 * bloque JSON-LD del sitio — sitios donde el framework de UI no escapa por
 * nosotros. Dentro de React/JSX no hace falta: ahí el escape es automático.
 *
 * @param input - Texto potencialmente hostil.
 * @returns El mismo texto con `& < > " '` convertidos a sus entidades HTML.
 */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}
