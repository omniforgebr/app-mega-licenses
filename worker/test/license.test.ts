import { describe, it, expect } from 'vitest';
import { computeStatus, graceUntil } from '../src/license';

const GRACE = 5;

describe('computeStatus', () => {
  it('active before/at paid_through', () => {
    expect(computeStatus('2026-07-10', GRACE, new Date('2026-07-05T12:00:00Z'))).toBe('active');
  });
  it('grace within 5 days after paid_through', () => {
    expect(computeStatus('2026-07-10', GRACE, new Date('2026-07-14T12:00:00Z'))).toBe('grace');
  });
  it('suspended after grace window', () => {
    expect(computeStatus('2026-07-10', GRACE, new Date('2026-07-16T12:00:00Z'))).toBe('suspended');
  });
  it('suspended when never paid', () => {
    expect(computeStatus(null, GRACE, new Date('2026-07-16T12:00:00Z'))).toBe('suspended');
  });
  it('override force_active wins', () => {
    expect(computeStatus(null, GRACE, new Date('2026-07-16T12:00:00Z'), 'force_active')).toBe('active');
  });
  it('override force_suspended wins', () => {
    expect(computeStatus('2026-07-10', GRACE, new Date('2026-07-05T12:00:00Z'), 'force_suspended')).toBe('suspended');
  });
});

describe('graceUntil', () => {
  it('adds grace days', () => {
    expect(graceUntil('2026-07-10', GRACE)).toBe('2026-07-15');
  });
});
