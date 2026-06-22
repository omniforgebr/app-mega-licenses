import { withinQuota, activeCutoff } from './seats';
import { getSeat, upsertSeat, deleteSeat, listSeats, countActiveSeats, getReseller } from './seatStore';
import { issueSessionToken, verifySessionToken } from './sessionToken';
import type { Seat } from './types';

export interface SeatEnv {
  LICENSES: KVNamespace;      // revendedores (reseller:<id>)
  SEATS_DB: D1Database;       // seats (contagem fortemente consistente)
  SIGNING_KEY: string;        // privada pkcs8 base64 (assina o token de sessão)
  SEAT_PUBLIC_KEY: string;    // pública raw base64 (verifica o token no heartbeat)
  MEGA_WORKER_SECRET: string; // login do Mega -> /seat/activate
  ADMIN_TOKEN: string;        // portal -> /seat/revoke, /reseller/usage
}

const TOKEN_TTL = 172800; // 48h — deve casar com o default de issueSessionToken

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.byteLength !== eb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ea.byteLength; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function getBearer(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function authed(req: Request, secret: string): boolean {
  const bearer = getBearer(req);
  return bearer !== null && timingSafeEqual(bearer, secret);
}

interface SeatIds {
  reseller_id: string;
  user_id: string;
  device_id: string;
}

function readSeatIds(body: unknown): SeatIds | null {
  if (typeof body !== 'object' || body === null) return null;
  const r = body as Record<string, unknown>;
  const ok = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
  if (!ok(r.reseller_id) || !ok(r.user_id) || !ok(r.device_id)) return null;
  return { reseller_id: r.reseller_id, user_id: r.user_id, device_id: r.device_id };
}

function errResp(e: unknown): Response {
  if (e instanceof SyntaxError) return jsonResponse({ status: 'bad_request' }, 400);
  return jsonResponse({ status: 'internal_error' }, 500);
}

/**
 * Handler das rotas de licença por seat. Retorna null se o path não for de seat
 * (pro index seguir o fluxo). Enforcement de cota: seat existente RENOVA (não
 * conta cota de novo); seat NOVO só entra se countActive < plano_cota.
 */
export async function handleSeatRoute(
  req: Request,
  url: URL,
  env: SeatEnv,
  now: Date,
): Promise<Response | null> {
  const path = url.pathname;

  if (path === '/seat/activate') {
    if (req.method !== 'POST') return jsonResponse({ status: 'method_not_allowed' }, 405);
    try {
      // O app whitelabel (gerado pela fábrica) chama direto: identidade = reseller_id do build
      // + install_id + user_id. Sem segredo de servidor (não faz sentido embutir no APK).
      const ids = readSeatIds(await req.json());
      if (!ids) return jsonResponse({ status: 'bad_request' }, 400);

      const reseller = await getReseller(env.LICENSES, ids.reseller_id);
      if (!reseller) return jsonResponse({ status: 'unknown_reseller' }, 403);
      if (reseller.status === 'suspended') return jsonResponse({ status: 'suspended' }, 403);

      const existing = await getSeat(env.SEATS_DB, ids.reseller_id, ids.user_id, ids.device_id);
      let seat: Seat;
      if (existing) {
        seat = { ...existing, last_seen: now.toISOString() }; // renovação — não conta cota
      } else {
        const ativos = await countActiveSeats(env.SEATS_DB, ids.reseller_id, activeCutoff(now));
        // plano 'cortesia' (free/personalizado) = cota ilimitada: nunca estoura.
        if (reseller.plano !== 'cortesia' && !withinQuota(ativos, reseller.plano_cota)) {
          return jsonResponse({ status: 'quota_exceeded' }, 403);
        }
        seat = { ...ids, first_seen: now.toISOString(), last_seen: now.toISOString() };
      }
      await upsertSeat(env.SEATS_DB, seat);
      const token = await issueSessionToken(env.SIGNING_KEY, { ...ids, status: reseller.status }, now, TOKEN_TTL);
      return jsonResponse({ status: 'active', token, exp_in: TOKEN_TTL }, 200);
    } catch (e) {
      return errResp(e);
    }
  }

  if (path === '/seat/heartbeat') {
    if (req.method !== 'POST') return jsonResponse({ status: 'method_not_allowed' }, 405);
    try {
      // O app se autentica com o PRÓPRIO token de sessão (não tem o MEGA_WORKER_SECRET).
      // O token é verificado com a chave pública e os IDs vêm dos claims assinados —
      // ninguém renova o seat de outro device.
      const bearer = getBearer(req);
      if (!bearer) return jsonResponse({ status: 'forbidden' }, 403);
      const claims = await verifySessionToken(bearer, env.SEAT_PUBLIC_KEY, now);
      if (!claims) return jsonResponse({ status: 'invalid_token' }, 401);

      const reseller = await getReseller(env.LICENSES, claims.reseller_id);
      if (!reseller || reseller.status === 'suspended') return jsonResponse({ status: 'suspended' }, 403);

      const existing = await getSeat(env.SEATS_DB, claims.reseller_id, claims.user_id, claims.device_id);
      if (!existing) return jsonResponse({ status: 'no_seat' }, 404);
      await upsertSeat(env.SEATS_DB, { ...existing, last_seen: now.toISOString() });
      return jsonResponse({ status: 'ok' }, 200);
    } catch (e) {
      return errResp(e);
    }
  }

  if (path === '/seat/revoke') {
    if (req.method !== 'POST') return jsonResponse({ status: 'method_not_allowed' }, 405);
    try {
      if (!authed(req, env.ADMIN_TOKEN)) return jsonResponse({ status: 'forbidden' }, 403);
      const ids = readSeatIds(await req.json());
      if (!ids) return jsonResponse({ status: 'bad_request' }, 400);
      await deleteSeat(env.SEATS_DB, ids.reseller_id, ids.user_id, ids.device_id);
      return jsonResponse({ status: 'revoked' }, 200);
    } catch (e) {
      return errResp(e);
    }
  }

  if (path === '/reseller/usage') {
    if (req.method !== 'GET') return jsonResponse({ status: 'method_not_allowed' }, 405);
    try {
      if (!authed(req, env.ADMIN_TOKEN)) return jsonResponse({ status: 'forbidden' }, 403);
      const reseller_id = url.searchParams.get('reseller_id');
      if (!reseller_id) return jsonResponse({ status: 'bad_request' }, 400);
      const reseller = await getReseller(env.LICENSES, reseller_id);
      if (!reseller) return jsonResponse({ status: 'not_found' }, 404);
      const seats = await listSeats(env.SEATS_DB, reseller_id);
      const ativos = await countActiveSeats(env.SEATS_DB, reseller_id, activeCutoff(now));
      return jsonResponse(
        {
          cota: reseller.plano_cota,
          ativos,
          seats: seats.map((s) => ({ user_id: s.user_id, device_id: s.device_id, last_seen: s.last_seen })),
        },
        200,
      );
    } catch {
      return jsonResponse({ status: 'internal_error' }, 500);
    }
  }

  return null;
}
