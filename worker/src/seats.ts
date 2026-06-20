import type { Seat } from './types';

export const ACTIVE_WINDOW_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function seatKey(reseller_id: string, user_id: string, device_id: string): string {
  return `seat:${reseller_id}:${user_id}:${device_id}`;
}

export function isActive(seat: Seat, now: Date): boolean {
  const lastSeen = Date.parse(seat.last_seen);
  if (Number.isNaN(lastSeen)) {
    return false;
  }
  return now.getTime() - lastSeen <= ACTIVE_WINDOW_DAYS * MS_PER_DAY;
}

export function countActive(seats: Seat[], now: Date): number {
  return seats.filter((seat) => isActive(seat, now)).length;
}

export function withinQuota(activeCount: number, quota: number): boolean {
  return activeCount < quota;
}
