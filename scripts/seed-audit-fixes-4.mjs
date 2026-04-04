import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function forceSet(obj, keys) {
  for (const [k, v] of Object.entries(keys)) {
    obj[k] = v
  }
}

const en = JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8'))
const ar = JSON.parse(readFileSync(join(root, 'messages/ar.json'), 'utf8'))

if (!en.admin) en.admin = {}
if (!ar.admin) ar.admin = {}
if (!en.students) en.students = {}
if (!ar.students) ar.students = {}
if (!en.login) en.login = {}
if (!ar.login) ar.login = {}

function syncNested(admin, patch) {
  if (admin && typeof admin === 'object' && !Array.isArray(admin)) {
    forceSet(admin, patch)
  }
}

// ─── PART 1: Force-overwrite pricing keys (16) ───────
const EN_PRICING_FORCE = {
  pricingControlPanel: 'Pricing Control Panel',
  pricingSectionSubscriptions: 'Subscription Plans',
  pricingPlanName: 'Plan Name',
  pricingStudentLimit: 'Student Limit',
  pricingMonthlyList: 'Monthly (List Price)',
  pricingQuarterlyAllIn: 'Quarterly All-In',
  pricingAnnualDerived: 'Annual (Derived)',
  pricingMonthlyPremiumDerived: 'Monthly +15% (Derived)',
  pricingActive: 'Active',
  pricingSave: 'Save',
  pricingSectionPack: 'Parent WhatsApp Pack',
  pricingPackPriceLabel: 'Price per Parent / Month (EGP)',
  pricingPackMinimumsTitle: 'Plan Invoice Minimums',
  pricingPackMinimumsNote:
    'Minimum charged per plan regardless of active parent count',
  pricingPlanKey: 'Plan',
  pricingMinimumEgp: 'Minimum (EGP)',
}
const AR_PRICING_FORCE = {
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
  pricingPackPriceLabel: 'السعر لكل ولي أمر / شهر (جنيه)',
  pricingPackMinimumsTitle: 'الحد الأدنى للفاتورة لكل خطة',
  pricingPackMinimumsNote:
    'الحد الأدنى المحصّل لكل خطة بغض النظر عن عدد الأولياء النشطين',
  pricingPlanKey: 'الخطة',
  pricingMinimumEgp: 'الحد الأدنى (جنيه)',
}
forceSet(en.admin, EN_PRICING_FORCE)
forceSet(ar.admin, AR_PRICING_FORCE)
syncNested(en.admin.pricing, EN_PRICING_FORCE)
syncNested(ar.admin.pricing, AR_PRICING_FORCE)

