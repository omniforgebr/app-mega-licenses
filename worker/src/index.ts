import { reissueClient, type Env } from './publish';
import { listClients, getClientBySubscription, getClientByDomain, setOverride, putClient } from './store';
import type { Override, ClientRecord } from './types';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname === '/webhook/asaas') {
      if (req.headers.get('asaas-access-token') !== env.ASAAS_WEBHOOK_TOKEN) return new Response('forbidden', { status: 403 });
      const body = (await req.json()) as { payment?: { subscription?: string } };
      const subId = body.payment?.subscription;
      if (subId) {
        const rec = await getClientBySubscription(env.LICENSES, subId);
        if (rec) await reissueClient(env, rec, new Date());
      }
      return new Response('ok');
    }

    if (req.method === 'POST' && url.pathname === '/admin/override') {
      if (req.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return new Response('forbidden', { status: 403 });
      const { dominio, override } = (await req.json()) as { dominio: string; override: Override };
      await setOverride(env.LICENSES, dominio, override);
      const rec = await getClientByDomain(env.LICENSES, dominio);
      if (rec) await reissueClient(env, rec, new Date());
      return new Response('ok');
    }

    // Cadastro/atualização de ativação — gestão 100% na Cloudflare (sem VPS).
    if (req.method === 'POST' && url.pathname === '/admin/client') {
      if (req.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return new Response('forbidden', { status: 403 });
      const rec = (await req.json()) as ClientRecord;
      await putClient(env.LICENSES, rec);
      await reissueClient(env, rec, new Date());
      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  },

  async scheduled(_e: ScheduledEvent, env: Env): Promise<void> {
    const now = new Date();
    for (const rec of await listClients(env.LICENSES)) {
      await reissueClient(env, rec, now);
    }
  },
};
