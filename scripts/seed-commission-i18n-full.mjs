import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function forceSet(obj, keys) {
  for (const [k, v] of Object.entries(keys)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!obj[k] || typeof obj[k] !== 'object') obj[k] = {}
      forceSet(obj[k], v)
    } else { obj[k] = v }
  }
}

const en = JSON.parse(readFileSync(join(root,'messages/en.json'),'utf8'))
const ar = JSON.parse(readFileSync(join(root,'messages/ar.json'),'utf8'))
if (!en.admin) en.admin = {}
if (!ar.admin) ar.admin = {}

// ── STAFF keys ──────────────────────────────────────────────
forceSet(en.admin, { staff: {
  title: "Sales Team", add: "Add Staff Member", edit: "Edit",
  save: "Save", saving: "Saving...", cancel: "Cancel",
  deactivate: "Terminate", no_staff: "No staff members yet",
  role_label: "Role", role_sm: "Sales Manager", role_sr: "Sales Rep",
  name_label: "Full Name", phone_label: "Phone Number",
  notes_label: "Notes", hire_date: "Hire Date",
  reports_to: "Reports To", no_reports_to: "No manager",
  base_salary: "Base Salary", territory: "Territory",
  city: "City", ytd_commission: "YTD Commission",
  centers_count: "Centers", col_name: "Name", col_role: "Role",
  col_city: "City", col_status: "Status", col_actions: "Actions",
  currency_suffix: "EGP", dash: "—",
  terminate_warning: "Terminating will forfeit all pending T2 and loyalty bonuses.",
  termination_type_label: "Termination Type",
  termination_date_label: "Termination Date",
  termination_type_resigned: "Resigned",
  termination_type_terminated: "Terminated for Cause",
  termination_type_completed: "Contract Completed",
  territory_mismatch: "⚠ Territory mismatch",
  status_active: "Active", status_inactive: "Inactive",
  status_terminated: "Terminated",
}})

forceSet(ar.admin, { staff: {
  title: "فريق المبيعات", add: "إضافة موظف", edit: "تعديل",
  save: "حفظ", saving: "جاري الحفظ...", cancel: "إلغاء",
  deactivate: "إنهاء الخدمة", no_staff: "لا يوجد موظفون بعد",
  role_label: "الدور", role_sm: "مدير مبيعات", role_sr: "مندوب مبيعات",
  name_label: "الاسم الكامل", phone_label: "رقم الهاتف",
  notes_label: "ملاحظات", hire_date: "تاريخ التعيين",
  reports_to: "يتبع لـ", no_reports_to: "بدون مدير",
  base_salary: "الراتب الأساسي", territory: "المنطقة",
  city: "المدينة", ytd_commission: "العمولات هذا العام",
  centers_count: "السناتر", col_name: "الاسم", col_role: "الدور",
  col_city: "المدينة", col_status: "الحالة", col_actions: "إجراءات",
  currency_suffix: "ج", dash: "—",
  terminate_warning: "إنهاء الخدمة يلغي كل الشرائح الثانية ومكافآت الولاء المعلقة.",
  termination_type_label: "نوع الإنهاء",
  termination_date_label: "تاريخ الإنهاء",
  termination_type_resigned: "استقالة",
  termination_type_terminated: "فصل",
  termination_type_completed: "انتهاء عقد",
  territory_mismatch: "⚠ عدم تطابق المنطقة",
  status_active: "نشط", status_inactive: "غير نشط",
  status_terminated: "منتهي",
}})

// ── COMMISSIONS keys ─────────────────────────────────────────
forceSet(en.admin, { commissions: {
  title: "Commissions", record_count: "records",
  no_commissions: "No commissions yet",
  col_center: "Center", col_staff: "Staff",
  col_plan: "Plan", col_total: "Total",
  col_t1: "T1", col_t2: "T2", col_loyalty: "Loyalty",
  col_actions: "Actions", active_days: "Active Days",
  days_until_t2: "days to T2", clock_paused: "Clock Paused",
  filter_t1: "T1 Status", filter_t2: "T2 Status",
  eyad_label: "Eyad (direct)",
  unlock_t2: "Unlock T2", unlock_reason: "Reason for Manual Unlock",
  unlock_reason_placeholder: "Minimum 10 characters",
  unlock_reason_counter: "chars / 10 minimum",
  unlock_confirm: "Confirm Unlock", unlock_unlocking: "Unlocking...",
  cancel: "Cancel",
  errors: { cannotUnlock: "Cannot unlock — current status:" },
  t1_pending: "Pending", t1_eligible: "Eligible",
  t1_paid: "Paid", t1_clawed_back: "Clawed Back",
  t2_locked: "Locked", t2_eligible: "Eligible",
  t2_paid: "Paid", t2_forfeited: "Forfeited",
  loyalty_locked: "Locked", loyalty_eligible: "Eligible",
  loyalty_paid: "Paid",
  type_self_sourced: "Direct", type_override: "Override",
  type_delta_upgrade: "Upgrade Delta",
}})

