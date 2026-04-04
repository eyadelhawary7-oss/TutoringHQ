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
if (!en.whatsappPack) en.whatsappPack = {}
if (!ar.whatsappPack) ar.whatsappPack = {}

/** admin.platformConfig is the nav label (string); nested copy lives in the same key only as object after migration. */
function ensurePlatformConfigObject(admin) {
  const pc = admin.platformConfig
  if (typeof pc === 'string') {
    if (!('platformConfigNav' in admin)) admin.platformConfigNav = pc
    admin.platformConfig = {}
  } else if (!pc || typeof pc !== 'object' || Array.isArray(pc)) {
    admin.platformConfig = {}
  }
}
ensurePlatformConfigObject(en.admin)
ensurePlatformConfigObject(ar.admin)

// ─── PART 1: admin.platformConfig (22 keys) ──────────
const EN_PC = {
  groupApproval: 'Approval Automation',
  auto_approve_signups_label: 'Auto-Approve New Signups',
  auto_approve_signups_desc:
    'Centers are approved automatically after payment confirms',
  pause_new_signups_label: 'Pause New Signups',
  pause_new_signups_desc:
    'Approved payments enter paid_pending_activation state',
  auto_approve_pack_label: 'Auto-Approve WA Pack Requests',
  auto_approve_pack_desc:
    'Pack requests auto-approve when all five conditions pass',
  groupWaBilling: 'WhatsApp & Billing',
  wa_sending_enabled_label: 'WhatsApp Sending Enabled',
  wa_sending_enabled_desc:
    'Disable to pause all outgoing WhatsApp messages',
  payment_failed_enabled_label: 'Payment Failed WA Alerts',
  payment_failed_enabled_desc:
    'Send WA when a payment fails (enable after chq_payment_failed approved)',
  pack_invoice_enabled_label: 'Pack Invoice WA Alerts',
  pack_invoice_enabled_desc:
    'Send WA for pack invoices (enable after chq_pack_invoice approved)',
  groupOps: 'Platform Operations',
  cron_paused_label: 'Pause All Crons',
  cron_paused_desc: 'Emergency pause for all scheduled jobs',
  maintenance_mode_label: 'Maintenance Mode',
  maintenance_mode_desc: 'Shows maintenance page to all users',
  read_only_mode_label: 'Read-Only Mode',
  read_only_mode_desc: 'Disables all write operations',
  bosta_auto_reship_on_lost_label: 'Auto-Reship Lost Card Orders',
  bosta_auto_reship_on_lost_desc:
    'Enable only after confirming Bosta covers lost packages',
}
const AR_PC = {
  groupApproval: 'أتمتة القبول',
  auto_approve_signups_label: 'القبول التلقائي للتسجيلات',
  auto_approve_signups_desc: 'يُقبل السنتر تلقائياً بعد تأكيد الدفع',
  pause_new_signups_label: 'إيقاف التسجيلات الجديدة',
  pause_new_signups_desc:
    'المدفوعات المقبولة تدخل حالة paid_pending_activation',
  auto_approve_pack_label: 'القبول التلقائي لطلبات الباقة',
  auto_approve_pack_desc:
    'تُقبل طلبات الباقة تلقائياً عند استيفاء الشروط الخمسة',
  groupWaBilling: 'واتساب والفوترة',
  wa_sending_enabled_label: 'تفعيل إرسال واتساب',
  wa_sending_enabled_desc: 'أوقف لإيقاف جميع رسائل واتساب الصادرة',
  payment_failed_enabled_label: 'تنبيهات فشل الدفع',
  payment_failed_enabled_desc:
    'أرسل واتساب عند فشل دفعة (فعّل بعد قبول chq_payment_failed)',
  pack_invoice_enabled_label: 'تنبيهات فواتير الباقة',
  pack_invoice_enabled_desc:
    'أرسل واتساب لفواتير الباقة (فعّل بعد قبول chq_pack_invoice)',
  groupOps: 'عمليات المنصة',
  cron_paused_label: 'إيقاف جميع المهام المجدولة',
  cron_paused_desc: 'إيقاف طارئ لجميع المهام المجدولة',
  maintenance_mode_label: 'وضع الصيانة',
  maintenance_mode_desc: 'يعرض صفحة الصيانة لجميع المستخدمين',
  read_only_mode_label: 'وضع القراءة فقط',
  read_only_mode_desc: 'يعطّل جميع عمليات الكتابة',
  bosta_auto_reship_on_lost_label: 'إعادة شحن الطلبات الضائعة',
  bosta_auto_reship_on_lost_desc:
    'فعّل فقط بعد تأكيد تغطية بوسطة للطرود الضائعة',
}

