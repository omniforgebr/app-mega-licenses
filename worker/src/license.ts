import type { LicenseStatus, Override } from './types';

const DAY = 86_400_000;

export function computeStatus(
  paidThrough: string | null,
  graceDays: number,
  now: Date,
  override: Override = 'none',
): LicenseStatus {
  if (override === 'force_active') return 'active';
  if (override === 'force_suspended') return 'suspended';
  if (!paidThrough) return 'suspended';
  const paid = new Date(paidThrough + 'T23:59:59Z');
  const graceEnd = new Date(paid.getTime() + graceDays * DAY);
  if (now <= paid) return 'active';
  if (now <= graceEnd) return 'grace';
  return 'suspended';
}

export function graceUntil(paidThrough: string, graceDays: number): string {
  const g = new Date(new Date(paidThrough + 'T00:00:00Z').getTime() + graceDays * DAY);
  return g.toISOString().slice(0, 10);
}
