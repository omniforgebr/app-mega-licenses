import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { handleSeatRoute, type SeatEnv } from '../src/seatRoutes';
import { issueSessionToken } from '../src/sessionToken';
import type { Reseller, Seat } from '../src/types';

interface FakeKV extends KVNamespace {
  _m: Map<string, string>;
}

function fakeKV(): FakeKV {
  const m = new Map<string, string>();
  return {
    _m: m,
    async get(k: string, type?: 'json') {
      const v = m.get(k);
      return v == null ? null : type === 'json' ? JSON.parse(v) : v;
    },
    async put(k: string, v: string) {
      m.set(k, v);
    },
  } as unknown as FakeKV;
}

interface FakeD1 extends D1Database {
  _rows: Seat[];
}

// Fake D1 que entende as 5 queries do seatStore (upsert, get, delete, count, list).
function fakeD1(): FakeD1 {
  const rows: Seat[] = [];
  const k = (s: { reseller_id: string; user_id: string; device_id: string }) =>
    `${s.reseller_id}|${s.user_id}|${s.device_id}`;
  const db = {
    _rows: rows,
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async run() {
          if (sql.includes('INSERT INTO seats')) {
            const [reseller_id, user_id, device_id, first_seen, last_seen] = args as string[];
            const seat: Seat = { reseller_id, user_id, device_id, first_seen, last_seen };
            const i = rows.findIndex((r) => k(r) === k(seat));
            if (i >= 0) rows[i].last_seen = last_seen;
            else rows.push(seat);
          } else if (sql.includes('DELETE FROM seats')) {
            const [reseller_id, user_id, device_id] = args as string[];
            const i = rows.findIndex((r) => k(r) === k({ reseller_id, user_id, device_id }));
            if (i >= 0) rows.splice(i, 1);
          }
          return { success: true };
        },
        async first() {
          if (sql.includes('COUNT(*)')) {
            const [reseller_id, cutoff] = args as string[];
            return { n: rows.filter((r) => r.reseller_id === reseller_id && r.last_seen > cutoff).length };
          }
          const [reseller_id, user_id, device_id] = args as string[];
          return rows.find((r) => k(r) === k({ reseller_id, user_id, device_id })) ?? null;
        },
        async all() {
          const [reseller_id] = args as string[];
          return { results: rows.filter((r) => r.reseller_id === reseller_id) };
        },
      };
      return stmt;
    },
  };
  return db as unknown as FakeD1;
}

async function makeEnv(): Promise<{ env: SeatEnv; kv: FakeKV; db: FakeD1; priv: string }> {
  const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const priv = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  const pub = Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64');
  const kv = fakeKV();
  const db = fakeD1();
  const env: SeatEnv = {
    LICENSES: kv,
    SEATS_DB: db,
    SIGNING_KEY: priv,
    SEAT_PUBLIC_KEY: pub,
    MEGA_WORKER_SECRET: 'mega-secret',
    ADMIN_TOKEN: 'admin-secret',
  };
  return { env, kv, db, priv };
}

const now = new Date('2026-06-20T12:00:00Z');
const RID = 'reseller-1';

