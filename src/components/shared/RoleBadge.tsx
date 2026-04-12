'use client';

import { useTranslations } from 'next-intl';

const styles: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700 border border-purple-200',
  admin: 'bg-blue-100 text-blue-700 border border-blue-200',
  assistant: 'bg-teal-100 text-teal-700 border border-teal-200',
  teacher: 'bg-amber-100 text-amber-700 border border-amber-200',
  super_admin: 'bg-red-100 text-red-700 border border-red-200',
};

const KNOWN_ROLES = ['owner', 'admin', 'assistant', 'teacher', 'super_admin'] as const;

export default function RoleBadge({ role }: { role: string }) {
  const tRoles = useTranslations('roles');
  const key = role?.toLowerCase() ?? '';
  const label =
    role && (KNOWN_ROLES as readonly string[]).includes(key)
      ? tRoles(key as (typeof KNOWN_ROLES)[number])
      : role;
  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${styles[key] ?? 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]'}`}
    >
      {label}
    </span>
  );
}
