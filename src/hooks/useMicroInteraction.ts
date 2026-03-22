'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type MicroState = 'idle' | 'loading' | 'success' | 'error';

type Options = {
  successDuration?: number;
  errorDuration?: number;
};

export type MicroInteractionResult = {
  state: MicroState;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  trigger: (action: () => Promise<void>) => Promise<void>;
  reset: () => void;
};

export function useMicroInteraction(options: Options = {}): MicroInteractionResult {
  const { successDuration = 1500, errorDuration = 2000 } = options;
  const [state, setState] = useState<MicroState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const trigger = useCallback(
    async (action: () => Promise<void>) => {
      if (state === 'loading') return;
      setState('loading');
      try {
        await action();
        setState('success');
        timerRef.current = setTimeout(() => setState('idle'), successDuration);
      } catch {
        setState('error');
        timerRef.current = setTimeout(() => setState('idle'), errorDuration);
      }
    },
    [state, successDuration, errorDuration]
  );

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState('idle');
  }, []);

  return {
    state,
    isLoading: state === 'loading',
    isSuccess: state === 'success',
    isError: state === 'error',
    trigger,
    reset,
  };
}
