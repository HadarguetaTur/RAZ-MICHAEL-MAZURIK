/**
 * Slot inventory resource with caching
 */

import { fetchWithCache } from '../fetchWithCache';
import { invalidateCache, buildKey } from '../cache';
import { nexusApi } from '../../services/nexusApi';
import { SlotInventory } from '../../types';
import { apiUrl } from '../../config/api';

const SLOT_INVENTORY_TTL = 3 * 60 * 1000; // 3 minutes (dynamic data)

export interface SlotInventoryRange {
  start: string;
  end: string;
}

/**
 * Normalize slot inventory response so UI never gets undefined date/startTime/endTime
 */
function normalizeSlotInventoryList(raw: unknown): SlotInventory[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: any) => {
    if (!item || typeof item !== 'object' || !item.id) return null;
    const date = item.date != null ? String(item.date) : (item.lessonDate != null ? String(item.lessonDate) : '');
    const startTime = item.startTime != null ? String(item.startTime) : '';
    const endTime = item.endTime != null ? String(item.endTime) : '';
    return {
      ...item,
      id: item.id || '',
      date,
      startTime,
      endTime,
      teacherId: item.teacherId ?? '',
      teacherName: item.teacherName ?? '',
      status: item.status ?? 'open',
      students: Array.isArray(item.students) ? item.students : [],
      lessons: Array.isArray(item.lessons) ? item.lessons : [],
    } as SlotInventory;
  }).filter(Boolean) as SlotInventory[];
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
    fetcher: async () => {
      try {
        // Try API server first (production-safe)
        try {
          const apiPath = apiUrl('/api/slot-inventory');
          const url = apiPath.startsWith('http') 
            ? new URL(apiPath)
            : new URL(apiPath, window.location.origin);
          url.searchParams.set('start', start);
          url.searchParams.set('end', end);
          if (teacherId) {
            url.searchParams.set('teacherId', teacherId);
          }
          
          const response = await fetch(url.toString());
          if (response.ok) {
            const data = await response.json();
            return normalizeSlotInventoryList(data);
          }
          const errBody = await response.text();
          console.warn('[getSlotInventory] API server failed', response.status, errBody?.slice(0, 200));
        } catch (err) {
          console.warn('[getSlotInventory] API server unavailable, falling back to direct Airtable:', err);
        }
        
        const fallback = await nexusApi.getSlotInventory(start, end, teacherId);
        return normalizeSlotInventoryList(fallback);
      } catch (err) {
        console.error('[getSlotInventory] Fetcher error:', err);
        return [];
      }
    },
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
