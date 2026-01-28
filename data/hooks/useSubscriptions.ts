/**
 * React hook for fetching subscriptions with caching
 */

import { useState, useEffect, useCallback } from 'react';
import { getSubscriptions } from '../resources/subscriptions';
import { Subscription } from '../../types';

export interface UseSubscriptionsReturn {
  data: Subscription[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useSubscriptions(): UseSubscriptionsReturn {
  const [data, setData] = useState<Subscription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadSubscriptions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const subscriptions = await getSubscriptions();
      setData(subscriptions);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error('[useSubscriptions] Error loading subscriptions:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubscriptions();
  }, [loadSubscriptions]);

  return {
    data,
    isLoading,
    error,
    refresh: loadSubscriptions,
  };
}
