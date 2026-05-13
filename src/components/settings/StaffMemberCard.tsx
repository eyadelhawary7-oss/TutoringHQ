'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SettingsSwitch } from './SettingsSwitch';
import { supabase } from '@/lib/supabase';
import type { CenterPermission } from '@/lib/centerPermissions';

/** All 8 granular center-side permission flags. */
export const GRANULAR_PERMISSION_FLAGS: CenterPermission[] = [
  'can_record_payments',
  'can_view_payments',
  'can_manage_billing',
  'can_edit_center_profile',
  'can_delete_students',
  'can_manage_academic_calendar',
  'can_place_card_orders',
  'can_request_referral_payouts',
];

/** The 6 new flags added in Prompt 1 (excludes the 2 pre-existing payment flags). */
export const SIX_NEW_FLAGS: CenterPermission[] = [
  'can_manage_billing',
  'can_edit_center_profile',
  'can_delete_students',
  'can_manage_academic_calendar',
  'can_place_card_orders',
  'can_request_referral_payouts',
];

/** True when role always passes every permission gate regardless of flags. */
export function isRoleAlwaysGranted(role: string): boolean {
  return role === 'owner' || role === 'super_admin';
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type Props = {
  userId: string;
  role: string;
  permissions: Partial<Record<CenterPermission, boolean>>;
  /** Subset of flags to render; defaults to all 8. */
  visibleFlags?: CenterPermission[];
  /** Called after a successful PATCH with the updated flag + value. */
  onUpdate?: (flag: CenterPermission, value: boolean) => void;
};

export function StaffMemberCard({
  userId,
  role,
  permissions: initialPermissions,
  visibleFlags = GRANULAR_PERMISSION_FLAGS,
  onUpdate,
}: Props) {
  const t = useTranslations('settings');
  const alwaysGranted = isRoleAlwaysGranted(role);

  const [permissions, setPermissions] = useState<Partial<Record<CenterPermission, boolean>>>(initialPermissions);
  const [flagState, setFlagState] = useState<Partial<Record<CenterPermission, SaveState>>>({});

  const setSave = (flag: CenterPermission, state: SaveState) =>
    setFlagState((prev) => ({ ...prev, [flag]: state }));

  const handleToggle = async (flag: CenterPermission, next: boolean) => {
    if (alwaysGranted) return;

    const previous = permissions[flag] ?? false;
    setPermissions((prev) => ({ ...prev, [flag]: next }));
    setSave(flag, 'saving');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const { getCsrfHeaders } = await import('@/lib/csrf-client');
      const res = await fetch(`/api/settings/staff/${userId}/permissions`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ [flag]: next }),
      });

      if (!res.ok) throw new Error('Save failed');

      setSave(flag, 'saved');
      onUpdate?.(flag, next);
      setTimeout(() => setSave(flag, 'idle'), 2000);
    } catch {
      setPermissions((prev) => ({ ...prev, [flag]: previous }));
      setSave(flag, 'error');
      setTimeout(() => setSave(flag, 'idle'), 3000);
    }
  };

  if (alwaysGranted) {
    return (
      <p className="text-xs text-[var(--color-text-secondary)] italic py-1">
        {t('staff.permissions.ownerHasAll')}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {visibleFlags.map((flag) => {
        const checked = permissions[flag] ?? false;
        const state = flagState[flag] ?? 'idle';
        const switchId = `perm-${userId}-${flag}`;

        return (
          <div key={flag} className="flex items-center justify-between gap-3 py-1">
            <div className="min-w-0 flex-1">
              <label
                htmlFor={switchId}
                className="text-xs font-medium text-[var(--color-text-primary)] cursor-pointer select-none"
              >
                {/* dynamic key, labels live at settings.staff.permissions.<flag>.label */}
                {t((`staff.permissions.${flag}.label`) as Parameters<typeof t>[0])}
              </label>
              {state === 'saving' && (
                <p className="text-xs text-[var(--color-text-secondary)] leading-none mt-0.5">
                  {t('staff.permissions.saving')}
                </p>
              )}
              {state === 'saved' && (
                <p className="text-xs text-teal-600 leading-none mt-0.5">
                  {t('staff.permissions.saved')}
                </p>
              )}
              {state === 'error' && (
                <p className="text-xs text-red-500 leading-none mt-0.5">
                  {t('staff.permissions.errorSaving')}
                </p>
              )}
            </div>
            <SettingsSwitch
              id={switchId}
              checked={checked}
              onCheckedChange={(next) => handleToggle(flag, next)}
              disabled={state === 'saving'}
            />
          </div>
        );
      })}
    </div>
  );
}
