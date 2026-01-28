import { useState, useCallback } from 'react';
import { useToast } from './useToast';

export type MutationStatus = 'idle' | 'saving' | 'success' | 'error';

export interface UseMutationOptions {
  onSuccessMessage?: string;
  onErrorMessage?: string;
  successToast?: boolean;
  errorToast?: boolean;
  finally?: () => void;
}

export interface UseMutationResult<T> {
  mutate: (asyncFn: () => Promise<T>) => Promise<T | undefined>;
  status: MutationStatus;
  error: Error | null;
}

export const useMutation = <T = void>(
  options: UseMutationOptions = {}
): UseMutationResult<T> => {
  const {
    onSuccessMessage,
    onErrorMessage,
    successToast = true,
    errorToast = true,
    finally: finallyCallback,
  } = options;

  const [status, setStatus] = useState<MutationStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const toast = useToast();

  const mutate = useCallback(
    async (asyncFn: () => Promise<T>): Promise<T | undefined> => {
      // Prevent duplicate submissions
      if (status === 'saving') {
        return undefined;
      }

      setStatus('saving');
      setError(null);

      try {
        const result = await asyncFn();
        setStatus('success');
        
        if (successToast && onSuccessMessage) {
          toast.success(onSuccessMessage);
        }
        
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setStatus('error');
        
        if (errorToast) {
          const message = onErrorMessage || error.message || 'הפעולה נכשלה, נסה שוב';
          toast.error(message);
        }
        
        throw error;
      } finally {
        if (finallyCallback) {
          finallyCallback();
        }
        // Reset to idle after a short delay to allow UI to show success state
        setTimeout(() => {
          setStatus('idle');
        }, 500);
      }
    },
    [status, toast, onSuccessMessage, onErrorMessage, successToast, errorToast, finallyCallback]
  );

  return { mutate, status, error };
};
