/**
 * Billing resource – cache invalidation for monthly billing data
 */

import { invalidateCache, buildKey } from '../cache';
import { fetchWithCache } from '../fetchWithCache';
import { nexusApi } from '../../services/nexusApi';
import { MonthlyBill } from '../../types';
import { ChargesReportKPIs } from '../../services/billingService';

const BILLING_TTL = 10 * 60 * 1000; // 10 minutes
const CACHE_VERSION = 'v4'; // Increment this to force cache clear for all users

/**
 * Get monthly bills with cache
 */
export async function getMonthlyBills(
  month: string,
  options?: { statusFilter?: 'all' | 'draft' | 'sent' | 'paid'; searchQuery?: string }
): Promise<MonthlyBill[]> {
  const key = buildKey(['billing', CACHE_VERSION, month, options?.statusFilter || 'all', options?.searchQuery || '']);
  
  return fetchWithCache({
    key,
    fetcher: () => nexusApi.getMonthlyBills(month, options),
    ttl: BILLING_TTL,
    staleWhileRevalidate: true,
  });
}

/**
 * Get billing KPIs with cache
 */
export async function getBillingKPIs(month: string): Promise<ChargesReportKPIs> {
  const key = buildKey(['billing', CACHE_VERSION, month, 'kpis']);
  
  return fetchWithCache({
    key,
    fetcher: () => nexusApi.getBillingKPIs(month),
    ttl: BILLING_TTL,
    staleWhileRevalidate: true,
  });
}

/**
 * Invalidate billing cache.
 * @param billingMonth - Optional YYYY-MM. If provided, invalidates only that month; otherwise invalidates all.
 */
export function invalidateBilling(billingMonth?: string): void {
  if (billingMonth) {
    invalidateCache(buildKey(['billing', CACHE_VERSION, billingMonth, '*']));
  } else {
    invalidateCache(buildKey(['billing', CACHE_VERSION, '*']));
  }
}
