'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export type Validator<T = string> = (value: T) => string | null;

export interface UseFieldValidationOptions<T = string> {
  value: T;
  validator: Validator<T>;
  debounce?: number;
}

export interface UseFieldValidationResult {
  error: string | null;
  isValid: boolean;
  isTouched: boolean;
  setTouched: (touched: boolean) => void;
  validate: () => string | null;
}

export function useFieldValidation<T = string>({
  value,
  validator,
  debounce = 400,
}: UseFieldValidationOptions<T>): UseFieldValidationResult {
  const [error, setError] = useState<string | null>(null);
  const [isTouched, setTouched] = useState(false);

  const validate = useCallback(() => {
    const err = validator(value);
    setError(err);
    return err;
  }, [validator, value]);

  useEffect(() => {
    if (!isTouched) return;
    const tid = setTimeout(() => validate(), debounce);
    return () => clearTimeout(tid);
  }, [value, isTouched, debounce, validate]);

  const isValid = error === null;

  return useMemo(
    () => ({
      error,
      isValid,
      isTouched,
      setTouched,
      validate,
    }),
    [error, isValid, isTouched, validate]
  );
}
