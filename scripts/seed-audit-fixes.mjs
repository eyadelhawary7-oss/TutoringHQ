import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const enPath = join(root, 'messages', 'en.json')
const arPath = join(root, 'messages', 'ar.json')

function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') {
        target[k] = {}
      }
      deepMerge(target[k], v)
    } else {
      if (!(k in target)) {
        target[k] = v
      }
    }
  }
}

const en = JSON.parse(readFileSync(enPath, 'utf8'))
const ar = JSON.parse(readFileSync(arPath, 'utf8'))

// Ensure top-level namespaces exist as objects
if (!en.students || typeof en.students !== 'object') en.students = {}
if (!ar.students || typeof ar.students !== 'object') ar.students = {}
if (!en.analytics || typeof en.analytics !== 'object') en.analytics = {}
if (!ar.analytics || typeof ar.analytics !== 'object') ar.analytics = {}
if (!en.admin || typeof en.admin !== 'object') en.admin = {}
if (!ar.admin || typeof ar.admin !== 'object') ar.admin = {}
if (!en.admin.centerManagement) en.admin.centerManagement = {}
if (!ar.admin.centerManagement) ar.admin.centerManagement = {}

// --- STUDENTS ---
const EN_STUDENTS = {
  subtitle: 'Manage your enrolled students',
  import: 'Import',
  order_cards: 'Order Cards',
  sendAnnouncement: 'Send Announcement',
  add_student: 'Add Student',
  total_students: 'Total Students',
  active_students: 'Active Students',
  search_placeholder: 'Search students...',
  filter_all: 'All',
  filter_active: 'Active',
  filter_at_risk: 'At Risk',
  filter_inactive: 'Inactive',
  filter_enrolled: 'Enrolled',
  filter_churned: 'Churned',
  sort: 'Sort',
  sortName: 'Sort by Name',
  sortBalance: 'Sort by Balance',
  status_at_risk: 'At Risk',
  status_enrolled: 'Enrolled',
  no_balance: 'No balance',
  last_sessions: 'Last Sessions',
  balance_due: 'Balance Due',
  parentPackOptIn: 'WhatsApp Pack',
  addToCardOrder: 'Add to Card Order',
  swipe_edit: 'Edit',
  swipe_scan: 'Scan',
  swipe_delete: 'Delete',
  studentName: 'Student Name',
  parentSection: 'Parent Information',
  autoGenerateNumber: 'Auto-generate student number',
}
const AR_STUDENTS = {
  subtitle: 'إدارة الطلاب المسجلين',
  import: 'استيراد',
  order_cards: 'طلب بطاقات',
  sendAnnouncement: 'إرسال إعلان',
  add_student: 'إضافة طالب',
  total_students: 'إجمالي الطلاب',
  active_students: 'الطلاب النشطون',
  search_placeholder: 'بحث عن طالب...',
  filter_all: 'الكل',
  filter_active: 'نشط',
  filter_at_risk: 'في خطر',
  filter_inactive: 'غير نشط',
  filter_enrolled: 'مسجل',
  filter_churned: 'منسحب',
  sort: 'ترتيب',
  sortName: 'ترتيب بالاسم',
  sortBalance: 'ترتيب بالرصيد',
  status_at_risk: 'في خطر',
  status_enrolled: 'مسجل',
  no_balance: 'لا يوجد رصيد',
  last_sessions: 'الجلسات الأخيرة',
  balance_due: 'الرصيد المستحق',
  parentPackOptIn: 'باقة واتساب',
  addToCardOrder: 'إضافة لطلب البطاقات',
  swipe_edit: 'تعديل',
  swipe_scan: 'مسح',
  swipe_delete: 'حذف',
  studentName: 'اسم الطالب',
  parentSection: 'معلومات ولي الأمر',
  autoGenerateNumber: 'توليد رقم الطالب تلقائياً',
}

// --- ANALYTICS ---
const EN_ANALYTICS = { aiChat_fabLabel: 'Ask AI' }
const AR_ANALYTICS = { aiChat_fabLabel: 'اسأل الذكاء الاصطناعي' }

