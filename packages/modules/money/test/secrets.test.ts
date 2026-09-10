import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { open, seal } from '../src/secrets';

describe('payout secrets', () => {
  const original = process.env.PAYOUT_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.PAYOUT_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });
  afterEach(() => {
    if (original === undefined) delete process.env.PAYOUT_ENCRYPTION_KEY;
    else process.env.PAYOUT_ENCRYPTION_KEY = original;
  });

  it('round-trips a payout method', () => {
    const plain = 'Meezan Bank 1234-5678-9012, Ali Raza';
    const sealed = seal(plain);
    expect(sealed.nonce).toHaveLength(12);
    expect(sealed.cipher[0]).toBe(0x01); // key-id prefix
    expect(sealed.cipher.toString('utf8')).not.toContain('Meezan'); // not plaintext
    expect(open(sealed)).toBe(plain);
  });

  it('produces a fresh nonce and ciphertext each time', () => {
    const a = seal('same');
    const b = seal('same');
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.cipher.equals(b.cipher)).toBe(false);
  });

  it('refuses a tampered ciphertext (GCM auth tag)', () => {
    const sealed = seal('secret');
    const i = sealed.cipher.length - 1; // flip the last body byte
    sealed.cipher[i] = (sealed.cipher[i] ?? 0) ^ 0xff;
    expect(() => open(sealed)).toThrow();
  });

  it('refuses when the key is absent', () => {
    delete process.env.PAYOUT_ENCRYPTION_KEY;
    expect(() => seal('x')).toThrow(/PAYOUT_ENCRYPTION_KEY/);
  });

  it('refuses a key that is not 32 bytes', () => {
    process.env.PAYOUT_ENCRYPTION_KEY = Buffer.from('too short').toString('base64');
    expect(() => seal('x')).toThrow(/32 bytes/);
  });
});
