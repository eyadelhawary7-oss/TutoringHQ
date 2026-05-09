'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  icon: LucideIcon;
  className?: string;
};

/**
 * Flips left/right icons in RTL so chevrons and arrows point the logical "forward" direction.
 */
export function DirectionalIcon({ icon: Icon, className }: Props) {
  return <Icon className={cn('rtl:scale-x-[-1]', className)} aria-hidden />;
}
