import { describe, it, expect } from 'vitest';
import { putClient, getClientByDomain, getClientBySubscription, setOverride, listClients } from '../src/store';
import type { ClientRecord } from '../src/types';

function fakeKV() {
  const m = new Map<string, string>();
  return {
    async get(k: string, type?: 'json') { const v = m.get(k); return v == null ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(k: string, v: string) { m.set(k, v); },
    // I3: fakeKV now returns list_complete:true so the cursor loop terminates correctly.
    async list({ prefix }: { prefix: string; limit?: number; cursor?: string }) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: '' };
    },
  } as unknown as KVNamespace;
}

const rec: ClientRecord = { dominio: 'chat.x.com.br', asaas_customer_id: 'cus_1', asaas_subscription_id: 'sub_1', override: 'none' };

describe('store', () => {
  it('puts and reads a client by domain and by subscription', async () => {
    const kv = fakeKV();
    await putClient(kv, rec);
    expect((await getClientByDomain(kv, 'chat.x.com.br'))?.asaas_subscription_id).toBe('sub_1');
    expect((await getClientBySubscription(kv, 'sub_1'))?.dominio).toBe('chat.x.com.br');
  });
  it('lists clients and sets override', async () => {
    const kv = fakeKV();
    await putClient(kv, rec);
    await setOverride(kv, 'chat.x.com.br', 'force_active');
    expect((await getClientByDomain(kv, 'chat.x.com.br'))?.override).toBe('force_active');
    expect(await listClients(kv)).toHaveLength(1);
  });
});
