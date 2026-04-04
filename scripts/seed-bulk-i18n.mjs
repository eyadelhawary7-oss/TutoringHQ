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
  selected: 'centers selected',
  bulkSelectAction: 'Select action...',
  bulkApprove: 'Approve all',
  bulkSuspend: 'Suspend all',
  bulkReactivate: 'Reactivate all',
  bulkSendWA: 'Send WhatsApp',
  bulkWAMessage: 'Type message to send...',
  applyAction: 'Apply',
  applying: 'Applying...',
  clearSelection: 'Clear',
  bulk: {
    completedWithErrors: 'Completed with {count} error(s). Check server logs for details.',
    errors: {
      unknown: 'Something went wrong.',
      config: 'Server configuration error.',
      unauthorized: 'Unauthorized.',
      superAdminOnly: 'Super admin only.',
      csrf: 'Invalid security token. Please refresh and try again.',
      invalidBody: 'Invalid request body.',
      actionAndIdsRequired: 'Action and center IDs are required.',
      maxCenters: 'Maximum 200 centers per bulk action.',
      noPendingInSelection: 'No pending centers found in selection.',
      messageRequired: 'Message is required for WhatsApp.',
      whatsappNotConfigured: 'WhatsApp is not configured.',
      invalidAction: 'Invalid action. Use approve, suspend, reactivate, or send_wa.',
    },
  },
});

forceSet(ar.admin, {
  selected: 'سنتر محدد',
  bulkSelectAction: 'اختر إجراء...',
  bulkApprove: 'اعتماد الكل',
  bulkSuspend: 'تعليق الكل',
  bulkReactivate: 'إعادة تفعيل الكل',
  bulkSendWA: 'إرسال واتساب',
  bulkWAMessage: 'اكتب الرسالة...',
  applyAction: 'تطبيق',
  applying: 'جاري التطبيق...',
  clearSelection: 'إلغاء التحديد',
  bulk: {
    completedWithErrors: 'اكتمل مع {count} خطأ. راجع سجلات الخادم.',
    errors: {
      unknown: 'حدث خطأ ما.',
      config: 'خطأ في إعداد الخادم.',
      unauthorized: 'غير مصرح.',
      superAdminOnly: 'للمشرف الأعلى فقط.',
      csrf: 'رمز أمان غير صالح. حدّث الصفحة وحاول مرة أخرى.',
      invalidBody: 'محتوى الطلب غير صالح.',
      actionAndIdsRequired: 'الإجراء ومعرفات السناتر مطلوبة.',
      maxCenters: 'حد أقصى 200 سنتر لكل إجراء جماعي.',
      noPendingInSelection: 'لا توجد سناتر قيد الانتظار في التحديد.',
      messageRequired: 'الرسالة مطلوبة للواتساب.',
      whatsappNotConfigured: 'الواتساب غير مُعد.',
      invalidAction: 'إجراء غير صالح. استخدم اعتماد أو تعليق أو إعادة تفعيل أو واتساب.',
    },
  },
});

writeFileSync(join(root, 'messages/en.json'), JSON.stringify(en, null, 2), 'utf8');
writeFileSync(join(root, 'messages/ar.json'), JSON.stringify(ar, null, 2), 'utf8');
console.log('Bulk actions i18n keys seeded ✓');
