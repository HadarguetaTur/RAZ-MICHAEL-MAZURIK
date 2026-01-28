import React, { useEffect, useRef } from 'react';
import { Lesson } from '../../types';

export interface SlotOverlapsLessonModalProps {
  isOpen: boolean;
  overlappingLessons: Lesson[];
  onSaveAnyway: () => void | Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

const SlotOverlapsLessonModal: React.FC<SlotOverlapsLessonModalProps> = ({
  isOpen,
  overlappingLessons,
  onSaveAnyway,
  onCancel,
  isLoading = false,
}) => {
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && saveButtonRef.current) {
      setTimeout(() => saveButtonRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isLoading, onCancel]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isLoading) onCancel();
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
            קיים שיעור בזמן הזה
          </h3>
          <div className="text-sm md:text-base text-slate-700 font-medium leading-relaxed mb-4">
            החלון המבוקש חופף עם {overlappingLessons.length} שיעור{overlappingLessons.length > 1 ? 'ים' : ''} קיים{overlappingLessons.length > 1 ? 'ים' : ''}:
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
            {overlappingLessons.map((lesson) => (
              <div
                key={lesson.id}
                className="p-3 rounded-xl border-2 border-slate-200 bg-slate-50"
              >
                <div className="font-bold text-slate-900">
                  {lesson.studentName || 'ללא שם'}
                </div>
                <div className="text-xs text-slate-500">
                  {lesson.date} • {lesson.startTime} – {lesson.duration} דק׳
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="p-6 md:p-8 flex flex-col sm:flex-row gap-3">
          <button
            ref={saveButtonRef}
            onClick={() => onSaveAnyway()}
            disabled={isLoading}
            className="flex-1 py-3 md:py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-sm md:text-base shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'שומר...' : 'שמור בכל זאת'}
          </button>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 py-3 md:py-4 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm md:text-base hover:bg-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            בטל
          </button>
        </div>
      </div>
    </div>
  );
};

export default SlotOverlapsLessonModal;
