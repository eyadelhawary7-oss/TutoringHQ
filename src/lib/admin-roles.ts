export const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: ['overview', 'ceo_dashboard', 'centers', 'billing', 'renewals', 'card_orders', 'plan_requests', 'pending_signups', 'internal_team', 'referrals', 'sales_pipeline', 'analytics'],
  admin: ['overview', 'centers', 'billing', 'renewals', 'card_orders', 'plan_requests', 'pending_signups', 'referrals', 'sales_pipeline', 'analytics'],
  internal_admin: ['overview', 'centers', 'billing', 'renewals', 'plan_requests', 'pending_signups'],
  internal_viewer: ['overview', 'centers', 'analytics'],
  sales_rep: ['overview', 'centers', 'pending_signups', 'sales_pipeline'],
  support_agent: ['overview', 'centers', 'pending_signups'],
  accountant: ['overview', 'billing', 'renewals', 'analytics'],
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
  { key: 'sales_pipeline', labelAr: 'خط المبيعات', labelEn: 'Sales Pipeline' },
  { key: 'analytics', labelAr: 'الإحصائيات', labelEn: 'Analytics' },
];

export const ALL_ADMIN_PERMISSIONS = ALL_PERMISSIONS;

export function getPermissionsForRole(role: string, customPermissions: string[]): string[] {
  if (role === 'custom') return customPermissions;
  return ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS['internal_viewer'];
}

export function getAdminPermissions(role: string, customPermissions: string[]): string[] {
  return getPermissionsForRole(role, customPermissions);
}
