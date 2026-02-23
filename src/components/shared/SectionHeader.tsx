'use client';

interface SectionHeaderProps {
  title: string;
}

export default function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-xs font-semibold tracking-widest text-slate-500 uppercase">{title}</span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}
