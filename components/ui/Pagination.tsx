import React from 'react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  onPageChange: (page: number) => void;
  onNext: () => void;
  onPrev: () => void;
  className?: string;
}

/**
 * Reusable Pagination component with RTL support
 * Displays page navigation controls and item count information
 */
const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  startIndex,
  endIndex,
  onPageChange,
  onNext,
  onPrev,
  className = '',
}) => {
  // Don't render if there are no items or only one page
  if (totalItems === 0 || totalPages <= 1) {
    return null;
  }

  return (
    <div className={`flex flex-col sm:flex-row items-center justify-between gap-4 p-4 md:p-6 border-t border-slate-100 bg-white ${className}`}>
      {/* Item count info */}
      <div className="text-sm text-slate-600 font-bold">
        מציג {startIndex}-{endIndex} מתוך {totalItems} תוצאות
      </div>

      {/* Pagination controls */}
      <div className="flex items-center gap-2">
        {/* Previous button */}
        <button
          onClick={onPrev}
          disabled={currentPage === 1}
          className={`px-4 py-2 rounded-xl font-black text-sm transition-all ${
            currentPage === 1
              ? 'bg-slate-50 text-slate-300 cursor-not-allowed'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:scale-95'
          }`}
          aria-label="עמוד קודם"
        >
          הקודם
        </button>

        {/* Page indicator */}
        <div className="px-4 py-2 text-sm font-black text-slate-700">
          עמוד {currentPage} מתוך {totalPages}
        </div>

        {/* Next button */}
        <button
          onClick={onNext}
          disabled={currentPage === totalPages}
          className={`px-4 py-2 rounded-xl font-black text-sm transition-all ${
            currentPage === totalPages
              ? 'bg-slate-50 text-slate-300 cursor-not-allowed'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:scale-95'
          }`}
          aria-label="עמוד הבא"
        >
          הבא
        </button>
      </div>
    </div>
  );
};

export default Pagination;
