/**
 * Dual-layer cache: In-memory (fast) + localStorage (persistent across refreshes)
 */

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  savedAt: number;
  etag?: string;
  meta?: Record<string, any>;
}

const MEMORY_CACHE = new Map<string, CacheEntry<any>>();
const STORAGE_PREFIX = 'app_cache_';
const MAX_STORAGE_SIZE = 5 * 1024 * 1024; // 5MB max localStorage size

/**
 * Build a cache key from parts
 */
export function buildKey(parts: string[]): string {
  return parts.filter(Boolean).join(':');
}

/**
 * Get cache entry (checks memory first, then localStorage)
 */
export function getCache<T>(key: string): { data: T; isFresh: boolean } | null {
  const now = Date.now();

  // Check memory cache first (fastest)
  const memoryEntry = MEMORY_CACHE.get(key);
  if (memoryEntry) {
    if (memoryEntry.expiresAt > now) {
      return { data: memoryEntry.data, isFresh: true };
    } else {
      // Expired, remove from memory
      MEMORY_CACHE.delete(key);
    }
  }

  // Check localStorage
  try {
    const storageKey = STORAGE_PREFIX + key;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const entry: CacheEntry<T> = JSON.parse(stored);
      if (entry.expiresAt > now) {
        // Restore to memory cache
        MEMORY_CACHE.set(key, entry);
        return { data: entry.data, isFresh: true };
      } else {
        // Expired, remove from storage
        localStorage.removeItem(storageKey);
      }
    }
  } catch (err) {
    // localStorage might be disabled or full
    console.warn('[Cache] Failed to read from localStorage:', err);
  }

  return null;
}

/**
 * Get cache entry including stale data
 */
export function getCacheEntry<T>(key: string): { data: T; isFresh: boolean } | null {
  const now = Date.now();

  // Check memory cache first
  const memoryEntry = MEMORY_CACHE.get(key);
  if (memoryEntry) {
    return { data: memoryEntry.data, isFresh: memoryEntry.expiresAt > now };
  }

  // Check localStorage (do not delete stale here)
  try {
    const storageKey = STORAGE_PREFIX + key;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const entry: CacheEntry<T> = JSON.parse(stored);
      const isFresh = entry.expiresAt > now;
      // Restore to memory cache for faster access
      MEMORY_CACHE.set(key, entry);
      return { data: entry.data, isFresh };
    }
  } catch (err) {
    console.warn('[Cache] Failed to read from localStorage:', err);
  }

  return null;
}

/**
 * Set cache entry (saves to both memory and localStorage)
 */
export function setCache<T>(
  key: string,
  data: T,
  ttlMs: number,
  meta?: Record<string, any>
): void {
  const now = Date.now();
  const entry: CacheEntry<T> = {
    data,
    expiresAt: now + ttlMs,
    savedAt: now,
    meta,
  };

  // Save to memory cache
  MEMORY_CACHE.set(key, entry);

  // Save to localStorage (with size check)
  try {
    const storageKey = STORAGE_PREFIX + key;
    const serialized = JSON.stringify(entry);
    
    // Check if adding this would exceed max size
    const currentSize = getStorageSize();
    if (currentSize + serialized.length > MAX_STORAGE_SIZE) {
      // Clear oldest entries (simple FIFO)
      clearOldestEntries(serialized.length);
    }

    localStorage.setItem(storageKey, serialized);
  } catch (err) {
    // localStorage might be full or disabled
    console.warn('[Cache] Failed to write to localStorage:', err);
    // Try to clear some space
    try {
      clearOldestEntries(0);
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
    } catch (retryErr) {
      // Give up on localStorage, memory cache still works
      console.warn('[Cache] localStorage unavailable, using memory cache only');
    }
  }
}

/**
 * Invalidate cache entries by prefix or exact keys
 */
export function invalidateCache(prefixOrKeys: string | string[]): void {
  const keys = Array.isArray(prefixOrKeys) ? prefixOrKeys : [prefixOrKeys];

  keys.forEach(keyOrPrefix => {
    // Invalidate from memory cache
    if (keyOrPrefix.includes('*')) {
      // Pattern match (e.g., "lessons:*")
      const prefix = keyOrPrefix.replace('*', '');
      for (const [cacheKey] of MEMORY_CACHE.entries()) {
        if (cacheKey.startsWith(prefix)) {
          MEMORY_CACHE.delete(cacheKey);
        }
      }
    } else {
      // Exact key
      MEMORY_CACHE.delete(keyOrPrefix);
    }

    // Invalidate from localStorage
    try {
      if (keyOrPrefix.includes('*')) {
        const prefix = keyOrPrefix.replace('*', '');
        const storagePrefix = STORAGE_PREFIX + prefix;
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const storageKey = localStorage.key(i);
          if (storageKey && storageKey.startsWith(storagePrefix)) {
            keysToRemove.push(storageKey);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      } else {
        localStorage.removeItem(STORAGE_PREFIX + keyOrPrefix);
      }
    } catch (err) {
      console.warn('[Cache] Failed to invalidate from localStorage:', err);
    }
  });
}

/**
 * Clear all cache
 */
export function clearCache(): void {
  MEMORY_CACHE.clear();
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (err) {
    console.warn('[Cache] Failed to clear localStorage:', err);
  }
}

/**
 * Get current localStorage size
 */
function getStorageSize(): number {
  let size = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        const value = localStorage.getItem(key);
        if (value) {
          size += key.length + value.length;
        }
      }
    }
  } catch (err) {
    // Ignore errors
  }
  return size;
}

/**
 * Clear oldest cache entries to make space
 */
function clearOldestEntries(minBytesToFree: number): void {
  try {
    const entries: Array<{ key: string; savedAt: number; size: number }> = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (storageKey && storageKey.startsWith(STORAGE_PREFIX)) {
        const value = localStorage.getItem(storageKey);
        if (value) {
          try {
            const entry: CacheEntry<any> = JSON.parse(value);
            entries.push({
              key: storageKey,
              savedAt: entry.savedAt,
              size: storageKey.length + value.length,
            });
          } catch {
            // Invalid entry, remove it
            localStorage.removeItem(storageKey);
          }
        }
      }
    }

    // Sort by age (oldest first)
    entries.sort((a, b) => a.savedAt - b.savedAt);

    // Remove oldest entries until we free enough space
    let freed = 0;
    for (const entry of entries) {
      if (freed >= minBytesToFree) break;
      localStorage.removeItem(entry.key);
      freed += entry.size;
    }
  } catch (err) {
    console.warn('[Cache] Failed to clear oldest entries:', err);
  }
}
