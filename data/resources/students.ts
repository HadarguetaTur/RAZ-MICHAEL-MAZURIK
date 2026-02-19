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
 * Get first page of students (for quick initial loads)
 */
export async function getStudents(): Promise<Student[]> {
  const key = buildKey(['students', 'page1']);

  return fetchWithCache({
    key,
    ttlMs: STUDENTS_TTL,
    fetcher: async () => {
      const { students } = await nexusApi.getStudents();
      return students;
    },
    staleWhileRevalidate: true,
  });
}

/**
 * Get all students (all pages) using Airtable's offset token pagination
 */
export async function getAllStudents(): Promise<Student[]> {
  const key = buildKey(['students', 'all']);

  return fetchWithCache({
    key,
    ttlMs: STUDENTS_TTL,
    fetcher: async () => {
      const all: Student[] = [];
      let offsetToken: string | undefined;
      do {
        const { students, nextOffset } = await nexusApi.getStudents(offsetToken);
        all.push(...students);
        offsetToken = nextOffset;
      } while (offsetToken);
      return all;
    },
    staleWhileRevalidate: true,
  });
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
