import type { ReactNode } from 'react';
import { LoginThemeEffect } from '@/components/LoginThemeEffect';

export default function ForgotPasswordLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <LoginThemeEffect />
      {children}
    </>
  );
}
