import { describe, it, expect } from 'vitest';
import { isActive, countActive, withinQuota, seatKey } from '../src/seats';
import type { Seat } from '../src/types';

const mk = (last_seen: string): Seat => ({
  reseller_id: 'r', user_id: 'u', device_id: 'd', first_seen: last_seen, last_seen,
});

describe('seats', () => {
  const now = new Date('2026-06-20T12:00:00Z');

  it('active within 7 days', () => {
    expect(isActive(mk('2026-06-15T12:00:00Z'), now)).toBe(true);
  });
  it('inactive after 7 days', () => {
    expect(isActive(mk('2026-06-10T11:00:00Z'), now)).toBe(false);
  });
  it('invalid date is inactive', () => {
    expect(isActive(mk('not-a-date'), now)).toBe(false);
  });
  it('countActive counts only active', () => {
    const seats = [mk('2026-06-19T12:00:00Z'), mk('2026-06-01T12:00:00Z'), mk('2026-06-18T12:00:00Z')];
    expect(countActive(seats, now)).toBe(2);
  });
  it('withinQuota: under allows, at limit blocks', () => {
    expect(withinQuota(9, 10)).toBe(true);
    expect(withinQuota(10, 10)).toBe(false);
  });
  it('seatKey format', () => {
    expect(seatKey('r1', 'u2', 'd3')).toBe('seat:r1:u2:d3');
  });
});
