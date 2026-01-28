/**
 * React hook for fetching weekly slots with caching
 */

import { useState, useEffect, useCallback } from 'react';
import { getWeeklySlots } from '../resources/weeklySlots';
import { WeeklySlot } from '../../types';

export interface UseWeeklySlotsReturn {
  data: WeeklySlot[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useWeeklySlots(teacherId?: string): UseWeeklySlotsReturn {
  const [data, setData] = useState<WeeklySlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadSlots = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const slots = await getWeeklySlots(teacherId);
      setData(slots);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error('[useWeeklySlots] Error loading weekly slots:', error);
    } finally {
      setIsLoading(false);
    }
  }, [teacherId]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  return {
    data,
    isLoading,
    error,
    refresh: loadSlots,
  };
}
