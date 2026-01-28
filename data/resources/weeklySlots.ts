/**
 * Weekly slots resource with caching
 */

import { fetchWithCache } from '../fetchWithCache';
import { invalidateCache, buildKey } from '../cache';
import { nexusApi } from '../../services/nexusApi';
import { WeeklySlot } from '../../types';

const WEEKLY_SLOTS_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Get weekly slots
 */
export async function getWeeklySlots(teacherId?: string): Promise<WeeklySlot[]> {
  const key = buildKey(['weekly_slot', teacherId || 'all']);

  return fetchWithCache({
    key,
    ttlMs: WEEKLY_SLOTS_TTL,
    fetcher: () => nexusApi.getWeeklySlots(),
    staleWhileRevalidate: true,
  });
}

/**
 * Invalidate weekly slots cache
 */
export function invalidateWeeklySlots(teacherId?: string): void {
  if (teacherId) {
    const key = buildKey(['weekly_slot', teacherId]);
    invalidateCache(key);
  } else {
    // Invalidate all weekly slots
    invalidateCache('weekly_slot:*');
  }
}
