import React, { createContext, useState, useCallback } from 'react';
import Toast, { ToastType } from '../Toast';

export interface ToastOptions {
  duration?: number;
}

interface ToastState {
  message: string;
  type: ToastType;
  id: number;
}

interface ToastContextValue {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

let toastIdCounter = 0;

const ToastHost: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, type: ToastType, options?: ToastOptions) => {
    const id = ++toastIdCounter;
    setToast({ message, type, id });
  }, []);

  const hideToast = useCallback(() => {
    setToast(null);
  }, []);

  const toastApi: ToastContextValue = {
    success: (message: string, options?: ToastOptions) => {
      showToast(message, 'success', options);
    },
    error: (message: string, options?: ToastOptions) => {
      showToast(message, 'error', options);
    },
    info: (message: string, options?: ToastOptions) => {
      showToast(message, 'info', options);
    },
  };

  return (
    <ToastContext.Provider value={toastApi}>
      {children}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={hideToast}
          duration={3000}
        />
      )}
    </ToastContext.Provider>
  );
};

export default ToastHost;
