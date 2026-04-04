import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function forceSet(obj, keys) {
  for (const [k, v] of Object.entries(keys)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!obj[k] || typeof obj[k] !== 'object') obj[k] = {}
      forceSet(obj[k], v)
    } else {
      obj[k] = v
    }
  }
}

const en = JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8'))
const ar = JSON.parse(readFileSync(join(root, 'messages/ar.json'), 'utf8'))
if (!en.admin) en.admin = {}
if (!ar.admin) ar.admin = {}

forceSet(en.admin, {
  commissions: {
    title: 'Commissions',
    filter_staff: 'Staff',
    filter_plan: 'Plan',
    filter_status: 'Status',
    filter_t1: 'T1',
    filter_t2: 'T2',
    t1_pending: 'Pending',
    t1_eligible: 'Eligible',
    t1_paid: 'Paid',
    t1_clawed_back: 'Clawed Back',
    t2_locked: 'Locked',
    t2_eligible: 'Eligible',
    t2_paid: 'Paid',
    t2_forfeited: 'Forfeited',
    loyalty_locked: 'Locked',
    loyalty_eligible: 'Eligible',
    loyalty_paid: 'Paid',
    loyalty_forfeited: 'Forfeited',
    plan_at_signing: 'Plan at Signing',
    total: 'Total Commission',
    active_days: 'Active Days',
    clock_paused: 'Clock Paused',
    unlock_t2: 'Unlock T2',
    unlock_reason: 'Reason for Manual Unlock',
    unlock_confirm: 'Confirm Unlock',
    no_commissions: 'No commissions yet',
    type_self_sourced: 'Self-Sourced',
    type_override: 'Team Override',
    type_delta: 'Plan Upgrade Delta',
    record_count: '{count} records',
    col_center: 'Center',
    col_staff: 'Staff',
    col_plan: 'Plan',
    col_total: 'Total',
    col_t1: 'T1',
    col_t2: 'T2',
    col_loyalty: 'Loyalty',
    col_actions: 'Actions',
    days_until_t2: '{count} days until T2',
    eyad_label: 'Platform (Eyad)',
    unlock_reason_placeholder: 'Describe why you are unlocking T2 (at least 10 characters).',
    unlock_reason_counter: '{current} / {min} minimum characters',
    unlock_unlocking: 'Unlocking…',
    cancel: 'Cancel',
    errors: {
      unauthorized: 'You must be signed in as an admin.',
      forbidden: 'Only a super admin can access commissions.',
      listFailed: 'Could not load commissions.',
      reasonTooShort: 'Reason is required (minimum 10 characters).',
      notFound: 'Commission not found.',
      cannotUnlock: 'Cannot unlock — current status: {status}',
      saveFailed: 'Could not complete unlock. Please try again.',
    },
  },
})

forceSet(ar.admin, {
  commissions: {
    title: 'العمولات',
    filter_staff: 'الموظف',
    filter_plan: 'الخطة',
    filter_status: 'الحالة',
    filter_t1: 'T1',
    filter_t2: 'T2',
    t1_pending: 'في الانتظار',
    t1_eligible: 'مستحقة',
    t1_paid: 'مدفوعة',
    t1_clawed_back: 'مُستردة',
    t2_locked: 'مقفلة',
    t2_eligible: 'مستحقة',
    t2_paid: 'مدفوعة',
    t2_forfeited: 'مفقودة',
    loyalty_locked: 'مقفلة',
    loyalty_eligible: 'مستحقة',
    loyalty_paid: 'مدفوعة',
    loyalty_forfeited: 'مفقودة',
    plan_at_signing: 'الخطة عند التوقيع',
    total: 'إجمالي العمولة',
    active_days: 'أيام نشطة',
    clock_paused: 'الساعة متوقفة',
    unlock_t2: 'فتح الشريحة الثانية',
    unlock_reason: 'سبب الفتح اليدوي',
    unlock_confirm: 'تأكيد الفتح',
    no_commissions: 'لا توجد عمولات بعد',
    type_self_sourced: 'مباشر',
    type_override: 'تجاوز الفريق',
    type_delta: 'ترقية خطة',
    record_count: '{count} سجل',
    col_center: 'المركز',
    col_staff: 'الموظف',
    col_plan: 'الخطة',
    col_total: 'الإجمالي',
    col_t1: 'T1',
    col_t2: 'T2',
    col_loyalty: 'الولاء',
    col_actions: 'إجراءات',
    days_until_t2: '{count} يوم متبقي حتى T2',
    eyad_label: 'المنصة (إياد)',
    unlock_reason_placeholder: 'اذكر سبب الفتح اليدوي (10 أحرف على الأقل).',
    unlock_reason_counter: '{current} / {min} حد أدنى للأحرف',
    unlock_unlocking: 'جاري الفتح…',
    cancel: 'إلغاء',
    errors: {
      unauthorized: 'يجب تسجيل الدخول كمسؤول.',
      forbidden: 'صلاحية المشرف الأعلى فقط لعرض العمولات.',
      listFailed: 'تعذر تحميل العمولات.',
      reasonTooShort: 'السبب مطلوب (10 أحرف على الأقل).',
      notFound: 'العمولة غير موجودة.',
      cannotUnlock: 'لا يمكن الفتح — الحالة الحالية: {status}',
      saveFailed: 'تعذر إتمام الفتح. حاول مرة أخرى.',
    },
  },
})

writeFileSync(join(root, 'messages/en.json'), JSON.stringify(en, null, 2), 'utf8')
writeFileSync(join(root, 'messages/ar.json'), JSON.stringify(ar, null, 2), 'utf8')
console.log('Commissions S3 i18n keys seeded.')
