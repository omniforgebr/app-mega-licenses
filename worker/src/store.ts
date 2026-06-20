import type { ClientRecord, Override } from './types';
import { normalizeDomain } from './domain';

const CK = (dominio: string) => 'client:' + dominio;
const SK = (subId: string) => 'subindex:' + subId;

export async function putClient(kv: KVNamespace, rec: ClientRecord): Promise<void> {
  // C4: always store under the normalized domain so the KV key matches the manifest hash input.
  rec.dominio = normalizeDomain(rec.dominio);
  await kv.put(CK(rec.dominio), JSON.stringify(rec));
  await kv.put(SK(rec.asaas_subscription_id), rec.dominio);
}
export function getClientByDomain(kv: KVNamespace, dominio: string): Promise<ClientRecord | null> {
  // C4: normalize before building the key.
  return kv.get(CK(normalizeDomain(dominio)), 'json') as Promise<ClientRecord | null>;
}
export async function getClientBySubscription(kv: KVNamespace, subId: string): Promise<ClientRecord | null> {
  const dominio = await kv.get(SK(subId));
  return dominio ? getClientByDomain(kv, dominio) : null;
}
export async function setOverride(kv: KVNamespace, dominio: string, override: Override): Promise<void> {
  // C4: normalize before lookup so caller may pass mixed-case/protocol prefixed input.
  const rec = await getClientByDomain(kv, dominio);
  if (!rec) throw new Error('client not found: ' + normalizeDomain(dominio));
  rec.override = override;
  await putClient(kv, rec);
}
export async function listClients(kv: KVNamespace): Promise<ClientRecord[]> {
  // I3: cursor loop — handles more than 1 000 keys without silently truncating.
  const out: ClientRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: 'client:', limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const k of page.keys) {
      const v = (await kv.get(k.name, 'json')) as ClientRecord | null;
      if (v) out.push(v);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
