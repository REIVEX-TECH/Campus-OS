import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * PayoutSecrets: seal/open a seller's payout method (bank/wallet details) with
 * AES-256-GCM at the application layer, so the database never holds the key
 * (design-money-movements.md §5). The ciphertext carries a one-byte key-id prefix
 * so a future re-encrypt job can rotate keys; one key is in use today.
 *
 * The key is `PAYOUT_ENCRYPTION_KEY`: 32 bytes, base64. It is read lazily and only
 * when a payout is actually sealed/opened (the MEDIA_DATA_DIR pattern), so the app
 * boots without it; wiring the finance UI adds the production boot assertion.
 */

const KEY_ID = 0x01;

export interface SealedSecret {
  cipher: Buffer; // key-id byte ++ auth tag (16) ++ ciphertext
  nonce: Buffer; // 12-byte GCM nonce
}

function loadKey(): Buffer {
  const raw = process.env.PAYOUT_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('PAYOUT_ENCRYPTION_KEY is not set; cannot handle payout details.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('PAYOUT_ENCRYPTION_KEY must be 32 bytes (base64-encoded).');
  }
  return key;
}

/** Encrypt a payout method string. Returns the cipher (with key-id + tag) and nonce. */
export function seal(plain: string): SealedSecret {
  const key = loadKey();
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return { cipher: Buffer.concat([Buffer.from([KEY_ID]), tag, body]), nonce };
}

/** Decrypt a sealed payout method. Throws if the key id is unknown or the tag fails. */
export function open(sealed: SealedSecret): string {
  const key = loadKey();
  if (sealed.cipher.length < 1 + 16) {
    throw new Error('payout cipher is too short');
  }
  const keyId = sealed.cipher[0];
  if (keyId !== KEY_ID) {
    throw new Error(`unknown payout key id ${keyId}`);
  }
  const tag = sealed.cipher.subarray(1, 17);
  const body = sealed.cipher.subarray(17);
  const d = createDecipheriv('aes-256-gcm', key, sealed.nonce);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}
