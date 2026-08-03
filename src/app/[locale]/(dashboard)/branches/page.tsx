'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { useUser } from '@/contexts/UserContext';
import { useBranchStore } from '@/stores/branchStore';
import PageHeader from '@/components/shared/PageHeader';
import { ExpandableRow, ActionSheet, type SheetAction, type InlineAction } from '@/components/patterns';
import {
  Building2,
  Plus,
  Loader2,
  Users,
  Repeat,
  LineChart,
  LayoutGrid,
  Pencil,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatNumber';

interface BranchRow {
  id: string;
  name: string;
  students: number;
  mrr: number;
  outstanding: number;
  district: string | null;
  /**
   * From /api/branches. Feeds the "main branch" tag: the org's OLDEST centre
   * is main — a documented derivation, because no primary/main marker column
   * exists in the live catalog (recorded as a migration ask).
   */
  created_at: string | null;
  /** null — never 0 — when the branch ran no session in the trailing 30 days. */
  attendance_pct: number | null;
}

interface ConsolidatedData {
  total_mrr: number;
  total_students: number;
  total_outstanding: number;
  by_branch: BranchRow[];
}

export default function BranchesPage() {
  const t = useTranslations('branches');
  const tCommon = useTranslations('common');
  const tToast = useTranslations('toasts');
  const locale = useLocale();
  const { user } = useUser();
  const isOwner = user?.role === 'owner' || user?.role === 'super_admin';
  const setActiveCenterId = useBranchStore((s) => s.setActiveCenterId);

  const [plan, setPlan] = useState<'single' | 'multi'>('single');
  const [orgName, setOrgName] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [consolidated, setConsolidated] = useState<ConsolidatedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDistrict, setNewDistrict] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sheetBranch, setSheetBranch] = useState<BranchRow | null>(null);
  const [editingBranch, setEditingBranch] = useState<BranchRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editDistrict, setEditDistrict] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The one config point for the add-branch price notice:
   * platform_config['branch_addon.monthly_price_egp'] via /api/branches.
   * Absent live today → null → the notice does not render at all. No invented
   * 199, no billing claim the engine does not make.
   */
  const [addonPrice, setAddonPrice] = useState<number | null>(null);

  // Both sheets close on Escape, matching their scrim tap.
  useEffect(() => {
    if (!showAddForm && !editingBranch) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAddForm(false);
        setEditingBranch(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showAddForm, editingBranch]);

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setLoading(true);
    setError(null);
    try {
      const [branchesRes, consolidatedRes] = await Promise.all([
        fetch('/api/branches', { headers: { Authorization: `Bearer ${session.access_token}` } }),
        fetch('/api/analytics/consolidated', { headers: { Authorization: `Bearer ${session.access_token}` } }),
      ]);

      const branchesData = await branchesRes.json();
      const consolidatedData = consolidatedRes.ok ? await consolidatedRes.json() : null;

      // /api/branches is the source for district + created_at (the main-branch
      // derivation input); /api/analytics/consolidated is the source for stats.
      const branchMeta = new Map<string, { district: string | null; created_at: string | null }>();
      if (branchesData?.branches) {
        setPlan((branchesData.plan as 'single' | 'multi') ?? 'single');
        setOrgName((branchesData.organization_name as string | null) ?? null);
        for (const b of branchesData.branches as { id: string; district?: string | null; created_at?: string | null }[]) {
          branchMeta.set(b.id, { district: b.district ?? null, created_at: b.created_at ?? null });
        }
        const addonRaw = branchesData.branch_addon_monthly_price_egp;
        setAddonPrice(typeof addonRaw === 'number' && Number.isFinite(addonRaw) && addonRaw > 0 ? addonRaw : null);
      }

      if (consolidatedData?.by_branch && consolidatedData.by_branch.length > 0) {
        const byBranch = consolidatedData.by_branch as (BranchRow & { center_id: string })[];
        const rows: BranchRow[] = byBranch.map((b) => ({
          id: b.center_id,
          name: b.name,
          students: b.students,
          mrr: b.mrr,
          outstanding: b.outstanding,
          district: branchMeta.get(b.center_id)?.district ?? b.district ?? null,
          created_at: branchMeta.get(b.center_id)?.created_at ?? null,
          attendance_pct: b.attendance_pct ?? null,
        }));
        setConsolidated({ ...consolidatedData, by_branch: rows });
        setBranches(rows);
      } else if (branchesData?.branches) {
        const br = branchesData.branches as { id: string; name: string; district?: string | null; created_at?: string | null }[];
        const rows: BranchRow[] = br.map((b) => ({
          id: b.id,
          name: b.name,
          students: 0,
          mrr: 0,
          outstanding: 0,
          district: b.district ?? null,
          created_at: b.created_at ?? null,
          attendance_pct: null,
        }));
        setBranches(rows);
        if (br.length > 0) {
          setConsolidated({ total_mrr: 0, total_students: 0, total_outstanding: 0, by_branch: rows });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddBranch = async () => {
    if (!newName.trim() || !isOwner) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setAdding(true);
    setError(null);
    try {
      const res = await fetch('/api/branches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ name: newName.trim(), district: newDistrict.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setNewName('');
      setNewDistrict('');
      setShowAddForm(false);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAdding(false);
    }
  };

  /**
   * Editing goes through PATCH /api/branches — a narrow REST route (owner-only,
   * CSRF, org-scoped in its WHERE clause), NOT the legacy /api/db proxy, which
   * bans new callers and force-scopes `centers` to the caller's own centre.
   * Because the route scopes by organization, an owner can rename ANY branch of
   * the org, not just the one they are standing in.
   */
  const openEdit = (b: BranchRow) => {
    setEditingBranch(b);
    setEditName(b.name);
    setEditDistrict(b.district ?? '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBranch || !editName.trim()) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch('/api/branches', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({
          id: editingBranch.id,
          name: editName.trim(),
          district: editDistrict.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setBranches((prev) =>
        prev.map((b) => (b.id === editingBranch.id ? { ...b, name: editName.trim(), district: editDistrict.trim() || null } : b)),
      );
      setEditingBranch(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : tToast('error'));
    } finally {
      setSavingEdit(false);
    }
  };

  const switchToBranch = (b: BranchRow) => {
    // The same Zustand store the sidebar BranchSwitcher persists to — not a
    // second, parallel notion of "which branch am I in".
    setActiveCenterId(b.id);
    setNotice(t('switched'));
  };

  const branchSheetActions = (b: BranchRow): SheetAction[] => {
    const actions: SheetAction[] = [
      { id: 'switch', label: t('switchToThis'), icon: Repeat, onSelect: () => switchToBranch(b) },
    ];
    if (isOwner) {
      actions.push({ id: 'edit', label: t('edit'), icon: Pencil, onSelect: () => openEdit(b) });
    }
    return actions;
  };

  const branchInlineActions = (b: BranchRow): InlineAction[] => [
    { id: 'switch', label: t('switchToThis'), icon: Repeat, onSelect: () => switchToBranch(b) },
    {
      id: 'dashboard',
      label: t('dashboard'),
      icon: LineChart,
      // Design (§04): the Dashboard chip means THAT branch's dashboard, so it
      // switches first. The store persists (zustand persist), so the value
      // survives the full navigation.
      onSelect: () => {
        setActiveCenterId(b.id);
        window.location.href = `/${locale}/dashboard`;
      },
    },
    { id: 'edit', label: t('edit'), icon: Pencil, onSelect: () => openEdit(b), disabled: !isOwner },
  ];

  /**
   * The org's oldest centre wears the design's "main branch" tag. There is no
   * marker column (recorded migration ask); until one exists the derivation is
   * min(created_at), and when created_at is unavailable NO branch claims to be
   * main rather than all of them claiming not to be.
   */
  const mainBranchId = (() => {
    let best: BranchRow | null = null;
    for (const b of branches) {
      if (!b.created_at) continue;
      if (!best || b.created_at < (best.created_at as string)) best = b;
    }
    return best?.id ?? null;
  })();

  if (loading && branches.length === 0) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <div className="h-8 w-48 rounded-lg bg-[var(--color-surface-2)] animate-pulse mb-4" />
        <div className="h-4 w-72 rounded bg-[var(--color-surface-2)] animate-pulse mb-8" />
        <div className="grid grid-cols-2 gap-4 mb-6">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
              <div className="h-6 w-20 rounded bg-[var(--color-surface-2)] animate-pulse mb-2" />
              <div className="h-3 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  /**
   * KEPT against the design (which never draws it).
   *
   * This is the only entry point to the paid multi-branch upgrade, and live
   * every centre is `plan: 'single'` — zero rows in `centers` carry an
   * `organization_id`. Removing it would strand 100% of production on a blank
   * page.
   */
  if (plan === 'single') {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        {/* Same "{name} · {n} branches" pattern as the multi screen, with the
            real centre name — the upgrade copy lives in the card below. */}
        <PageHeader
          title={t('title')}
          subtitle={t('headerSubtitle', {
            org: user?.center?.name ?? '',
            count: formatNumber(Math.max(branches.length, 1), locale),
          })}
        />
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 max-w-lg">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-xl bg-teal-100 flex items-center justify-center">
              <Building2 className="h-7 w-7 text-teal-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--color-text-primary)]">{t('upgradeTitle')}</h2>
              <p className="text-[var(--color-text-muted)] text-sm">{t('upgradeBody')}</p>
            </div>
          </div>
          <p className="text-[var(--color-text-secondary)] mb-6">{t('upgradeDesc')}</p>
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white font-medium hover:bg-teal-700 transition-colors"
          >
            {t('upgradeCta')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] p-6" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader
        title={t('title')}
        subtitle={t('headerSubtitle', {
          org: orgName ?? user?.center?.name ?? '',
          count: formatNumber(branches.length, locale),
        })}
      >
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            aria-label={t('addBranch')}
            title={t('addBranch')}
            className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-teal-600 text-white transition-colors hover:bg-teal-700 btn-press chq-focus"
          >
            <Plus size={22} aria-hidden />
          </button>
        )}
      </PageHeader>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--color-danger-muted)] text-[var(--color-danger)] text-sm">{error}</div>
      )}
      {notice && (
        <div className="mb-4 p-3 rounded-lg bg-teal-500/10 text-teal-700 text-sm">{notice}</div>
      )}

      {/* Design (§04): TWO KPIs. The old third card, "Total Outstanding", is
          gone — and "Total MRR" was never MRR: /api/analytics/consolidated sums
          CONFIRMED PAYMENTS IN THE CURRENT CALENDAR MONTH, which is what the
          design's "This month · EGP" actually says. */}
      {consolidated && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
            <p className="font-mono text-2xl font-bold tabular-nums text-[var(--color-text-primary)]">
              {formatNumber(consolidated.total_students, locale)}
            </p>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]">
              <Users size={14} aria-hidden />
              {t('totalStudents')}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
            <p className="font-mono text-2xl font-bold tabular-nums text-[var(--color-text-primary)]">
              {formatNumber(consolidated.total_mrr, locale)}
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t('thisMonthEgp')}</p>
          </div>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-secondary)]">{t('branchesSection')}</h2>
      <div className="flex flex-col gap-2">
        {branches.map((b) => {
          const isCurrent = user?.center_id === b.id;
          return (
            <div
              key={b.id}
              className={isCurrent ? 'rounded-lg shadow-[0_0_0_2px_rgba(14,107,97,0.10)] ring-1 ring-[var(--color-accent)]' : ''}
            >
              <ExpandableRow
                title={b.name}
                meta={
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {/* Design (§04): "12 El-Nasr St · main branch". The tag is
                        the min-created_at derivation; with no created_at data
                        no branch claims to be main. */}
                    {(() => {
                      const tag = mainBranchId == null ? null : b.id === mainBranchId ? t('mainBranch') : t('branchTag');
                      const line = [b.district, tag].filter(Boolean).join(' · ');
                      return line ? <span>{line}</span> : null;
                    })()}
                    <span className="font-mono tabular-nums">
                      {formatNumber(b.students, locale)} {t('studentsLower')}
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatNumber(b.mrr, locale)} {t('egpPerMonth')}
                    </span>
                    {/* An em dash, never 0% — a branch with no session in the
                        window has no attendance rate to report. */}
                    <span className="font-mono tabular-nums">
                      {b.attendance_pct != null ? formatPercent(b.attendance_pct, locale) : '—'} {t('attendance')}
                    </span>
                  </span>
                }
                badge={
                  isCurrent ? (
                    <span className="shrink-0 rounded-full bg-teal-500/12 px-2 py-0.5 text-xs font-semibold text-teal-700">
                      {t('current')}
                    </span>
                  ) : undefined
                }
                expanded={expandedId === b.id}
                onToggle={() => setExpandedId((v) => (v === b.id ? null : b.id))}
                inlineActions={branchInlineActions(b)}
                onMore={() => setSheetBranch(b)}
                moreLabel={t('more')}
              />
            </div>
          );
        })}
      </div>

      {/* Add-branch bottom sheet (design §04 "EN · add branch"): grab handle,
          name, area, the config-gated add-on notice, ONE primary button. No
          Cancel — scrim tap and Escape close, like every sheet here. */}
      {showAddForm && isOwner && (
        <div className="fixed inset-0 z-50" role="presentation">
          <div className="absolute inset-0 bg-[rgba(20,22,20,0.34)]" onClick={() => setShowAddForm(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('addBranch')}
            className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-[var(--color-panel)] px-6 pb-6 pt-2 shadow-[0_-10px_40px_rgba(0,0,0,0.16)]"
          >
            <div className="mx-auto mb-3 mt-1 h-1 w-10 rounded-pill bg-[var(--color-line)]" aria-hidden />
            <h2 className="mb-3 text-lg font-bold text-[var(--color-text-primary)]">{t('addBranch')}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleAddBranch();
              }}
              className="space-y-3"
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">{t('branchName')}</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t('branchNamePlaceholder')}
                  autoFocus
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25"
                />
              </div>
              <div>
                {/* Maps to the existing `centers.district`; there is no
                    `centers.address` column and none was added. */}
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">{t('areaAddress')}</label>
                <input
                  type="text"
                  value={newDistrict}
                  onChange={(e) => setNewDistrict(e.target.value)}
                  placeholder={t('areaAddressPlaceholder')}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25"
                />
              </div>
              {/* Renders ONLY when platform_config['branch_addon.monthly_price_egp']
                  exists and is positive — it does not exist live, so today this
                  notice is absent. When Eyad prices the add-on (config value +
                  the billing-engine line that charges it), it appears with no
                  code change. Never a hardcoded 199. */}
              {addonPrice != null && (
                <div className="flex items-center gap-2.5 rounded-md border border-[rgba(138,94,22,0.25)] bg-[#FBFAF5] px-3 py-2.5">
                  <LayoutGrid size={16} className="shrink-0 text-[#8A5E16]" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-[var(--color-text-secondary)]">{t('addonTitle')}</p>
                    <p className="font-mono text-xs text-[var(--color-text-muted)]">
                      {t('addonLine', { price: formatCurrency(addonPrice, locale) })}
                    </p>
                  </div>
                </div>
              )}
              <button
                type="submit"
                disabled={adding || !newName.trim()}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-teal-600 font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50 btn-press chq-focus"
              >
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus size={18} aria-hidden />}
                {t('addBranch')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit-branch bottom sheet — same presentation as Add, per the design's
          one-sheet language. Submits to PATCH /api/branches (org-scoped). */}
      {editingBranch && (
        <div className="fixed inset-0 z-50" role="presentation">
          <div className="absolute inset-0 bg-[rgba(20,22,20,0.34)]" onClick={() => setEditingBranch(null)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('edit')}
            className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-[var(--color-panel)] px-6 pb-6 pt-2 shadow-[0_-10px_40px_rgba(0,0,0,0.16)]"
          >
            <div className="mx-auto mb-3 mt-1 h-1 w-10 rounded-pill bg-[var(--color-line)]" aria-hidden />
            <h2 className="mb-1 text-lg font-bold text-[var(--color-text-primary)]">{t('edit')}</h2>
            <p className="mb-3 truncate text-sm text-[var(--color-text-muted)]">{editingBranch.name}</p>
            <form onSubmit={handleSaveEdit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">{t('branchName')}</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">{t('areaAddress')}</label>
                <input
                  value={editDistrict}
                  onChange={(e) => setEditDistrict(e.target.value)}
                  placeholder={t('areaAddressPlaceholder')}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25"
                />
              </div>
              <button
                type="submit"
                disabled={savingEdit}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-teal-600 font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50 btn-press chq-focus"
              >
                {tCommon('save')}
              </button>
            </form>
          </div>
        </div>
      )}

      <ActionSheet
        open={sheetBranch !== null}
        onClose={() => setSheetBranch(null)}
        title={sheetBranch?.name ?? ''}
        subtitle={sheetBranch?.district ?? undefined}
        actions={sheetBranch ? branchSheetActions(sheetBranch) : []}
      />
    </div>
  );
}
