import React, { useState, useEffect, useRef } from 'react';

export interface CancelLessonModalProps {
  isOpen: boolean;
  lessonDate: string; // YYYY-MM-DD format
  lessonTime?: string; // HH:mm format
  studentName: string;
  onClose: () => void;
  onCancelOnly: () => Promise<void>;
  onCancelAndNotify: () => Promise<void>;
}

type ActionType = 'none' | 'cancelOnly' | 'cancelAndNotify';

const CancelLessonModal: React.FC<CancelLessonModalProps> = ({
  isOpen,
  lessonDate,
  lessonTime,
  studentName,
  onClose,
  onCancelOnly,
  onCancelAndNotify,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentAction, setCurrentAction] = useState<ActionType>('none');
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setIsProcessing(false);
      setCurrentAction('none');
    }
  }, [isOpen]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isProcessing) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isProcessing, onClose]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isProcessing) {
      onClose();
    }
  };

  const handleCancelOnly = async () => {
    if (isProcessing) return;
    
    setIsProcessing(true);
    setCurrentAction('cancelOnly');
    
    try {
      await onCancelOnly();
    } finally {
      setIsProcessing(false);
      setCurrentAction('none');
    }
  };

  const handleCancelAndNotify = async () => {
    if (isProcessing) return;
    
    setIsProcessing(true);
    setCurrentAction('cancelAndNotify');
    
    try {
      await onCancelAndNotify();
    } finally {
      setIsProcessing(false);
      setCurrentAction('none');
    }
  };

  // Format the date for display
  const formatDisplayDate = () => {
    try {
      const date = new Date(lessonDate);
      const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
      const day = dayNames[date.getDay()];
      const formattedDate = date.toLocaleDateString('he-IL', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
      });
      return lessonTime ? `${day}, ${formattedDate} בשעה ${lessonTime}` : `${day}, ${formattedDate}`;
    } catch {
      return lessonDate;
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"></div>
      <div
        ref={dialogRef}
        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border-2 border-amber-200 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 md:p-8 border-b-2 border-amber-200">
          <h3 className="text-xl md:text-2xl font-black text-amber-800 mb-4">
            ביטול שיעור
          </h3>
          <div className="text-sm md:text-base text-slate-700 font-medium leading-relaxed space-y-2">
            <p className="text-lg font-bold">
              אתה בטוח שאתה רוצה לבטל שיעור?
            </p>
            <div className="bg-amber-50 rounded-xl p-3 mt-3">
              <p className="text-slate-600">
                <span className="font-bold text-amber-800">תלמיד:</span> {studentName}
              </p>
              <p className="text-slate-600">
                <span className="font-bold text-amber-800">מועד:</span> {formatDisplayDate()}
              </p>
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="p-6 md:p-8 flex flex-col gap-3">
          {/* Cancel + Send notification button */}
          <button
            onClick={handleCancelAndNotify}
            disabled={isProcessing}
            className={`w-full py-3 md:py-4 rounded-xl font-bold text-sm md:text-base shadow-lg transition-all flex items-center justify-center gap-2 ${
              isProcessing
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-rose-600 hover:bg-rose-700 text-white'
            }`}
          >
            {currentAction === 'cancelAndNotify' ? (
              <>
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>מבטל ושולח הודעה...</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                </svg>
                <span>בטל + שלח הודעה לתלמיד</span>
              </>
            )}
          </button>

          {/* Cancel only button */}
          <button
            onClick={handleCancelOnly}
            disabled={isProcessing}
            className={`w-full py-3 md:py-4 rounded-xl font-bold text-sm md:text-base transition-all flex items-center justify-center gap-2 ${
              isProcessing
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-amber-100 hover:bg-amber-200 text-amber-800 border-2 border-amber-300'
            }`}
          >
            {currentAction === 'cancelOnly' ? (
              <>
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>מבטל שיעור...</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="m15 9-6 6"/>
                  <path d="m9 9 6 6"/>
                </svg>
                <span>בטל שיעור</span>
              </>
            )}
          </button>

          {/* Back button */}
          <button
            onClick={onClose}
            disabled={isProcessing}
            className={`w-full py-3 md:py-4 rounded-xl font-bold text-sm md:text-base transition-all ${
              isProcessing
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            חזור
          </button>
        </div>
      </div>
    </div>
  );
};

export default CancelLessonModal;
