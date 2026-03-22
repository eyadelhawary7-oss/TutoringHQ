'use client';

const styles: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700 border border-purple-200',
  admin: 'bg-blue-100 text-blue-700 border border-blue-200',
  assistant: 'bg-teal-100 text-teal-700 border border-teal-200',
  teacher: 'bg-amber-100 text-amber-700 border border-amber-200',
};

export default function RoleBadge({ role }: { role: string }) {
  const key = role?.toLowerCase() ?? '';
  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${styles[key] ?? 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]'}`}
    >
      {role ? role.charAt(0).toUpperCase() + role.slice(1) : role}
    </span>
  );
}
