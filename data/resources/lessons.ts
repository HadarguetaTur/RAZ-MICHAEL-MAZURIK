/**
 * Lessons resource with caching
 */

import { fetchWithCache } from '../fetchWithCache';
import { invalidateCache, buildKey } from '../cache';
import { nexusApi } from '../../services/nexusApi';
import { Lesson } from '../../types';

const LESSONS_TTL = 90 * 1000; // 90 seconds for calendar view

export interface LessonsRange {
  start: string;
  end: string;
}

/**
 * Get lessons for a date range
 */
export async function getLessons(
  range: LessonsRange,
  teacherId?: string
): Promise<Lesson[]> {
  const { start, end } = range;
  const key = buildKey([
    'lessons',
    teacherId || 'all',
    start.split('T')[0], // Use date part only for cache key
    end.split('T')[0],
  ]);

  return fetchWithCache({
    key,
    ttlMs: LESSONS_TTL,
    fetcher: () => nexusApi.getLessons(start, end, teacherId),
    staleWhileRevalidate: true,
  });
}

/**
 * Check for lesson conflicts
 * Note: This is not cached as conflicts need to be checked in real-time
 */
export async function checkLessonConflicts(
  startDatetime: string,
  endDatetime: string,
  studentId?: string,
  teacherId?: string,
  excludeLessonId?: string
): Promise<Lesson[]> {
  // Direct API call without caching - conflicts need to be fresh
  return nexusApi.checkLessonConflicts(
    startDatetime,
    endDatetime,
    studentId,
    teacherId,
    excludeLessonId
  );
}

/**
 * Invalidate lessons cache
 */
export function invalidateLessons(range?: LessonsRange, teacherId?: string): void {
  if (range) {
    const { start, end } = range;
    const key = buildKey([
      'lessons',
      teacherId || 'all',
      start.split('T')[0],
      end.split('T')[0],
    ]);
    invalidateCache(key);
  } else {
    // Invalidate all lessons
    invalidateCache('lessons:*');
  }
}
