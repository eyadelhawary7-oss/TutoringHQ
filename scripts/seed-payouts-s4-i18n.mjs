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
  payouts: {
    title: 'Monthly Payouts',
    generate: 'Generate Payout',
    period: 'Period',
    base_salary: 'Base Salary',
    t1_total: 'T1 Commissions',
    t2_total: 'T2 Commissions',
    loyalty_total: 'Loyalty Bonuses',
    override_total: 'Team Overrides',
    grand_total: 'Total Payout',
    status_draft: 'Draft',
    status_confirmed: 'Confirmed',
    status_paid: 'Paid',
    requires_review: 'Requires review',
    mark_confirmed: 'Confirm',
    confirm_reviewed: 'Confirm (reviewed)',
    mark_paid: 'Mark as Paid',
    no_payouts: 'No payouts yet',
    adjustment: 'Adjustment',
    adjustment_reason: 'Adjustment Reason',
    adjustment_amount_label: 'Amount (negative to deduct)',
    adjustment_amount_hint: 'Example: 500 or -200',
    breakdown: 'Breakdown',
    history: 'History',
    record_count: '{count} payouts',
    paid_at_label: 'Paid on {date}',
    staff_label: 'Staff member',
    staff_placeholder: 'Select staff',
    create_action: 'Create',
    apply: 'Apply',
    creating: 'Creating…',
    applying: 'Applying…',
    cancel: 'Cancel',
    period_format_hint: 'Format: YYYY-MM',
    errors: {
      unauthorized: 'You must be signed in as an admin.',
      forbidden: 'Only a super admin can manage payouts.',
      listFailed: 'Could not load payouts.',
      invalidPeriod: 'Period must be YYYY-MM.',
      staffRequired: 'Staff member is required.',
      exists: 'A payout already exists for this period.',
      staffNotFound: 'Staff member not found.',
      saveFailed: 'Could not save. Please try again.',
      notFound: 'Payout not found.',
      paidLocked: 'This payout is paid — use an adjustment on the next payout.',
      confirmDraftOnly: 'Only draft payouts can be confirmed.',
      reviewRequired: 'This payout is flagged for review. Confirm only after review.',
      markPaidConfirmedOnly: 'Only confirmed payouts can be marked as paid.',
      adjustReason: 'Adjustment reason is required (at least 5 characters).',
      badAction: 'Action must be confirm, mark_paid, or adjust.',
    },
  },
})

forceSet(ar.admin, {
  payouts: {
    title: 'المدفوعات الشهرية',
    generate: 'إنشاء كشف راتب',
    period: 'الفترة',
    base_salary: 'الراتب الأساسي',
    t1_total: 'عمولات الشريحة الأولى',
    t2_total: 'عمولات الشريحة الثانية',
    loyalty_total: 'مكافآت الولاء',
    override_total: 'عمولات الفريق',
    grand_total: 'الإجمالي',
    status_draft: 'مسودة',
    status_confirmed: 'مؤكدة',
    status_paid: 'مدفوعة',
    requires_review: 'تحتاج مراجعة',
    mark_confirmed: 'تأكيد',
    confirm_reviewed: 'تأكيد بعد المراجعة',
    mark_paid: 'تأكيد الدفع',
    no_payouts: 'لا توجد مدفوعات بعد',
    adjustment: 'تسوية',
    adjustment_reason: 'سبب التسوية',
    adjustment_amount_label: 'المبلغ (سالب للخصم)',
    adjustment_amount_hint: 'مثال: 500 أو -200',
    breakdown: 'التفاصيل',
    history: 'السجل',
    record_count: '{count} كشف راتب',
    paid_at_label: 'دُفع في {date}',
    staff_label: 'الموظف',
    staff_placeholder: 'اختر موظفاً',
    create_action: 'إنشاء',
    apply: 'تطبيق',
    creating: 'جاري الإنشاء…',
    applying: 'جاري التطبيق…',
    cancel: 'إلغاء',
    period_format_hint: 'الصيغة: YYYY-MM',
    errors: {
      unauthorized: 'يجب تسجيل الدخول كمسؤول.',
      forbidden: 'صلاحية المشرف الأعلى فقط لإدارة المدفوعات.',
      listFailed: 'تعذر تحميل المدفوعات.',
      invalidPeriod: 'الفترة يجب أن تكون YYYY-MM.',
      staffRequired: 'اختيار الموظف مطلوب.',
      exists: 'يوجد كشف راتب لهذه الفترة مسبقاً.',
      staffNotFound: 'الموظف غير موجود.',
      saveFailed: 'تعذر الحفظ. حاول مرة أخرى.',
      notFound: 'الكشف غير موجود.',
      paidLocked: 'الكشف مدفوع — استخدم تسوية على الكشف التالي.',
      confirmDraftOnly: 'يمكن تأكيد المسودات فقط.',
      reviewRequired: 'هذا الكشف يحتاج مراجعة. أكّد فقط بعد المراجعة.',
      markPaidConfirmedOnly: 'يمكن تأكيد الدفع للكشوف المؤكدة فقط.',
      adjustReason: 'سبب التسوية مطلوب (5 أحرف على الأقل).',
      badAction: 'الإجراء يجب أن يكون تأكيد أو دفع أو تسوية.',
    },
  },
})

writeFileSync(join(root, 'messages/en.json'), JSON.stringify(en, null, 2), 'utf8')
writeFileSync(join(root, 'messages/ar.json'), JSON.stringify(ar, null, 2), 'utf8')
console.log('Payouts S4 i18n keys seeded.')