forceSet(ar.admin, { commissions: {
  title: "العمولات", record_count: "سجل",
  no_commissions: "لا توجد عمولات بعد",
  col_center: "المركز", col_staff: "الموظف",
  col_plan: "الخطة", col_total: "الإجمالي",
  col_t1: "الشريحة 1", col_t2: "الشريحة 2", col_loyalty: "الولاء",
  col_actions: "إجراءات", active_days: "أيام نشطة",
  days_until_t2: "يوم متبقي", clock_paused: "الساعة متوقفة",
  filter_t1: "حالة الشريحة 1", filter_t2: "حالة الشريحة 2",
  eyad_label: "عياد (مباشر)",
  unlock_t2: "فتح الشريحة الثانية",
  unlock_reason: "سبب الفتح اليدوي",
  unlock_reason_placeholder: "10 أحرف على الأقل",
  unlock_reason_counter: "حرف / 10 حد أدنى",
  unlock_confirm: "تأكيد الفتح", unlock_unlocking: "جاري الفتح...",
  cancel: "إلغاء",
  errors: { cannotUnlock: "لا يمكن الفتح — الحالة الحالية:" },
  t1_pending: "في الانتظار", t1_eligible: "مستحقة",
  t1_paid: "مدفوعة", t1_clawed_back: "مُستردة",
  t2_locked: "مقفلة", t2_eligible: "مستحقة",
  t2_paid: "مدفوعة", t2_forfeited: "مفقودة",
  loyalty_locked: "مقفلة", loyalty_eligible: "مستحقة",
  loyalty_paid: "مدفوعة",
  type_self_sourced: "مباشر", type_override: "تجاوز",
  type_delta_upgrade: "ترقية خطة",
}})

// ── PAYOUTS keys ─────────────────────────────────────────────
forceSet(en.admin, { payouts: {
  title: "Monthly Payouts", record_count: "payouts",
  no_payouts: "No payouts yet", generate: "Generate Payout",
  period: "Period", period_format_hint: "YYYY-MM format",
  staff_label: "Staff Member", staff_placeholder: "Select a staff member",
  base_salary: "Base Salary", t1_total: "T1 Commissions",
  t2_total: "T2 Commissions", loyalty_total: "Loyalty Bonuses",
  override_total: "Team Overrides", grand_total: "Total Payout",
  adjustment: "Adjustment", adjustment_amount_label: "Amount (negative to deduct)",
  adjustment_amount_hint: "e.g. 500 or -200",
  adjustment_reason: "Adjustment Reason",
  status_draft: "Draft", status_confirmed: "Confirmed", status_paid: "Paid",
  requires_review: "⚠ Requires Review",
  confirm_reviewed: "Override Review Flag",
  mark_confirmed: "Confirm", mark_paid: "Mark as Paid",
  paid_at_label: "Paid on",
  create_action: "Generate", creating: "Generating...",
  apply: "Apply", applying: "Applying...", cancel: "Cancel",
}})

forceSet(ar.admin, { payouts: {
  title: "المدفوعات الشهرية", record_count: "كشف راتب",
  no_payouts: "لا توجد مدفوعات بعد", generate: "إنشاء كشف راتب",
  period: "الفترة", period_format_hint: "صيغة YYYY-MM",
  staff_label: "الموظف", staff_placeholder: "اختر موظفاً",
  base_salary: "الراتب الأساسي", t1_total: "عمولات الشريحة الأولى",
  t2_total: "عمولات الشريحة الثانية", loyalty_total: "مكافآت الولاء",
  override_total: "عمولات الفريق", grand_total: "الإجمالي",
  adjustment: "تسوية", adjustment_amount_label: "المبلغ (سالب للخصم)",
  adjustment_amount_hint: "مثال: 500 أو -200",
  adjustment_reason: "سبب التسوية",
  status_draft: "مسودة", status_confirmed: "مؤكدة", status_paid: "مدفوعة",
  requires_review: "⚠ تحتاج مراجعة",
  confirm_reviewed: "تجاوز علامة المراجعة",
  mark_confirmed: "تأكيد", mark_paid: "تأكيد الدفع",
  paid_at_label: "دُفع في",
  create_action: "إنشاء", creating: "جاري الإنشاء...",
  apply: "تطبيق", applying: "جاري التطبيق...", cancel: "إلغاء",
}})

writeFileSync(join(root,'messages/en.json'),JSON.stringify(en,null,2),'utf8')
writeFileSync(join(root,'messages/ar.json'),JSON.stringify(ar,null,2),'utf8')
console.log('Commission i18n keys seeded ✓')
