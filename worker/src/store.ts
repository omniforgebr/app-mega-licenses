import type { ClientRecord, Override } from './types';

const CK = (dominio: string) => 'client:' + dominio;
const SK = (subId: string) => 'subindex:' + subId;

export async function putClient(kv: KVNamespace, rec: ClientRecord): Promise<void> {
  await kv.put(CK(rec.dominio), JSON.stringify(rec));
  await kv.put(SK(rec.asaas_subscription_id), rec.dominio);
}
export function getClientByDomain(kv: KVNamespace, dominio: string): Promise<ClientRecord | null> {
  return kv.get(CK(dominio), 'json') as Promise<ClientRecord | null>;
}
export async function getClientBySubscription(kv: KVNamespace, subId: string): Promise<ClientRecord | null> {
  const dominio = await kv.get(SK(subId));
  return dominio ? getClientByDomain(kv, dominio) : null;
}
export async function setOverride(kv: KVNamespace, dominio: string, override: Override): Promise<void> {
  const rec = await getClientByDomain(kv, dominio);
  if (!rec) throw new Error('client not found: ' + dominio);
  rec.override = override;
  await putClient(kv, rec);
}
export async function listClients(kv: KVNamespace): Promise<ClientRecord[]> {
  const { keys } = await kv.list({ prefix: 'client:' });
  const out: ClientRecord[] = [];
  for (const k of keys) {
    const v = (await kv.get(k.name, 'json')) as ClientRecord | null;
    if (v) out.push(v);
  }
  return out;
}
