'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  MessageCircle,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import { BLAST_PRICE_PER_PARENT, getAnnouncementCap } from '@/lib/parentPack';
import { supabase } from '@/lib/supabase';
import { dbUpdate } from '@/lib/db-proxy';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

const ANNOUNCEMENT_MESSAGE_MAX = 160;

type CenterData = {
  id: string;
  name: string;
  phone: string | null;
  plan: string;
  parent_pack_enabled: boolean;
  parent_pack_active_parents: number;
  announcement_balance: string | number;
};

type StudentRow = {
  id: string;
  name: string;
  student_number: string | null;
  parent_phone: string | null;
  parent_pack_opted_in: boolean | null;
};

type BlastRow = {
  id: string;
  blast_type: string;
  message: string;
  parents_notified: number;
  total_amount: string | number;
  billing_status: string;
  created_at: string;
};

type Props = {
  center: CenterData;
  students: StudentRow[];
  blasts: BlastRow[];
  lastAlertMap: Record<string, string>;
  locale: string;
  packRequestStatus: string;
  packRejectionReason: string | null;
  packRequestedAt: string | null;
  packPendingBalance: number;
  monthsWithoutInvoice: number;
  announcementsThisMonth: number;
};

async function jsonAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

export default function WhatsAppPackClient({
  center,
  students,
  blasts,
  lastAlertMap,
  locale,
  packRequestStatus,
  packRejectionReason,
  packRequestedAt,
  packPendingBalance,
  monthsWithoutInvoice,
  announcementsThisMonth: initialAnnouncementsThisMonth,
}: Props) {
  const t = useTranslations();
  const toast = useToast();
  const router = useRouter();

  const [requestStatus, setRequestStatus] = useState(packRequestStatus);
  const [rejectionReason, setRejectionReason] = useState(packRejectionReason);
  const [packRequestedAtState, setPackRequestedAtState] = useState(packRequestedAt);
  const [submitting, setSubmitting] = useState(false);
  const [packEnabled, setPackEnabled] = useState(center.parent_pack_enabled);
  const [activeParents, setActiveParents] = useState(center.parent_pack_active_parents);
  const [balance, setBalance] = useState(Number(center.announcement_balance ?? 0));
  const [blastList, setBlastList] = useState<BlastRow[]>(blasts);
  const [studentList, setStudentList] = useState<StudentRow[]>(students);
  const [blastType, setBlastType] = useState<'ops' | 'promo' | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [announcementInlineError, setAnnouncementInlineError] = useState<string | null>(null);
  const [announcementsThisMonth, setAnnouncementsThisMonth] = useState(initialAnnouncementsThisMonth);
  const [togglingPack, setTogglingPack] = useState(false);
  const [confirmClearId, setConfirmClearId] = useState<string | null>(null);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [parentsExpanded, setParentsExpanded] = useState(true);
  const [parentSearch, setParentSearch] = useState('');

  const cap = getAnnouncementCap(center.plan);
  const pct = cap > 0 ? Math.min((balance / cap) * 100, 100) : 0;
  const pendingBal = Number(packPendingBalance);
  const monthsAccum = Number(monthsWithoutInvoice);
  const blastCost = activeParents * BLAST_PRICE_PER_PARENT;
  const remainingAllowance = Math.max(0, cap - balance);
  const monthlyLimitReached = announcementsThisMonth >= 2;
  const cannotAffordBlast = balance >= cap || pct >= 100;

  const sendAnnouncementBlast = useCallback(async () => {
    if (!blastType || !message.trim()) return;
    setSending(true);
    setAnnouncementInlineError(null);
    const currentBlastType = blastType;
    const currentMessage = message;
    try {
      const res = await fetch('/api/parent-pack/announcement', {
        method: 'POST',
        headers: await jsonAuthHeaders(),
        body: JSON.stringify({ blast_type: currentBlastType, message: currentMessage }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        sent?: number;
        totalCost?: number;
      };
      if (!res.ok) {
        if (payload.error === 'monthly_limit') {
          setAnnouncementInlineError(t('whatsapp.announcementMonthlyLimit'));
        } else if (payload.error === 'cap_reached') {
          setAnnouncementInlineError(t('whatsapp.capReached'));
        } else if (payload.error === 'no_parents') {
          setAnnouncementInlineError(t('whatsapp.noParentsForBlast'));
        } else {
          setAnnouncementInlineError(payload.message ?? payload.error ?? t('common.errorGeneric'));
        }
        return;
      }
      const cost = Number(payload.totalCost ?? blastCost);
      setBalance((prev) => prev + cost);
      setAnnouncementsThisMonth((n) => n + 1);
      setBlastType(null);
      setMessage('');
      setShowConfirm(false);
      setBlastList((prev) => [
        {
          id: Date.now().toString(),
          blast_type: currentBlastType!,
          message: currentMessage,
          parents_notified: activeParents,
          total_amount: cost,
          billing_status: 'pending',
          created_at: new Date().toISOString(),
        },
        ...prev.slice(0, 9),
      ]);
      toast.success(t('whatsapp.announcementSent', { count: activeParents }));
      router.refresh();
    } finally {
      setSending(false);
    }
  }, [blastType, message, activeParents, blastCost, t, toast, router]);

  const lastAlertLabel = useCallback(
    (phone: string | null) => {
      const ts = lastAlertMap[phone ?? ''];
      if (!ts) return '-';
      const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
      if (days === 0) return t('whatsapp.today');
      if (days === 1) return t('whatsapp.yesterday');
      return `${days.toLocaleString('en-US')} ${t('whatsapp.daysAgo')}`;
    },
    [lastAlertMap, t],
  );

  const grouped = new Map<string, StudentRow[]>();
  for (const s of studentList) {
    const key = s.parent_phone as string;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }

  const normalizedSearch = parentSearch.trim().toLowerCase();
  const filteredGroupedEntries =
    normalizedSearch === ''
      ? Array.from(grouped.entries())
      : Array.from(grouped.entries()).filter(([phone, group]) => {
          if (phone.toLowerCase().includes(normalizedSearch)) return true;
          return group.some((s) => {
            const name = (s.name ?? '').toLowerCase();
            const sn = (s.student_number ?? '').toLowerCase();
            const pp = (s.parent_phone ?? '').toLowerCase();
            return (
              name.includes(normalizedSearch) ||
              sn.includes(normalizedSearch) ||
              pp.includes(normalizedSearch)
            );
          });
        });

  async function postPackRequest() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/parent-pack/request', {
        method: 'POST',
        headers: await jsonAuthHeaders(),
      });
      if (res.ok) {
        setRequestStatus('pending');
        setPackRequestedAtState(new Date().toISOString());
        toast.success(t('whatsapp.requestSent'));
      } else {
        let errMsg: string | undefined;
        try {
          const err = (await res.json()) as { error?: string };
          errMsg = err.error;
        } catch {
          errMsg = undefined;
        }
        toast.error(errMsg ?? t('common.errorGeneric'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (packEnabled) {
    return (
      <div className="min-h-screen w-full bg-[#080D14] px-4 py-6 pb-24 md:pb-8 max-w-5xl mx-auto space-y-8">
        {/* Section 1 - Status */}
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 sm:p-6 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-teal-600/15 px-3 py-1 text-sm font-medium text-teal-600">
              {t('whatsapp.packActive')}
            </span>
            <span className="text-sm text-[var(--color-text-secondary)]">
              {activeParents.toLocaleString('en-US')} {t('whatsapp.activeParents')}
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('whatsapp.monthlyCost')}: {activeParents.toLocaleString('en-US')} × 12 ={' '}
            {(activeParents * 12).toLocaleString('en-US')} EGP
          </p>

          {pendingBal > 0 ? (
            <div className="mt-4 grid gap-4 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('whatsapp.pendingBalance')}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-text-primary)]">
                  {pendingBal.toLocaleString('en-US')} EGP
                </p>
                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{t('whatsapp.pendingBalanceNote')}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('whatsapp.monthsAccumulating')}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-text-primary)]">
                  {monthsAccum.toLocaleString('en-US')}
                </p>
                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">{t('whatsapp.monthsAccumulatingNote')}</p>
              </div>
            </div>
          ) : null}

          <div className="pt-2 space-y-3">
            <button
              type="button"
              disabled={togglingPack}
              onClick={() => setShowDisableConfirm(true)}
              className="text-sm font-medium text-red-400 border border-red-500/60 rounded-lg px-3 py-1.5 hover:bg-red-950/30 disabled:opacity-50"
            >
              {t('whatsapp.disablePack')}
            </button>
            {showDisableConfirm ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-4 space-y-3">
                <div className="flex gap-2 items-start">
                  <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" aria-hidden />
                  <p className="text-sm text-[var(--color-text-secondary)]">{t('whatsapp.disablePackWarning')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={togglingPack}
                    onClick={async () => {
                      setTogglingPack(true);
                      try {
                        const res = await fetch('/api/settings/parent-pack', {
                          method: 'PATCH',
                          headers: await jsonAuthHeaders(),
                          body: JSON.stringify({ enabled: false }),
                        });
                        if (res.ok) {
                          window.location.reload();
                        } else {
                          toast.error(t('common.errorGeneric'));
                        }
                      } finally {
                        setTogglingPack(false);
                      }
                    }}
                    className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {togglingPack ? <Loader2 className="inline h-4 w-4 animate-spin me-1" /> : null}
                    {t('whatsapp.confirmDisablePack')}
                  </button>
                  <button
                    type="button"
                    disabled={togglingPack}
                    onClick={() => setShowDisableConfirm(false)}
                    className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* Section 2 - Parents */}
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-6">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {t('whatsapp.parentTable')}
            </h2>
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              onClick={() => setParentsExpanded((prev) => !prev)}
              aria-label={
                parentsExpanded ? t('whatsapp.collapseParents') : t('whatsapp.expandParents')
              }
            >
              {parentsExpanded ? (
                <ChevronUp className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
          {parentsExpanded &&
            (grouped.size === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <MessageCircle className="h-12 w-12 text-teal-600/80 mb-3" />
                <p className="text-sm text-[var(--color-text-secondary)] max-w-md">{t('whatsapp.noParents')}</p>
                <Link
                  href="/students"
                  className="mt-4 text-sm font-medium text-teal-600 hover:underline"
                >
                  {t('whatsapp.goToStudents')}
                </Link>
              </div>
            ) : (
              <div className="p-4 sm:p-6 space-y-6">
                <div className="relative mb-3">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none"
                    aria-hidden
                  />
                  <input
                    type="text"
                    value={parentSearch}
                    onChange={(e) => setParentSearch(e.target.value)}
                    placeholder={t('whatsapp.searchParents')}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg ps-9 pe-10 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                  {parentSearch ? (
                    <button
                      type="button"
                      onClick={() => setParentSearch('')}
                      className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                      aria-label={t('whatsapp.clearParentSearch')}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>
                {filteredGroupedEntries.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-4">{t('whatsapp.noSearchResults')}</p>
                ) : (
                  filteredGroupedEntries.map(([phone, group]) => (
                <div key={phone} className="rounded-lg border border-[var(--color-border-subtle)] overflow-hidden">
                  <div className="bg-teal-900/20 px-3 py-2 font-medium text-sm text-teal-100 tabular-nums">
                    {phone}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                          <th className="text-start px-3 py-2 font-semibold">{t('common.name')}</th>
                          <th className="text-start px-3 py-2 font-semibold">{t('students.studentId')}</th>
                          <th className="text-start px-3 py-2 font-semibold">{t('whatsapp.notifications')}</th>
                          <th className="text-start px-3 py-2 font-semibold">{t('whatsapp.lastAlert')}</th>
                          <th className="w-24 px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {group.map((student) => {
                          const isOpted = student.parent_pack_opted_in ?? false;
                          return (
                            <tr key={student.id} className="border-b border-[var(--color-border-subtle)]">
                              <td className="px-3 py-2 font-medium">{student.name}</td>
                              <td className="px-3 py-2 text-xs text-slate-400 tabular-nums">
                                #{student.student_number ?? '-'}
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={isOpted}
                                  disabled={false}
                                  onClick={async () => {
                                    const newVal = !isOpted;
                                    setStudentList((prev) =>
                                      prev.map((s) =>
                                        s.id === student.id ? { ...s, parent_pack_opted_in: newVal } : s,
                                      ),
                                    );
                                    const res = await fetch(`/api/parent-pack/student/${student.id}`, {
                                      method: 'PATCH',
                                      headers: await jsonAuthHeaders(),
                                      body: JSON.stringify({ parent_pack_opted_in: newVal }),
                                    });
                                    if (res.ok) {
                                      const data = (await res.json()) as {
                                        activeParents?: number;
                                        activeCount?: number;
                                      };
                                      const next =
                                        data.activeParents ?? data.activeCount ?? activeParents;
                                      setActiveParents(next);
                                    } else {
                                      setStudentList((prev) =>
                                        prev.map((s) =>
                                          s.id === student.id ? { ...s, parent_pack_opted_in: !newVal } : s,
                                        ),
                                      );
                                    }
                                  }}
                                  className={cn(
                                    'relative inline-flex h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors',
                                    isOpted ? 'bg-teal-600' : 'bg-slate-600',
                                  )}
                                >
                                  <span
                                    className={cn(
                                      'h-6 w-6 rounded-full bg-slate-200 shadow transition-[margin]',
                                      isOpted ? 'ms-auto' : 'ms-0',
                                    )}
                                  />
                                </button>
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">
                                {lastAlertLabel(student.parent_phone)}
                              </td>
                              <td className="px-3 py-2">
                                {confirmClearId !== student.id ? (
                                  <button
                                    type="button"
                                    className="text-slate-400 hover:text-red-400 text-lg leading-none"
                                    aria-label={t('common.delete')}
                                    onClick={() => setConfirmClearId(student.id)}
                                  >
                                    ✕
                                  </button>
                                ) : (
                                  <div className="flex flex-col gap-1 items-start">
                                    <button
                                      type="button"
                                      className="text-xs font-semibold text-red-500"
                                      onClick={async () => {
                                        const { error } = await dbUpdate({
                                          table: 'students',
                                          data: {
                                            parent_phone: null,
                                            parent_pack_opted_in: false,
                                          },
                                          filters: [{ column: 'id', op: 'eq', value: student.id }],
                                        });
                                        if (!error) {
                                          const updated = studentList.filter((s) => s.id !== student.id);
                                          setStudentList(updated);
                                          const newActive = updated.filter(
                                            (s) => s.parent_pack_opted_in && s.parent_phone,
                                          ).length;
                                          setActiveParents(newActive);
                                          setConfirmClearId(null);
                                        }
                                      }}
                                    >
                                      {t('whatsapp.confirmClear')}
                                    </button>
                                    <button
                                      type="button"
                                      className="text-xs text-teal-500 hover:underline"
                                      onClick={() => setConfirmClearId(null)}
                                    >
                                      {t('common.cancel')}
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                  ))
                )}
              </div>
            )
          )}
        </section>

        {/* Section 3 - Announcement blast (parent_pack_enabled only; composer max 160 chars; sendAnnouncementBlast POST) */}
        <section
          className={cn(
            'rounded-2xl border border-slate-700/60 bg-slate-800/40 p-4 sm:p-6 space-y-4 shadow-sm',
            activeParents === 0 && 'opacity-50 pointer-events-none',
          )}
        >
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t('whatsapp.announcementSectionTitle')}
          </h2>
          {activeParents === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">{t('whatsapp.noParentsForBlast')}</p>
          ) : null}

          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('whatsapp.announcementBalanceRemaining', {
              remaining: remainingAllowance.toLocaleString('en-US'),
            })}
          </p>
          {remainingAllowance <= 0 ? (
            <p className="text-sm rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-200 px-3 py-2">
              {t('whatsapp.announcementNoBalance')}
            </p>
          ) : null}

          <p className="text-xs text-[var(--color-text-tertiary)]">
            {t('whatsapp.announcementMonthlyUsage', {
              used: announcementsThisMonth,
              max: 2,
            })}
          </p>
          {monthlyLimitReached ? (
            <p className="text-sm rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-200 px-3 py-2">
              {t('whatsapp.announcementMonthlyLimit')}
            </p>
          ) : null}

          <div>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-1">
              {balance.toLocaleString('en-US')} EGP / {cap.toLocaleString('en-US')} EGP {t('whatsapp.announcementUsedOfCap')}
            </p>
            <div className="w-full h-1 rounded bg-slate-200 dark:bg-slate-700 overflow-hidden" aria-hidden>
              <div
                className={cn('h-1 rounded transition-all', pct < 90 ? 'bg-teal-600' : 'bg-amber-500')}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setBlastType('ops');
                setAnnouncementInlineError(null);
              }}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-shadow',
                blastType === 'ops' ? 'ring-2 ring-teal-500 bg-teal-900 text-white' : 'bg-slate-100 dark:bg-slate-900 text-[var(--color-text-primary)]',
              )}
            >
              {t('billing.blastOps')}
            </button>
            <button
              type="button"
              onClick={() => {
                setBlastType('promo');
                setAnnouncementInlineError(null);
              }}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-shadow',
                blastType === 'promo' ? 'ring-2 ring-teal-500 bg-teal-900 text-white' : 'bg-slate-100 dark:bg-slate-900 text-[var(--color-text-primary)]',
              )}
            >
              {t('billing.blastPromo')}
            </button>
          </div>

          <div>
            <textarea
              dir="auto"
              data-announcement-message
              placeholder={t('whatsapp.announcementPlaceholder')}
              maxLength={ANNOUNCEMENT_MESSAGE_MAX}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setAnnouncementInlineError(null);
              }}
              className="w-full min-h-[100px] rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-2 text-sm text-[var(--color-text-primary)]"
            />
            <p className="text-end text-xs text-[var(--color-text-tertiary)] mt-1" data-announcement-counter>
              {message.length}/{ANNOUNCEMENT_MESSAGE_MAX}
            </p>
          </div>

          <div className="flex justify-end" dir="ltr">
            <div className="max-w-[min(100%,20rem)] rounded-2xl rounded-tr-sm bg-[#dcf8c6] dark:bg-[#056162] px-3 py-2.5 text-sm text-slate-900 dark:text-slate-50 shadow-sm">
              {blastType === 'ops'
                ? t('whatsapp.previewOps', { center: center.name, message: message.trim() || '…' })
                : blastType === 'promo'
                  ? t('whatsapp.previewPromo', { center: center.name, message: message.trim() || '…' })
                  : t('whatsapp.previewIdle', { center: center.name })}
            </div>
          </div>

          <div className="space-y-1 text-sm text-[var(--color-text-secondary)]">
            <p>
              {t('whatsapp.announcementCostLine', {
                cost: blastCost.toLocaleString('en-US'),
                parents: activeParents.toLocaleString('en-US'),
                price: BLAST_PRICE_PER_PARENT.toLocaleString('en-US'),
              })}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {t('whatsapp.announcementCostBalanceNote', { cost: blastCost.toLocaleString('en-US') })}
            </p>
          </div>

          {pct >= 90 && pct < 100 ? (
            <p className="text-sm rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-200 px-3 py-2">
              {t('whatsapp.capWarning')}
            </p>
          ) : null}
          {pct >= 100 ? (
            <p className="text-sm rounded-lg bg-red-500/15 text-red-700 dark:text-red-200 px-3 py-2">
              {t('whatsapp.capReached')}
            </p>
          ) : null}

          {announcementInlineError ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {announcementInlineError}
            </p>
          ) : null}

          <button
            type="button"
            disabled={
              !blastType ||
              !message.trim() ||
              cannotAffordBlast ||
              activeParents === 0 ||
              sending ||
              monthlyLimitReached
            }
            onClick={() => setShowConfirm(true)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {t('whatsapp.sendBtn')}
          </button>

          {showConfirm ? (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="announcement-confirm-title"
              onClick={() => {
                if (!sending) setShowConfirm(false);
              }}
            >
              <div
                className="w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-800/40 p-5 shadow-xl space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 id="announcement-confirm-title" className="text-lg font-semibold text-[var(--color-text-primary)]">
                  {t('whatsapp.announcementConfirmTitle', { parents: activeParents.toLocaleString('en-US') })}
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {t('whatsapp.announcementConfirmCost', {
                    cost: blastCost.toLocaleString('en-US'),
                    after: (balance + blastCost).toLocaleString('en-US'),
                  })}
                </p>
                <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => setShowConfirm(false)}
                    className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => void sendAnnouncementBlast()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t('whatsapp.announcementConfirmSend')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {/* Section 4 - History */}
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">{t('whatsapp.blastHistory')}</h2>
          {blastList.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">{t('whatsapp.noBlasts')}</p>
          ) : (
            <ul className="space-y-3">
              {blastList.map((blast) => (
                <li
                  key={blast.id}
                  className="rounded-lg border border-[var(--color-border-subtle)] p-3 flex flex-wrap gap-2 items-start justify-between"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        {new Date(blast.created_at).toLocaleDateString(
                          locale === 'ar' ? 'en-US' : 'en-US',
                          { day: 'numeric', month: 'long', year: 'numeric' },
                        )}
                      </span>
                      <span
                        className={cn(
                          'text-xs font-medium rounded px-2 py-0.5',
                          blast.blast_type === 'ops' ? 'bg-teal-900 text-teal-200' : 'bg-amber-900 text-amber-200',
                        )}
                      >
                        {blast.blast_type === 'ops' ? t('billing.blastOps') : t('billing.blastPromo')}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--color-text-primary)] break-words">
                      {blast.message.length > 60 ? `${blast.message.slice(0, 60)}...` : blast.message}
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {blast.parents_notified.toLocaleString('en-US')} ·{' '}
                      {`${Number(blast.total_amount).toLocaleString('en-US')} EGP`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  if (requestStatus === 'pending') {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full rounded-xl border border-amber-500/40 bg-[var(--color-surface-1)] p-8 text-center shadow-sm">
          <Clock className="mx-auto h-12 w-12 text-amber-500 mb-4" aria-hidden />
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('whatsapp.requestSubmitted')}</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t('whatsapp.requestPendingDesc')}</p>
          {packRequestedAtState ? (
            <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
              {t('whatsapp.requestedOn')}{' '}
              {new Date(packRequestedAtState).toLocaleDateString(
                locale === 'ar' ? 'en-US' : 'en-US',
                { day: 'numeric', month: 'long', year: 'numeric' },
              )}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (requestStatus === 'rejected') {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full rounded-xl border border-red-500/40 bg-[var(--color-surface-1)] p-8 text-center shadow-sm">
          <XCircle className="mx-auto h-12 w-12 text-red-500 mb-4" aria-hidden />
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('whatsapp.requestRejected')}</h1>
          {rejectionReason ? (
            <div className="mt-4 text-start space-y-1">
              <p className="text-xs font-medium text-[var(--color-text-secondary)]">{t('whatsapp.rejectionReason')}</p>
              <div
                dir="rtl"
                className="rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border-subtle)] p-3 text-sm text-[var(--color-text-secondary)]"
              >
                {rejectionReason}
              </div>
            </div>
          ) : null}
          <button
            type="button"
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                const res = await fetch('/api/parent-pack/request', {
                  method: 'POST',
                  headers: await jsonAuthHeaders(),
                });
                if (res.ok) {
                  setRequestStatus('pending');
                  setRejectionReason(null);
                  setPackRequestedAtState(new Date().toISOString());
                  toast.success(t('whatsapp.requestSent'));
                } else {
                  let errMsg: string | undefined;
                  try {
                    const err = (await res.json()) as { error?: string };
                    errMsg = err.error;
                  } catch {
                    errMsg = undefined;
                  }
                  toast.error(errMsg ?? t('common.errorGeneric'));
                }
              } finally {
                setSubmitting(false);
              }
            }}
            className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('whatsapp.resubmitRequest')}
          </button>
        </div>
      </div>
    );
  }

  /* STATE 1 - none (or other): request pack */
  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-8">
      <div className="max-w-md w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-8 text-center shadow-sm">
        <MessageCircle className="mx-auto h-12 w-12 text-teal-500 mb-4" aria-hidden />
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('whatsapp.packDisabledTitle')}</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t('whatsapp.requestPackDesc')}</p>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t('whatsapp.requestPackPricingLine')}</p>
        <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">{t('whatsapp.pricingNote')}</p>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void postPackRequest()}
          className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t('whatsapp.requestPack')}
        </button>
      </div>
    </div>
  );
}