// --- ADMIN extras ---
const EN_ADMIN_EXTRA = {
  search: 'Search centers...',
  studentsCount: 'Students',
  lastActive: 'Last Active',
  usage: 'Usage',
}
const AR_ADMIN_EXTRA = {
  search: 'بحث عن سنتر...',
  studentsCount: 'الطلاب',
  lastActive: 'آخر نشاط',
  usage: 'الاستخدام',
}

// --- CENTER MANAGEMENT (full object) ---
const EN_CM = {
  backToList: 'Back to Centers',
  title: 'Center Management',
  saveSection: 'Save Changes',
  section1: {
    title: 'Center Identity',
    name: 'Center Name',
    ownerName: 'Owner Name',
    phone: 'Phone Number',
    email: 'Email',
    city: 'City',
    district: 'District',
    governorate: 'Governorate',
    centerCode: 'Center Code',
    centerCodeWarning: 'Center code cannot be changed after assignment',
    cardColor: 'QR Card Color',
    signupNotes: 'Signup Notes',
  },
  section2: {
    title: 'Status & Plan',
    status: 'Account Status',
    subscriptionStatus: 'Subscription Status',
    billingStatus: 'Billing Status',
    plan: 'Plan',
    pricingType: 'Pricing Type',
    billingType: 'Billing Type',
    billingPeriod: 'Billing Period',
    weeklyStudentLimit: 'Weekly Student Limit',
  },
  section3: {
    title: 'Billing Details',
    effectiveMonthly: 'Effective Monthly Price',
    annualEquivalent: 'Annual Equivalent',
    billingAmount: 'Billing Amount',
    allInPrice: 'All-In Price',
    nextPaymentDue: 'Next Payment Due',
    autoSuspendAt: 'Auto-Suspend Date',
    autoSuspendWarning: 'Center will be suspended on this date if unpaid',
    subscriptionStartDate: 'Subscription Start Date',
    isEarlyAdopter: 'Early Adopter',
  },
  section4: {
    title: 'Invoices',
    createInvoice: 'Create Invoice',
    invoiceNumber: 'Invoice #',
    type: 'Type',
    amount: 'Amount',
    status: 'Status',
    dueDate: 'Due Date',
    created: 'Created',
    notes: 'Notes',
  },
  section5: {
    title: 'Payment History',
    recordPayment: 'Record Payment',
    noPayments: 'No payments recorded yet',
  },
  section6: {
    title: 'WhatsApp Pack',
    packApprovedAt: 'Pack Approved',
    packRequestedAt: 'Pack Requested',
    packDisabledAt: 'Pack Disabled',
    activeParents: 'Active Parents',
    packEnabled: 'Pack Enabled',
    packRequestStatus: 'Request Status',
    packPrice: 'Price per Parent',
    packCustomMin: 'Custom Invoice Minimum',
    packPendingBalance: 'Pending Balance',
    packBalanceNote: 'Balance carried to next invoice',
    packMonths: 'Months Without Invoice',
  },
  section7: {
    title: 'Announcements',
    balance: 'Announcement Balance',
    balanceNote: 'Used for center announcements',
    balanceUpdated: 'Balance Last Updated',
    pricePerBlast: 'Price per Blast',
    cap: 'Monthly Cap',
  },
  section8: {
    title: 'Configuration',
    individualAlerts: 'Individual Attendance Alerts',
    dailySummary: 'Daily Summary',
    summerMode: 'Summer Mode',
    whatsappOptedIn: 'WhatsApp Opted In',
    summerModeWarning: 'Summer mode pauses billing reminders',
    scheduleStart: 'Schedule Start Hour',
    scheduleEnd: 'Schedule End Hour',
    instapayNumber: 'InstaPay Number',
    instapayNote: 'Used for credit withdrawals',
  },
  section9: {
    title: 'Plan Requests',
    overridePlan: 'Override Plan',
    overrideWarning: 'Manually overriding the plan bypasses payment',
    currentPlan: 'Current Plan',
    requestedPlan: 'Requested Plan',
    approve: 'Approve',
    reject: 'Reject',
  },
  section10: {
    title: 'Referrals',
    referralCode: 'Referral Code',
    copy: 'Copy',
    referredBy: 'Referred By',
    centersReferred: 'Centers Referred',
    commissions: 'Commissions',
    noCommissions: 'No commissions yet',
    rewardStatus: 'Reward Status',
    rewardAmount: 'Reward Amount',
    payoutRequests: 'Payout Requests',
    noPayouts: 'No payout requests',
  },
  section11: {
    title: 'Danger Zone',
    blacklistBtn: 'Blacklist Center',
    blacklistWarning:
      'Blacklisting permanently blocks this center from the platform',
  },
  section12: {
    title: 'System Information',
    id: 'Center ID',
    createdAt: 'Created At',
    approvedAt: 'Approved At',
    approvedBy: 'Approved By',
    healthScore: 'Health Score',
    healthBand: 'Health Band',
    onboardingStep: 'Onboarding Step',
    onboardingCompleted: 'Onboarding Completed',
    onboardingStarted: 'Onboarding Started',
    lastPayment: 'Last Payment',
    studentSequence: 'Student Sequence',
    packActivatedAt: 'Pack Activated',
    packDisabledAt: 'Pack Disabled',
    renewalReminder: 'Renewal Reminder Sent',
    overdueReminder: 'Overdue Reminder Sent',
  },
}
const AR_CM = {
  backToList: 'العودة للسناتر',
  title: 'إدارة السنتر',
  saveSection: 'حفظ التغييرات',
  section1: {
    title: 'هوية السنتر',
    name: 'اسم السنتر',
    ownerName: 'اسم المالك',
    phone: 'رقم الهاتف',
    email: 'البريد الإلكتروني',
    city: 'المدينة',
    district: 'الحي',
    governorate: 'المحافظة',
    centerCode: 'كود السنتر',
    centerCodeWarning: 'لا يمكن تغيير الكود بعد التعيين',
    cardColor: 'لون بطاقة QR',
    signupNotes: 'ملاحظات التسجيل',
  },
  section2: {
    title: 'الحالة والخطة',
    status: 'حالة الحساب',
    subscriptionStatus: 'حالة الاشتراك',
    billingStatus: 'حالة الفوترة',
    plan: 'الخطة',
    pricingType: 'نوع التسعير',
    billingType: 'نوع الفوترة',
    billingPeriod: 'فترة الفوترة',
    weeklyStudentLimit: 'حد الطلاب الأسبوعي',
  },
  section3: {
    title: 'تفاصيل الفوترة',
    effectiveMonthly: 'السعر الشهري الفعلي',
    annualEquivalent: 'المكافئ السنوي',
    billingAmount: 'مبلغ الفاتورة',
    allInPrice: 'السعر الشامل',
    nextPaymentDue: 'الدفعة القادمة',
    autoSuspendAt: 'تاريخ الإيقاف التلقائي',
    autoSuspendWarning: 'سيتم إيقاف السنتر في هذا التاريخ إذا لم يُسدَّد',
    subscriptionStartDate: 'تاريخ بداية الاشتراك',
    isEarlyAdopter: 'مبكر التبني',
  },
  section4: {
    title: 'الفواتير',
    createInvoice: 'إنشاء فاتورة',
    invoiceNumber: 'رقم الفاتورة',
    type: 'النوع',
    amount: 'المبلغ',
    status: 'الحالة',
    dueDate: 'تاريخ الاستحقاق',
    created: 'تاريخ الإنشاء',
    notes: 'ملاحظات',
  },
  section5: {
    title: 'سجل المدفوعات',
    recordPayment: 'تسجيل دفعة',
    noPayments: 'لا توجد مدفوعات مسجلة بعد',
  },
  section6: {
    title: 'باقة واتساب',
    packApprovedAt: 'تاريخ القبول',
    packRequestedAt: 'تاريخ الطلب',
    packDisabledAt: 'تاريخ التعطيل',
    activeParents: 'الأولياء النشطون',
    packEnabled: 'الباقة مفعّلة',
    packRequestStatus: 'حالة الطلب',
    packPrice: 'السعر لكل ولي أمر',
    packCustomMin: 'الحد الأدنى المخصص للفاتورة',
    packPendingBalance: 'الرصيد المعلق',
    packBalanceNote: 'الرصيد يُضاف للفاتورة القادمة',
    packMonths: 'أشهر بدون فاتورة',
  },
  section7: {
    title: 'الإعلانات',
    balance: 'رصيد الإعلانات',
    balanceNote: 'يستخدم لإعلانات السنتر',
    balanceUpdated: 'آخر تحديث للرصيد',
    pricePerBlast: 'سعر الإرسال',
    cap: 'الحد الأقصى الشهري',
  },
  section8: {
    title: 'الإعدادات',
    individualAlerts: 'تنبيهات الحضور الفردية',
    dailySummary: 'الملخص اليومي',
    summerMode: 'وضع الصيف',
    whatsappOptedIn: 'اشتراك واتساب',
    summerModeWarning: 'وضع الصيف يوقف تذكيرات الفوترة',
    scheduleStart: 'ساعة بداية الجدول',
    scheduleEnd: 'ساعة نهاية الجدول',
    instapayNumber: 'رقم الإنستاباي',
    instapayNote: 'يستخدم لسحب الرصيد',
  },
  section9: {
    title: 'طلبات الخطة',
    overridePlan: 'تجاوز الخطة',
    overrideWarning: 'التجاوز اليدوي للخطة يتخطى الدفع',
    currentPlan: 'الخطة الحالية',
    requestedPlan: 'الخطة المطلوبة',
    approve: 'قبول',
    reject: 'رفض',
  },
  section10: {
    title: 'الإحالات',
    referralCode: 'كود الإحالة',
    copy: 'نسخ',
    referredBy: 'محال من',
    centersReferred: 'السناتر المُحالة',
    commissions: 'العمولات',
    noCommissions: 'لا توجد عمولات بعد',
    rewardStatus: 'حالة المكافأة',
    rewardAmount: 'مبلغ المكافأة',
    payoutRequests: 'طلبات الصرف',
    noPayouts: 'لا توجد طلبات صرف',
  },
  section11: {
    title: 'منطقة الخطر',
    blacklistBtn: 'حظر السنتر',
    blacklistWarning: 'الحظر يمنع هذا السنتر نهائياً من المنصة',
  },
  section12: {
    title: 'معلومات النظام',
    id: 'معرّف السنتر',
    createdAt: 'تاريخ الإنشاء',
    approvedAt: 'تاريخ القبول',
    approvedBy: 'قبله',
    healthScore: 'درجة الصحة',
    healthBand: 'نطاق الصحة',
    onboardingStep: 'خطوة الإعداد',
    onboardingCompleted: 'اكتمل الإعداد',
    onboardingStarted: 'بدأ الإعداد',
    lastPayment: 'آخر دفعة',
    studentSequence: 'تسلسل الطلاب',
    packActivatedAt: 'تفعيل الباقة',
    packDisabledAt: 'تعطيل الباقة',
    renewalReminder: 'إرسال تذكير التجديد',
    overdueReminder: 'إرسال تذكير التأخر',
  },
}

