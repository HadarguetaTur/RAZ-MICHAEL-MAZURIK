import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Student } from '../types';
import { getStudents, getAllStudents, searchStudents as searchStudentsResource, getStudentByRecordId, invalidateStudents } from '../data/resources/students';

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
  getStudentById: (id: string) => Promise<Student | undefined>;
  getStudentByIdSync: (id: string) => Student | undefined; // Synchronous version for immediate lookups
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
    if (import.meta.env.DEV) {
      console.log('[useStudents] Starting loadStudents, loadAllPages:', loadAllPages);
    }
    setIsLoading(true);
    setError(null);
    try {
      // Use the new resource layer which handles caching automatically
      const fetched = loadAllPages ? await getAllStudents() : await getStudents(1);
      if (isMountedRef.current) {
        if (import.meta.env.DEV) {
          console.log('[useStudents] Loaded students:', {
            count: fetched.length,
            loadAllPages,
            studentIds: fetched.slice(0, 5).map(s => s.id),
          });
        }
        setStudents(fetched);
        setError(null);
      }
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(err?.message || 'Failed to load students');
      if (import.meta.env.DEV) {
        console.error('[useStudents] Error loading students:', error);
      }
      if (isMountedRef.current) {
        setError(error);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        if (import.meta.env.DEV) {
          console.log('[useStudents] Finished loading, isLoading set to false');
        }
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

  // Get student by ID (synchronous) - only checks local cache
  const getStudentByIdSync = useCallback((id: string): Student | undefined => {
    return students.find(s => s.id === id);
  }, [students]);

  // Get student by ID - try local cache first, then fetch from resource if not found
  const getStudentById = useCallback(async (id: string): Promise<Student | undefined> => {
    // First try local cache
    const localStudent = students.find(s => s.id === id);
    if (localStudent) {
      if (import.meta.env.DEV) {
        console.log('[getStudentById] Found in local cache:', id, localStudent.name);
      }
      return localStudent;
    }

    // If still loading, wait a bit for initial load to complete
    // Note: We check isLoading at the start, but don't use it in the loop to avoid stale closure
    if (isLoading) {
      if (import.meta.env.DEV) {
        console.log('[getStudentById] Still loading, waiting for initial load...', id);
      }
      // Wait for load to complete (max 2 seconds, check every 100ms)
      const maxWaitTime = 2000;
      const checkInterval = 100;
      let waited = 0;
      
      // Use a ref or check students.length instead of isLoading in the loop
      while (waited < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        waited += checkInterval;
        
        // Check again after wait - students array might have been updated
        // We can't check isLoading here because it's a stale closure value
        const studentAfterWait = students.find(s => s.id === id);
        if (studentAfterWait) {
          if (import.meta.env.DEV) {
            console.log('[getStudentById] Found after waiting:', id, studentAfterWait.name);
          }
          return studentAfterWait;
        }
        
        // If we've waited enough and students array is still empty, break
        if (waited >= maxWaitTime || students.length > 0) {
          break;
        }
      }
      
      // Final check after waiting
      const finalCheck = students.find(s => s.id === id);
      if (finalCheck) {
        if (import.meta.env.DEV) {
          console.log('[getStudentById] Found in final check:', id, finalCheck.name);
        }
        return finalCheck;
      }
    }

    // If not found locally and we have an ID, try fetching from resource
    if (id && id.startsWith('rec')) {
      if (import.meta.env.DEV) {
        console.log('[getStudentById] Not found in local cache, fetching from resource:', id);
      }
      try {
        const fetched = await getStudentByRecordId(id);
        if (fetched && isMountedRef.current) {
          if (import.meta.env.DEV) {
            console.log('[getStudentById] Successfully fetched from resource:', id, fetched.name);
          }
          // Add to local cache for future lookups
          setStudents(prev => {
            // Avoid duplicates
            if (prev.find(s => s.id === id)) return prev;
            return [...prev, fetched];
          });
          return fetched;
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[getStudentById] Failed to fetch student:', id, err);
        }
      }
    }

    if (import.meta.env.DEV) {
      console.warn('[getStudentById] Student not found:', id);
    }
    return undefined;
  }, [students, isLoading]);

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
    getStudentByIdSync,
  };
}