// ─── PART 2: Force-overwrite health keys (19) ────────
const EN_HEALTH_FORCE = {
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
const AR_HEALTH_FORCE = {
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
  healthColCron: 'المهمة',
  healthColLastRun: 'آخر تشغيل',
  healthColStatus: 'الحالة',
  healthColDuration: 'المدة',
  healthColError: 'آخر خطأ',
  healthPendingActions: 'الإجراءات المعلقة',
  healthPendingCancellations: 'الإلغاءات المعلقة',
  healthPendingWithdrawals: 'السحوبات المعلقة',
  healthPendingSignupsLink: 'التسجيلات المعلقة',
}
forceSet(en.admin, EN_HEALTH_FORCE)
forceSet(ar.admin, AR_HEALTH_FORCE)
syncNested(en.admin.health, EN_HEALTH_FORCE)
syncNested(ar.admin.health, AR_HEALTH_FORCE)

// ─── PART 3: Force-overwrite vendor keys (8) ─────────
if (typeof en.admin.vendors !== 'object' || en.admin.vendors === null) {
  en.admin.vendors = {}
}
if (typeof ar.admin.vendors !== 'object' || ar.admin.vendors === null) {
  ar.admin.vendors = {}
}
const EN_VENDOR_FORCE = {
  vendorsTitle: 'Vendors',
  noVendorYet: 'No vendors added yet',
  vendorName: 'Vendor Name',
  vendorWhatsapp: 'WhatsApp Number',
  vendorAddress: 'Address',
  vendorCity: 'City',
  vendorActive: 'Active',
  saveVendor: 'Save Vendor',
}
const AR_VENDOR_FORCE = {
  vendorsTitle: 'الموردون',
  noVendorYet: 'لا يوجد موردون بعد',
  vendorName: 'اسم المورد',
  vendorWhatsapp: 'رقم واتساب',
  vendorAddress: 'العنوان',
  vendorCity: 'المدينة',
  vendorActive: 'نشط',
  saveVendor: 'حفظ المورد',
}
forceSet(en.admin, EN_VENDOR_FORCE)
forceSet(ar.admin, AR_VENDOR_FORCE)
syncNested(en.admin.vendors, EN_VENDOR_FORCE)
syncNested(ar.admin.vendors, AR_VENDOR_FORCE)

// ─── PART 4: platformConfig Business + back (4) ──────
forceSet(en.admin, {
  platformConfigBack: 'Back',
  platformConfigGroupBusiness: 'Business Targets',
  platformConfig_breakeven_target_label: 'Break-Even Target (Centers)',
  platformConfig_breakeven_target_desc:
    'Number of paying centers required to reach self-funding',
})
forceSet(ar.admin, {
  platformConfigBack: 'رجوع',
  platformConfigGroupBusiness: 'الأهداف التجارية',
  platformConfig_breakeven_target_label: 'هدف التعادل (سناتر)',
  platformConfig_breakeven_target_desc:
    'عدد السناتر المدفوعة المطلوب للوصول للتمويل الذاتي',
})

// ─── PART 5: referrals — sidebar nav string → referralsNav + nested object
function ensureReferralsDetailObject(admin) {
  const r = admin.referrals
  if (typeof r === 'string') {
    if (!('referralsNav' in admin)) admin.referralsNav = r
    admin.referrals = {}
  } else if (!r || typeof r !== 'object') {
    admin.referrals = {}
  }
}
ensureReferralsDetailObject(en.admin)
ensureReferralsDetailObject(ar.admin)

const EN_REFERRALS_ADMIN_FLAT = {
  referralsPageTitle: 'Referrals',
  referralsTabReferrals: 'Referrals',
  referralsTabCommissions: 'Commissions',
}
const AR_REFERRALS_ADMIN_FLAT = {
  referralsPageTitle: 'الإحالات',
  referralsTabReferrals: 'الإحالات',
  referralsTabCommissions: 'العمولات',
}
forceSet(en.admin, EN_REFERRALS_ADMIN_FLAT)
forceSet(ar.admin, AR_REFERRALS_ADMIN_FLAT)

const EN_REFERRALS_NESTED = {
  pageTitle: 'Referrals',
  tabReferrals: 'Referrals',
  tabCommissions: 'Commissions',
}
const AR_REFERRALS_NESTED = {
  pageTitle: 'الإحالات',
  tabReferrals: 'الإحالات',
  tabCommissions: 'العمولات',
}
forceSet(en.admin.referrals, EN_REFERRALS_NESTED)
forceSet(ar.admin.referrals, AR_REFERRALS_NESTED)

// referrals/page.tsx uses useTranslations('admin.referralsAdminPage')
if (
  !en.admin.referralsAdminPage ||
  typeof en.admin.referralsAdminPage !== 'object'
) {
  en.admin.referralsAdminPage = {}
}
if (
  !ar.admin.referralsAdminPage ||
  typeof ar.admin.referralsAdminPage !== 'object'
) {
  ar.admin.referralsAdminPage = {}
}
forceSet(en.admin.referralsAdminPage, EN_REFERRALS_NESTED)
forceSet(ar.admin.referralsAdminPage, AR_REFERRALS_NESTED)

if (!('referralsNav' in en.admin)) en.admin.referralsNav = 'Referrals'
if (!('referralsNav' in ar.admin)) ar.admin.referralsNav = 'الإحالات'

// ─── PART 6: students.title (1 key) ──────────────────
en.students.title = 'Students'
ar.students.title = 'الطلاب'

// ─── PART 7: login page keys (login/page.tsx) ────────
forceSet(en.login, {
  phonePlaceholder: 'Phone number',
  pinPlaceholder: 'PIN',
  registerLink: 'Register new center',
})
forceSet(ar.login, {
  phonePlaceholder: 'رقم الهاتف',
  pinPlaceholder: 'الرقم السري',
  registerLink: 'تسجيل سنتر جديد',
})

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
console.log('Pass 4 fix: 54 keys force-overwritten.')
