import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {}
      deepMerge(target[k], v)
    } else {
      if (!(k in target)) target[k] = v
    }
  }
}

const en = JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8'))
const ar = JSON.parse(readFileSync(join(root, 'messages/ar.json'), 'utf8'))

if (!en.admin) en.admin = {}
if (!ar.admin) ar.admin = {}
if (!en.admin.centerManagement) en.admin.centerManagement = {}
if (!ar.admin.centerManagement) ar.admin.centerManagement = {}

/** admin.vendors is the sidebar nav string; page keys need a nested object. */
function ensureVendorsObject(admin) {
  const v = admin.vendors
  if (typeof v === 'string') {
    if (!('vendorsNav' in admin)) admin.vendorsNav = v
    admin.vendors = {}
  } else if (!v || typeof v !== 'object' || Array.isArray(v)) {
    admin.vendors = {}
  }
}
ensureVendorsObject(en.admin)
ensureVendorsObject(ar.admin)

// ─── PART 1: 7 remaining centerManagement keys ───────
deepMerge(en.admin.centerManagement, {
  section4: { noInvoices: 'No invoices yet' },
  section5: {
    date: 'Date',
    amount: 'Amount',
    method: 'Method',
    recordedBy: 'Recorded By',
  },
  section9: { noRequests: 'No plan change requests' },
  section10: { noReferrals: 'No referrals yet' },
})
deepMerge(ar.admin.centerManagement, {
  section4: { noInvoices: 'لا توجد فواتير بعد' },
  section5: {
    date: 'التاريخ',
    amount: 'المبلغ',
    method: 'طريقة الدفع',
    recordedBy: 'سُجّل بواسطة',
  },
  section9: { noRequests: 'لا توجد طلبات تغيير خطة' },
  section10: { noReferrals: 'لا توجد إحالات بعد' },
})

// ─── PART 2: 3 new platformConfig Business keys ──────
deepMerge(en.admin, {
  platformConfigGroupBusiness: 'Business Targets',
  platformConfig_breakeven_target_label: 'Break-Even Target (Centers)',
  platformConfig_breakeven_target_desc:
    'Number of paying centers required to reach self-funding',
})
deepMerge(ar.admin, {
  platformConfigGroupBusiness: 'الأهداف التجارية',
  platformConfig_breakeven_target_label: 'هدف التعادل (سناتر)',
  platformConfig_breakeven_target_desc:
    'عدد السناتر المدفوعة المطلوب للوصول للتمويل الذاتي',
})

// ─── PART 3: 16 pricing page keys ────────────────────
// pricing/page.tsx uses useTranslations('admin'); nested mirrors for consistency.
const EN_PRICING = {
  pricingControlPanel: 'Pricing Control Panel',
  pricingSectionSubscriptions: 'Subscription Plans',
  pricingPlanName: 'Plan Name',
  pricingStudentLimit: 'Student Limit',
  pricingMonthlyList: 'Monthly (List)',
  pricingQuarterlyAllIn: 'Quarterly (All-In)',
  pricingAnnualDerived: 'Annual (Derived)',
  pricingMonthlyPremiumDerived: 'Monthly +15% (Derived)',
  pricingActive: 'Active',
  pricingSave: 'Save',
  pricingSectionPack: 'Parent WhatsApp Pack',
  pricingPackPriceLabel: 'Price per Parent / Month',
  pricingPackMinimumsTitle: 'Plan Invoice Minimums',
  pricingPackMinimumsNote:
    'Minimum invoice amount charged per plan regardless of active parents',
  pricingPlanKey: 'Plan',
  pricingMinimumEgp: 'Minimum (EGP)',
}
const AR_PRICING = {
  pricingControlPanel: 'لوحة التحكم بالأسعار',
  pricingSectionSubscriptions: 'خطط الاشتراك',
  pricingPlanName: 'اسم الخطة',
  pricingStudentLimit: 'حد الطلاب',
  pricingMonthlyList: 'شهري (سعر القائمة)',
  pricingQuarterlyAllIn: 'ربع سنوي (شامل)',
  pricingAnnualDerived: 'سنوي (محسوب)',
  pricingMonthlyPremiumDerived: 'شهري +15% (محسوب)',
  pricingActive: 'نشط',
  pricingSave: 'حفظ',
  pricingSectionPack: 'باقة واتساب للأولياء',
  pricingPackPriceLabel: 'السعر لكل ولي أمر / شهر',
  pricingPackMinimumsTitle: 'الحد الأدنى للفاتورة لكل خطة',
  pricingPackMinimumsNote:
    'الحد الأدنى للفاتورة المحصّلة لكل خطة بغض النظر عن عدد الأولياء النشطين',
  pricingPlanKey: 'الخطة',
  pricingMinimumEgp: 'الحد الأدنى (جنيه)',
}
deepMerge(en.admin, EN_PRICING)
deepMerge(ar.admin, AR_PRICING)
if (!en.admin.pricing) en.admin.pricing = {}
if (!ar.admin.pricing) ar.admin.pricing = {}
deepMerge(en.admin.pricing, EN_PRICING)
deepMerge(ar.admin.pricing, AR_PRICING)