// ─── PART 2: admin keys (13 keys across pages) ───────
const EN_ADMIN = {
  centersTab: 'Centers',
  packRequestsTab: 'Pack Requests',
  announcementBalance: 'Announcement Balance',
  packRequestStatus: 'Request Status',
  pendingBalance: 'Pending Balance',
  statusApproved: 'Approved',
  noPendingRequests: 'No pending pack requests',
  allReferrals: 'All Referrals',
  referrer: 'Referrer',
  code: 'Code',
  createdDate: 'Created',
  pendingPayouts: 'Pending Payouts',
  centerName: 'Center Name',
  amountAvailable: 'Available Amount',
  noPendingPayouts: 'No pending payouts',
  referredBy: 'Referred By',
  center: 'Center',
  rejected: 'Rejected',
  approved: 'Approved',
  addLead: 'Add Lead',
  addAdmin: 'Add Admin',
  joinedDate: 'Joined',
}
const AR_ADMIN = {
  centersTab: 'السناتر',
  packRequestsTab: 'طلبات الباقة',
  announcementBalance: 'رصيد الإعلانات',
  packRequestStatus: 'حالة الطلب',
  pendingBalance: 'الرصيد المعلق',
  statusApproved: 'مقبول',
  noPendingRequests: 'لا توجد طلبات باقة معلقة',
  allReferrals: 'كل الإحالات',
  referrer: 'المحيل',
  code: 'الكود',
  createdDate: 'تاريخ الإنشاء',
  pendingPayouts: 'المدفوعات المعلقة',
  centerName: 'اسم السنتر',
  amountAvailable: 'المبلغ المتاح',
  noPendingPayouts: 'لا توجد مدفوعات معلقة',
  referredBy: 'محال من',
  center: 'السنتر',
  rejected: 'مرفوض',
  approved: 'مقبول',
  addLead: 'إضافة عميل',
  addAdmin: 'إضافة مشرف',
  joinedDate: 'تاريخ الانضمام',
}

// ─── PART 3: whatsappPack notification toggles (4 keys)
const EN_WP = {
  notifScan: 'Scan Notifications',
  notifAbsence: 'Absence Notifications',
  notifBalance: 'Balance Notifications',
  notifAnnouncement: 'Announcement Notifications',
}
const AR_WP = {
  notifScan: 'تنبيهات المسح',
  notifAbsence: 'تنبيهات الغياب',
  notifBalance: 'تنبيهات الرصيد',
  notifAnnouncement: 'تنبيهات الإعلانات',
}

