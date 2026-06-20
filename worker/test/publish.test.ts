import { describe, it, expect, vi, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { reissueClient, type Env } from '../src/publish';
import type { ClientRecord } from '../src/types';

afterEach(() => vi.restoreAllMocks());

const rec: ClientRecord = { dominio: 'chat.x.com.br', asaas_customer_id: 'cus_1', asaas_subscription_id: 'sub_1', override: 'none' };

describe('reissueClient', () => {
  it('fetches Asaas, signs, and PUTs to GitHub', async () => {
    const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const priv = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');

    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url); seen.push(u);
      if (u.includes('api.asaas.com')) return new Response(JSON.stringify({ data: [{ status: 'RECEIVED', dueDate: '2026-07-10', paymentDate: '2026-07-09' }] }), { status: 200 });
      if (u.includes('api.github.com') && (!init?.method || init.method === 'GET')) return new Response('nf', { status: 404 });
      if (u.includes('api.github.com')) return new Response('{}', { status: 201 });
      return new Response('ok', { status: 200 }); // jsdelivr purge
    }));

    const env = { SIGNING_KEY: priv, GITHUB_TOKEN: 't', GITHUB_REPO: 'omniforge/app-mega-licenses', ASAAS_API_KEY: 'a', KID: 'of-license-2026' } as Env;
    await reissueClient(env, rec, new Date('2026-07-12T12:00:00Z'));

    expect(seen.some((u) => u.includes('api.asaas.com'))).toBe(true);
    expect(seen.some((u) => u.includes('/contents/licenses/'))).toBe(true);
  });
});
