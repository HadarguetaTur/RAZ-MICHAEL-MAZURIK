/**
 * Subscriptions resource with caching
 */

import { fetchWithCache } from '../fetchWithCache';
import { invalidateCache, buildKey } from '../cache';
import { subscriptionsService } from '../../services/subscriptionsService';
import { Subscription } from '../../types';

const SUBSCRIPTIONS_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Get subscriptions
 */
export async function getSubscriptions(): Promise<Subscription[]> {
  const key = buildKey(['subscriptions', 'all']);

  return fetchWithCache({
    key,
    ttlMs: SUBSCRIPTIONS_TTL,
    fetcher: () => subscriptionsService.listSubscriptions(),
    staleWhileRevalidate: true,
  });
}

/**
 * Invalidate subscriptions cache
 */
export function invalidateSubscriptions(): void {
  invalidateCache('subscriptions:*');
}
