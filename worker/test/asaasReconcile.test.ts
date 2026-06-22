import { describe, it, expect } from 'vitest';
import { computeResellerStatus } from '../src/asaasReconcile';
import type { AsaasPayment } from '../src/asaas';

const now = new Date('2026-06-22T12:00:00Z');
const p = (status: string, dueDate: string): AsaasPayment => ({ status, dueDate }) as AsaasPayment;

describe('computeResellerStatus', () => {
  it('sem pagamentos → active', () => {
    expect(computeResellerStatus([], now)).toBe('active');
  });

  it('pagamentos pagos (sem OVERDUE) → active', () => {
    expect(computeResellerStatus([p('RECEIVED', '2026-06-01'), p('CONFIRMED', '2026-06-15')], now)).toBe('active');
  });

  it('OVERDUE há ~3 dias → grace (dentro da carência de 5)', () => {
    expect(computeResellerStatus([p('OVERDUE', '2026-06-19')], now)).toBe('grace');
  });

  it('OVERDUE há ~12 dias → suspended (além da carência)', () => {
    expect(computeResellerStatus([p('OVERDUE', '2026-06-10')], now)).toBe('suspended');
  });

  it('OVERDUE com dueDate no futuro é ignorado → active', () => {
    expect(computeResellerStatus([p('OVERDUE', '2026-06-25')], now)).toBe('active');
  });

  it('usa o vencimento mais antigo → suspended', () => {
    expect(computeResellerStatus([p('OVERDUE', '2026-06-20'), p('OVERDUE', '2026-06-08')], now)).toBe('suspended');
  });

  it('4 dias vencido ainda é grace; 6 dias já é suspended', () => {
    expect(computeResellerStatus([p('OVERDUE', '2026-06-18')], now)).toBe('grace');
    expect(computeResellerStatus([p('OVERDUE', '2026-06-16')], now)).toBe('suspended');
  });
});
