import React, { useState, useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'אישור',
  cancelLabel = 'ביטול',
  variant = 'info',
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  const [isConfirmedChecked, setIsConfirmedChecked] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Reset checkbox when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setIsConfirmedChecked(false);
      // Focus confirm button after a short delay (for accessibility)
      setTimeout(() => {
        if (confirmButtonRef.current && variant !== 'danger') {
          confirmButtonRef.current.focus();
        }
      }, 100);
    }
  }, [isOpen, variant]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isLoading, onCancel]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isLoading) {
      onCancel();
    }
  };

  const handleConfirm = async () => {
    if (isLoading) return;
    if (variant === 'danger' && !isConfirmedChecked) return;
    
    await onConfirm();
  };

  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      confirmButton: 'bg-rose-600 hover:bg-rose-700 text-white',
      border: 'border-rose-200',
      title: 'text-rose-800',
    },
    warning: {
      confirmButton: 'bg-amber-600 hover:bg-amber-700 text-white',
      border: 'border-amber-200',
      title: 'text-amber-800',
    },
    info: {
      confirmButton: 'bg-blue-600 hover:bg-blue-700 text-white',
      border: 'border-blue-200',
      title: 'text-blue-800',
    },
  };

  const styles = variantStyles[variant];
  const canConfirm = variant !== 'danger' || isConfirmedChecked;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"></div>
      <div
        ref={dialogRef}
        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border-2 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`p-6 md:p-8 border-b-2 ${styles.border}`}>
          <h3 className={`text-xl md:text-2xl font-black ${styles.title} mb-4`}>
            {title}
          </h3>
          <div className="text-sm md:text-base text-slate-700 font-medium leading-relaxed">
            {message}
          </div>
        </div>

        {variant === 'danger' && (
          <div className="p-4 md:p-6 bg-rose-50 border-b border-rose-100">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isConfirmedChecked}
                onChange={(e) => setIsConfirmedChecked(e.target.checked)}
                disabled={isLoading}
                className="w-5 h-5 rounded border-rose-300 text-rose-600 focus:ring-2 focus:ring-rose-200 disabled:opacity-50"
              />
              <span className="text-sm font-bold text-rose-800">
                אני מבין/ה
              </span>
            </label>
          </div>
        )}

        <div className="p-6 md:p-8 flex gap-3">
          <button
            ref={confirmButtonRef}
            onClick={handleConfirm}
            disabled={isLoading || !canConfirm}
            className={`flex-1 py-3 md:py-4 rounded-xl font-black text-sm md:text-base shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              canConfirm && !isLoading
                ? styles.confirmButton
                : 'bg-slate-300 text-slate-500'
            }`}
          >
            {isLoading ? 'שומר...' : confirmLabel}
          </button>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 py-3 md:py-4 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm md:text-base hover:bg-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
