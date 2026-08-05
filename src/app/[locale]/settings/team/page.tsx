'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { PageHeader, RoleBadge } from '@/components/shared';
import PasswordConfirmModal from '@/components/PasswordConfirmModal';
import { StaffMemberCard, SIX_NEW_FLAGS } from '@/components/settings/StaffMemberCard';
import TeacherJoinRequests from '@/components/settings/TeacherJoinRequests';
import TeamMemberCard from '@/components/settings/TeamMemberCard';
import { ActionSheet, type SheetAction } from '@/components/patterns';
import { SettingsGroupLabel } from '@/components/settings/SettingsRows';
import type { CenterPermission } from '@/lib/centerPermissions';
import {
  BookOpen,
  Camera,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  Pencil,
  Shield,
  UserPlus,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { formatNumber } from '@/lib/formatNumber';

interface TeamMember {
  id: string;
  name: string | null;
  phone: string;
  role: string;
  is_active?: boolean;
  can_scan?: boolean;
  can_view_payments?: boolean;
  can_record_payments?: boolean;
  can_view_dashboard?: boolean;
  can_view_revenue?: boolean;
  can_manage_students?: boolean;
  can_manage_groups?: boolean;
  can_allow_late_entry?: boolean;
  can_manage_rooms?: boolean;
  can_view_schedule?: boolean;
  can_view_settings?: boolean;
  can_manage_billing?: boolean;
  can_edit_center_profile?: boolean;
  can_delete_students?: boolean;
  can_manage_academic_calendar?: boolean;
  can_place_card_orders?: boolean;
  can_request_referral_payouts?: boolean;
}

interface PendingInvite {
  id?: string;
  phone: string;
  role: string;
  status: string;
}

const PERMISSION_KEYS: { key: string; labelKey: string }[] = [
  { key: 'can_scan', labelKey: 'canScan' },
  { key: 'can_view_payments', labelKey: 'canViewPayments' },
  { key: 'can_record_payments', labelKey: 'canRecordPayments' },
  { key: 'can_view_dashboard', labelKey: 'canViewDashboard' },
  { key: 'can_view_revenue', labelKey: 'canViewRevenue' },
  { key: 'can_manage_students', labelKey: 'canManageStudents' },
  { key: 'can_manage_groups', labelKey: 'canManageGroups' },
  { key: 'can_allow_late_entry', labelKey: 'canAllowLateEntry' },
  { key: 'can_manage_rooms', labelKey: 'canManageRooms' },
  { key: 'can_view_schedule', labelKey: 'canViewSchedule' },
  { key: 'can_view_settings', labelKey: 'canViewSettings' },
];

export default function TeamSettingsPage() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const tBilling = useTranslations('billing');
  const locale = useLocale();
  const router = useRouter();
  const { user: currentUser, hasPermission } = useUser();
  const isRTL = locale === 'ar';

  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlatformAdminNoCenter, setIsPlatformAdminNoCenter] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [limits, setLimits] = useState<{ maxTeachers: number; canAddTeacher: boolean } | null>(null);
  const [assistantPermissions, setAssistantPermissions] = useState<Record<string, Record<string, boolean>>>({});
  const [editingPermissionsId, setEditingPermissionsId] = useState<string | null>(null);
  const [permissionPrompt, setPermissionPrompt] = useState<{ targetId: string; key: string; enabled: boolean } | null>(null);
  const [permissionPromptError, setPermissionPromptError] = useState('');
  const [actionSheetFor, setActionSheetFor] = useState<TeamMember | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState<'assistant' | 'teacher'>('assistant');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [lastInvitePassword, setLastInvitePassword] = useState<string | null>(null);
  const [invitePerms, setInvitePerms] = useState<Record<string, boolean>>({
    can_scan: true,
    can_view_payments: true,
    can_view_dashboard: true,
    can_manage_students: false,
    can_manage_groups: false,
    can_view_settings: false,
  });
  const [inviteTeacherGroupIds, setInviteTeacherGroupIds] = useState<string[]>([]);
  const [inviteGroups, setInviteGroups] = useState<{ id: string; name: string; subject?: string }[]>([]);

  // Redirect assistants/teachers without can_view_settings
  useEffect(() => {
    if (currentUser && (currentUser.role === 'assistant' || currentUser.role === 'teacher') && !hasPermission('can_view_settings')) {
      router.replace('/dashboard');
    }
  }, [currentUser, hasPermission, router]);

  // Resolve session + centerId
  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setIsLoading(false);
        return;
      }
      setUserId(session.user.id);

      const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
      const meData = await meRes.json();

      if (!meData?.user?.center_id) {
        try {
          const adminRes = await fetch('/api/admin/check', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const adminData = await adminRes.json();
          setIsPlatformAdminNoCenter(!!adminData?.isAdmin);
        } catch {
          setIsPlatformAdminNoCenter(false);
        }
        setIsLoading(false);
        return;
      }

      setCenterId(meData.user.center_id);
      setIsLoading(false);
    };
    load();
  }, []);

  const loadTeamData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !centerId) return;

    try {
      const limitsRes = await fetch('/api/settings/limits', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (limitsRes.ok) {
        const limitsData = await limitsRes.json();
        setLimits({ maxTeachers: limitsData.maxTeachers ?? 2, canAddTeacher: limitsData.canAddTeacher !== false });
      } else {
        setLimits({ maxTeachers: 2, canAddTeacher: true });
      }
    } catch {
      setLimits({ maxTeachers: 2, canAddTeacher: true });
    }

    const { data: membersData } = await dbSelect({
      table: 'users',
      select:
        'id, name, phone, role, is_active, can_scan, can_view_payments, can_record_payments, can_view_dashboard, can_view_revenue, can_manage_students, can_manage_groups, can_allow_late_entry, can_manage_rooms, can_view_schedule, can_view_settings, can_manage_billing, can_edit_center_profile, can_delete_students, can_manage_academic_calendar, can_place_card_orders, can_request_referral_payouts',
      filters: [{ column: 'center_id', op: 'eq', value: centerId }],
    });
    const permMap: Record<string, Record<string, boolean>> = {};
    if (membersData) {
      setTeamMembers(
        (membersData as (TeamMember & Record<string, unknown>)[]).map((m) => {
          permMap[m.id] = {
            can_scan: m.can_scan === true,
            can_view_payments: m.can_view_payments === true,
            can_record_payments: m.can_record_payments === true,
            can_view_dashboard: m.can_view_dashboard === true,
            can_view_revenue: m.can_view_revenue === true,
            can_manage_students: m.can_manage_students === true,
            can_manage_groups: m.can_manage_groups === true,
            can_allow_late_entry: m.can_allow_late_entry === true,
            can_manage_rooms: m.can_manage_rooms === true,
            can_view_schedule: m.can_view_schedule === true,
            can_view_settings: m.can_view_settings === true,
            can_manage_billing: m.can_manage_billing === true,
            can_edit_center_profile: m.can_edit_center_profile === true,
            can_delete_students: m.can_delete_students === true,
            can_manage_academic_calendar: m.can_manage_academic_calendar === true,
            can_place_card_orders: m.can_place_card_orders === true,
            can_request_referral_payouts: m.can_request_referral_payouts === true,
          };
          return { id: m.id, name: m.name ?? null, phone: m.phone, role: m.role, is_active: m.is_active };
        }),
      );
    }
    setAssistantPermissions(permMap);

    const { data: invitesData } = await dbSelect({
      table: 'center_invites',
      select: 'phone, role, status',
      filters: [
        { column: 'center_id', op: 'eq', value: centerId },
        { column: 'status', op: 'eq', value: 'pending' },
      ],
    });
    if (invitesData) {
      setPendingInvites((invitesData as PendingInvite[]).map((inv) => ({ phone: inv.phone, role: inv.role, status: inv.status })));
    }
  }, [centerId]);

  useEffect(() => {
    if (centerId) loadTeamData();
  }, [centerId, loadTeamData]);

  // Load groups when invite modal opens (teacher group assignment)
  useEffect(() => {
    if (!showInviteModal || !centerId) return;
    const load = async () => {
      const { data } = await dbSelect({
        table: 'student_groups',
        select: 'id, name, subject',
        filters: [{ column: 'center_id', op: 'eq', value: centerId }],
        order: { column: 'name' },
      });
      setInviteGroups((data as { id: string; name: string; subject?: string }[]) ?? []);
    };
    load();
  }, [showInviteModal, centerId]);

  const showSaved = () => {
    setSavedMessage(t('saved'));
    setTimeout(() => setSavedMessage(''), 2000);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    setLastInvitePassword(null);
    if (!centerId || !userId) return;
    let phone = invitePhone.trim().replace(/\D/g, '');
    if (phone.startsWith('0')) phone = phone.substring(1);
    if (phone.length !== 10 || !/^1[0125]\d{8}$/.test(phone)) {
      setInviteError(t('invalidPhone'));
      return;
    }
    const phoneToSend = '0' + phone;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setInviteError(tCommon('error'));
      return;
    }
    setInviteSubmitting(true);
    try {
      const { getCsrfHeaders } = await import('@/lib/csrf-client');
      const body: Record<string, unknown> = { name: inviteName.trim() || '', phone: phoneToSend, role: inviteRole };
      if (inviteRole === 'teacher' && inviteTeacherGroupIds.length) {
        body.teacher_group_ids = inviteTeacherGroupIds;
      }
      if (inviteRole === 'assistant') {
        body.permissions = invitePerms;
      }
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) {
        setInviteError(result.code === 'TEAM_LIMIT_REACHED' ? t('planLimitReached') : result.error || tCommon('errorGeneric'));
        return;
      }
      if (result.success && result.member) {
        setTeamMembers((prev) => [...prev, result.member]);
        setAssistantPermissions((prev) => ({ ...prev, [result.member.id]: { ...invitePerms } }));
        setInviteName('');
        setInvitePhone('');
        setInviteRole('assistant');
        setInvitePerms({
          can_scan: true,
          can_view_payments: true,
          can_view_dashboard: true,
          can_manage_students: false,
          can_manage_groups: false,
          can_view_settings: false,
        });
        setLastInvitePassword(result.tempPassword ?? null);
        setShowInviteModal(false);
        showSaved();
      } else if (result.success && result.pendingInvite) {
        setInviteName('');
        setInvitePhone('');
        setInviteRole('assistant');
        setInviteTeacherGroupIds([]);
        setPendingInvites((prev) => [...prev, { phone: phoneToSend, role: inviteRole, status: 'pending' }]);
        setShowInviteModal(false);
        setSavedMessage(result.message || t('inviteSuccess'));
        setTimeout(() => setSavedMessage(''), 5000);
      } else {
        setInviteError(result.error || tCommon('errorGeneric'));
      }
    } catch {
      setInviteError(tCommon('error'));
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleToggleActive = async (member: TeamMember) => {
    if (!centerId || !userId) return;
    const newStatus = member.is_active === false;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const { getCsrfHeaders } = await import('@/lib/csrf-client');
      const res = await fetch('/api/permissions', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ targetUserId: member.id, permissions: { is_active: newStatus }, centerId }),
      });
      if (!res.ok) throw new Error('permission_update_failed');
      setTeamMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, is_active: newStatus } : m)));
      setSavedMessage(newStatus ? t('memberActivated') : t('memberDeactivated'));
      setTimeout(() => setSavedMessage(''), 2000);
    } catch {
      alert(tCommon('error'));
    }
  };

  const handlePermissionToggle = (targetId: string, key: string, enabled: boolean) => {
    setPermissionPromptError('');
    setPermissionPrompt({ targetId, key, enabled });
  };

  const confirmPermissionChange = async (password: string) => {
    if (!permissionPrompt || !centerId) return;
    const { targetId, key, enabled } = permissionPrompt;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setAssistantPermissions((prev) => ({ ...prev, [targetId]: { ...prev[targetId], [key]: enabled } }));
    try {
      const { getCsrfHeaders } = await import('@/lib/csrf-client');
      const res = await fetch('/api/permissions', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ targetUserId: targetId, permissionKey: key, enabled, centerId, password }),
      });
      if (res.ok) {
        setPermissionPrompt(null);
        showSaved();
      } else {
        const data = await res.json();
        setPermissionPromptError(data.error || t('permissionUpdateFailed'));
        setAssistantPermissions((prev) => ({ ...prev, [targetId]: { ...prev[targetId], [key]: !enabled } }));
      }
    } catch {
      setPermissionPromptError(t('permissionUpdateFailed'));
      setAssistantPermissions((prev) => ({ ...prev, [targetId]: { ...prev[targetId], [key]: !enabled } }));
    }
  };

  const isOwner = (member: TeamMember) => member.role === 'owner' || member.role === 'admin';
  const canEditPermissions = (member: TeamMember) => !isOwner(member) && member.id !== userId;

  /**
   * The design's `.mperm` line — "Money · students · attendance · messages".
   * Built from the member's REAL granted flags, never from their role: two
   * people with the same role can hold different permissions, and printing a
   * role-shaped guess would be a claim about access that isn't true.
   */
  const permissionSummary = (member: TeamMember): string => {
    if (member.is_active === false) return t('pausedNoAccess');
    if (isOwner(member)) return t('fullAccess');
    const granted = assistantPermissions[member.id] ?? {};
    const labels = PERMISSION_KEYS.filter(({ key }) => granted[key] === true).map(({ labelKey }) => t(labelKey));
    return labels.length ? labels.join(' · ') : t('noPermissionsGranted');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4" aria-busy>
          <div className="skeleton h-8 rounded-xl w-48" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-28 rounded-2xl w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isPlatformAdminNoCenter) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <PageHeader title={t('teamMembers')} />
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-6 space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">{t('platformAdminSettingsHint')}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/admin"
                className="inline-flex items-center justify-center gap-2 px-4 py-3 border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg hover:bg-[var(--color-surface-0)] transition-colors"
              >
                <Shield className="w-4 h-4 shrink-0" />
                {t('backToAdminConsole')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title={t('teamMembers')} />

        <div className="mb-6">
          <Link
            href="/settings/general"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <DirectionalIcon icon={ChevronRight} className="w-4 h-4 rotate-180" />
            {t('title')}
          </Link>
        </div>

        {savedMessage && (
          <div className="mb-4 p-3 bg-teal-50 border border-teal-500/30 text-teal-800 rounded-xl text-sm text-center">
            {savedMessage}
          </div>
        )}

        <div className="space-y-4">
          {currentUser?.role === 'assistant' || currentUser?.role === 'teacher' ? (
            <p className="text-[var(--color-text-secondary)]">{tBilling('onlyOwnersCanManageTeam')}</p>
          ) : (
            <>
              <TeacherJoinRequests />

              <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('teamMembers')}</h2>
                  {/* The design draws a seat meter — "3 of 5 seats used", a
                      progress bar, and a per-extra-seat price. It is NOT built,
                      and the denominator this screen used to print has been
                      dropped rather than restyled, because it was not a real
                      number: `/api/settings/limits` selects
                      `max_teachers, max_students` from `centers` and NEITHER
                      COLUMN EXISTS in the live catalog (re-confirmed this pass:
                      0 matching rows in information_schema.columns). The route
                      404s, the client falls back to a hardcoded 2, and every
                      centre — whatever its plan — was being told it had 2 seats
                      (F19.3 / D8). The member count below is real; the cap was
                      invented, so only the real half is shown. The invite
                      button's disabled state is left exactly as it was — that
                      is an entitlement gate, not a label, and changing it is
                      Eyad's call. */}
                  <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
                    {t('teamMembersCountOnly', { current: formatNumber(teamMembers.length, locale) })}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setInviteRole('assistant');
                    setInviteTeacherGroupIds([]);
                    setInvitePerms({
                      can_scan: true,
                      can_view_payments: true,
                      can_view_dashboard: true,
                      can_manage_students: false,
                      can_manage_groups: false,
                      can_view_settings: false,
                    });
                    setShowInviteModal(true);
                  }}
                  disabled={limits ? !limits.canAddTeacher : false}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <UserPlus className="w-4 h-4 shrink-0" /> {t('inviteMemberPlus')}
                </button>
              </div>

              {lastInvitePassword && (
                <div className="p-4 bg-teal-50 rounded-xl border border-teal-500/30 text-sm text-teal-800 mb-4">
                  <p className="font-medium">{t('inviteSuccess')}</p>
                  <p className="mt-1">{t('passwordIs', { password: lastInvitePassword })}</p>
                </div>
              )}

              {/* §07 MEMBERS — the design's `.mcard` list. Replaces the
                  840px-min-width table this screen used to draw, which on a
                  phone (the width every frame in the design is drawn at) could
                  only be read by scrolling sideways. Same data, same actions,
                  same handlers — the three-dot now opens the shared
                  `ActionSheet` from `src/components/patterns/` instead of two
                  bare icon buttons in a table cell. */}
              <SettingsGroupLabel>{t('groupMembers')}</SettingsGroupLabel>
              <div className="space-y-3">
                {teamMembers.map((member) => {
                  const isSelf = member.id === userId;
                  const ownerRow = isOwner(member);
                  const isPermReadOnly = ownerRow || isSelf;
                  const permChecked = (k: string) => (ownerRow ? true : assistantPermissions[member.id]?.[k] ?? false);
                  return (
                    <TeamMemberCard
                      key={member.id}
                      member={member}
                      isSelf={isSelf}
                      isOwnerRow={ownerRow}
                      permissionSummary={permissionSummary(member)}
                      onActions={!isSelf && !ownerRow ? () => setActionSheetFor(member) : undefined}
                      onEditPermissions={
                        canEditPermissions(member) && editingPermissionsId !== member.id
                          ? () => setEditingPermissionsId(member.id)
                          : undefined
                      }
                      onToggleActive={
                        !isSelf && !ownerRow && member.is_active === false
                          ? () => handleToggleActive(member)
                          : undefined
                      }
                    >
                      {editingPermissionsId === member.id && (
                        <div className="mt-3 space-y-2 border-t border-[var(--color-hairline)] pt-3">
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {PERMISSION_KEYS.map(({ key, labelKey }) => (
                              <label
                                key={key}
                                className={`flex items-center gap-1.5 text-xs select-none ${isPermReadOnly ? 'cursor-default opacity-75' : 'cursor-pointer text-[var(--color-text-primary)]'}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={permChecked(key)}
                                  onChange={(e) => !isPermReadOnly && handlePermissionToggle(member.id, key, e.target.checked)}
                                  disabled={isPermReadOnly}
                                  className="w-3.5 h-3.5 rounded accent-teal-600"
                                />
                                {t(labelKey)}
                              </label>
                            ))}
                          </div>
                          <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
                            <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2 uppercase tracking-wide">
                              {t('sensitivePermissions')}
                            </p>
                            <StaffMemberCard
                              userId={member.id}
                              role={member.role}
                              permissions={(assistantPermissions[member.id] as Partial<Record<CenterPermission, boolean>>) ?? {}}
                              visibleFlags={SIX_NEW_FLAGS}
                              onUpdate={(flag, value) =>
                                setAssistantPermissions((prev) => ({
                                  ...prev,
                                  [member.id]: { ...prev[member.id], [flag]: value },
                                }))
                              }
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditingPermissionsId(null)}
                            className="text-xs text-teal-600 hover:underline"
                          >
                            {tCommon('cancel')}
                          </button>
                        </div>
                      )}
                    </TeamMemberCard>
                  );
                })}

                {pendingInvites.map((inv, idx) => (
                  <div
                    key={`pending-${idx}`}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 card-shadow"
                  >
                    <span className="font-mono text-base text-[var(--color-text-secondary)]" dir="ltr">
                      {inv.phone}
                    </span>
                    <RoleBadge role={inv.role} />
                    <span className="ms-auto rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                      {t('pendingInvite')}
                    </span>
                  </div>
                ))}

                {teamMembers.length === 0 && pendingInvites.length === 0 && (
                  <p className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-8 text-center text-[var(--color-text-secondary)]">
                    {t('noTeamMembers')}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {showInviteModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowInviteModal(false)}>
            <div className="bg-[var(--color-surface-1)] rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-[var(--color-border-subtle)]">
                <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('inviteMember')}</h2>
                <button type="button" onClick={() => setShowInviteModal(false)} className="p-2 hover:bg-[var(--color-surface-2)] rounded-lg">
                  <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
                </button>
              </div>
              <form onSubmit={handleInvite} className="p-6 space-y-4">
                {inviteError && <p className="text-sm text-red-500">{inviteError}</p>}
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('inviteName')}</label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder={t('inviteName')}
                    className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('invitePhone')}</label>
                  <input
                    type="tel"
                    value={invitePhone}
                    onChange={(e) => {
                      let v = e.target.value.replace(/\D/g, '');
                      if (v.startsWith('0') && v.length > 1) v = v.substring(1);
                      setInvitePhone(v);
                      setInviteError('');
                    }}
                    placeholder={t('phonePlaceholder')}
                    dir="ltr"
                    className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('role')}</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'assistant' || v === 'teacher') setInviteRole(v);
                    }}
                    className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-1)]"
                  >
                    <option value="assistant">{t('assistant')}</option>
                    <option value="teacher">{tNav('roleTeacher')}</option>
                  </select>
                </div>
                {inviteRole === 'teacher' ? (
                  <>
                    <p className="text-sm text-[var(--color-text-secondary)] bg-[var(--color-surface-0)] rounded-lg p-3 border border-[var(--color-border-subtle)]">{t('teacherAccessInfo')}</p>
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('assignGroups')}</label>
                      <div className="mt-1 max-h-32 overflow-y-auto border border-[var(--color-border-subtle)] rounded-lg p-2 space-y-1">
                        {inviteGroups.length === 0 ? (
                          <p className="text-sm text-[var(--color-text-secondary)] py-2">{tCommon('noData')}</p>
                        ) : (
                          inviteGroups.map((g) => (
                            <label key={g.id} className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-[var(--color-surface-0)] rounded px-2">
                              <input
                                type="checkbox"
                                checked={inviteTeacherGroupIds.includes(g.id)}
                                onChange={(e) =>
                                  setInviteTeacherGroupIds((prev) =>
                                    e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id),
                                  )
                                }
                                className="rounded border-[var(--color-border)] text-teal-600 focus:ring-teal-500"
                              />
                              <span className="text-sm text-[var(--color-text-primary)]">{g.name}{g.subject ? ` (${g.subject})` : ''}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">{t('permissions')}</p>
                    {[
                      { key: 'can_scan', labelKey: 'canScan', Icon: Camera },
                      { key: 'can_view_payments', labelKey: 'canViewPayments', Icon: CreditCard },
                      { key: 'can_view_dashboard', labelKey: 'canViewDashboard', Icon: LayoutDashboard },
                      { key: 'can_manage_students', labelKey: 'canManageStudents', Icon: Users },
                      { key: 'can_manage_groups', labelKey: 'canManageGroups', Icon: BookOpen },
                      { key: 'can_view_settings', labelKey: 'canViewSettings', Icon: Shield },
                    ].map(({ key, labelKey, Icon }) => (
                      <div key={key} className="flex items-center justify-between py-2 border-b border-[var(--color-border-subtle)]">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-[var(--color-text-muted)]" />
                          <span className="text-sm text-[var(--color-text-primary)]">{t(labelKey)}</span>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={invitePerms[key] ?? false}
                          onClick={() => setInvitePerms((p) => ({ ...p, [key]: !(p[key] ?? false) }))}
                          className={`relative w-10 h-5 rounded-full transition-colors ${invitePerms[key] ?? false ? 'bg-teal-600' : 'bg-[var(--color-surface-3)]'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 bg-[var(--color-surface-1)] rounded-full shadow transition-all ${invitePerms[key] ?? false ? 'start-5' : 'start-0.5'}`} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    className="px-4 py-2 border border-[var(--color-border-default)] hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg"
                  >
                    {tCommon('cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={inviteSubmitting || !invitePhone.trim()}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                  >
                    {inviteSubmitting ? tCommon('loading') : t('invite')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* §07's three-dot. One sheet, one gesture — the shared primitive from
            `src/components/patterns/`, not a local menu. Both actions are the
            page's existing handlers, unchanged. */}
        <ActionSheet
          open={actionSheetFor !== null}
          onClose={() => setActionSheetFor(null)}
          title={actionSheetFor?.name || actionSheetFor?.phone || ''}
          subtitle={actionSheetFor ? t('permissions') : undefined}
          actions={
            actionSheetFor
              ? ([
                  {
                    id: 'edit-permissions',
                    label: t('editPermissions'),
                    icon: Pencil,
                    onSelect: () => {
                      setEditingPermissionsId(actionSheetFor.id);
                      setActionSheetFor(null);
                    },
                  },
                  {
                    id: 'toggle-active',
                    label: actionSheetFor.is_active !== false ? t('deactivate') : t('activate'),
                    icon: UserX,
                    destructive: actionSheetFor.is_active !== false,
                    onSelect: () => {
                      const target = actionSheetFor;
                      setActionSheetFor(null);
                      handleToggleActive(target);
                    },
                  },
                ] satisfies SheetAction[])
              : []
          }
        />

        <PasswordConfirmModal
          isOpen={!!permissionPrompt}
          onClose={() => {
            setPermissionPrompt(null);
            setPermissionPromptError('');
          }}
          title={t('confirmPermissionChange')}
          message={t('enterPasswordToConfirm')}
          error={permissionPromptError}
          onConfirm={confirmPermissionChange}
        />
      </div>
    </div>
  );
}
