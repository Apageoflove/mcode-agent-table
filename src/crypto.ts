import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, createHash, randomBytes } from 'node:crypto';

/** Canonical JSON: object keys sorted recursively, no whitespace, undefined dropped. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}

export interface OwnerKeys { publicKey: string; privateKey: string } // base64 SPKI / PKCS8 DER

export function generateOwnerKeys(): OwnerKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

export function signPayload(privateKeyB64: string, payload: unknown): string {
  const key = createPrivateKey({ key: Buffer.from(privateKeyB64, 'base64'), format: 'der', type: 'pkcs8' });
  return sign(null, Buffer.from(canonical(payload)), key).toString('base64');
}

export function verifyPayload(publicKeyB64: string, payload: unknown, signature: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(canonical(payload)), key, Buffer.from(signature, 'base64'));
  } catch { return false; }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const nonce = () => randomBytes(12).toString('hex');
export const token = () => randomBytes(24).toString('base64url');
