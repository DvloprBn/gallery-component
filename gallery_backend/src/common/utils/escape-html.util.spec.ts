import { escapeHtml } from './escape-html.util';

describe('escape-html.util', () => {
  it('neutraliza un payload de XSS clásico', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapa comillas y ampersand para no romper atributos', () => {
    expect(escapeHtml(`" onmouseover="x" & '`)).toBe(
      '&quot; onmouseover=&quot;x&quot; &amp; &#39;',
    );
  });

  it('deja intacto un texto sin caracteres peligrosos', () => {
    expect(escapeHtml('Álbum de la boda 2026')).toBe('Álbum de la boda 2026');
  });
});
