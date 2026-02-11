import type { ReactNode } from 'react';
import './globals.css';

type Props = {
  children: ReactNode;
};

// Since we have a `[locale]` segment, this is a root layout that just passes through
export default function RootLayout({ children }: Props) {
  return children;
}
