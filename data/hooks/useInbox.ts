/**
 * React hook for Admin Inbox (server-only data).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getInboxItems,
  closeInboxItem as apiCloseInboxItem,
  snoozeInboxItem as apiSnoozeInboxItem,
  updateInboxItem as apiUpdateInboxItem,
  type AdminInboxItem,
  type GetInboxParams,
  type GetInboxResult,
} from '../resources/inbox';

export interface UseInboxParams extends GetInboxParams {}

export interface UseInboxReturn {
  items: AdminInboxItem[];
  nextOffset?: string;
  countsByCategory: Record<string, number>;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  close: (recordId: string) => Promise<void>;
  snooze: (recordId: string, until: string) => Promise<void>;
  update: (
    recordId: string,
    patch: Partial<Pick<AdminInboxItem, 'status' | 'title' | 'details' | 'priority' | 'due_at'>>
  ) => Promise<void>;
}

const CATEGORIES = ['ביטולים', 'חיובים', 'נוכחות', 'שגיאות', 'שיבוצים/וויטליסט', 'כללי'] as const;

function groupByCategory(items: AdminInboxItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of CATEGORIES) counts[c] = 0;
  for (const i of items) {
    const cat = i.category || 'כללי';
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  return counts;
}

export function useInbox(params: UseInboxParams = {}): UseInboxReturn {
  const [items, setItems] = useState<AdminInboxItem[]>([]);
  const [nextOffset, setNextOffset] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getInboxItems({
        ...params,
        pageSize: params.pageSize ?? 200,
        status: params.status ?? 'openOnly',
        includeSnoozed: params.includeSnoozed ?? false,
      });
      setItems(result.items ?? []);
      setNextOffset(result.nextOffset);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setItems([]);
      setNextOffset(undefined);
      if (import.meta.env?.DEV) console.error('[useInbox]', e);
    } finally {
      setIsLoading(false);
    }
  }, [
    params.category,
    params.status,
    params.includeSnoozed,
    params.search,
    params.pageSize,
    params.offset,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const close = useCallback(
    async (recordId: string) => {
      try {
        await apiCloseInboxItem(recordId);
        setItems((prev) => prev.filter((i) => i.id !== recordId));
      } catch (err) {
        if (import.meta.env?.DEV) console.error('[useInbox] close', err);
        throw err;
      }
    },
    []
  );

  const snooze = useCallback(
    async (recordId: string, until: string) => {
      try {
        await apiSnoozeInboxItem(recordId, until);
        setItems((prev) => prev.filter((i) => i.id !== recordId));
      } catch (err) {
        if (import.meta.env?.DEV) console.error('[useInbox] snooze', err);
        throw err;
      }
    },
    []
  );

  const update = useCallback(
    async (
      recordId: string,
      patch: Partial<Pick<AdminInboxItem, 'status' | 'title' | 'details' | 'priority' | 'due_at'>>
    ) => {
      try {
        const updated = await apiUpdateInboxItem(recordId, patch);
        setItems((prev) => prev.map((i) => (i.id === recordId ? { ...i, ...updated } : i)));
      } catch (err) {
        if (import.meta.env?.DEV) console.error('[useInbox] update', err);
        throw err;
      }
    },
    []
  );

  const countsByCategory = groupByCategory(items);

  return {
    items,
    nextOffset,
    countsByCategory,
    isLoading,
    error,
    refresh: load,
    close,
    snooze,
    update,
  };
}
