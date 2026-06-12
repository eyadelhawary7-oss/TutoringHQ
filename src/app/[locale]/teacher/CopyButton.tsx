'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * Brass copy-to-clipboard button with a brief "copied" confirmation. Shared by
 * the share-profile, referral, and first-group surfaces.
 */
export default function CopyButton({
  value,
  label,
  copiedLabel,
  className = '',
}: {
  value: string;
  label: string;
  copiedLabel: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure context / permissions) - no-op.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={[
        'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-brass)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90',
        className,
      ].join(' ')}
    >
      {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
      {copied ? copiedLabel : label}
    </button>
  );
}
