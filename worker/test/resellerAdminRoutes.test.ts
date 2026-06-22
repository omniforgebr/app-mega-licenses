import { describe, it, expect } from 'vitest';
import { handleResellerAdminRoute, type AdminEnv } from '../src/resellerAdminRoutes';
import type { Reseller, Seat } from '../src/types';

interface FakeKV extends KVNamespace {
  _m: Map<string, string>;
}
function fakeKV(): FakeKV {
  const m = new Map<string, string>();
  return {
    _m: m,
    async get(k: string, t?: 'json') {
      const v = m.get(k);
      return v == null ? null : t === 'json' ? JSON.parse(v) : v;
    },
    async put(k: string, v: string) {
      m.set(k, v);
    },
    async list({ prefix }: { prefix: string }) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: '' };
    },
  } as unknown as FakeKV;
}

function fakeD1(rows: Seat[] = []): D1Database {
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async first() {
          if (sql.includes('COUNT(*)')) {
            const [rid, cutoff] = args as string[];
            return { n: rows.filter((r) => r.reseller_id === rid && r.last_seen > cutoff).length };
          }
          return null;
        },
        async run() {
          return { success: true };
        },
        async all() {
          return { results: [] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

const now = new Date('2026-06-21T12:00:00Z');

function env(seats: Seat[] = []): { env: AdminEnv; kv: FakeKV } {
  const kv = fakeKV();
  return {
    env: { LICENSES: kv, SEATS_DB: fakeD1(seats), ADMIN_TOKEN: 'adm', KID: 'of-license-2026' },
    kv,
  };
}
function seedReseller(kv: FakeKV, id: string, cota: number, status: Reseller['status'] = 'active') {
  kv._m.set(`reseller:${id}`, JSON.stringify({ id, asaas_subscription_id: 'sub', plano_cota: cota, status, kid: 'k' }));
}
function post(path: string, body: object, token = 'adm') {
  return new Request(`https://w${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}
const u = (p: string) => new URL(`https://w${p}`);

describe('resellerAdminRoutes', () => {
  it('403 without admin token', async () => {
    const { env: e } = env();
    const r = await handleResellerAdminRoute(post('/admin/reseller', { id: 'x', plano_cota: 5 }, 'wrong'), u('/admin/reseller'), e, now);
    expect(r?.status).toBe(403);
  });

  it('null for non-admin path', async () => {
    const { env: e } = env();
    expect(await handleResellerAdminRoute(new Request('https://w/other'), u('/other'), e, now)).toBeNull();
  });

  it('creates a reseller', async () => {
    const { env: e, kv } = env();
    const r = await handleResellerAdminRoute(post('/admin/reseller', { id: 'rev-a', plano_cota: 10, asaas_subscription_id: 'sub_1' }, 'adm'), u('/admin/reseller'), e, now);
    const body = await r!.json();
    expect(body.status).toBe('ok');
    expect(body.reseller.plano_cota).toBe(10);
    expect(kv._m.has('reseller:rev-a')).toBe(true);
  });

  it('rejects non-integer plano_cota', async () => {
    const { env: e } = env();
    const r = await handleResellerAdminRoute(post('/admin/reseller', { id: 'rev-a', plano_cota: 1.5 }, 'adm'), u('/admin/reseller'), e, now);
    expect(r?.status).toBe(400);
  });

  it('upsert WITHOUT status preserves existing (não reativa suspenso)', async () => {
    const { env: e, kv } = env();
    seedReseller(kv, 'rev-a', 10, 'suspended');
    // admin só atualiza a cota, sem mandar status
    const r = await handleResellerAdminRoute(post('/admin/reseller', { id: 'rev-a', plano_cota: 20 }, 'adm'), u('/admin/reseller'), e, now);
    expect((await r!.json()).reseller.status).toBe('suspended');
    expect(JSON.parse(kv._m.get('reseller:rev-a')!).plano_cota).toBe(20);
  });

  it('lists resellers with active seat counts', async () => {
    const seats: Seat[] = [
      { reseller_id: 'rev-a', user_id: 'u1', device_id: 'd1', first_seen: now.toISOString(), last_seen: now.toISOString() },
      { reseller_id: 'rev-a', user_id: 'u2', device_id: 'd2', first_seen: now.toISOString(), last_seen: '2026-06-01T00:00:00Z' },
    ];
    const { env: e, kv } = env(seats);
    seedReseller(kv, 'rev-a', 10);
    const req = new Request('https://w/admin/resellers', { method: 'GET', headers: { authorization: 'Bearer adm' } });
    const r = await handleResellerAdminRoute(req, u('/admin/resellers'), e, now);
    const body = await r!.json();
    expect(body.resellers).toHaveLength(1);
    expect(body.resellers[0].id).toBe('rev-a');
    expect(body.resellers[0].ativos).toBe(1); // só u1 ativo
  });

  it('status override updates the reseller', async () => {
    const { env: e, kv } = env();
    seedReseller(kv, 'rev-a', 10, 'active');
    const r = await handleResellerAdminRoute(post('/admin/reseller/status', { id: 'rev-a', status: 'suspended' }, 'adm'), u('/admin/reseller/status'), e, now);
    expect((await r!.json()).status).toBe('ok');
    expect(JSON.parse(kv._m.get('reseller:rev-a')!).status).toBe('suspended');
  });

  it('status override 404 for unknown reseller', async () => {
    const { env: e } = env();
    const r = await handleResellerAdminRoute(post('/admin/reseller/status', { id: 'nope', status: 'suspended' }, 'adm'), u('/admin/reseller/status'), e, now);
    expect(r?.status).toBe(404);
  });

  it('405 GET on /admin/reseller', async () => {
    const { env: e } = env();
    const req = new Request('https://w/admin/reseller', { method: 'GET', headers: { authorization: 'Bearer adm' } });
    const r = await handleResellerAdminRoute(req, u('/admin/reseller'), e, now);
    expect(r?.status).toBe(405);
  });
});
