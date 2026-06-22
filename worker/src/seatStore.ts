import type { Seat, Reseller } from './types';

// ───────────── Revendedores (KV — escrita rara, consistência eventual ok) ─────────────

export async function getReseller(kv: KVNamespace, reseller_id: string): Promise<Reseller | null> {
  return (await kv.get(`reseller:${reseller_id}`, 'json')) as Reseller | null;
}

export async function putReseller(kv: KVNamespace, r: Reseller): Promise<void> {
  await kv.put(`reseller:${r.id}`, JSON.stringify(r));
}

export async function listResellers(kv: KVNamespace): Promise<Reseller[]> {
  const out: Reseller[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: "reseller:", cursor, limit: 1000 });
    for (const k of page.keys) {
      const v = (await kv.get(k.name, "json")) as Reseller | null;
      if (v) out.push(v);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

// ───────────── Seats (D1 — FORTEMENTE consistente; a contagem de cota precisa disso) ─────────────

export async function upsertSeat(db: D1Database, seat: Seat): Promise<void> {
  await db
    .prepare(
      `INSERT INTO seats (reseller_id, user_id, device_id, first_seen, last_seen)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(reseller_id, user_id, device_id)
       DO UPDATE SET last_seen = excluded.last_seen`,
    )
    .bind(seat.reseller_id, seat.user_id, seat.device_id, seat.first_seen, seat.last_seen)
    .run();
}

export async function getSeat(
  db: D1Database,
  reseller_id: string,
  user_id: string,
  device_id: string,
): Promise<Seat | null> {
  const row = await db
    .prepare(
      `SELECT reseller_id, user_id, device_id, first_seen, last_seen
       FROM seats WHERE reseller_id = ?1 AND user_id = ?2 AND device_id = ?3`,
    )
    .bind(reseller_id, user_id, device_id)
    .first<Seat>();
  return row ?? null;
}

export async function deleteSeat(
  db: D1Database,
  reseller_id: string,
  user_id: string,
  device_id: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM seats WHERE reseller_id = ?1 AND user_id = ?2 AND device_id = ?3`)
    .bind(reseller_id, user_id, device_id)
    .run();
}

// Contagem de seats ativos (last_seen > cutoff). Strongly consistent → cota confiável.
export async function countActiveSeats(db: D1Database, reseller_id: string, cutoffIso: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM seats WHERE reseller_id = ?1 AND last_seen > ?2`)
    .bind(reseller_id, cutoffIso)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listSeats(db: D1Database, reseller_id: string): Promise<Seat[]> {
  const res = await db
    .prepare(
      `SELECT reseller_id, user_id, device_id, first_seen, last_seen
       FROM seats WHERE reseller_id = ?1`,
    )
    .bind(reseller_id)
    .all<Seat>();
  return res.results ?? [];
}
