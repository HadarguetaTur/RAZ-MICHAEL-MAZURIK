/**
 * React hook for fetching lessons with caching
 */

import { useState, useEffect, useCallback } from 'react';
import { getLessons, type LessonsRange } from '../resources/lessons';
import { Lesson } from '../../types';

export interface UseLessonsReturn {
  data: Lesson[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useLessons(
  range: LessonsRange,
  teacherId?: string
): UseLessonsReturn {
  const [data, setData] = useState<Lesson[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadLessons = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const lessons = await getLessons(range, teacherId);
      setData(lessons);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error('[useLessons] Error loading lessons:', error);
    } finally {
      setIsLoading(false);
    }
  }, [range.start, range.end, teacherId]);

  useEffect(() => {
    loadLessons();
  }, [loadLessons]);

  return {
    data,
    isLoading,
    error,
    refresh: loadLessons,
  };
}