// Flat keys under admin (platform-config/page.tsx uses useTranslations('admin'))
deepMerge(en.admin, {
  platformConfigGroupApproval: EN_PC.groupApproval,
  platformConfig_auto_approve_signups_label: EN_PC.auto_approve_signups_label,
  platformConfig_auto_approve_signups_desc: EN_PC.auto_approve_signups_desc,
  platformConfig_pause_new_signups_label: EN_PC.pause_new_signups_label,
  platformConfig_pause_new_signups_desc: EN_PC.pause_new_signups_desc,
  platformConfig_auto_approve_pack_label: EN_PC.auto_approve_pack_label,
  platformConfig_auto_approve_pack_desc: EN_PC.auto_approve_pack_desc,
  platformConfigGroupWaBilling: EN_PC.groupWaBilling,
  platformConfig_wa_sending_enabled_label: EN_PC.wa_sending_enabled_label,
  platformConfig_wa_sending_enabled_desc: EN_PC.wa_sending_enabled_desc,
  platformConfig_payment_failed_enabled_label:
    EN_PC.payment_failed_enabled_label,
  platformConfig_payment_failed_enabled_desc:
    EN_PC.payment_failed_enabled_desc,
  platformConfig_pack_invoice_enabled_label:
    EN_PC.pack_invoice_enabled_label,
  platformConfig_pack_invoice_enabled_desc: EN_PC.pack_invoice_enabled_desc,
  platformConfigGroupOps: EN_PC.groupOps,
  platformConfig_cron_paused_label: EN_PC.cron_paused_label,
  platformConfig_cron_paused_desc: EN_PC.cron_paused_desc,
  platformConfig_maintenance_mode_label: EN_PC.maintenance_mode_label,
  platformConfig_maintenance_mode_desc: EN_PC.maintenance_mode_desc,
  platformConfig_read_only_mode_label: EN_PC.read_only_mode_label,
  platformConfig_read_only_mode_desc: EN_PC.read_only_mode_desc,
  platformConfig_bosta_auto_reship_on_lost_label:
    EN_PC.bosta_auto_reship_on_lost_label,
  platformConfig_bosta_auto_reship_on_lost_desc:
    EN_PC.bosta_auto_reship_on_lost_desc,
})
deepMerge(ar.admin, {
  platformConfigGroupApproval: AR_PC.groupApproval,
  platformConfig_auto_approve_signups_label: AR_PC.auto_approve_signups_label,
  platformConfig_auto_approve_signups_desc: AR_PC.auto_approve_signups_desc,
  platformConfig_pause_new_signups_label: AR_PC.pause_new_signups_label,
  platformConfig_pause_new_signups_desc: AR_PC.pause_new_signups_desc,
  platformConfig_auto_approve_pack_label: AR_PC.auto_approve_pack_label,
  platformConfig_auto_approve_pack_desc: AR_PC.auto_approve_pack_desc,
  platformConfigGroupWaBilling: AR_PC.groupWaBilling,
  platformConfig_wa_sending_enabled_label: AR_PC.wa_sending_enabled_label,
  platformConfig_wa_sending_enabled_desc: AR_PC.wa_sending_enabled_desc,
  platformConfig_payment_failed_enabled_label:
    AR_PC.payment_failed_enabled_label,
  platformConfig_payment_failed_enabled_desc:
    AR_PC.payment_failed_enabled_desc,
  platformConfig_pack_invoice_enabled_label:
    AR_PC.pack_invoice_enabled_label,
  platformConfig_pack_invoice_enabled_desc: AR_PC.pack_invoice_enabled_desc,
  platformConfigGroupOps: AR_PC.groupOps,
  platformConfig_cron_paused_label: AR_PC.cron_paused_label,
  platformConfig_cron_paused_desc: AR_PC.cron_paused_desc,
  platformConfig_maintenance_mode_label: AR_PC.maintenance_mode_label,
  platformConfig_maintenance_mode_desc: AR_PC.maintenance_mode_desc,
  platformConfig_read_only_mode_label: AR_PC.read_only_mode_label,
  platformConfig_read_only_mode_desc: AR_PC.read_only_mode_desc,
  platformConfig_bosta_auto_reship_on_lost_label:
    AR_PC.bosta_auto_reship_on_lost_label,
  platformConfig_bosta_auto_reship_on_lost_desc:
    AR_PC.bosta_auto_reship_on_lost_desc,
})

deepMerge(en.admin.platformConfig, EN_PC)
deepMerge(ar.admin.platformConfig, AR_PC)

deepMerge(en.admin, EN_ADMIN)
deepMerge(ar.admin, AR_ADMIN)
deepMerge(en.whatsappPack, EN_WP)
deepMerge(ar.whatsappPack, AR_WP)

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
console.log('46 audit-2 keys applied.')
