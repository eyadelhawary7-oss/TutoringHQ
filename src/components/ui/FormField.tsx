'use client';

import type { ReactNode } from 'react';

export interface FormFieldProps {
  label?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}

export default function FormField({ label, error, children, htmlFor }: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-[var(--color-text-primary)]">
          {label}
        </label>
      )}
      <div className={error ? '[&_input]:border-red-500 [&_input]:focus:ring-red-500/20 [&_input]:focus:border-red-500' : ''}>
        {children}
      </div>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
