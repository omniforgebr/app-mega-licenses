import { getReseller, putReseller, listResellers, countActiveSeats } from './seatStore';
import { activeCutoff } from './seats';
import type { Reseller, LicenseStatus } from './types';

export interface AdminEnv {
  LICENSES: KVNamespace;
  SEATS_DB: D1Database;
  ADMIN_TOKEN: string;
  KID: string;
}

const VALID_STATUS: ReadonlySet<string> = new Set(['active', 'grace', 'suspended']);
const ID_RE = /^[a-zA-Z0-9_.-]{1,64}$/;

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.byteLength !== eb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ea.byteLength; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function authed(req: Request, secret: string): boolean {
  const h = req.headers.get('authorization') || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : null;
  return bearer !== null && timingSafeEqual(bearer, secret);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Painel mestre OmniForge — CRUD de revendedores. Retorna null se o path não for
 * de admin de revendedor. Tudo exige ADMIN_TOKEN.
 */
export async function handleResellerAdminRoute(
  req: Request,
  url: URL,
  env: AdminEnv,
  now: Date,
): Promise<Response | null> {
  const path = url.pathname;
  if (path !== '/admin/resellers' && path !== '/admin/reseller' && path !== '/admin/reseller/status') {
    return null;
  }
  if (!authed(req, env.ADMIN_TOKEN)) return jsonResponse({ status: 'forbidden' }, 403);

  try {
    if (path === '/admin/resellers') {
      if (req.method !== 'GET') return jsonResponse({ status: 'method_not_allowed' }, 405);
      const resellers = await listResellers(env.LICENSES);
      const cutoff = activeCutoff(now);
      const list = await Promise.all(
        resellers.map(async (r) => ({
          id: r.id,
          plano_cota: r.plano_cota,
          status: r.status,
          asaas_subscription_id: r.asaas_subscription_id,
          ativos: await countActiveSeats(env.SEATS_DB, r.id, cutoff),
        })),
      );
      return jsonResponse({ resellers: list }, 200);
    }

    if (path === '/admin/reseller') {
      if (req.method !== 'POST') return jsonResponse({ status: 'method_not_allowed' }, 405);
      const body = (await req.json()) as Record<string, unknown>;
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!ID_RE.test(id)) return jsonResponse({ status: 'invalid_id' }, 400);
      const cota = body.plano_cota;
      if (typeof cota !== 'number' || !Number.isInteger(cota) || cota < 0) {
        return jsonResponse({ status: 'invalid_plano_cota' }, 400);
      }
      const existing = await getReseller(env.LICENSES, id);
      let status: LicenseStatus;
      if (body.status !== undefined) {
        if (!VALID_STATUS.has(body.status as string)) return jsonResponse({ status: 'invalid_status' }, 400);
        status = body.status as LicenseStatus;
      } else {
        status = existing?.status ?? 'active'; // upsert sem status → preserva o existente (não reativa suspenso)
      }
      const asaas =
        typeof body.asaas_subscription_id === 'string'
          ? body.asaas_subscription_id
          : existing?.asaas_subscription_id ?? '';
      const rec: Reseller = { id, asaas_subscription_id: asaas, plano_cota: cota, status, kid: env.KID };
      await putReseller(env.LICENSES, rec);
      return jsonResponse({ status: 'ok', reseller: rec }, 200);
    }

    // /admin/reseller/status — override de status
    if (req.method !== 'POST') return jsonResponse({ status: 'method_not_allowed' }, 405);
    const body = (await req.json()) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return jsonResponse({ status: 'invalid_id' }, 400);
    if (!VALID_STATUS.has(body.status as string)) return jsonResponse({ status: 'invalid_status' }, 400);
    const rec = await getReseller(env.LICENSES, id);
    if (!rec) return jsonResponse({ status: 'not_found' }, 404);
    rec.status = body.status as LicenseStatus;
    await putReseller(env.LICENSES, rec);
    return jsonResponse({ status: 'ok' }, 200);
  } catch (e) {
    if (e instanceof SyntaxError) return jsonResponse({ status: 'bad_request' }, 400);
    return jsonResponse({ status: 'internal_error' }, 500);
  }
}
