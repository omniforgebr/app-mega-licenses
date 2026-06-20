import { seatKey } from './seats';
import type { Seat, Reseller } from './types';

export async function upsertSeat(kv: KVNamespace, seat: Seat): Promise<void> {
  await kv.put(seatKey(seat.reseller_id, seat.user_id, seat.device_id), JSON.stringify(seat));
}

export async function getSeat(
  kv: KVNamespace,
  reseller_id: string,
  user_id: string,
  device_id: string,
): Promise<Seat | null> {
  return (await kv.get(seatKey(reseller_id, user_id, device_id), 'json')) as Seat | null;
}

export async function deleteSeat(
  kv: KVNamespace,
  reseller_id: string,
  user_id: string,
  device_id: string,
): Promise<void> {
  await kv.delete(seatKey(reseller_id, user_id, device_id));
}

export async function listSeats(kv: KVNamespace, reseller_id: string): Promise<Seat[]> {
  const prefix = `seat:${reseller_id}:`;
  const seats: Seat[] = [];
  let cursor: string | undefined;

  do {
    const result = await kv.list({ prefix, cursor });
    for (const key of result.keys) {
      const seat = (await kv.get(key.name, 'json')) as Seat | null;
      if (seat) {
        seats.push(seat);
      }
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return seats;
}

export async function getReseller(kv: KVNamespace, reseller_id: string): Promise<Reseller | null> {
  return (await kv.get(`reseller:${reseller_id}`, 'json')) as Reseller | null;
}

export async function putReseller(kv: KVNamespace, r: Reseller): Promise<void> {
  await kv.put(`reseller:${r.id}`, JSON.stringify(r));
}
