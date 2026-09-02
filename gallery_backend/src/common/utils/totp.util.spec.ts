import { authenticator } from 'otplib';
import {
  buildOtpAuthUrl,
  generateTotpSecret,
  verifyTotp,
} from './totp.util';

describe('totp.util (RFC 6238)', () => {
  it('acepta un código generado con el MISMO secreto', () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    expect(verifyTotp(code, secret)).toBe(true);
  });

  it('rechaza un código válido de OTRO secreto (el caso que atraparía un "todo pasa")', () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const codeForB = authenticator.generate(secretB);
    expect(verifyTotp(codeForB, secretA)).toBe(false);
  });

  it('rechaza basura sin lanzar', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp('000000', secret)).toBe(false);
    expect(verifyTotp('no-son-digitos', secret)).toBe(false);
    expect(verifyTotp('', secret)).toBe(false);
  });

  it('la otpauth URL lleva el emisor y la cuenta', () => {
    const url = buildOtpAuthUrl('JBSWY3DPEHPK3PXP', 'ana@example.com', 'Galería');
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain('Galer');
    expect(url).toContain('ana%40example.com');
  });
});
