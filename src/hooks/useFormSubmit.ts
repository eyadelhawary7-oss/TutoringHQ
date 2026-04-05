'use client';

import { useState, useCallback, useRef, type RefObject } from 'react';

type State = 'idle' | 'loading' | 'success' | 'error';

interface UseFormSubmitOptions {
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
  successDuration?: number;
}

interface UseFormSubmitReturn {
  state: State;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  formRef: RefObject<HTMLFormElement | null>;
  handleSubmit: (fn: () => Promise<void>) => Promise<void>;
  reset: () => void;
}

export function useFormSubmit(options: UseFormSubmitOptions = {}): UseFormSubmitReturn {
  const { onSuccess, onError, successDuration = 2000 } = options;
  const [state, setState] = useState<State>('idle');
  const formRef = useRef<HTMLFormElement | null>(null);

  const handleSubmit = useCallback(
    async (fn: () => Promise<void>) => {
      setState('loading');
      try {
        await fn();
        setState('success');
        onSuccess?.();
        setTimeout(() => setState('idle'), successDuration);
      } catch (err) {
        setState('error');
        onError?.(err);
        if (formRef.current) {
          formRef.current.classList.add('chq-shake');
          formRef.current.addEventListener(
            'animationend',
            () => {
              formRef.current?.classList.remove('chq-shake');
            },
            { once: true },
          );
        }
        setTimeout(() => setState('idle'), 2000);
      }
    },
    [onSuccess, onError, successDuration],
  );

  const reset = useCallback(() => setState('idle'), []);

  return {
    state,
    isLoading: state === 'loading',
    isSuccess: state === 'success',
    isError: state === 'error',
    formRef,
    handleSubmit,
    reset,
  };
}
