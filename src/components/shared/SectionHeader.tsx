'use client';

interface SectionHeaderProps {
  title: string;
}

export default function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <p className="text-xs font-medium text-[var(--color-text-muted)] mt-2 mb-0">
      {title}
    </p>
  );
}
