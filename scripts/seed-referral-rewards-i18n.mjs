import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function forceSet(obj, keys) {
  for (const [k, v] of Object.entries(keys)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!obj[k] || typeof obj[k] !== 'object') obj[k] = {};
      forceSet(obj[k], v);
    } else {
      obj[k] = v;
    }
  }
}

const en = JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8'));
const ar = JSON.parse(readFileSync(join(root, 'messages/ar.json'), 'utf8'));
if (!en.admin) en.admin = {};
if (!ar.admin) ar.admin = {};

forceSet(en.admin, {
  referralRewards: {
    title: 'Referral Rewards',
    subtitle: 'Monthly reward records for all active referrals',
    col_referrer: 'Referrer',
    col_referred: 'Referred Center',
    col_month: 'Month #',
    col_rate: 'Rate',
    col_base: 'Base Amount',
    col_reward: 'Reward',
    col_period: 'Period',
    col_status: 'Status',
    col_held_until: 'Payable After',
    status_pending: 'Pending',
    status_held: 'Held',
    status_available: 'Available',
    status_paid: 'Paid',
    mark_paid: 'Mark Selected as Paid',
    marking: 'Marking...',
    totals_heading: 'Referrer Totals',
    col_total_pending: 'Total Pending',
    col_total_paid: 'Total Paid',
    col_total_records: 'Records',
    no_records: 'No reward records yet — cron runs on the 2nd of each month',
    filter_all: 'All',
    filter_pending: 'Pending',
    filter_held: 'Held',
    filter_paid: 'Paid',
    select_payable: 'Select payable rows (pending or available) to mark paid.',
    errors: {
      unauthorized: 'Unauthorized',
      config: 'Server configuration error',
      listFailed: 'Failed to load reward records',
      superAdminOnly: 'Super admin only',
      invalidBody: 'Invalid request body',
      recordIdsRequired: 'Record IDs are required',
    },
  },
});

forceSet(ar.admin, {
  referralRewards: {
    title: 'مكافآت الإحالة',
    subtitle: 'سجلات المكافآت الشهرية لجميع الإحالات النشطة',
    col_referrer: 'المُحيل',
    col_referred: 'السنتر المُحال',
    col_month: 'الشهر #',
    col_rate: 'النسبة',
    col_base: 'المبلغ الأساسي',
    col_reward: 'المكافأة',
    col_period: 'الفترة',
    col_status: 'الحالة',
    col_held_until: 'قابلة للسحب بعد',
    status_pending: 'في الانتظار',
    status_held: 'محجوزة',
    status_available: 'متاحة',
    status_paid: 'مدفوعة',
    mark_paid: 'تأكيد دفع المحدد',
    marking: 'جاري التأكيد...',
    totals_heading: 'إجماليات المُحيلين',
    col_total_pending: 'إجمالي المعلق',
    col_total_paid: 'إجمالي المدفوع',
    col_total_records: 'السجلات',
    no_records: 'لا توجد سجلات مكافآت بعد — يعمل الكرون في الثاني من كل شهر',
    filter_all: 'الكل',
    filter_pending: 'معلق',
    filter_held: 'محجوز',
    filter_paid: 'مدفوع',
    select_payable: 'اختر الصفوف القابلة للدفع (معلق أو متاح) لتأكيد الدفع.',
    errors: {
      unauthorized: 'غير مصرح',
      config: 'خطأ في إعداد الخادم',
      listFailed: 'تعذر تحميل سجلات المكافآت',
      superAdminOnly: 'للمشرف الأعلى فقط',
      invalidBody: 'محتوى الطلب غير صالح',
      recordIdsRequired: 'معرفات السجلات مطلوبة',
    },
  },
});

writeFileSync(join(root, 'messages/en.json'), JSON.stringify(en, null, 2), 'utf8');
writeFileSync(join(root, 'messages/ar.json'), JSON.stringify(ar, null, 2), 'utf8');
console.log('Referral rewards i18n keys seeded ✓');
