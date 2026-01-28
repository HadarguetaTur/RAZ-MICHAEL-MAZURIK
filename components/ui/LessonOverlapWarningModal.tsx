import React, { useState, useEffect, useRef } from 'react';
import type { ConflictItem } from '../../services/conflictsCheckService';

export interface LessonOverlapWarningModalProps {
  isOpen: boolean;
  conflicts: ConflictItem[];
  onContinue: () => void | Promise<void>;
  onBack: () => void;
  isLoading?: boolean;
}

function formatTimeRange(start: string, end: string): string {
  try {
    const s = start.includes('T') ? start.slice(11, 16) : start.slice(0, 5);
    const e = end.includes('T') ? end.slice(11, 16) : end.slice(0, 5);
    return `${s} – ${e}`;
  } catch {
    return `${start} – ${end}`;
  }
}

function sourceLabel(source: ConflictItem['source']): string {
  return source === 'lessons' ? 'שיעור' : 'חלון פתוח';
}

const LessonOverlapWarningModal: React.FC<LessonOverlapWarningModalProps> = ({
  isOpen,
  conflicts,
  onContinue,
  onBack,
  isLoading = false,
}) => {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && continueRef.current) {
      setTimeout(() => continueRef.current?.focus(), 100);
    }
    if (!isOpen) setDetailsExpanded(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onBack();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isLoading, onBack]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isLoading) onBack();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border-2 border-amber-200 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 md:p-8 border-b-2 border-amber-200">
          <h3 className="text-xl md:text-2xl font-black text-amber-800 mb-4">
            נמצאה חפיפה בלו״ז
          </h3>
          <div className="text-sm md:text-base text-slate-700 font-medium leading-relaxed mb-4">
            השיעור המבוקש חופף עם {conflicts.length} פריט{conflicts.length > 1 ? 'ים' : ''} קיים{conflicts.length > 1 ? 'ים' : ''}:
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
            {conflicts.map((c) => (
              <div
                key={c.recordId}
                className="p-3 rounded-xl border-2 border-slate-200 bg-slate-50"
              >
                <div className="font-bold text-slate-900">{c.label}</div>
                <div className="text-xs text-slate-500">
                  {formatTimeRange(c.start, c.end)} · {sourceLabel(c.source)}
                </div>
                {detailsExpanded && (
                  <div className="mt-2 pt-2 border-t border-slate-200 text-[10px] font-mono text-slate-400">
                    recordId: {c.recordId} · source: {c.source}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="p-6 md:p-8 space-y-3">
          <button
            ref={continueRef}
            onClick={() => onContinue()}
            disabled={isLoading}
            className="w-full py-3 md:py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-sm md:text-base shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'שומר...' : 'המשך בכל זאת'}
          </button>
          <button
            onClick={onBack}
            disabled={isLoading}
            className="w-full py-3 md:py-4 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm md:text-base hover:bg-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            חזור לעריכה
          </button>
          <button
            type="button"
            onClick={() => setDetailsExpanded((v) => !v)}
            disabled={isLoading}
            className="w-full py-2 text-amber-600 text-xs font-bold hover:bg-amber-50 rounded-xl transition-all disabled:opacity-50"
          >
            {detailsExpanded ? 'הסתר פרטים' : 'הצג פרטים'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LessonOverlapWarningModal;
