export interface AsaasPayment {
  status: string;
  dueDate: string;
  paymentDate: string | null;
  value?: number;
}

export interface AsaasSubscription {
  status: string; // ACTIVE | EXPIRED | INACTIVE
  value: number;
  cycle: string; // MONTHLY, etc.
  nextDueDate: string | null;
}

const PAID = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

export function latestPaidThrough(payments: AsaasPayment[]): string | null {
  const dates = payments.filter((p) => PAID.has(p.status) && p.dueDate).map((p) => p.dueDate).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

export async function fetchSubscriptionPayments(
  apiKey: string,
  subId: string,
  base = 'https://api.asaas.com/v3',
): Promise<AsaasPayment[]> {
  // I5: Asaas returns payments desc by dueDate; 100 covers years of monthly invoices.
  const r = await fetch(`${base}/payments?subscription=${encodeURIComponent(subId)}&limit=100`, {
    headers: { access_token: apiKey },
  });
  if (!r.ok) throw new Error('asaas payments ' + r.status);
  const j = (await r.json()) as { data?: AsaasPayment[] };
  return j.data ?? [];
}

// Cria (ou seria reutilizado) um cliente no Asaas com os dados empresariais.
export async function createCustomer(
  apiKey: string,
  data: { name: string; cpfCnpj: string; email?: string; phone?: string },
  base = 'https://api.asaas.com/v3',
): Promise<{ id: string }> {
  const r = await fetch(`${base}/customers`, {
    method: 'POST',
    headers: { access_token: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ name: data.name, cpfCnpj: data.cpfCnpj, email: data.email, mobilePhone: data.phone }),
  });
  if (!r.ok) throw new Error('asaas customer ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const j = (await r.json()) as { id?: string };
  if (!j.id) throw new Error('asaas customer sem id');
  return { id: j.id };
}

// Cria uma assinatura mensal amarrada a um cliente. Devolve o id da assinatura.
export async function createSubscription(
  apiKey: string,
  data: { customer: string; value: number; nextDueDate: string; externalReference?: string },
  base = 'https://api.asaas.com/v3',
): Promise<{ id: string }> {
  const r = await fetch(`${base}/subscriptions`, {
    method: 'POST',
    headers: { access_token: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      customer: data.customer,
      billingType: 'UNDEFINED',
      value: data.value,
      nextDueDate: data.nextDueDate,
      cycle: 'MONTHLY',
      externalReference: data.externalReference,
    }),
  });
  if (!r.ok) throw new Error('asaas subscription ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const j = (await r.json()) as { id?: string };
  if (!j.id) throw new Error('asaas subscription sem id');
  return { id: j.id };
}

// Pega o link de pagamento (invoiceUrl) da primeira cobrança de uma assinatura.
export async function subscriptionPaymentUrl(
  apiKey: string,
  subId: string,
  base = 'https://api.asaas.com/v3',
): Promise<string | null> {
  const r = await fetch(`${base}/payments?subscription=${encodeURIComponent(subId)}&limit=1`, {
    headers: { access_token: apiKey },
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: { invoiceUrl?: string }[] };
  return j.data?.[0]?.invoiceUrl ?? null;
}

// Cria um Link de Pagamento Asaas (o admin gera e manda pro cliente; o cliente paga
// sem precisar de cadastro prévio). recurrent=true → assinatura mensal.
export async function createPaymentLink(
  apiKey: string,
  opts: { name: string; value: number; recurrent: boolean; externalReference?: string },
  base = 'https://api.asaas.com/v3',
): Promise<{ id: string; url: string }> {
  const body: Record<string, unknown> = {
    name: opts.name,
    billingType: 'UNDEFINED', // cliente escolhe (PIX/boleto/cartão)
    value: opts.value,
    chargeType: opts.recurrent ? 'RECURRENT' : 'DETACHED',
    dueDateLimitDays: 5,
  };
  if (opts.recurrent) body.subscriptionCycle = 'MONTHLY';
  if (opts.externalReference) body.externalReference = opts.externalReference;
  const r = await fetch(`${base}/paymentLinks`, {
    method: 'POST',
    headers: { access_token: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('asaas paymentLink ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const j = (await r.json()) as { id?: string; url?: string };
  if (!j.url) throw new Error('asaas paymentLink sem url');
  return { id: j.id ?? '', url: j.url };
}

export async function fetchSubscription(
  apiKey: string,
  subId: string,
  base = 'https://api.asaas.com/v3',
): Promise<AsaasSubscription | null> {
  const r = await fetch(`${base}/subscriptions/${encodeURIComponent(subId)}`, {
    headers: { access_token: apiKey },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('asaas subscription ' + r.status);
  const j = (await r.json()) as Partial<AsaasSubscription>;
  return {
    status: j.status ?? 'UNKNOWN',
    value: typeof j.value === 'number' ? j.value : 0,
    cycle: j.cycle ?? '',
    nextDueDate: j.nextDueDate ?? null,
  };
}
