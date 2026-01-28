/**
 * Billing resource – cache invalidation for monthly billing data
 */

import { invalidateCache } from '../cache';

/**
 * Invalidate billing cache.
 * @param billingMonth - Optional YYYY-MM. If provided, invalidates only that month; otherwise invalidates all.
 */
export function invalidateBilling(billingMonth?: string): void {
  if (billingMonth) {
    invalidateCache(`billing:${billingMonth}:*`);
  } else {
    invalidateCache('billing:*');
  }
}
