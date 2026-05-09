'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Building2 } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { useBranchStore, type Branch } from '@/stores/branchStore';
import { supabase } from '@/lib/supabase';

export function BranchSwitcher() {
  const t = useTranslations('settings');
  const { user } = useUser();
  const { activeCenterId, setActiveCenterId } = useBranchStore();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [plan, setPlan] = useState<'single' | 'multi'>('single');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch('/api/branches', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        if (data?.branches) {
          const br = data.branches as Branch[];
          setBranches(br);
          useBranchStore.getState().setBranches(br);
          setPlan((data.plan as 'single' | 'multi') ?? 'single');
          const firstId = data.branches[0]?.id;
          const current = activeCenterId ?? user?.center_id ?? firstId;
          if (current && data.branches.some((b: Branch) => b.id === current)) {
            setActiveCenterId(current);
          } else if (firstId) {
            setActiveCenterId(firstId);
          }
        }
      } catch {
        setBranches([]);
      } finally {
        setLoading(false);
      }
    };
    fetchBranches();
  }, [user?.center_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeBranch = branches.find((b) => b.id === activeCenterId) ?? branches[0];
  const isMultiBranch = plan === 'multi' && branches.length > 1;

  if (!user || loading || branches.length === 0) {
    return (
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-0.5">{t('centerName')}</p>
        <p className="text-sm font-semibold text-[var(--color-text-secondary)] truncate">{user?.center?.name ?? '-'}</p>
      </div>
    );
  }

  if (!isMultiBranch) {
    return (
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-0.5">{t('centerName')}</p>
        <p className="text-sm font-semibold text-[var(--color-text-secondary)] truncate">{activeBranch?.name ?? user?.center?.name ?? '-'}</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-b border-[var(--color-border)] relative">
      <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">{t('centerName')}</p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full text-start rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface-2)] transition-colors group"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Switch branch"
      >
        {activeBranch?.logo_url ? (
          <img src={activeBranch.logo_url} alt="" className="w-6 h-6 rounded object-contain shrink-0" />
        ) : (
          <div className="w-6 h-6 rounded bg-teal-600/80 flex items-center justify-center shrink-0">
            <Building2 size={12} className="text-primary-foreground" />
          </div>
        )}
        <span className="flex-1 text-sm font-semibold text-[var(--color-text-secondary)] truncate">{activeBranch?.name ?? '-'}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-600/20 text-[var(--color-text-brand)] font-medium shrink-0">
          {branches.length} branches
        </span>
        <ChevronDown size={14} className={`text-[var(--color-text-secondary)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setOpen(false)} />
          <ul
            role="listbox"
            className="absolute start-2 end-2 mt-1 py-1 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto"
          >
            {branches.map((b) => (
              <li key={b.id} role="option" aria-selected={b.id === activeCenterId}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveCenterId(b.id);
                    setOpen(false);
                  }}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-start text-sm transition-colors ${b.id === activeCenterId ? 'bg-teal-600/10 text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'}`}
                >
                  {b.logo_url ? (
                    <img src={b.logo_url} alt="" className="w-5 h-5 rounded object-contain shrink-0" />
                  ) : (
                    <div className="w-5 h-5 rounded bg-[var(--color-surface-2)] flex items-center justify-center shrink-0">
                      <Building2 size={10} className="text-[var(--color-text-muted)]" />
                    </div>
                  )}
                  <span className="truncate">{b.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