// ─── PART 4: 19 health page keys ─────────────────────
const EN_HEALTH = {
  healthBack: 'Back',
  healthLastUpdated: 'Last Updated',
  healthPaymob: 'Paymob',
  healthWhatsApp: 'WhatsApp',
  healthQuickStats: 'Quick Stats',
  healthActiveCenters: 'Active Centers',
  healthPendingSignups: 'Pending Signups',
  healthStuckPayments: 'Stuck Payments',
  healthZeroBilling: 'Zero Billing',
  healthCronStatus: 'Cron Status',
  healthColCron: 'Cron Job',
  healthColLastRun: 'Last Run',
  healthColStatus: 'Status',
  healthColDuration: 'Duration',
  healthColError: 'Last Error',
  healthPendingActions: 'Pending Actions',
  healthPendingCancellations: 'Pending Cancellations',
  healthPendingWithdrawals: 'Pending Withdrawals',
  healthPendingSignupsLink: 'Pending Signups',
}
const AR_HEALTH = {
  healthBack: 'رجوع',
  healthLastUpdated: 'آخر تحديث',
  healthPaymob: 'بيموب',
  healthWhatsApp: 'واتساب',
  healthQuickStats: 'إحصائيات سريعة',
  healthActiveCenters: 'السناتر النشطة',
  healthPendingSignups: 'التسجيلات المعلقة',
  healthStuckPayments: 'المدفوعات العالقة',
  healthZeroBilling: 'فوترة صفرية',
  healthCronStatus: 'حالة المهام المجدولة',
  healthColCron: 'المهمة المجدولة',
  healthColLastRun: 'آخر تشغيل',
  healthColStatus: 'الحالة',
  healthColDuration: 'المدة',
  healthColError: 'آخر خطأ',
  healthPendingActions: 'الإجراءات المعلقة',
  healthPendingCancellations: 'الإلغاءات المعلقة',
  healthPendingWithdrawals: 'السحوبات المعلقة',
  healthPendingSignupsLink: 'التسجيلات المعلقة',
}
deepMerge(en.admin, EN_HEALTH)
deepMerge(ar.admin, AR_HEALTH)
if (!en.admin.health) en.admin.health = {}
if (!ar.admin.health) ar.admin.health = {}
deepMerge(en.admin.health, EN_HEALTH)
deepMerge(ar.admin.health, AR_HEALTH)

// ─── PART 5: 8 vendor page keys ──────────────────────
const EN_VENDORS = {
  vendorsTitle: 'Vendors',
  noVendorYet: 'No vendors added yet',
  vendorName: 'Vendor Name',
  vendorWhatsapp: 'WhatsApp Number',
  vendorAddress: 'Address',
  vendorCity: 'City',
  vendorActive: 'Active',
  saveVendor: 'Save Vendor',
}
const AR_VENDORS = {
  vendorsTitle: 'الموردون',
  noVendorYet: 'لا يوجد موردون بعد',
  vendorName: 'اسم المورد',
  vendorWhatsapp: 'رقم واتساب',
  vendorAddress: 'العنوان',
  vendorCity: 'المدينة',
  vendorActive: 'نشط',
  saveVendor: 'حفظ المورد',
}
deepMerge(en.admin, EN_VENDORS)
deepMerge(ar.admin, AR_VENDORS)
deepMerge(en.admin.vendors, EN_VENDORS)
deepMerge(ar.admin.vendors, AR_VENDORS)

// ─── PART 6: Admin sidebar title ─────────────────────
deepMerge(en.admin, {
  sidebarTitle: 'Admin Panel',
  title: 'Admin Panel',
})
deepMerge(ar.admin, {
  sidebarTitle: 'لوحة الإدارة',
  title: 'لوحة الإدارة',
})

// Obvious placeholder / audit fixes (values existed but were wrong)
if (en.admin.title === 'Title') en.admin.title = 'Admin Panel'
if (ar.admin.title === 'عنوان') ar.admin.title = 'لوحة الإدارة'
if (en.admin.platformConfigNav === 'Platform Config Nav') {
  en.admin.platformConfigNav = 'Platform Config'
}
if (
  ar.admin.platformConfigNav === 'المنصة إعدادات التنقل' ||
  !ar.admin.platformConfigNav
) {
  ar.admin.platformConfigNav = 'إعدادات المنصة'
}

// ─── PART 7: platformConfigNav sidebar label ─────────
if (!('platformConfigNav' in en.admin)) {
  en.admin.platformConfigNav = 'Platform Config'
}
if (!('platformConfigNav' in ar.admin)) {
  ar.admin.platformConfigNav = 'إعدادات المنصة'
}

writeFileSync(
  join(root, 'messages/en.json'),
  JSON.stringify(en, null, 2),
  'utf8',
)
writeFileSync(
  join(root, 'messages/ar.json'),
  JSON.stringify(ar, null, 2),
  'utf8',
)
console.log('Pass 3 fix: 53 keys applied.')
