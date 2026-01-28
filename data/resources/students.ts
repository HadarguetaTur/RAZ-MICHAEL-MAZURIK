/**
 * Students resource with caching
 */

import { fetchWithCache } from '../fetchWithCache';
import { invalidateCache, buildKey } from '../cache';
import { nexusApi } from '../../services/nexusApi';
import { Student } from '../../types';

const STUDENTS_TTL = 12 * 60 * 60 * 1000; // 12 hours (relatively static)

const PAGE_SIZE = 100;

/**
 * Get students (single page)
 */
export async function getStudents(page: number = 1): Promise<Student[]> {
  const key = buildKey(['students', String(page)]);

  return fetchWithCache({
    key,
    ttlMs: STUDENTS_TTL,
    fetcher: () => nexusApi.getStudents(page),
    staleWhileRevalidate: true,
  });
}

/**
 * Get all students (all pages) — for pages like Subscriptions that need full list for name resolution
 */
export async function getAllStudents(): Promise<Student[]> {
  const all: Student[] = [];
  let page = 1;
  while (true) {
    const batch = await getStudents(page);
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

/**
 * Search students (uses local cache if available, otherwise fetches)
 */
export async function searchStudents(
  query: string,
  limit: number = 15
): Promise<Student[]> {
  // For search, we can use a shorter TTL since results might change
  const key = buildKey(['students', 'search', query.toLowerCase().trim(), String(limit)]);
  const SEARCH_TTL = 5 * 60 * 1000; // 5 minutes for search results

  return fetchWithCache({
    key,
    ttlMs: SEARCH_TTL,
    fetcher: () => nexusApi.searchStudents(query, limit),
    staleWhileRevalidate: false, // Don't SWR for search
  });
}

/**
 * Get a single student by Airtable record ID (for resolving names when not in bulk cache)
 */
export async function getStudentByRecordId(recordId: string): Promise<Student | null> {
  if (!recordId || !recordId.startsWith('rec')) return null;
  const key = buildKey(['students', 'record', recordId]);
  const TTL = 10 * 60 * 1000; // 10 min
  return fetchWithCache({
    key,
    ttlMs: TTL,
    fetcher: () => nexusApi.getStudentByRecordId(recordId),
    staleWhileRevalidate: true,
  });
}

/**
 * Invalidate students cache
 */
export function invalidateStudents(): void {
  invalidateCache('students:*');
}
