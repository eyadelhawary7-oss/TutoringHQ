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
  staff: {
    title: 'Sales Team',
    add: 'Add Staff',
    edit: 'Edit',
    deactivate: 'Deactivate',
    role_sm: 'Sales Manager',
    role_sr: 'Sales Rep',
    status_active: 'Active',
    status_inactive: 'Inactive',
    status_terminated: 'Terminated',
    hire_date: 'Hire Date',
    territory: 'Territory',
    reports_to: 'Reports To',
    base_salary: 'Base Salary',
    no_staff: 'No staff members yet',
    centers_count: 'Centers',
    ytd_commission: 'YTD Commission',
    termination_type_resigned: 'Resigned',
    termination_type_terminated: 'Terminated for Cause',
    termination_type_completed: 'Contract Completed',
    col_name: 'Name',
    col_role: 'Role',
    col_city: 'City',
    col_status: 'Status',
    currency_suffix: 'EGP',
    territory_mismatch: 'Territory mismatch with city',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
    terminate_warning:
      'Resignation or termination forfeits unpaid T2 commissions and loyalty bonuses.',
    termination_type_label: 'Termination type',
    termination_date_label: 'Termination date',
    role_label: 'Role',
    name_label: 'Name',
    phone_label: 'Phone',
    no_reports_to: 'No manager',
    notes_label: 'Notes',
    dash: '—',
    city_cairo: 'Cairo',
    city_alexandria: 'Alexandria',
    city_giza: 'Giza',
    city_mansoura: 'Mansoura',
    city_tanta: 'Tanta',
    city_assiut: 'Assiut',
    city_ismailia: 'Ismailia',
    errors: {
      unauthorized: 'You must be signed in as an admin.',
      forbidden: 'You do not have permission for this action.',
      listFailed: 'Could not load staff.',
      notFound: 'Staff member not found.',
      missingRequired: 'Name, phone, role, and city are required.',
      invalidRole: 'Role must be sales manager or sales rep.',
      phoneDuplicate: 'This phone number is already registered.',
      saveFailed: 'Could not save. Please try again.',
      terminationRequired: 'Termination type and date are required when terminating.',
    },
  },
})

forceSet(ar.admin, {
  staff: {
    title: 'فريق المبيعات',
    add: 'إضافة موظف',
    edit: 'تعديل',
    deactivate: 'إنهاء الخدمة',
    role_sm: 'مدير مبيعات',
    role_sr: 'مندوب مبيعات',
    status_active: 'نشط',
    status_inactive: 'غير نشط',
    status_terminated: 'منتهي',
    hire_date: 'تاريخ التعيين',
    territory: 'المنطقة',
    reports_to: 'يتبع لـ',
    base_salary: 'الراتب الأساسي',
    no_staff: 'لا يوجد موظفون بعد',
    centers_count: 'السناتر',
    ytd_commission: 'العمولات هذا العام',
    termination_type_resigned: 'استقالة',
    termination_type_terminated: 'فصل',
    termination_type_completed: 'انتهاء عقد',
    col_name: 'الاسم',
    col_role: 'الدور',
    col_city: 'المدينة',
    col_status: 'الحالة',
    currency_suffix: 'ج.م.',
    territory_mismatch: 'تعارض بين المنطقة والمدينة',
    cancel: 'إلغاء',
    save: 'حفظ',
    saving: 'جاري الحفظ…',
    terminate_warning: 'الاستقالة أو الفصل يلغي الشريحة الثانية وحوافز الولاء غير المدفوعة.',
    termination_type_label: 'نوع الإنهاء',
    termination_date_label: 'تاريخ الإنهاء',
    role_label: 'الدور',
    name_label: 'الاسم',
    phone_label: 'الهاتف',
    no_reports_to: 'بدون مدير',
    notes_label: 'ملاحظات',
    dash: '—',
    city_cairo: 'القاهرة',
    city_alexandria: 'الإسكندرية',
    city_giza: 'الجيزة',
    city_mansoura: 'المنصورة',
    city_tanta: 'طنطا',
    city_assiut: 'أسيوط',
    city_ismailia: 'الإسماعيلية',
    errors: {
      unauthorized: 'يجب تسجيل الدخول كمسؤول.',
      forbidden: 'ليس لديك صلاحية لهذا الإجراء.',
      listFailed: 'تعذر تحميل الموظفين.',
      notFound: 'الموظف غير موجود.',
      missingRequired: 'الاسم والهاتف والدور والمدينة مطلوبة.',
      invalidRole: 'الدور يجب أن يكون مدير مبيعات أو مندوب.',
      phoneDuplicate: 'رقم الهاتف مسجل مسبقاً.',
      saveFailed: 'تعذر الحفظ. حاول مرة أخرى.',
      terminationRequired: 'نوع الإنهاء والتاريخ مطلوبان عند الإنهاء.',
    },
  },
})

writeFileSync(join(root, 'messages/en.json'), JSON.stringify(en, null, 2), 'utf8')
writeFileSync(join(root, 'messages/ar.json'), JSON.stringify(ar, null, 2), 'utf8')
console.log('Staff S2 i18n keys seeded.')
