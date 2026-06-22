import { fetchSubscriptionPayments, type AsaasPayment } from './asaas';
import { listResellers, putReseller } from './seatStore';
import type { LicenseStatus } from './types';

const GRACE_DAYS = 5;
const MS_PER_DAY = 86400000;

export interface ReconcileEnv {
  LICENSES: KVNamespace;
  ASAAS_API_KEY: string;
}

// Determina o status do revendedor com base nas cobranças vencidas (OVERDUE) + carência.
export function computeResellerStatus(payments: AsaasPayment[], now: Date): LicenseStatus {
  const overdueDues = payments
    .filter((p) => p.status === 'OVERDUE' && p.dueDate && new Date(p.dueDate).getTime() < now.getTime())
    .map((p) => p.dueDate as string)
    .sort();

  if (overdueDues.length === 0) {
    return 'active';
  }

  const oldest = new Date(overdueDues[0]).getTime();
  const daysOverdue = (now.getTime() - oldest) / MS_PER_DAY;

  return daysOverdue <= GRACE_DAYS ? 'grace' : 'suspended';
}

// Reconcilia todos os revendedores a partir do Asaas (chamado pelo cron).
export async function reconcileResellers(
  env: ReconcileEnv,
  now: Date,
): Promise<{ checked: number; changed: number; errors: string[] }> {
  const resellers = await listResellers(env.LICENSES);
  let checked = 0;
  let changed = 0;
  const errors: string[] = [];

  for (const r of resellers) {
    if (!r.asaas_subscription_id) {
      continue; // pula quem não tem assinatura atrelada
    }

    checked++;

    try {
      const payments = await fetchSubscriptionPayments(env.ASAAS_API_KEY, r.asaas_subscription_id);
      const newStatus = computeResellerStatus(payments, now);

      if (newStatus !== r.status) {
        r.status = newStatus;
        await putReseller(env.LICENSES, r);
        changed++;
      }
    } catch (e) {
      errors.push(`${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { checked, changed, errors };
}
