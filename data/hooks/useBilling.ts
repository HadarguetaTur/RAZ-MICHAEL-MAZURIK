/**
 * React hook for fetching billing data with caching
 */

import { useState, useEffect, useCallback } from 'react';
import { getMonthlyBills, getBillingKPIs } from '../resources/billing';
import { MonthlyBill } from '../../types';
import { ChargesReportKPIs } from '../../services/billingService';

export interface UseBillingReturn {
  bills: MonthlyBill[];
  kpis: ChargesReportKPIs | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useBilling(
  month: string,
  options?: { statusFilter?: 'all' | 'draft' | 'sent' | 'paid'; searchQuery?: string }
): UseBillingReturn {
  const [bills, setBills] = useState<MonthlyBill[]>([]);
  const [kpis, setKpis] = useState<ChargesReportKPIs | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [billsData, kpisData] = await Promise.all([
        getMonthlyBills(month, options),
        getBillingKPIs(month),
      ]);
      setBills(billsData);
      setKpis(kpisData);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error('[useBilling] Error loading billing data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [month, options?.statusFilter, options?.searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return {
    bills,
    kpis,
    isLoading,
    error,
    refresh: loadData,
  };
}
