/**
 * React hook for fetching teachers with caching
 */

import { useState, useEffect, useCallback } from 'react';
import { getTeachers } from '../resources/teachers';
import { Teacher } from '../../types';

export interface UseTeachersReturn {
  data: Teacher[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useTeachers(): UseTeachersReturn {
  const [data, setData] = useState<Teacher[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadTeachers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const teachers = await getTeachers();
      setData(teachers);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error('[useTeachers] Error loading teachers:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeachers();
  }, [loadTeachers]);

  return {
    data,
    isLoading,
    error,
    refresh: loadTeachers,
  };
}
