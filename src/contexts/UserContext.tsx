'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

export type UserRole = 'owner' | 'admin' | 'assistant' | 'teacher';

export type PermissionKey = 'can_send_whatsapp' | 'can_add_subjects' | 'can_view_calendar' | 'can_manage_payments';

interface UserProfile {
  id: string;
  center_id: string;
  role: UserRole;
  name: string | null;
  phone: string | null;
  center?: { logo_url?: string; name?: string } | null;
}

interface UserContextType {
  user: UserProfile | null;
  permissions: Record<PermissionKey, boolean>;
  loading: boolean;
  hasPermission: (key: PermissionKey) => boolean;
}

const defaultPermissions: Record<PermissionKey, boolean> = {
  can_send_whatsapp: false,
  can_add_subjects: false,
  can_view_calendar: false,
  can_manage_payments: false,
};

const UserContext = createContext<UserContextType>({
  user: null,
  permissions: defaultPermissions,
  loading: true,
  hasPermission: () => false,
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [permissions, setPermissions] = useState<Record<PermissionKey, boolean>>(defaultPermissions);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setLoading(false);
          return;
        }

        const res = await fetch('/api/me', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        const data = await res.json();

        if (data?.user) {
          setUser(data.user);
          if (data.permissions) {
            setPermissions({
              can_send_whatsapp: data.permissions.can_send_whatsapp ?? false,
              can_add_subjects: data.permissions.can_add_subjects ?? false,
              can_view_calendar: data.permissions.can_view_calendar ?? false,
              can_manage_payments: data.permissions.can_manage_payments ?? false,
            });
          }
        }
      } catch (err) {
        console.error('Failed to load user profile:', err);
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, []);

  const hasPermission = (key: PermissionKey) => permissions[key] ?? false;

  return (
    <UserContext.Provider value={{ user, permissions, loading, hasPermission }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