// Apply all merges
deepMerge(en.students, EN_STUDENTS)
deepMerge(ar.students, AR_STUDENTS)
deepMerge(en.analytics, EN_ANALYTICS)
deepMerge(ar.analytics, AR_ANALYTICS)
deepMerge(en.admin, EN_ADMIN_EXTRA)
deepMerge(ar.admin, AR_ADMIN_EXTRA)
deepMerge(en.admin.centerManagement, EN_CM)
deepMerge(ar.admin.centerManagement, AR_CM)

// settings/page.tsx uses useTranslations('billing') for these keys
if (!en.billing || typeof en.billing !== 'object') en.billing = {}
if (!ar.billing || typeof ar.billing !== 'object') ar.billing = {}
const BILLING_AUDIT_KEYS = {
  whatsappSupport: { en: 'WhatsApp Support', ar: 'دعم واتساب' },
  contactSupportViaWhatsapp: {
    en: 'Contact support via WhatsApp',
    ar: 'تواصل مع الدعم عبر واتساب',
  },
  securityAndSignOut: {
    en: 'Security & Sign Out',
    ar: 'الأمان وتسجيل الخروج',
  },
}
for (const [k, v] of Object.entries(BILLING_AUDIT_KEYS)) {
  if (!(k in en.billing)) en.billing[k] = v.en
  if (!(k in ar.billing)) ar.billing[k] = v.ar
}

writeFileSync(enPath, JSON.stringify(en, null, 2), 'utf8')
writeFileSync(arPath, JSON.stringify(ar, null, 2), 'utf8')
console.log('All audit keys applied (billing namespace for WhatsApp/security strings).')
