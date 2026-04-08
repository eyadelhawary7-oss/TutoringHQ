import type { ReactNode } from 'react';
import { LoginThemeEffect } from '@/components/LoginThemeEffect';

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <LoginThemeEffect />
      {children}
    </>
  );
}