function seedReseller(kv: FakeKV, cota: number, status: Reseller['status'] = 'active') {
  const r: Reseller = { id: RID, asaas_subscription_id: 'sub_1', plano_cota: cota, status, kid: 'k' };
  kv._m.set(`reseller:${RID}`, JSON.stringify(r));
}
function seedSeat(db: FakeD1, user: string, device: string, last_seen = now.toISOString()) {
  db._rows.push({ reseller_id: RID, user_id: user, device_id: device, first_seen: last_seen, last_seen });
}
function post(path: string, body: object, token: string) {
  return new Request(`https://w${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}
const u = (path: string) => new URL(`https://w${path}`);

describe('seatRoutes /seat/activate (D1)', () => {
  it('403 without valid auth', async () => {
    const { env } = await makeEnv();
    const r = await handleSeatRoute(post('/seat/activate', { reseller_id: RID, user_id: 'u1', device_id: 'd1' }, 'wrong'), u('/seat/activate'), env, now);
    expect(r?.status).toBe(403);
  });
  it('403 unknown reseller', async () => {
    const { env } = await makeEnv();
    const r = await handleSeatRoute(post('/seat/activate', { reseller_id: 'nope', user_id: 'u1', device_id: 'd1' }, 'mega-secret'), u('/seat/activate'), env, now);
    expect((await r!.json()).status).toBe('unknown_reseller');
  });
  it('403 suspended reseller', async () => {
    const { env, kv } = await makeEnv();
    seedReseller(kv, 10, 'suspended');
    const r = await handleSeatRoute(post('/seat/activate', { reseller_id: RID, user_id: 'u1', device_id: 'd1' }, 'mega-secret'), u('/seat/activate'), env, now);
    expect((await r!.json()).status).toBe('suspended');
  });
  it('400 missing fields', async () => {
    const { env, kv } = await makeEnv();
    seedReseller(kv, 10);
    const r = await handleSeatRoute(post('/seat/activate', { reseller_id: RID }, 'mega-secret'), u('/seat/activate'), env, now);
    expect(r?.status).toBe(400);
  });
  it('new seat under quota → active + token + persisted in D1', async () => {
    const { env, kv, db } = await makeEnv();
    seedReseller(kv, 2);
    const r = await handleSeatRoute(post('/seat/activate', { reseller_id: RID, user_id: 'u1', device_id: 'd1' }, 'mega-secret'), u('/seat/activate'), env, now);
    const body = await r!.json();
    expect(body.status).toBe('active');
    expect(typeof body.token).toBe('string');
    expect(db._rows.some((s) => s.user_id === 'u1' && s.device_id === 'd1')).toBe(true);
  });
  it('new seat over quota → quota_exceeded', async () => {
    const { env, kv, db } = await makeEnv();
    seedReseller(kv, 1);
    seedSeat(db, 'u1', 'd1');
    const r = await handleSeatRoute(post('/seat/activate', { reseller_id: RID, user_id: 'u2', device_id: 'd2' }, 'mega-secret'), u('/seat/activate'), env, now);
    expect((await r!.json()).status).toBe('quota_exceeded');
  });
  it('existing seat at full quota → renews (active)', async () => {
    const { env, kv, db } = await makeEnv();
    seedReseller(kv, 1);
    seedSeat(db, 'u1', 'd1', '2026-06-19T12:00:00Z');
    const r = await handleSeatRoute(post('/seat/activate', { reseller_id: RID, user_id: 'u1', device_id: 'd1' }, 'mega-secret'), u('/seat/activate'), env, now);
    expect((await r!.json()).status).toBe('active');
    expect(db._rows.find((s) => s.user_id === 'u1')!.last_seen).toBe(now.toISOString());
  });
  it('405 on GET', async () => {
    const { env } = await makeEnv();
    const r = await handleSeatRoute(new Request('https://w/seat/activate', { method: 'GET' }), u('/seat/activate'), env, now);
    expect(r?.status).toBe(405);
  });
});

describe('seatRoutes heartbeat / revoke / usage (D1)', () => {
  const hbReq = (token: string) =>
    new Request('https://w/seat/heartbeat', { method: 'POST', headers: { authorization: `Bearer ${token}` } });

  it('heartbeat renews existing (token de sessão válido) → ok', async () => {
    const { env, kv, db, priv } = await makeEnv();
    seedReseller(kv, 5);
    seedSeat(db, 'u1', 'd1', '2026-06-19T00:00:00Z');
    const token = await issueSessionToken(priv, { reseller_id: RID, user_id: 'u1', device_id: 'd1', status: 'active' }, now);
    const r = await handleSeatRoute(hbReq(token), u('/seat/heartbeat'), env, now);
    expect((await r!.json()).status).toBe('ok');
    expect(db._rows.find((s) => s.user_id === 'u1')!.last_seen).toBe(now.toISOString());
  });
  it('heartbeat 404 when no seat', async () => {
    const { env, kv, priv } = await makeEnv();
    seedReseller(kv, 5);
    const token = await issueSessionToken(priv, { reseller_id: RID, user_id: 'ux', device_id: 'dx', status: 'active' }, now);
    const r = await handleSeatRoute(hbReq(token), u('/seat/heartbeat'), env, now);
    expect(r?.status).toBe(404);
  });
  it('heartbeat 401 with invalid token', async () => {
    const { env, kv } = await makeEnv();
    seedReseller(kv, 5);
    const r = await handleSeatRoute(hbReq('garbage'), u('/seat/heartbeat'), env, now);
    expect(r?.status).toBe(401);
  });
  it('heartbeat 403 without token', async () => {
    const { env, kv } = await makeEnv();
    seedReseller(kv, 5);
    const r = await handleSeatRoute(new Request('https://w/seat/heartbeat', { method: 'POST' }), u('/seat/heartbeat'), env, now);
    expect(r?.status).toBe(403);
  });

  it('revoke (admin) deletes seat from D1', async () => {
    const { env, kv, db } = await makeEnv();
    seedReseller(kv, 5);
    seedSeat(db, 'u1', 'd1');
    const r = await handleSeatRoute(post('/seat/revoke', { reseller_id: RID, user_id: 'u1', device_id: 'd1' }, 'admin-secret'), u('/seat/revoke'), env, now);
    expect((await r!.json()).status).toBe('revoked');
    expect(db._rows.some((s) => s.user_id === 'u1')).toBe(false);
  });
  it('revoke 403 with mega secret (needs admin)', async () => {
    const { env, kv } = await makeEnv();
    seedReseller(kv, 5);
    const r = await handleSeatRoute(post('/seat/revoke', { reseller_id: RID, user_id: 'u1', device_id: 'd1' }, 'mega-secret'), u('/seat/revoke'), env, now);
    expect(r?.status).toBe(403);
  });
  it('usage (admin GET) returns cota + ativos (só conta last_seen recente)', async () => {
    const { env, kv, db } = await makeEnv();
    seedReseller(kv, 10);
    seedSeat(db, 'u1', 'd1');
    seedSeat(db, 'u2', 'd2', '2026-06-01T00:00:00Z'); // inativo (>7d)
    const req = new Request(`https://w/reseller/usage?reseller_id=${RID}`, { method: 'GET', headers: { authorization: 'Bearer admin-secret' } });
    const r = await handleSeatRoute(req, u(`/reseller/usage?reseller_id=${RID}`), env, now);
    const body = await r!.json();
    expect(body.cota).toBe(10);
    expect(body.ativos).toBe(1);
    expect(body.seats.length).toBe(2);
  });
  it('returns null for non-seat path', async () => {
    const { env } = await makeEnv();
    const r = await handleSeatRoute(new Request('https://w/other'), u('/other'), env, now);
    expect(r).toBeNull();
  });
});
