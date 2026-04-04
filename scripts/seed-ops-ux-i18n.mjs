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
  centerNotes: {
    title: 'Internal Notes',
    placeholder: 'Add a note about this center...',
    add: 'Add Note',
    adding: 'Adding...',
    pin: 'Pin',
    unpin: 'Unpin',
    delete: 'Delete',
    no_notes: 'No notes yet',
    pinned_badge: 'Pinned',
    loadError: 'Could not load notes',
    deletedToast: 'Note deleted',
    errors: {
      bodyRequired: 'Note text is required',
      noteIdRequired: 'Note id is required',
      noChanges: 'No changes to apply',
      superAdminOnly: 'Only super admins can delete notes',
      authorNotRegistered: 'Your account must be in the admin team table to add notes',
      csrf: 'Security check failed. Refresh and try again.',
      invalidJson: 'Invalid request body',
    },
  },
  manualWA: {
    title: 'Send WhatsApp',
    placeholder: 'Type your message to this center owner...',
    send: 'Send Message',
    sending: 'Sending...',
    success: 'Message sent to {name} ({phone})',
    no_phone: 'No phone number on file',
    char_count: '{count} characters',
    loadError: 'Could not load audit log',
    errors: {
      minLength: 'Message must be at least 5 characters',
      noPhone: 'Center has no phone number on file',
      notConfigured: 'WhatsApp is not configured for this environment',
      sendFailed: 'WhatsApp send failed',
      csrf: 'Security check failed. Refresh and try again.',
      invalidJson: 'Invalid request body',
    },
  },
  auditLog: {
    title: 'Audit Log',
    col_date: 'Date',
    col_action: 'Action',
    col_user: 'By',
    col_details: 'Details',
    no_logs: 'No audit log entries',
    loadError: 'Could not load audit log',
  },
});

forceSet(ar.admin, {
  centerNotes: {
    title: 'ملاحظات داخلية',
    placeholder: 'أضف ملاحظة حول هذا السنتر...',
    add: 'إضافة ملاحظة',
    adding: 'جاري الإضافة...',
    pin: 'تثبيت',
    unpin: 'إلغاء التثبيت',
    delete: 'حذف',
    no_notes: 'لا توجد ملاحظات بعد',
    pinned_badge: 'مثبت',
    loadError: 'تعذر تحميل الملاحظات',
    deletedToast: 'تم حذف الملاحظة',
    errors: {
      bodyRequired: 'نص الملاحظة مطلوب',
      noteIdRequired: 'معرف الملاحظة مطلوب',
      noChanges: 'لا توجد تغييرات',
      superAdminOnly: 'المشرف الأعلى فقط يمكنه حذف الملاحظات',
      authorNotRegistered: 'يجب أن يكون حسابك في جدول فريق الإدارة لإضافة ملاحظات',
      csrf: 'فشل التحقق الأمني. حدّث الصفحة وحاول مرة أخرى.',
      invalidJson: 'محتوى الطلب غير صالح',
    },
  },
  manualWA: {
    title: 'إرسال واتساب',
    placeholder: 'اكتب رسالتك لصاحب السنتر...',
    send: 'إرسال الرسالة',
    sending: 'جاري الإرسال...',
    success: 'تم الإرسال إلى {name} ({phone})',
    no_phone: 'لا يوجد رقم هاتف مسجل',
    char_count: '{count} حرف',
    loadError: 'تعذر تحميل سجل المراجعة',
    errors: {
      minLength: 'الرسالة يجب ألا تقل عن 5 أحرف',
      noPhone: 'لا يوجد رقم هاتف لهذا السنتر',
      notConfigured: 'واتساب غير مهيأ في هذا البيئة',
      sendFailed: 'فشل إرسال واتساب',
      csrf: 'فشل التحقق الأمني. حدّث الصفحة وحاول مرة أخرى.',
      invalidJson: 'محتوى الطلب غير صالح',
    },
  },
  auditLog: {
    title: 'سجل المراجعة',
    col_date: 'التاريخ',
    col_action: 'الإجراء',
    col_user: 'بواسطة',
    col_details: 'التفاصيل',
    no_logs: 'لا توجد سجلات مراجعة',
    loadError: 'تعذر تحميل سجل المراجعة',
  },
});

writeFileSync(join(root, 'messages/en.json'), JSON.stringify(en, null, 2), 'utf8');
writeFileSync(join(root, 'messages/ar.json'), JSON.stringify(ar, null, 2), 'utf8');
console.log('Ops UX i18n keys seeded ✓');
