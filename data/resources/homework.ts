/**
 * Homework resource with caching
 */

import { fetchWithCache } from '../fetchWithCache';
import { invalidateCache, buildKey } from '../cache';
import { nexusApi } from '../../services/nexusApi';
import { HomeworkLibraryItem, HomeworkAssignment } from '../../types';

const HOMEWORK_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Get homework library
 */
export async function getHomeworkLibrary(): Promise<HomeworkLibraryItem[]> {
  const key = buildKey(['homework', 'library']);

  return fetchWithCache({
    key,
    ttlMs: HOMEWORK_TTL,
    fetcher: () => nexusApi.getHomeworkLibrary(),
    staleWhileRevalidate: true,
  });
}

/**
 * Get homework assignments
 */
export async function getHomeworkAssignments(): Promise<HomeworkAssignment[]> {
  const key = buildKey(['homework', 'assignments']);

  return fetchWithCache({
    key,
    ttlMs: HOMEWORK_TTL,
    fetcher: () => nexusApi.getHomeworkAssignments(),
    staleWhileRevalidate: true,
  });
}

/**
 * Invalidate homework cache
 */
export function invalidateHomework(): void {
  invalidateCache('homework:*');
}
