import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { issueSessionToken, verifySessionToken } from '../src/sessionToken';

async function keypair() {
  const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const priv = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  const pub = Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64');
  return { priv, pub };
}

const now = new Date('2026-06-20T12:00:00Z');
// reseller_id e user_id com PONTO — prova que split('.') do token não quebra
const claims = { reseller_id: 'chat.empresa.com.br', user_id: 'user.42', device_id: 'dev-abc', status: 'active' };

describe('sessionToken', () => {
  it('round-trip verifies (ids com ponto)', async () => {
    const { priv, pub } = await keypair();
    const tok = await issueSessionToken(priv, claims, now);
    const out = await verifySessionToken(tok, pub, now);
    expect(out?.reseller_id).toBe('chat.empresa.com.br');
    expect(out?.user_id).toBe('user.42');
    expect(out?.exp).toBe(Math.floor(now.getTime() / 1000) + 172800);
  });

  it('rejects tampered signature', async () => {
    const { priv, pub } = await keypair();
    const tok = await issueSessionToken(priv, claims, now);
    const [c, s] = tok.split('.');
    const bad = c + '.' + (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    expect(await verifySessionToken(bad, pub, now)).toBeNull();
  });

  it('rejects expired token', async () => {
    const { priv, pub } = await keypair();
    const tok = await issueSessionToken(priv, claims, now, 60);
    const later = new Date(now.getTime() + 120_000);
    expect(await verifySessionToken(tok, pub, later)).toBeNull();
  });

  it('rejects malformed token', async () => {
    const { pub } = await keypair();
    expect(await verifySessionToken('garbage', pub, now)).toBeNull();
    expect(await verifySessionToken('a.b.c', pub, now)).toBeNull();
  });

  it('rejects token from a different key', async () => {
    const a = await keypair();
    const b = await keypair();
    const tok = await issueSessionToken(a.priv, claims, now);
    expect(await verifySessionToken(tok, b.pub, now)).toBeNull();
  });
});
