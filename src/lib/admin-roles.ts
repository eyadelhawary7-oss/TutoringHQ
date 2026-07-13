export const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: ['overview', 'ceo_dashboard', 'centers', 'billing', 'renewals', 'card_orders', 'plan_requests', 'pending_signups', 'internal_team', 'referrals', 'withdrawals', 'sales_pipeline', 'analytics'],
  admin: ['overview', 'centers', 'billing', 'renewals', 'card_orders', 'plan_requests', 'pending_signups', 'referrals', 'sales_pipeline', 'analytics'],
  internal_admin: ['overview', 'centers', 'billing', 'renewals', 'plan_requests', 'pending_signups'],
  internal_viewer: ['overview', 'centers', 'analytics'],
  // Manager / Rep: scoped Accounts (centers) list. pending_signups is CEO-only now
  // (enforced by SUPER_ONLY_PERMISSION_KEYS in AdminSidebar + super_admin API gates).
  sales_manager: ['overview', 'centers', 'card_orders'],
  sales_rep: ['overview', 'centers'],
  support_agent: ['overview', 'centers', 'pending_signups'],
  accountant: [
    'overview',
    'ceo_dashboard',
    'centers',
    'card_orders',
    'plan_requests',
    'pending_signups',
    'referrals',
    'sales_pipeline',
    'analytics',
    'renewals',
  ],
  /** Sales / ops staff - sidebar + API gates use custom_permissions (e.g. can_approve_signups). */
  staff: [
    'overview',
    'ceo_dashboard',
    'centers',
    'card_orders',
    'plan_requests',
    'pending_signups',
    'referrals',
    'sales_pipeline',
    'analytics',
  ],
  custom: [],
};

export const ALL_PERMISSIONS = [
  { key: 'overview', labelAr: 'نظرة عامة', labelEn: 'Overview' },
  { key: 'ceo_dashboard', labelAr: 'لوحة CEO', labelEn: 'CEO Dashboard' },
  { key: 'centers', labelAr: 'السناتر', labelEn: 'Centers' },
  { key: 'billing', labelAr: 'الفواتير', labelEn: 'Billing' },
  { key: 'renewals', labelAr: 'تجديدات الاشتراك', labelEn: 'Subscription Renewals' },
  { key: 'card_orders', labelAr: 'طلبات البطاقات', labelEn: 'Card Orders' },
  { key: 'plan_requests', labelAr: 'طلبات الخطط', labelEn: 'Plan Requests' },
  { key: 'pending_signups', labelAr: 'التسجيل المعلق', labelEn: 'Pending Signups' },
  { key: 'internal_team', labelAr: 'الفريق الداخلي', labelEn: 'Internal Team' },
  { key: 'referrals', labelAr: 'الإحالات', labelEn: 'Referrals' },
  { key: 'withdrawals', labelAr: 'السحوبات', labelEn: 'Withdrawals' },
  { key: 'sales_pipeline', labelAr: 'خط المبيعات', labelEn: 'Sales Pipeline' },
  { key: 'analytics', labelAr: 'الإحصائيات', labelEn: 'Analytics' },
];

export const ALL_ADMIN_PERMISSIONS = ALL_PERMISSIONS;

/**
 * Internal roles that MAY be assigned to a team member (via the invite/approval flow or a
 * role edit). super_admin and the legacy 'admin' are intentionally ABSENT: they are never
 * conferred through team management — only by seed SQL and SUPER_ADMIN_PHONES. Kept in sync
 * with the DB CHECK on staff_invites.role / staff_requests.role.
 */
export const ASSIGNABLE_INTERNAL_ROLES = [
  'internal_viewer',
  'internal_admin',
  'sales_manager',
  'sales_rep',
  'support_agent',
  'accountant',
  'custom',
] as const;

export type AssignableInternalRole = (typeof ASSIGNABLE_INTERNAL_ROLES)[number];

/** True only for a role this flow is permitted to grant (excludes super_admin/admin). */
export function isAssignableInternalRole(role: unknown): role is AssignableInternalRole {
  return typeof role === 'string' && (ASSIGNABLE_INTERNAL_ROLES as readonly string[]).includes(role);
}

export function getPermissionsForRole(role: string, customPermissions: string[]): string[] {
  if (role === 'custom') return customPermissions;
  return ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS['internal_viewer'];
}

export function getAdminPermissions(role: string, customPermissions: string[]): string[] {
  return getPermissionsForRole(role, customPermissions);
}
