/**
 * System resource with caching
 */

import { fetchWithCache } from '../fetchWithCache';
import { invalidateCache, buildKey } from '../cache';
import { nexusApi } from '../../services/nexusApi';
import { SystemError } from '../../types';

const SYSTEM_ERRORS_TTL = 5 * 60 * 1000; // 5 minutes (mock data, can cache longer)

/**
 * Get system errors
 */
export async function getSystemErrors(): Promise<SystemError[]> {
  const key = buildKey(['system', 'errors']);

  return fetchWithCache({
    key,
    ttlMs: SYSTEM_ERRORS_TTL,
    fetcher: () => nexusApi.getSystemErrors(),
    staleWhileRevalidate: true,
  });
}

/**
 * Invalidate system errors cache
 */
export function invalidateSystemErrors(): void {
  invalidateCache('system:*');
}
