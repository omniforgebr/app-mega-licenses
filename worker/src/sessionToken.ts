import { canonicalize } from './canonical';
import { importPrivateKey, importPublicKey } from './sign';

export interface SessionClaims {
  reseller_id: string;
  user_id: string;
  device_id: string;
  status: string;
  exp: number; // epoch seconds
}

function b64ToBytes(b: string): Uint8Array {
  const std = b.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std.padEnd(std.length + ((4 - (std.length % 4)) % 4), '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(u: Uint8Array): string {
  return btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const strToB64url = (s: string): string => bytesToB64url(new TextEncoder().encode(s));
const b64urlToStr = (b: string): string => new TextDecoder().decode(b64ToBytes(b));

function validClaims(c: unknown): c is SessionClaims {
  if (typeof c !== 'object' || c === null) return false;
  const x = c as Record<string, unknown>;
  return (
    typeof x.reseller_id === 'string' &&
    typeof x.user_id === 'string' &&
    typeof x.device_id === 'string' &&
    typeof x.status === 'string' &&
    typeof x.exp === 'number'
  );
}

/**
 * Token = base64url(canonicalClaimsJson) + '.' + base64url(sig).
 * Os dois segmentos são base64url (não contêm '.'), então split('.') é seguro
 * mesmo com IDs/domínios que tenham ponto. A assinatura cobre EXATAMENTE a
 * string canônica transmitida — verify não re-canonicaliza.
 */
export async function issueSessionToken(
  privPkcs8Base64: string,
  claims: Omit<SessionClaims, 'exp'>,
  now: Date,
  ttlSeconds = 172800, // 48h
): Promise<string> {
  const full: SessionClaims = { ...claims, exp: Math.floor(now.getTime() / 1000) + ttlSeconds };
  const claimsJson = canonicalize(full as unknown as Record<string, unknown>);
  const payload = new TextEncoder().encode(claimsJson);
  const key = await importPrivateKey(privPkcs8Base64);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, payload);
  return strToB64url(claimsJson) + '.' + bytesToB64url(new Uint8Array(sig));
}

export async function verifySessionToken(
  token: string,
  pubRawBase64: string,
  now: Date,
): Promise<SessionClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const claimsJson = b64urlToStr(parts[0]);
    const sig = b64ToBytes(parts[1]);
    const payload = new TextEncoder().encode(claimsJson);
    const key = await importPublicKey(pubRawBase64);
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, sig.buffer as ArrayBuffer, payload);
    if (!ok) return null;
    const claims: unknown = JSON.parse(claimsJson);
    if (!validClaims(claims)) return null;
    if (claims.exp <= Math.floor(now.getTime() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
