/**
 * Teachers resource with caching
 */

import { fetchWithCache } from '../fetchWithCache';
import { invalidateCache, buildKey } from '../cache';
import { nexusApi } from '../../services/nexusApi';
import { Teacher } from '../../types';

const TEACHERS_TTL = 12 * 60 * 60 * 1000; // 12 hours (relatively static)

/**
 * Get teachers
 */
export async function getTeachers(): Promise<Teacher[]> {
  const key = buildKey(['teachers', 'all']);

  return fetchWithCache({
    key,
    ttlMs: TEACHERS_TTL,
    fetcher: () => nexusApi.getTeachers(),
    staleWhileRevalidate: true,
  });
}

/**
 * Invalidate teachers cache
 */
export function invalidateTeachers(): void {
  invalidateCache('teachers:*');
}
