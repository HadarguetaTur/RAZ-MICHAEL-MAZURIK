/**
 * useConfirmDialog Hook - Global Confirmation Dialog System
 * 
 * Usage:
 * ```tsx
 * import { useConfirmDialog } from '../hooks/useConfirmDialog';
 * 
 * function MyComponent() {
 *   const { confirm } = useConfirmDialog();
 *   
 *   const handleDelete = async () => {
 *     const confirmed = await confirm({
 *       title: 'מחיקת פריט',
 *       message: 'האם אתה בטוח שברצונך למחוק?',
 *       variant: 'danger',
 *       confirmLabel: 'מחק',
 *       cancelLabel: 'ביטול'
 *     });
 *     
 *     if (confirmed) {
 *       await deleteItem();
 *     }
 *   };
 * }
 * ```
 * 
 * Options:
 * - title: string - The dialog title
 * - message: string | ReactNode - The dialog message
 * - variant?: 'danger' | 'warning' | 'info' - Visual style (default: 'info')
 * - confirmLabel?: string - Confirm button text (default: 'אישור')
 * - cancelLabel?: string - Cancel button text (default: 'ביטול')
 * 
 * Returns: Promise<boolean> - true if confirmed, false if cancelled
 */

import { useContext } from 'react';
import { ConfirmDialogContext } from '../components/ui/ConfirmDialogHost';

export const useConfirmDialog = () => {
  const context = useContext(ConfirmDialogContext);
  
  if (!context) {
    throw new Error('useConfirmDialog must be used within a ConfirmDialogHost provider');
  }
  
  return context;
};
