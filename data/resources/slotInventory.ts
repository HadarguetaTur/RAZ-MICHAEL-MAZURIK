/**
 * Slot inventory resource with caching
 */

import { fetchWithCache } from '../fetchWithCache';
import { invalidateCache, buildKey } from '../cache';
import { nexusApi } from '../../services/nexusApi';
import { SlotInventory } from '../../types';

const SLOT_INVENTORY_TTL = 3 * 60 * 1000; // 3 minutes (dynamic data)

export interface SlotInventoryRange {
  start: string;
  end: string;
}

/**
 * Get slot inventory for a date range
 */
export async function getSlotInventory(
  range: SlotInventoryRange,
  teacherId?: string,
  forceRefresh?: boolean
): Promise<SlotInventory[]> {
  const { start, end } = range;
  // Use week start for cache key (group by week)
  const startDate = new Date(start);
  const weekStart = new Date(startDate);
  weekStart.setDate(startDate.getDate() - startDate.getDay()); // Sunday
  const weekStartIso = weekStart.toISOString().split('T')[0];

  const key = buildKey([
    'slot_inventory',
    weekStartIso,
    teacherId || 'all',
  ]);

  // If forceRefresh is true, invalidate cache first
  if (forceRefresh) {
    invalidateCache(key);
    // Also invalidate all to catch edge cases
    invalidateCache('slot_inventory:*');
  }

  return fetchWithCache({
    key,
    ttlMs: SLOT_INVENTORY_TTL,
    fetcher: () => nexusApi.getSlotInventory(start, end, teacherId),
    staleWhileRevalidate: true,
  });
}

/**
 * Invalidate slot inventory cache
 */
export function invalidateSlotInventory(
  range?: SlotInventoryRange,
  teacherId?: string
): void {
  if (range) {
    const { start } = range;
    const startDate = new Date(start);
    const weekStart = new Date(startDate);
    weekStart.setDate(startDate.getDate() - startDate.getDay());
    const weekStartIso = weekStart.toISOString().split('T')[0];
    
    const key = buildKey([
      'slot_inventory',
      weekStartIso,
      teacherId || 'all',
    ]);
    invalidateCache(key);
  } else {
    // Invalidate all slot inventory
    invalidateCache('slot_inventory:*');
  }
}
