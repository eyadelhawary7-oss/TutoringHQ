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

const enBlock = {
  centerAssignments: {
    title: 'Center Assignments',
    subtitle: 'Assign each center to the SR, SM, or Eyad who sourced it',
    add: 'Add Assignment',
    edit: 'Edit',
    save: 'Save',
    saving: 'Saving...',
    cancel: 'Cancel',
    loading: 'Loading…',
    no_assignments: 'No assignments yet — add one for each active center',
    col_center: 'Center',
    col_staff: 'Assigned To',
    col_sourced_by: 'Sourced By',
    col_status: 'Status',
    col_territory: 'Territory',
    col_actions: 'Actions',
    sourced_eyad: 'Eyad (direct)',
    sourced_sm: 'SM',
    sourced_sr: 'SR',
    staff_display_eyad: 'Eyad',
    status_approved: 'Approved',
    status_pending_sm_approval: 'Pending SM Approval',
    status_disputed: 'Disputed',
    referred_badge: 'Referral — no commission',
    dispute_flag: 'Flag Dispute',
    resolve_dispute: 'Resolve',
    dispute_notes_label: 'Dispute Notes',
    center_label: 'Center',
    center_placeholder: 'Select center',
    staff_label: 'Staff Member',
    staff_placeholder: 'Select staff (or leave empty for Eyad)',
    sourced_by_label: 'Sourced By',
    territory_city_label: 'Territory City (if override)',
    territory_placeholder_example: 'e.g. Nasr City',
    override_reason_label: 'Override Reason',
    override_note_prefix: 'Override:',
    unassigned_warning: 'centers have no primary assignment — commissions cannot be calculated',
    unassigned_more: '+{count} more',
    commission_blocked: 'Referral center — SR commission blocked',
    errors: {
      unauthorized: 'Unauthorized',
      forbidden_super_admin: 'Super admin only',
      misconfigured: 'Server misconfigured',
      center_sourced_required: 'center_id and sourced_by are required',
      sourced_by_invalid: 'sourced_by must be eyad, sm, or sr',
      eyad_no_staff: 'Eyad sourcing must not include a staff member',
      sm_sr_requires_staff: 'SM or SR sourcing requires a staff member',
      duplicate_primary: 'This center already has a primary assignment. Edit the existing one.',
      list_failed: 'Failed to load assignments',
      save_failed: 'Failed to save assignment',
      invalid_json: 'Invalid request body',
      not_found: 'Assignment not found',
    },
  },
};

const arBlock = {
  centerAssignments: {
    title: 'تخصيص السناتر',
    subtitle: 'حدد من أحضر كل سنتر: مندوب أو مدير أو عياد',
    add: 'إضافة تخصيص',
    edit: 'تعديل',
    save: 'حفظ',
    saving: 'جاري الحفظ...',
    cancel: 'إلغاء',
    loading: 'جاري التحميل…',
    no_assignments: 'لا توجد تخصيصات بعد — أضف واحداً لكل سنتر نشط',
    col_center: 'السنتر',
    col_staff: 'المخصص له',
    col_sourced_by: 'من أحضره',
    col_status: 'الحالة',
    col_territory: 'المنطقة',
    col_actions: 'إجراءات',
    sourced_eyad: 'عياد (مباشر)',
    sourced_sm: 'مدير المبيعات',
    sourced_sr: 'مندوب المبيعات',
    staff_display_eyad: 'عياد',
    status_approved: 'معتمد',
    status_pending_sm_approval: 'في انتظار موافقة المدير',
    status_disputed: 'متنازع عليه',
    referred_badge: 'إحالة — بدون عمولة',
    dispute_flag: 'الإبلاغ عن نزاع',
    resolve_dispute: 'حل النزاع',
    dispute_notes_label: 'ملاحظات النزاع',
    center_label: 'السنتر',
    center_placeholder: 'اختر السنتر',
    staff_label: 'الموظف',
    staff_placeholder: 'اختر موظفاً (اتركه فارغاً لعياد)',
    sourced_by_label: 'من أحضره',
    territory_city_label: 'مدينة المنطقة (عند التجاوز)',
    territory_placeholder_example: 'مثال: مدينة نصر',
    override_reason_label: 'سبب التجاوز',
    override_note_prefix: 'تجاوز:',
    unassigned_warning: 'سنتر بدون تخصيص — لا يمكن احتساب العمولات',
    unassigned_more: '+{count} آخرين',
    commission_blocked: 'سنتر إحالة — عمولة المندوب محجوبة',
    errors: {
      unauthorized: 'غير مصرح',
      forbidden_super_admin: 'للمشرف الأعلى فقط',
      misconfigured: 'الخادم غير مُهيأ',
      center_sourced_required: 'يجب إدخال السنتر ومصدره',
      sourced_by_invalid: 'المصدر يجب أن يكون eyad أو sm أو sr',
      eyad_no_staff: 'مصدر عياد لا يقبل موظفاً',
      sm_sr_requires_staff: 'مصدر مدير أو مندوب يتطلب اختيار موظف',
      duplicate_primary: 'هذا السنتر له تخصيص أساسي بالفعل. عدّل السجل الحالي.',
      list_failed: 'تعذر تحميل التخصيصات',
      save_failed: 'تعذر حفظ التخصيص',
      invalid_json: 'طلب غير صالح',
      not_found: 'التخصيص غير موجود',
    },
  },
};

forceSet(en.admin, enBlock);
forceSet(ar.admin, arBlock);

writeFileSync(join(root, 'messages/en.json'), JSON.stringify(en, null, 2), 'utf8');
writeFileSync(join(root, 'messages/ar.json'), JSON.stringify(ar, null, 2), 'utf8');
console.log('Center assignments i18n keys seeded ✓');
