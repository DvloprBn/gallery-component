import { decryptSecret, encryptSecret } from './crypto.util';

/**
 * `TOTP_ENCRYPTION_KEY` de prueba — 64 hex fijos, solo para estos tests.
 * No es un secreto real (el archivo está en el repo público).
 */
const TEST_KEY =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('crypto.util (AES-256-GCM)', () => {
  beforeAll(() => {
    process.env.TOTP_ENCRYPTION_KEY = TEST_KEY;
  });

  it('descifra exactamente lo que cifró (ida y vuelta)', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP';
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it('produce un texto cifrado distinto cada vez (IV aleatorio)', () => {
    const plaintext = 'mismo-secreto';
    expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
  });

  it('rechaza el descifrado si el texto cifrado fue manipulado (authTag de GCM)', () => {
    const payload = encryptSecret('dato-intacto');
    const raw = Buffer.from(payload, 'base64');
    raw[raw.length - 1] ^= 0x01; // voltea un bit del último byte del ciphertext
    expect(() => decryptSecret(raw.toString('base64'))).toThrow();
  });

  it('falla si la llave no es 64 hex', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'demasiado-corta';
    expect(() => encryptSecret('x')).toThrow();
    process.env.TOTP_ENCRYPTION_KEY = TEST_KEY;
  });
});
