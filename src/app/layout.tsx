import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

// Root layout just passes through - [locale]/layout.tsx handles everything
export default function RootLayout({ children }: Props) {
  return children;
}
