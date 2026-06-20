import { sha256Hex } from './hash';
import { normalizeDomain } from './domain';
import { computeStatus, graceUntil } from './license';
import type { Manifest, Override } from './types';

export const GRACE_DAYS = 5;
export const LEASH_DAYS = 14;
const DAY = 86_400_000;

export async function buildManifest(opts: {
  dominio: string;
  paidThrough: string | null;
  override: Override;
  now: Date;
  kid: string;
}): Promise<Manifest> {
  // Hash the NORMALIZED domain — the app computes its key the same way,
  // so both must agree on the canonical form (Task 3).
  const key = await sha256Hex(normalizeDomain(opts.dominio));
  const status = computeStatus(opts.paidThrough, GRACE_DAYS, opts.now, opts.override);
  // I2: use sentinel '1970-01-01' when there is no paid record so the manifest
  // is unambiguously expired and the app never mistakes it for "paid today".
  const paid_through = opts.paidThrough ?? '1970-01-01';
  const grace_until = opts.paidThrough ? graceUntil(opts.paidThrough, GRACE_DAYS) : '1970-01-01';
  return {
    v: 1,
    key,
    status,
    paid_through,
    grace_until,
    issued_at: opts.now.toISOString(),
    expires_at: new Date(opts.now.getTime() + LEASH_DAYS * DAY).toISOString(),
    kid: opts.kid,
  };
}
