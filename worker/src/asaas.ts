export interface AsaasPayment {
  status: string;
  dueDate: string;
  paymentDate: string | null;
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
