import { reissueClient, type Env } from './publish';
import { listClients, getClientBySubscription, getClientByDomain, setOverride, putClient } from './store';
import { handleSeatRoute } from './seatRoutes';
import { handleResellerAdminRoute } from './resellerAdminRoutes';
import { reconcileResellers } from './asaasReconcile';
import { handleUpgradePayment } from './upgradeRelease';
import type { Override, ClientRecord } from './types';

// I1: timing-safe token comparison to prevent timing-oracle attacks.
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.byteLength !== eb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ea.byteLength; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

const VALID_OVERRIDES = new Set<Override>(['none', 'force_active', 'force_suspended']);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Rotas de licença por seat (Portal do Revendedor / login do Mega).
    // Retorna null se o path não for de seat → segue o fluxo das rotas abaixo.
    const seatResp = await handleSeatRoute(req, url, env, new Date());
    if (seatResp) return seatResp;

    // Painel mestre OmniForge — gestão de revendedores (/admin/resellers, /admin/reseller[/status]).
    const adminResp = await handleResellerAdminRoute(req, url, env, new Date());
    if (adminResp) return adminResp;

    if (req.method === 'POST' && url.pathname === '/webhook/asaas') {
      // C2: wrap route body; parse errors → 400, other errors → 500.
      try {
        // I1: timing-safe token check.
        if (!timingSafeEqual(req.headers.get('asaas-access-token') ?? '', env.ASAAS_WEBHOOK_TOKEN)) {
          return new Response('forbidden', { status: 403 });
        }
        let body: { event?: string; payment?: { subscription?: string; paymentLink?: string } };
        try {
          body = (await req.json()) as { event?: string; payment?: { subscription?: string; paymentLink?: string } };
        } catch {
          console.error('asaas webhook: malformed JSON body');
          return new Response('bad request', { status: 400 });
        }
        const subId = body.payment?.subscription;
        if (subId) {
          const rec = await getClientBySubscription(env.LICENSES, subId);
          if (rec) await reissueClient(env, rec, new Date());
        }
        // Auto-liberação de upgrade: cliente pagou o link → cota += conexões (idempotente).
        const release = await handleUpgradePayment(env, body);
        if (release.released) console.log(`licença ativada (pagamento): ${release.reseller_id}`);
        return new Response('ok');
      } catch (err) {
        console.error('asaas webhook error:', err);
        return new Response('internal error', { status: 500 });
      }
    }

    if (req.method === 'POST' && url.pathname === '/admin/override') {
      // C2: wrap route body.
      try {
        // I1: timing-safe token check.
        if (!timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${env.ADMIN_TOKEN}`)) {
          return new Response('forbidden', { status: 403 });
        }
        let parsed: { dominio: string; override: Override };
        try {
          parsed = (await req.json()) as { dominio: string; override: Override };
        } catch {
          console.error('admin/override: malformed JSON body');
          return new Response('bad request', { status: 400 });
        }
        const { dominio, override } = parsed;
        // m3: validate override value.
        if (!VALID_OVERRIDES.has(override)) {
          return new Response('bad request: override must be none|force_active|force_suspended', { status: 400 });
        }
        await setOverride(env.LICENSES, dominio, override);
        const rec = await getClientByDomain(env.LICENSES, dominio);
        if (rec) await reissueClient(env, rec, new Date());
        return new Response('ok');
      } catch (err) {
        console.error('admin/override error:', err);
        return new Response('internal error', { status: 500 });
      }
    }

    // Cadastro/atualização de ativação — gestão 100% na Cloudflare (sem VPS).
    if (req.method === 'POST' && url.pathname === '/admin/client') {
      // C2: wrap route body.
      try {
        // I1: timing-safe token check.
        if (!timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${env.ADMIN_TOKEN}`)) {
          return new Response('forbidden', { status: 403 });
        }
        let rec: ClientRecord;
        try {
          rec = (await req.json()) as ClientRecord;
        } catch {
          console.error('admin/client: malformed JSON body');
          return new Response('bad request', { status: 400 });
        }
        // C3: validate required fields before store.
        if (
          typeof rec.dominio !== 'string' || rec.dominio.trim() === '' ||
          typeof rec.asaas_subscription_id !== 'string' || rec.asaas_subscription_id.trim() === '' ||
          typeof rec.asaas_customer_id !== 'string' || rec.asaas_customer_id.trim() === ''
        ) {
          return new Response('bad request: dominio, asaas_subscription_id, asaas_customer_id are required', { status: 400 });
        }
        await putClient(env.LICENSES, rec);
        await reissueClient(env, rec, new Date());
        return new Response('ok');
      } catch (err) {
        console.error('admin/client error:', err);
        return new Response('internal error', { status: 500 });
      }
    }

    return new Response('not found', { status: 404 });
  },

  async scheduled(_e: ScheduledEvent, env: Env): Promise<void> {
    // C1: isolate per-client failures so one bad client doesn't abort the whole cron.
    const now = new Date();
    const errors: string[] = [];
    for (const rec of await listClients(env.LICENSES)) {
      try {
        await reissueClient(env, rec, now);
      } catch (err) {
        errors.push(`${rec.dominio}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Modelo seat/revenda: reconcilia status dos revendedores a partir do Asaas.
    try {
      const rec = await reconcileResellers(env, now);
      if (rec.errors.length) errors.push(...rec.errors);
      console.log(`reconcile revendedores: checked=${rec.checked} changed=${rec.changed}`);
    } catch (err) {
      errors.push(`reconcile: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (errors.length) console.error('cron failures:', errors.join(' | '));
  },
};
