import { useState, useMemo, useEffect } from 'react';

export interface UsePaginationOptions<T> {
  items: T[];
  itemsPerPage: number;
  initialPage?: number;
}

export interface UsePaginationReturn<T> {
  currentPage: number;
  totalPages: number;
  paginatedItems: T[];
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  startIndex: number;
  endIndex: number;
  totalItems: number;
}

/**
 * Hook for managing pagination state and logic
 * Automatically resets to page 1 when items change
 */
export function usePagination<T>({
  items,
  itemsPerPage,
  initialPage = 1,
}: UsePaginationOptions<T>): UsePaginationReturn<T> {
  const [currentPage, setCurrentPage] = useState(initialPage);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));

  // Reset to page 1 when items change (e.g., after search)
  useEffect(() => {
    setCurrentPage(1);
  }, [items.length, items]);

  // Ensure current page is valid
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return items.slice(start, end);
  }, [items, currentPage, itemsPerPage]);

  const startIndex = useMemo(() => {
    return totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  }, [currentPage, itemsPerPage, totalItems]);

  const endIndex = useMemo(() => {
    return Math.min(currentPage * itemsPerPage, totalItems);
  }, [currentPage, itemsPerPage, totalItems]);

  const goToPage = (page: number) => {
    const validPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(validPage);
  };

  const nextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(prev => prev + 1);
    }
  };

  const prevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(prev => prev - 1);
    }
  };

  return {
    currentPage,
    totalPages,
    paginatedItems,
    goToPage,
    nextPage,
    prevPage,
    startIndex,
    endIndex,
    totalItems,
  };
}
