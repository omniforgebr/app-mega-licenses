import { describe, it, expect } from 'vitest';
import { handleUpgradePayment } from '../src/upgradeRelease';

function fakeKV(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
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
  } as unknown as KVNamespace & { _m: Map<string, string> };
}

const seed = (status = 'grace') =>
  fakeKV({
    'reseller:rev-a': JSON.stringify({ id: 'rev-a', asaas_subscription_id: 'sub-1', plano_cota: 10, status, kid: 'k' }),
  });

const paid = { event: 'PAYMENT_RECEIVED', payment: { subscription: 'sub-1' } };

describe('handleUpgradePayment (assinatura → active)', () => {
  it('pagamento confirmado → ativa a licença', async () => {
    const kv = seed('grace');
    const r = await handleUpgradePayment({ LICENSES: kv }, paid);
    expect(r.released).toBe(true);
    expect(r.reseller_id).toBe('rev-a');
    expect(JSON.parse((kv as { _m: Map<string, string> })._m.get('reseller:rev-a')!).status).toBe('active');
  });

  it('já ativo → não faz nada (idempotente)', async () => {
    const kv = seed('active');
    const r = await handleUpgradePayment({ LICENSES: kv }, paid);
    expect(r.released).toBe(false);
    expect(r.reason).toBe('already_active');
  });

  it('evento que não é de pagamento → ignora', async () => {
    const r = await handleUpgradePayment({ LICENSES: seed() }, { event: 'PAYMENT_CREATED', payment: { subscription: 'sub-1' } });
    expect(r.released).toBe(false);
    expect(r.reason).toBe('not_paid_event');
  });

  it('sem subscription → ignora', async () => {
    const r = await handleUpgradePayment({ LICENSES: seed() }, { event: 'PAYMENT_RECEIVED', payment: {} });
    expect(r.released).toBe(false);
    expect(r.reason).toBe('no_subscription');
  });

  it('assinatura desconhecida → ignora', async () => {
    const r = await handleUpgradePayment({ LICENSES: seed() }, { event: 'PAYMENT_RECEIVED', payment: { subscription: 'sub-naoexiste' } });
    expect(r.released).toBe(false);
    expect(r.reason).toBe('unknown_subscription');
  });
});
