import { getReseller, putReseller, listResellers, countActiveSeats } from './seatStore';
import { activeCutoff } from './seats';
import { fetchSubscription, fetchSubscriptionPayments } from './asaas';
import type { Reseller, LicenseStatus } from './types';

export interface AdminEnv {
  LICENSES: KVNamespace;
  SEATS_DB: D1Database;
  ADMIN_TOKEN: string;
  KID: string;
  ASAAS_API_KEY: string;
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
  if (
    path !== '/admin/resellers' &&
    path !== '/admin/reseller' &&
    path !== '/admin/reseller/status' &&
    path !== '/admin/asaas'
  ) {
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

    if (path === '/admin/asaas') {
      // Painel financeiro de um cliente: resumo da assinatura Asaas (status, valor, vencimento, último pagamento).
      if (req.method !== 'GET') return jsonResponse({ status: 'method_not_allowed' }, 405);
      const rid = (url.searchParams.get('reseller_id') || '').trim();
      const reseller = await getReseller(env.LICENSES, rid);
      if (!reseller) return jsonResponse({ status: 'not_found' }, 404);
      if (!reseller.asaas_subscription_id) {
        return jsonResponse({ has_subscription: false }, 200);
      }
      const subId = reseller.asaas_subscription_id;
      const [sub, payments] = await Promise.all([
        fetchSubscription(env.ASAAS_API_KEY, subId),
        fetchSubscriptionPayments(env.ASAAS_API_KEY, subId),
      ]);
      const sorted = [...payments].filter((p) => p.dueDate).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
      const last = sorted[0] || null;
      const overdue = payments.filter((p) => p.status === 'OVERDUE').length;
      return jsonResponse(
        {
          has_subscription: true,
          subscription_id: subId,
          subscription_status: sub?.status ?? 'UNKNOWN',
          value: sub?.value ?? null,
          cycle: sub?.cycle ?? '',
          next_due: sub?.nextDueDate ?? null,
          overdue_count: overdue,
          last_payment: last ? { status: last.status, due_date: last.dueDate, value: last.value ?? null } : null,
        },
        200,
      );
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
