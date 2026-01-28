import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Student } from '../types';
import { getStudents, getAllStudents, searchStudents as searchStudentsResource, invalidateStudents } from '../data/resources/students';

interface UseStudentsOptions {
  filterActiveOnly?: boolean;
  autoLoad?: boolean;
  /** When true, load all pages (for Subscriptions etc.) so student names resolve for every subscription */
  loadAllPages?: boolean;
}

interface UseStudentsReturn {
  students: Student[];
  activeStudents: Student[];
  isLoading: boolean;
  error: Error | null;
  searchStudents: (query: string, limit?: number) => Promise<Student[]>;
  refreshStudents: () => Promise<void>;
  getStudentById: (id: string) => Student | undefined;
}

/**
 * Centralized hook for managing student data with caching
 * Uses the new data layer with dual-layer cache (memory + localStorage)
 * Provides search functionality that filters the cached data locally
 */
export function useStudents(options: UseStudentsOptions = {}): UseStudentsReturn {
  const { filterActiveOnly = true, autoLoad = true, loadAllPages = false } = options;
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMountedRef = useRef(true);

  // Load all students using the new resource layer (with caching)
  const loadStudents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Use the new resource layer which handles caching automatically
      const fetched = loadAllPages ? await getAllStudents() : await getStudents(1);
      if (isMountedRef.current) {
        setStudents(fetched);
        setError(null);
      }
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(err?.message || 'Failed to load students');
      if (isMountedRef.current) {
        setError(error);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [loadAllPages]);

  // Search students - try local cache first, then use resource search
  const searchStudents = useCallback(async (query: string, limit: number = 15): Promise<Student[]> => {
    if (query.length < 2) {
      return [];
    }

    // First try local filtering from already loaded students
    if (students.length > 0) {
      const searchQuery = query.trim().toLowerCase();
      const filtered = students
        .filter(student => {
          if (filterActiveOnly && student.status === 'inactive') {
            return false;
          }
          const nameMatch = student.name?.toLowerCase().includes(searchQuery);
          const phoneMatch = student.phone?.toLowerCase().includes(searchQuery);
          return nameMatch || phoneMatch;
        })
        .slice(0, limit)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
      
      // If we have enough results locally, return them
      if (filtered.length >= limit || filtered.length === students.length) {
        return filtered;
      }
    }

    // Otherwise use the resource search (which also uses cache)
    try {
      const results = await searchStudentsResource(query, limit);
      // Filter by active if needed
      if (filterActiveOnly) {
        return results.filter(s => s.status !== 'inactive');
      }
      return results;
    } catch (err) {
      console.error('[useStudents] Search error:', err);
      return [];
    }
  }, [students, filterActiveOnly]);

  // Refresh students (invalidate cache and reload)
  const refreshStudents = useCallback(async () => {
    invalidateStudents();
    await loadStudents();
  }, [loadStudents]);

  // Get student by ID
  const getStudentById = useCallback((id: string): Student | undefined => {
    return students.find(s => s.id === id);
  }, [students]);

  // Auto-load on mount if enabled
  useEffect(() => {
    if (autoLoad) {
      loadStudents();
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [autoLoad, loadStudents]);

  // Compute active students
  const activeStudents = useMemo(() => {
    return filterActiveOnly
      ? students.filter(s => s.status !== 'inactive')
      : students;
  }, [students, filterActiveOnly]);

  return {
    students,
    activeStudents,
    isLoading,
    error,
    searchStudents,
    refreshStudents,
    getStudentById,
  };
}
