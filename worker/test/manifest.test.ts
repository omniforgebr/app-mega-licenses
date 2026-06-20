import { describe, it, expect } from 'vitest';
import { buildManifest } from '../src/manifest';

describe('buildManifest', () => {
  it('builds a signed-shape manifest with grace + 14d leash', async () => {
    const m = await buildManifest({
      dominio: 'chat.empresa.com.br',
      paidThrough: '2026-07-10',
      override: 'none',
      now: new Date('2026-07-12T12:00:00Z'),
      kid: 'of-license-2026',
    });
    expect(m.v).toBe(1);
    expect(m.key).toHaveLength(64);            // sha256 hex
    expect(m.status).toBe('grace');            // 2 days after paid_through
    expect(m.paid_through).toBe('2026-07-10');
    expect(m.grace_until).toBe('2026-07-15');
    expect(m.issued_at).toBe('2026-07-12T12:00:00.000Z');
    expect(m.expires_at).toBe('2026-07-26T12:00:00.000Z'); // +14 days
    expect(m.sig).toBeUndefined();
  });
});
