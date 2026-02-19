import React, { useState, useRef, useEffect, useMemo } from 'react';
import { StudentGroup } from '../types';
import { useGroups } from '../hooks/useGroups';

interface GroupPickerProps {
  value: string | null;
  onChange: (groupId: string | null, studentIds: string[]) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * Searchable dropdown for selecting a student group.
 * On selection, emits the group ID and its full studentIds array.
 */
const GroupPicker: React.FC<GroupPickerProps> = ({
  value,
  onChange,
  disabled = false,
  className = '',
  placeholder = 'בחר קבוצה...',
}) => {
  const { activeGroups, isLoading, getGroupById } = useGroups();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedGroup = value ? getGroupById(value) : undefined;

  const filtered = useMemo(() => {
    if (!search.trim()) return activeGroups;
    const q = search.trim().toLowerCase();
    return activeGroups.filter(g => g.name.toLowerCase().includes(q));
  }, [activeGroups, search]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (group: StudentGroup) => {
    onChange(group.id, group.studentIds);
    setIsOpen(false);
    setSearch('');
    setHighlightedIndex(-1);
  };

  const handleClear = () => {
    onChange(null, []);
    setSearch('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || filtered.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < filtered.length) {
          handleSelect(filtered[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`} dir="rtl">
      {selectedGroup ? (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex-1">
            <div className="font-bold text-blue-900 text-sm">{selectedGroup.name}</div>
            <div className="text-[10px] text-blue-600 font-medium mt-0.5">
              {selectedGroup.studentCount ?? selectedGroup.studentIds.length} תלמידים
              {selectedGroup.studentNames && selectedGroup.studentNames.length > 0 && (
                <span className="text-blue-400"> • {selectedGroup.studentNames.slice(0, 4).join(', ')}{selectedGroup.studentNames.length > 4 ? '...' : ''}</span>
              )}
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1.5 text-blue-400 hover:text-blue-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setIsOpen(true);
              setHighlightedIndex(-1);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={placeholder}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {isLoading && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <div className="animate-spin">⏳</div>
            </div>
          )}
        </div>
      )}

      {isOpen && !selectedGroup && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-[300px] overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="p-4 text-center text-slate-400 text-sm">טוען קבוצות...</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-center text-slate-400 text-sm">
              {activeGroups.length === 0 ? 'אין קבוצות פעילות' : 'לא נמצאו קבוצות'}
            </div>
          ) : (
            <div className="py-2">
              {filtered.map((group, index) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => handleSelect(group)}
                  className={`w-full text-right px-4 py-3 hover:bg-blue-50 transition-colors ${
                    index === highlightedIndex ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="font-bold text-slate-900 text-sm">{group.name}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {group.studentCount ?? group.studentIds.length} תלמידים
                    {group.studentNames && group.studentNames.length > 0 && (
                      <span> • {group.studentNames.slice(0, 3).join(', ')}{group.studentNames.length > 3 ? '...' : ''}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GroupPicker;
