'use client';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: string;
  children?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{title}</h1>
        {subtitle && <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
