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
  } as unknown as KVNamespace & { _m: Map<string, string> };
}

const seed = () =>
  fakeKV({
    'pl:link1': JSON.stringify({ reseller_id: 'rev-a', conexoes: 5, released: false }),
    'reseller:rev-a': JSON.stringify({ id: 'rev-a', asaas_subscription_id: '', plano_cota: 10, status: 'active', kid: 'k' }),
  });

const paid = { event: 'PAYMENT_RECEIVED', payment: { paymentLink: 'link1' } };

describe('handleUpgradePayment', () => {
  it('pagamento confirmado → libera cota (+conexoes) e marca released', async () => {
    const kv = seed();
    const r = await handleUpgradePayment({ LICENSES: kv }, paid);
    expect(r.released).toBe(true);
    expect(r.conexoes).toBe(5);
    expect(JSON.parse((kv as { _m: Map<string, string> })._m.get('reseller:rev-a')!).plano_cota).toBe(15);
    expect(JSON.parse((kv as { _m: Map<string, string> })._m.get('pl:link1')!).released).toBe(true);
  });

  it('segundo pagamento do mesmo link → não soma de novo (idempotente)', async () => {
    const kv = seed();
    await handleUpgradePayment({ LICENSES: kv }, paid);
    const r2 = await handleUpgradePayment({ LICENSES: kv }, paid);
    expect(r2.released).toBe(false);
    expect(r2.reason).toBe('already_released');
    expect(JSON.parse((kv as { _m: Map<string, string> })._m.get('reseller:rev-a')!).plano_cota).toBe(15);
  });

  it('evento que não é de pagamento → ignora', async () => {
    const r = await handleUpgradePayment({ LICENSES: seed() }, { event: 'PAYMENT_CREATED', payment: { paymentLink: 'link1' } });
    expect(r.released).toBe(false);
    expect(r.reason).toBe('not_paid_event');
  });

  it('link desconhecido → ignora', async () => {
    const r = await handleUpgradePayment({ LICENSES: seed() }, { event: 'PAYMENT_RECEIVED', payment: { paymentLink: 'naoexiste' } });
    expect(r.released).toBe(false);
    expect(r.reason).toBe('unknown_link');
  });

  it('sem paymentLink → ignora', async () => {
    const r = await handleUpgradePayment({ LICENSES: seed() }, { event: 'PAYMENT_RECEIVED', payment: {} });
    expect(r.released).toBe(false);
    expect(r.reason).toBe('no_payment_link');
  });
});
