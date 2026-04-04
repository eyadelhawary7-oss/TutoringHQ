/**
 * Deep-merge curated admin copy (EN/AR) over messages after fill-i18n-missing.
 * Keeps admin.withdrawals as a string for sidebar; withdrawal table uses admin.withdrawalsPage.*.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function isObj(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function deepMerge(base, overlay) {
  if (!isObj(base)) return JSON.parse(JSON.stringify(overlay));
  const out = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

const EN_ADMIN = {
  overview: 'Overview',
  ceoDashboard: 'CEO Dashboard',
  centers: 'Centers',
  billing: 'Billing',
  pendingSignups: 'Pending Signups',
  cardOrders: 'Card Orders',
  planRequests: 'Plan Requests',
  referrals: 'Referrals',
  withdrawals: 'Withdrawals',
  internalTeam: 'Internal Team',
  salesPipeline: 'Sales Pipeline',
  analytics: 'Analytics',
  totalCenters: 'Total Centers',
  activeCenters: 'Active Centers',
  suspendedCenters: 'Suspended Centers',
  totalStudents: 'Total Students',
  revenue: 'Revenue',
  mrr: 'MRR',
  outstandingInvoices: 'Outstanding Invoices',
  collectedThisMonth: 'Collected This Month',
  collectionRate: 'Collection Rate',
  securityAlerts: 'Security Alerts',
  failedLogins24h: 'Failed Logins (24h)',
  newSignups7d: 'New Signups (7 days)',
  flaggedActivity: 'Flagged Activity',
  systemStatus: 'System Status',
  allSystemsOperational: 'All Systems Operational',
  newCentersPerWeek: 'New Centers Per Week',
  monthlyRevenueChart: 'Monthly Revenue Chart',
  recentActivity: 'Recent Activity',
  signupRejected: 'Signup Rejected',
  signupApproved: 'Signup Approved',
  studentCreate: 'Student Created',
  centerUpdate: 'Center Updated',
  centerSuspended: 'Center Suspended',
  platformHealth: 'Platform Health',
  healthTitle: 'Platform Health',
  healthSubtitle: 'Live platform status — refreshes every 60 seconds',
  platformConfigTitle: 'Platform Configuration',
  platformConfigSubtitle: 'All changes take effect immediately. No code changes needed.',
  pricingPageTitle: 'Pricing Control Panel',
  withdrawalsPage: {
    title: 'Withdrawal Requests',
    tab_pending: 'Pending',
    tab_paid: 'Paid',
    tab_rejected: 'Rejected',
    empty: 'No withdrawal requests',
    loadError: 'Failed to load withdrawals',
    actionError: 'Action failed',
    summary: 'Q{quarter} {year}: {count} pending · {sum} EGP credits',
    colCenter: 'Center',
    colCredits: 'Credits',
    colCash: 'Cash (EGP)',
    colInstapay: 'InstaPay',
    colRequested: 'Requested',
    colActions: 'Actions',
    statusPending: 'Pending',
    statusPaid: 'Paid',
    statusRejected: 'Rejected',
    confirmPaid: 'Mark this withdrawal as paid?',
    confirmReject: 'Reject this withdrawal?',
    markPaid: 'Mark paid',
    reject: 'Reject',
  },
};

const AR_ADMIN = {
  overview: 'نظرة عامة',
  ceoDashboard: 'لوحة المدير',
  centers: 'السناتر',
  billing: 'الفوترة',
  pendingSignups: 'التسجيلات المعلقة',
  cardOrders: 'طلبات البطاقات',
  planRequests: 'طلبات الخطة',
  referrals: 'الإحالات',
  withdrawals: 'طلبات السحب',
  internalTeam: 'الفريق الداخلي',
  salesPipeline: 'خط المبيعات',
  analytics: 'التحليلات',
  totalCenters: 'إجمالي السناتر',
  activeCenters: 'السناتر النشطة',
  suspendedCenters: 'السناتر الموقوفة',
  totalStudents: 'إجمالي الطلاب',
  revenue: 'الإيرادات',
  mrr: 'الإيراد الشهري المتكرر',
  outstandingInvoices: 'الفواتير المستحقة',
  collectedThisMonth: 'المحصل هذا الشهر',
  collectionRate: 'معدل التحصيل',
  securityAlerts: 'تنبيهات الأمان',
  failedLogins24h: 'محاولات دخول فاشلة (24 ساعة)',
  newSignups7d: 'تسجيلات جديدة (7 أيام)',
  flaggedActivity: 'نشاط مشبوه',
  systemStatus: 'حالة النظام',
  allSystemsOperational: 'جميع الأنظمة تعمل',
  newCentersPerWeek: 'سناتر جديدة أسبوعياً',
  monthlyRevenueChart: 'رسم الإيراد الشهري',
  recentActivity: 'النشاط الأخير',
  signupRejected: 'تسجيل مرفوض',
  signupApproved: 'تسجيل مقبول',
  studentCreate: 'طالب مضاف',
  centerUpdate: 'سنتر محدث',
  centerSuspended: 'سنتر موقوف',
  platformHealth: 'صحة المنصة',
  healthTitle: 'صحة المنصة',
  healthSubtitle: 'حالة المنصة المباشرة — تتحدث كل 60 ثانية',
  platformConfigTitle: 'إعدادات المنصة',
  platformConfigSubtitle: 'جميع التغييرات فورية. لا تحتاج لتغيير كود.',
  pricingPageTitle: 'لوحة تحكم الأسعار',
  withdrawalsPage: {
    title: 'طلبات السحب',
    tab_pending: 'معلقة',
    tab_paid: 'مدفوعة',
    tab_rejected: 'مرفوضة',
    empty: 'لا توجد طلبات سحب',
    loadError: 'تعذر تحميل طلبات السحب',
    actionError: 'فشل الإجراء',
    summary: 'الربع {quarter} {year}: {count} معلق · {sum} ج.م رصيد',
    colCenter: 'السنتر',
    colCredits: 'الرصيد',
    colCash: 'النقد (ج.م)',
    colInstapay: 'إنستاباي',
    colRequested: 'تاريخ الطلب',
    colActions: 'إجراءات',
    statusPending: 'معلق',
    statusPaid: 'مدفوع',
    statusRejected: 'مرفوض',
    confirmPaid: 'تأكيد الدفع لهذا الطلب؟',
    confirmReject: 'رفض هذا الطلب؟',
    markPaid: 'تسجيل كمدفوع',
    reject: 'رفض',
  },
};

for (const [file, seed] of [
  ['en.json', EN_ADMIN],
  ['ar.json', AR_ADMIN],
]) {
  const path = join(ROOT, 'messages', file);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const cur = isObj(data.admin) ? data.admin : {};
  data.admin = deepMerge(cur, seed);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

console.log('Admin namespace seeded (flat + withdrawalsPage).');
