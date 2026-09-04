import { resolveRights, sanitizeRightsPartial } from './rights.util';

describe('sanitizeRightsPartial', () => {
  it('conserva solo las claves conocidas', () => {
    expect(
      sanitizeRightsPartial({
        rightsHolder: 'Mara Solís',
        creator: 'Mara Solís',
        __proto__: 'x', // no debe colarse
        arbitraryField: 'inyectado',
        messageId: 'algo-ajeno',
      }),
    ).toEqual({ rightsHolder: 'Mara Solís', creator: 'Mara Solís' });
  });

  it('trunca cada campo a su tope de longitud', () => {
    const result = sanitizeRightsPartial({ rightsHolder: 'x'.repeat(500) });
    expect(result.rightsHolder).toHaveLength(160);
  });

  it('ignora valores que no son string', () => {
    expect(
      sanitizeRightsPartial({ rightsHolder: 123, creator: null, creditLine: ['x'] }),
    ).toEqual({});
  });

  it('con entrada no-objeto (null, array, string) devuelve vacío', () => {
    expect(sanitizeRightsPartial(null)).toEqual({});
    expect(sanitizeRightsPartial('texto')).toEqual({});
    expect(sanitizeRightsPartial(['a', 'b'])).toEqual({});
  });
});

describe('resolveRights', () => {
  const defaults = {
    rightsHolder: 'Mara Solís',
    creator: 'Mara Solís',
    creditLine: 'Estudio Mara Solís',
    rightsStatement: '© Mara Solís 2026',
    licenseTerms: 'Uso editorial únicamente',
    licensorUrl: 'https://marasolis.mx',
  };

  it('usa los defaults del sitio cuando la imagen no tiene override', () => {
    expect(resolveRights(defaults, null)).toEqual(defaults);
  });

  it('el override de la imagen gana campo por campo', () => {
    const result = resolveRights(defaults, { creditLine: 'Cliente XYZ' });
    expect(result.creditLine).toBe('Cliente XYZ');
    expect(result.rightsHolder).toBe(defaults.rightsHolder); // el resto sigue en default
  });

  it('un override con un campo vacío ("") cae al default, no se queda vacío', () => {
    const result = resolveRights(defaults, { creditLine: '' });
    expect(result.creditLine).toBe(defaults.creditLine);
  });
});
