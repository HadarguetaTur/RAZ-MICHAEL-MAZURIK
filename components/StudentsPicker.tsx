import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Student } from '../types';
import { useStudents } from '../hooks/useStudents';

interface StudentsPickerProps {
  values: string[]; // Array of student IDs
  onChange: (studentIds: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  filterActiveOnly?: boolean;
  minChars?: number;
  limit?: number;
}

/**
 * Reusable searchable multi-select student picker component
 * Uses cached student data for fast local filtering
 */
const StudentsPicker: React.FC<StudentsPickerProps> = ({
  values,
  onChange,
  placeholder = 'חפש תלמידים...',
  disabled = false,
  className = '',
  filterActiveOnly = true,
  minChars = 2,
  limit = 15,
}) => {
  const { searchStudents, getStudentById, activeStudents, isLoading: isLoadingStudents } = useStudents({ filterActiveOnly, autoLoad: true });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Student[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get selected students from IDs
  const selectedStudents = values
    .map(id => getStudentById(id))
    .filter((s): s is Student => s !== undefined);

  // Debounced search function
  const performSearch = useCallback(async (query: string) => {
    if (query.length < minChars) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchStudents(query, limit);
      // Filter out already selected students
      const filtered = results.filter(s => !values.includes(s.id));
      setSearchResults(filtered);
    } catch (err: any) {
      console.error('Student search error:', err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [searchStudents, minChars, limit, values]);

  // Debounce search input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.length >= minChars) {
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(searchQuery);
      }, 300); // 300ms debounce
    } else {
      setSearchResults([]);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, performSearch, minChars]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    setIsOpen(true);
    setHighlightedIndex(-1);
  };

  const handleToggle = (student: Student) => {
    const isSelected = values.includes(student.id);
    if (isSelected) {
      onChange(values.filter(id => id !== student.id));
    } else {
      onChange([...values, student.id]);
    }
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleRemove = (studentId: string) => {
    onChange(values.filter(id => id !== studentId));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || searchResults.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < searchResults.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < searchResults.length) {
          handleToggle(searchResults[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  return (
    <div ref={containerRef} className={`relative space-y-2 ${className}`}>
      {/* Selected Students Chips */}
      {selectedStudents.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl min-h-[60px]">
          {selectedStudents.map(student => (
            <div
              key={student.id}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-bold"
            >
              <span>{student.name}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemove(student.id)}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {(isSearching || isLoadingStudents) && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <div className="animate-spin">⏳</div>
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (searchQuery.length >= minChars || searchResults.length > 0) && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-[300px] overflow-y-auto custom-scrollbar">
          {isSearching ? (
            <div className="p-4 text-center text-slate-400 text-sm">מחפש...</div>
          ) : searchResults.length === 0 && searchQuery.length >= minChars ? (
            <div className="p-4 text-center text-slate-400 text-sm">לא נמצאו תוצאות</div>
          ) : searchResults.length > 0 ? (
            <div className="py-2">
              {searchResults.map((student, index) => {
                const isSelected = values.includes(student.id);
                return (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => handleToggle(student)}
                    className={`w-full text-right px-4 py-3 hover:bg-blue-50 transition-colors flex items-center justify-between ${
                      index === highlightedIndex ? 'bg-blue-50' : ''
                    } ${isSelected ? 'bg-blue-100' : ''}`}
                  >
                    <div className="flex-1 text-right">
                      <div className="font-bold text-slate-900">{student.name}</div>
                      {student.phone && (
                        <div className="text-xs text-slate-500 mt-1">{student.phone}</div>
                      )}
                      {student.grade && (
                        <div className="text-xs text-slate-400 mt-0.5">{student.grade}</div>
                      )}
                    </div>
                    {isSelected && (
                      <div className="mr-2 text-blue-600">✓</div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default StudentsPicker;
