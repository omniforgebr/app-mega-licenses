import { getResellerBySubscription, putReseller } from './seatStore';

export interface UpgradeEnv {
  LICENSES: KVNamespace;
}

// Eventos do Asaas que confirmam pagamento.
const PAID_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);

export interface PaymentWebhook {
  event?: string;
  payment?: { subscription?: string; value?: number };
}

export interface UpgradeResult {
  released: boolean;
  reseller_id?: string;
  reason?: string;
}

/**
 * Auto-liberação: quando o cliente paga a assinatura (Asaas confirma), ativa a licença
 * (status → active). A cota é definida pelo admin no cadastro; o pagamento só libera o
 * acesso. Idempotente (se já está active, não faz nada). A reconciliação trata o inverso
 * (vencido → grace/suspended).
 */
export async function handleUpgradePayment(env: UpgradeEnv, body: PaymentWebhook): Promise<UpgradeResult> {
  if (!body.event || !PAID_EVENTS.has(body.event)) return { released: false, reason: 'not_paid_event' };
  const subId = body.payment?.subscription;
  if (!subId) return { released: false, reason: 'no_subscription' };

  const reseller = await getResellerBySubscription(env.LICENSES, subId);
  if (!reseller) return { released: false, reason: 'unknown_subscription' };
  if (reseller.status === 'active') return { released: false, reseller_id: reseller.id, reason: 'already_active' };

  reseller.status = 'active';
  await putReseller(env.LICENSES, reseller);
  return { released: true, reseller_id: reseller.id };
}
