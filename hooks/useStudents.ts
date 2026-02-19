import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Student } from '../types';
import { getStudents, getAllStudents, searchStudents as searchStudentsResource, getStudentByRecordId, invalidateStudents } from '../data/resources/students';

interface UseStudentsOptions {
  filterActiveOnly?: boolean;
  autoLoad?: boolean;
  /** When true, load all pages so student names resolve for every record */
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
  getStudentByIdSync: (id: string) => Student | undefined;
}

export function useStudents(options: UseStudentsOptions = {}): UseStudentsReturn {
  const { filterActiveOnly = true, autoLoad = true, loadAllPages = false } = options;
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMountedRef = useRef(true);
  const studentsRef = useRef<Student[]>([]);
  const isLoadingRef = useRef(false);

  // Keep refs in sync with state so async callbacks see fresh values
  useEffect(() => { studentsRef.current = students; }, [students]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  const loadStudents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetched = loadAllPages ? await getAllStudents() : await getStudents();
      if (isMountedRef.current) {
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
      }
    }
  }, [loadAllPages]);

  const searchStudents = useCallback(async (query: string, limit: number = 15): Promise<Student[]> => {
    if (query.length < 2) {
      return [];
    }

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
      
      if (filtered.length >= limit || filtered.length === students.length) {
        return filtered;
      }
    }

    try {
      const results = await searchStudentsResource(query, limit);
      if (filterActiveOnly) {
        return results.filter(s => s.status !== 'inactive');
      }
      return results;
    } catch (err) {
      console.error('[useStudents] Search error:', err);
      return [];
    }
  }, [students, filterActiveOnly]);

  const refreshStudents = useCallback(async () => {
    invalidateStudents();
    await loadStudents();
  }, [loadStudents]);

  const getStudentByIdSync = useCallback((id: string): Student | undefined => {
    return students.find(s => s.id === id);
  }, [students]);

  const getStudentById = useCallback(async (id: string): Promise<Student | undefined> => {
    const localStudent = studentsRef.current.find(s => s.id === id);
    if (localStudent) {
      return localStudent;
    }

    // Wait for an in-progress load to finish using refs to avoid stale closures
    if (isLoadingRef.current) {
      const maxWait = 2000;
      const interval = 100;
      let waited = 0;
      while (waited < maxWait && isLoadingRef.current) {
        await new Promise(resolve => setTimeout(resolve, interval));
        waited += interval;
        const found = studentsRef.current.find(s => s.id === id);
        if (found) return found;
      }
    }

    if (id && id.startsWith('rec')) {
      try {
        const fetched = await getStudentByRecordId(id);
        if (fetched && isMountedRef.current) {
          setStudents(prev => {
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
  }, []);

  useEffect(() => {
    if (autoLoad) {
      loadStudents();
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [autoLoad, loadStudents]);

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
