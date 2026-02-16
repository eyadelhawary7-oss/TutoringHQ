'use client';

import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeName } from '@/contexts/ThemeContext';
import { Moon, CircleDot, Sun } from 'lucide-react';

const THEMES: { id: ThemeName; label: string; icon: React.ReactNode }[] = [
  { id: 'dark-blue', label: 'Dark Blue', icon: <Moon className="w-4 h-4" /> },
  { id: 'midnight', label: 'Midnight', icon: <CircleDot className="w-4 h-4" /> },
  { id: 'light', label: 'Light', icon: <Sun className="w-4 h-4" /> },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-black/20">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTheme(t.id)}
          title={t.label}
          className={`p-2 rounded-md transition-all duration-200 ${
            theme === t.id
              ? 'bg-indigo-500/50 text-white'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
          aria-label={t.label}
        >
          {t.icon}
        </button>
      ))}
    </div>
  );
}
