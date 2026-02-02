import { getCacheEntry, setCache } from './cache';

export interface FetchWithCacheOptions<T> {
  key: string;
  ttlMs: number;
  fetcher: () => Promise<T>;
  staleWhileRevalidate?: boolean;
}

const inFlight = new Map<string, Promise<any>>();
const apiCallTimestamps: number[] = [];

function trackApiCall(): void {
  const now = Date.now();
  apiCallTimestamps.push(now);
  // Keep only last 60 seconds
  while (apiCallTimestamps.length > 0 && apiCallTimestamps[0] < now - 60_000) {
    apiCallTimestamps.shift();
  }
}

export function getApiStats(): { callsPerMinute: number } {
  const now = Date.now();
  while (apiCallTimestamps.length > 0 && apiCallTimestamps[0] < now - 60_000) {
    apiCallTimestamps.shift();
  }
  return { callsPerMinute: apiCallTimestamps.length };
}

async function revalidate<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = (async () => {
    trackApiCall();
    const data = await fetcher();
    setCache(key, data, ttlMs);
    return data;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Fetch data with caching + optional stale-while-revalidate
 */
export async function fetchWithCache<T>(
  options: FetchWithCacheOptions<T>
): Promise<T> {
  const { key, ttlMs, fetcher, staleWhileRevalidate = false } = options;
  const cached = getCacheEntry<T>(key);

  if (cached?.isFresh) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fetchWithCache.ts:freshReturn',message:'Returning FRESH cached data',data:{key,isFresh:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H9'})}).catch(()=>{});
    // #endregion
    return cached.data;
  }

  if (cached && !cached.isFresh && staleWhileRevalidate) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c84d89a2-beed-426a-aa89-c66f0cddbbf2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fetchWithCache.ts:staleReturn',message:'Returning STALE data while revalidating',data:{key,isFresh:false,staleWhileRevalidate:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H9'})}).catch(()=>{});
    // #endregion
    // Fire-and-forget revalidation
    void revalidate(key, ttlMs, fetcher);
    return cached.data;
  }

  return revalidate(key, ttlMs, fetcher);
}
