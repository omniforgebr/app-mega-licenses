import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { signManifest, verifyManifest, importPrivateKey, importPublicKey } from '../src/sign';
import type { Manifest } from '../src/types';

async function keypair() {
  const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const priv = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  const pub = Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64');
  return { priv, pub };
}

const base: Manifest = {
  v: 1, key: 'a'.repeat(64), status: 'active',
  paid_through: '2026-07-10', grace_until: '2026-07-15',
  issued_at: '2026-07-12T12:00:00.000Z', expires_at: '2026-07-26T12:00:00.000Z',
  kid: 'of-license-2026',
};

describe('sign/verify', () => {
  it('verifies a freshly signed manifest', async () => {
    const { priv, pub } = await keypair();
    const signed = await signManifest(base, await importPrivateKey(priv));
    expect(signed.sig).toBeTruthy();
    expect(await verifyManifest(signed, await importPublicKey(pub))).toBe(true);
  });
  it('rejects a tampered manifest', async () => {
    const { priv, pub } = await keypair();
    const signed = await signManifest(base, await importPrivateKey(priv));
    const tampered = { ...signed, status: 'suspended' as const };
    expect(await verifyManifest(tampered, await importPublicKey(pub))).toBe(false);
  });
});
