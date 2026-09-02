import { signMediaKey, verifyMediaSignature } from './media-signing';

describe('media-signing (HMAC de URLs de media privada)', () => {
  const key = '11111111-2222-3333-4444-555555555555.webp';

  it('acepta una firma válida no expirada', () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = signMediaKey(key, exp);
    expect(verifyMediaSignature(key, String(exp), sig)).toBe(true);
  });

  it('rechaza una firma manipulada', () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = signMediaKey(key, exp);
    const tampered = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a');
    expect(verifyMediaSignature(key, String(exp), tampered)).toBe(false);
  });

  it('rechaza una firma de OTRA clave', () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sigForOther = signMediaKey('otra-clave.webp', exp);
    expect(verifyMediaSignature(key, String(exp), sigForOther)).toBe(false);
  });

  it('rechaza cuando ya expiró', () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const sig = signMediaKey(key, exp);
    expect(verifyMediaSignature(key, String(exp), sig)).toBe(false);
  });

  it('rechaza si falta exp o sig, o si exp no es numérico', () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = signMediaKey(key, exp);
    expect(verifyMediaSignature(key, undefined, sig)).toBe(false);
    expect(verifyMediaSignature(key, String(exp), undefined)).toBe(false);
    expect(verifyMediaSignature(key, 'no-numero', sig)).toBe(false);
  });
});
