'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { isRefreshTokenNotFoundError } from '@/lib/supabaseRefreshSilence';

export type UserRole = 'owner' | 'admin' | 'assistant' | 'teacher' | 'super_admin';

export type PermissionKey = 'can_scan' | 'can_view_payments' | 'can_record_payments' | 'can_view_dashboard' | 'can_view_revenue' | 'can_manage_students' | 'can_manage_groups' | 'can_allow_late_entry' | 'can_manage_rooms' | 'can_view_schedule' | 'can_view_settings';

interface UserProfile {
  id: string;
  center_id?: string | null;
  role: UserRole;
  name: string | null;
  phone: string | null;
  center?: {
    logo_url?: string;
    name?: string;
    plan?: string;
    parent_pack_enabled?: boolean;
    parent_pack_active_parents?: number;
    card_orders_enabled?: boolean;
    announcement_balance?: string | number;
    status?: string;
    subscription_status?: string;
    billing_status?: string;
    next_payment_due?: string | null;
    auto_suspend_at?: string | null;
  } | null;
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
  is_active?: boolean;
}

interface UserContextType {
  user: UserProfile | null;
  permissions: Record<PermissionKey, boolean>;
  loading: boolean;
  hasPermission: (key: PermissionKey) => boolean;
  refreshUser: () => Promise<void>;
}

const defaultPermissions: Record<PermissionKey, boolean> = {
  can_scan: false,
  can_view_payments: false,
  can_record_payments: false,
  can_view_dashboard: false,
  can_view_revenue: false,
  can_manage_students: false,
  can_manage_groups: false,
  can_allow_late_entry: false,
  can_manage_rooms: false,
  can_view_schedule: false,
  can_view_settings: false,
};

const UserContext = createContext<UserContextType>({
  user: null,
  permissions: defaultPermissions,
  loading: true,
  hasPermission: () => false,
  refreshUser: async () => {},
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [permissions, setPermissions] = useState<Record<PermissionKey, boolean>>(defaultPermissions);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) {
        if (isRefreshTokenNotFoundError(sessionErr)) {
          setUser(null);
          setLoading(false);
          return;
        }
        console.error('Failed to read auth session:', sessionErr);
        setUser(null);
        setLoading(false);
        return;
      }
      if (!session) {
        setUser(null);
        setLoading(false);
        return;
      }

      const res = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();

      if (data?.user) {
        setUser(data.user);
        if (data.user.role === 'owner' || data.user.role === 'admin' || data.user.role === 'super_admin') {
          const allTrue: Record<PermissionKey, boolean> = {} as Record<PermissionKey, boolean>;
          for (const key of Object.keys(defaultPermissions)) {
            allTrue[key as PermissionKey] = true;
          }
          setPermissions(allTrue);
        } else {
          setPermissions({
            can_scan: data.user.can_scan ?? false,
            can_view_payments: data.user.can_view_payments ?? false,
            can_record_payments: data.user.can_record_payments ?? false,
            can_view_dashboard: data.user.can_view_dashboard ?? false,
            can_view_revenue: data.user.can_view_revenue ?? false,
            can_manage_students: data.user.can_manage_students ?? false,
            can_manage_groups: data.user.can_manage_groups ?? false,
            can_allow_late_entry: data.user.can_allow_late_entry ?? false,
            can_manage_rooms: data.user.can_manage_rooms ?? false,
            can_view_schedule: data.user.can_view_schedule ?? false,
            can_view_settings: data.user.can_view_settings ?? false,
          });
        }
      }
    } catch (err) {
      const isNetworkError = err instanceof TypeError && (err.message === 'Failed to fetch' || err.message?.includes('fetch'));
      if (isNetworkError) {
        console.warn('User profile unavailable (network). Are you offline or is the dev server running?');
      } else {
        console.error('Failed to load user profile:', err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const refreshUser = useCallback(async () => {
    setLoading(true);
    await loadUser();
  }, [loadUser]);

  const hasPermission = (key: PermissionKey) => permissions[key] ?? false;

  return (
    <UserContext.Provider value={{ user, permissions, loading, hasPermission, refreshUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
