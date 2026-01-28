/**
 * React hook for fetching slot inventory with caching
 */

import { useState, useEffect, useCallback } from 'react';
import { getSlotInventory, type SlotInventoryRange } from '../resources/slotInventory';
import { SlotInventory } from '../../types';

export interface UseSlotInventoryReturn {
  data: SlotInventory[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useSlotInventory(
  range: SlotInventoryRange,
  teacherId?: string
): UseSlotInventoryReturn {
  const [data, setData] = useState<SlotInventory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadInventory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const inventory = await getSlotInventory(range, teacherId);
      setData(inventory);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error('[useSlotInventory] Error loading slot inventory:', error);
    } finally {
      setIsLoading(false);
    }
  }, [range.start, range.end, teacherId]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  return {
    data,
    isLoading,
    error,
    refresh: loadInventory,
  };
}
