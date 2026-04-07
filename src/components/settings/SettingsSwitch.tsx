'use client';

type Props = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-labelledby'?: string;
};

/**
 * Shared teal track switch for settings (avoids native checkbox styling).
 */
export function SettingsSwitch({
  checked,
  onCheckedChange,
  disabled = false,
  id,
  'aria-labelledby': labelledBy,
}: Props) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-teal-600' : 'bg-slate-200 dark:bg-slate-600'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-slate-200 shadow ring-0 transition-transform duration-150 ${
          checked ? 'translate-x-5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
