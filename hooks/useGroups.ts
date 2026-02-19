import { useState, useEffect, useCallback } from 'react';
import { StudentGroup } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';

interface UseGroupsReturn {
  groups: StudentGroup[];
  activeGroups: StudentGroup[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createGroup: (group: { name: string; studentIds: string[]; status: 'active' | 'paused' }) => Promise<StudentGroup>;
  updateGroup: (id: string, updates: { name?: string; studentIds?: string[]; status?: 'active' | 'paused' }) => Promise<StudentGroup>;
  deleteGroup: (id: string) => Promise<void>;
  getGroupById: (id: string) => StudentGroup | undefined;
}

export function useGroups(): UseGroupsReturn {
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetched = await nexusApi.fetchGroups();
      setGroups(fetched);
    } catch (err: any) {
      setError(parseApiError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const fetched = await nexusApi.fetchGroups();
        if (!cancelled) setGroups(fetched);
      } catch (err: any) {
        if (!cancelled) setError(parseApiError(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const createGroup = useCallback(async (group: { name: string; studentIds: string[]; status: 'active' | 'paused' }) => {
    const created = await nexusApi.createGroup(group);
    setGroups(prev => [created, ...prev]);
    return created;
  }, []);

  const updateGroup = useCallback(async (id: string, updates: { name?: string; studentIds?: string[]; status?: 'active' | 'paused' }) => {
    const updated = await nexusApi.updateGroup(id, updates);
    setGroups(prev => prev.map(g => g.id === id ? updated : g));
    return updated;
  }, []);

  const deleteGroup = useCallback(async (id: string) => {
    await nexusApi.deleteGroup(id);
    setGroups(prev => prev.filter(g => g.id !== id));
  }, []);

  const getGroupById = useCallback((id: string) => {
    return groups.find(g => g.id === id);
  }, [groups]);

  const activeGroups = groups.filter(g => g.status === 'active');

  return {
    groups,
    activeGroups,
    isLoading,
    error,
    refresh: loadGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    getGroupById,
  };
}
