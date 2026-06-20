import { describe, it, expect } from 'vitest';
import { latestPaidThrough } from '../src/asaas';

describe('latestPaidThrough', () => {
  it('returns the latest dueDate among paid payments', () => {
    const payments = [
      { status: 'RECEIVED', dueDate: '2026-06-10', paymentDate: '2026-06-09' },
      { status: 'CONFIRMED', dueDate: '2026-07-10', paymentDate: '2026-07-09' },
      { status: 'OVERDUE', dueDate: '2026-08-10', paymentDate: null },
    ];
    expect(latestPaidThrough(payments)).toBe('2026-07-10');
  });
  it('returns null when nothing is paid', () => {
    expect(latestPaidThrough([{ status: 'PENDING', dueDate: '2026-07-10', paymentDate: null }])).toBeNull();
  });
});
