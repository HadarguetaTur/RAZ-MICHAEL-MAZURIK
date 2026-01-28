/**
 * useToast Hook - Global Toast Notification System
 * 
 * Usage:
 * ```tsx
 * import { useToast } from '../hooks/useToast';
 * 
 * function MyComponent() {
 *   const toast = useToast();
 *   
 *   const handleSave = async () => {
 *     try {
 *       await saveData();
 *       toast.success('נשמר בהצלחה!');
 *     } catch (err) {
 *       toast.error('הפעולה נכשלה, נסה שוב');
 *     }
 *   };
 * }
 * ```
 * 
 * Available methods:
 * - toast.success(message, options?)
 * - toast.error(message, options?)
 * - toast.info(message, options?)
 * 
 * Options:
 * - duration?: number (default: 3000ms)
 */

import { useContext } from 'react';
import { ToastContext } from '../components/ui/ToastHost';

export const useToast = () => {
  const context = useContext(ToastContext);
  
  if (!context) {
    throw new Error('useToast must be used within a ToastHost provider');
  }
  
  return context;
};
