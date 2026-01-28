
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Student } from '../types';
import { searchStudents } from '../data/resources/students';

interface StudentSearchAutocompleteProps {
  value: Student | null;
  onSelect: (student: Student | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const StudentSearchAutocomplete: React.FC<StudentSearchAutocompleteProps> = ({
  value,
  onSelect,
  placeholder = 'חפש תלמיד...',
  disabled = false,
  className = '',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Student[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search function
  const performSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchStudents(query, 15);
      setSearchResults(results);
    } catch (err: any) {
      console.error('Student search error:', err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounce search input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(searchQuery);
      }, 400); // 400ms debounce
    } else {
      setSearchResults([]);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, performSearch]);

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

  const handleSelect = (student: Student) => {
    setSearchQuery('');
    setSearchResults([]);
    setIsOpen(false);
    onSelect(student);
  };

  const handleClear = () => {
    setSearchQuery('');
    setSearchResults([]);
    setIsOpen(false);
    onSelect(null);
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
          handleSelect(searchResults[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Input */}
      <div className="relative">
        <input
          type="text"
          value={value ? value.name : searchQuery}
          onChange={handleInputChange}
          onFocus={() => {
            if (value) {
              setSearchQuery(value.name);
            }
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            disabled={disabled}
          >
            ✕
          </button>
        )}
        {isSearching && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <div className="animate-spin">⏳</div>
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (searchQuery.length >= 2 || searchResults.length > 0) && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-[300px] overflow-y-auto custom-scrollbar">
          {isSearching ? (
            <div className="p-4 text-center text-slate-400 text-sm">מחפש...</div>
          ) : searchResults.length === 0 && searchQuery.length >= 2 ? (
            <div className="p-4 text-center text-slate-400 text-sm">לא נמצאו תוצאות</div>
          ) : searchResults.length > 0 ? (
            <div className="py-2">
              {searchResults.map((student, index) => (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => handleSelect(student)}
                  className={`w-full text-right px-4 py-3 hover:bg-blue-50 transition-colors ${
                    index === highlightedIndex ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="font-bold text-slate-900">{student.name}</div>
                  {student.phone && (
                    <div className="text-xs text-slate-500 mt-1">{student.phone}</div>
                  )}
                  {student.grade && (
                    <div className="text-xs text-slate-400 mt-0.5">{student.grade}</div>
                  )}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default StudentSearchAutocomplete;
