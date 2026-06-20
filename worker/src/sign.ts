import { canonicalize } from './canonical';
import type { Manifest } from './types';

const ALG = { name: 'Ed25519' } as const;
const b64ToBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const bytesToB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

export function importPrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', b64ToBytes(pkcs8Base64), ALG, false, ['sign']);
}
export function importPublicKey(rawBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64ToBytes(rawBase64), ALG, false, ['verify']);
}

function payloadBytes(m: Manifest): Uint8Array {
  const { sig: _omit, ...unsigned } = m;
  return new TextEncoder().encode(canonicalize(unsigned as Record<string, unknown>));
}

export async function signManifest(m: Manifest, priv: CryptoKey): Promise<Manifest> {
  const sigBuf = await crypto.subtle.sign(ALG, priv, payloadBytes(m));
  return { ...m, sig: bytesToB64(new Uint8Array(sigBuf)) };
}
export async function verifyManifest(m: Manifest, pub: CryptoKey): Promise<boolean> {
  if (!m.sig) return false;
  return crypto.subtle.verify(ALG, pub, b64ToBytes(m.sig), payloadBytes(m));
}
