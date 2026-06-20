import { describe, it, expect, vi, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import worker from '../src/index';
import type { Env } from '../src/publish';

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeKV() {
  const m = new Map<string, string>();
  return {
    async get(k: string, type?: 'json') {
      const v = m.get(k);
      return v == null ? null : (type === 'json' ? JSON.parse(v) : v);
    },
    async put(k: string, v: string) { m.set(k, v); },
    async list({ prefix }: { prefix: string; limit?: number; cursor?: string }) {
      return {
        keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cursor: '',
      };
    },
    _store: m,
  };
}

async function makeEnv(kv: ReturnType<typeof fakeKV>): Promise<Env> {
  const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const priv = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  return {
    LICENSES: kv as unknown as KVNamespace,
    SIGNING_KEY: priv,
    GITHUB_TOKEN: 'gh-token',
    GITHUB_REPO: 'omniforge/app-mega-licenses',
    ASAAS_API_KEY: 'asaas-key',
    ASAAS_WEBHOOK_TOKEN: 'wh-secret',
    ADMIN_TOKEN: 'admin-secret',
    KID: 'of-license-2026',
  };
}

function stubFetchSuccess() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('api.asaas.com')) {
      return new Response(
        JSON.stringify({ data: [{ status: 'RECEIVED', dueDate: '2026-07-10', paymentDate: '2026-07-09' }] }),
        { status: 200 },
      );
    }
    if (u.includes('api.github.com') && (!init?.method || init.method === 'GET')) {
      return new Response('nf', { status: 404 });
    }
    if (u.includes('api.github.com')) return new Response('{}', { status: 201 });
    return new Response('ok', { status: 200 }); // jsdelivr purge
  }));
}

// ---------------------------------------------------------------------------
// Auth checks — missing or wrong token → 403
// ---------------------------------------------------------------------------

describe('auth guards', () => {
  it('/webhook/asaas with wrong token → 403', async () => {
    const kv = fakeKV();
    const env = await makeEnv(kv);
    const req = new Request('http://w/webhook/asaas', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'asaas-access-token': 'wrong' },
      body: '{}',
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(403);
  });

  it('/webhook/asaas with no token → 403', async () => {
    const kv = fakeKV();
    const env = await makeEnv(kv);
    const req = new Request('http://w/webhook/asaas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(403);
  });

  it('/admin/override with wrong Bearer → 403', async () => {
    const kv = fakeKV();
    const env = await makeEnv(kv);
    const req = new Request('http://w/admin/override', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer bad-token' },
      body: JSON.stringify({ dominio: 'x.com.br', override: 'none' }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(403);
  });

  it('/admin/client with no Bearer → 403', async () => {
    const kv = fakeKV();
    const env = await makeEnv(kv);
    const req = new Request('http://w/admin/client', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dominio: 'x.com.br', asaas_subscription_id: 's1', asaas_customer_id: 'c1', override: 'none',
      }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// C3 — /admin/client with missing field → 400
// ---------------------------------------------------------------------------

describe('/admin/client validation (C3)', () => {
  it('missing dominio → 400', async () => {
    const kv = fakeKV();
    const env = await makeEnv(kv);
    const req = new Request('http://w/admin/client', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer admin-secret' },
      body: JSON.stringify({ asaas_subscription_id: 's1', asaas_customer_id: 'c1', override: 'none' }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it('empty dominio → 400', async () => {
    const kv = fakeKV();
    const env = await makeEnv(kv);
    const req = new Request('http://w/admin/client', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer admin-secret' },
      body: JSON.stringify({ dominio: '   ', asaas_subscription_id: 's1', asaas_customer_id: 'c1', override: 'none' }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it('missing asaas_subscription_id → 400', async () => {
    const kv = fakeKV();
    const env = await makeEnv(kv);
    const req = new Request('http://w/admin/client', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer admin-secret' },
      body: JSON.stringify({ dominio: 'chat.x.com.br', asaas_customer_id: 'c1', override: 'none' }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it('missing asaas_customer_id → 400', async () => {
    const kv = fakeKV();
    const env = await makeEnv(kv);
    const req = new Request('http://w/admin/client', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer admin-secret' },
      body: JSON.stringify({ dominio: 'chat.x.com.br', asaas_subscription_id: 's1', override: 'none' }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// C3 + C4 — /admin/client with mixed-case/https:// domain → 200 + normalized KV key
// ---------------------------------------------------------------------------

describe('/admin/client domain normalization (C3 + C4)', () => {
  it('stores record under normalized key when domain has uppercase/https:// prefix', async () => {
    const kv = fakeKV();
    const env = await makeEnv(kv);
    stubFetchSuccess();

    const req = new Request('http://w/admin/client', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer admin-secret' },
      body: JSON.stringify({
        dominio: 'HTTPS://Chat.EMPRESA.com.br/',
        asaas_subscription_id: 'sub_99',
        asaas_customer_id: 'cus_99',
        override: 'none',
      }),
    });

    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);

    // C4: KV key must be the normalized domain.
    const normalizedKey = 'client:chat.empresa.com.br';
    expect(kv._store.has(normalizedKey)).toBe(true);

    // The stored record's dominio field must also be normalized.
    const stored = JSON.parse(kv._store.get(normalizedKey)!);
    expect(stored.dominio).toBe('chat.empresa.com.br');

    // Sub-index must point to the normalized domain.
    expect(kv._store.get('subindex:sub_99')).toBe('chat.empresa.com.br');
  });
});

// ---------------------------------------------------------------------------
// m3 — /admin/override with invalid override value → 400
// ---------------------------------------------------------------------------

describe('/admin/override validation (m3)', () => {
  it('invalid override value → 400', async () => {
    const kv = fakeKV();
    const env = await makeEnv(kv);
    const req = new Request('http://w/admin/override', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer admin-secret' },
      body: JSON.stringify({ dominio: 'x.com.br', override: 'bad_value' }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });
});
