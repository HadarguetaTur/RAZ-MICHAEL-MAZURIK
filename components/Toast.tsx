
import React, { useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

const Toast: React.FC<ToastProps> = ({ message, type, onClose, duration = 3000 }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const styles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    error: 'bg-rose-50 border-rose-200 text-rose-700',
    info: 'bg-blue-50 border-blue-200 text-blue-700',
  };

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
  };

  return (
    <div className={`fixed top-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-[9999] animate-in slide-in-from-top-2 duration-300`}>
      <div className={`${styles[type]} border-2 rounded-2xl p-4 shadow-lg flex items-center gap-3`}>
        <div className="text-xl font-black">{icons[type]}</div>
        <div className="flex-1 font-bold text-sm">{message}</div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 transition-colors text-lg font-black"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default Toast;
