import { getReseller, putReseller } from './seatStore';

export interface UpgradeEnv {
  LICENSES: KVNamespace;
}

// Eventos do Asaas que confirmam pagamento.
const PAID_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);

export interface PaymentWebhook {
  event?: string;
  payment?: { paymentLink?: string; value?: number };
}

interface PaymentLinkOrder {
  reseller_id: string;
  conexoes: number;
  released?: boolean;
}

export interface UpgradeResult {
  released: boolean;
  reseller_id?: string;
  conexoes?: number;
  reason?: string;
}

/**
 * Auto-liberação: quando o cliente paga um link de upgrade, soma as conexões à cota.
 * Idempotente — libera UMA vez por link (pagamentos recorrentes seguintes só renovam,
 * não somam de novo). O mapa `pl:<linkId>` é gravado quando o admin gera o link.
 */
export async function handleUpgradePayment(env: UpgradeEnv, body: PaymentWebhook): Promise<UpgradeResult> {
  if (!body.event || !PAID_EVENTS.has(body.event)) return { released: false, reason: 'not_paid_event' };
  const linkId = body.payment?.paymentLink;
  if (!linkId) return { released: false, reason: 'no_payment_link' };

  const key = `pl:${linkId}`;
  const order = (await env.LICENSES.get(key, 'json')) as PaymentLinkOrder | null;
  if (!order) return { released: false, reason: 'unknown_link' };
  if (order.released) return { released: false, reseller_id: order.reseller_id, reason: 'already_released' };

  const reseller = await getReseller(env.LICENSES, order.reseller_id);
  if (!reseller) return { released: false, reason: 'unknown_reseller' };

  reseller.plano_cota += order.conexoes;
  await putReseller(env.LICENSES, reseller);
  await env.LICENSES.put(key, JSON.stringify({ ...order, released: true }));
  return { released: true, reseller_id: order.reseller_id, conexoes: order.conexoes };
}
