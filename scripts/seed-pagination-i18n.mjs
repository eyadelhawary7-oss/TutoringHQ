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
  searchCenters: 'Search by name, phone, code...',
  pageOf: 'Page {page} of {total}',
  prevPage: 'Previous',
  nextPage: 'Next',
  exportCenters: 'Export Centers',
  exportInvoices: 'Export Invoices',
  exportCommissions: 'Export Commissions',
  export: {
    unauthorized: 'Unauthorized',
    configError: 'Server configuration error',
  },
});

forceSet(ar.admin, {
  searchCenters: 'بحث بالاسم أو الهاتف أو الكود...',
  pageOf: 'صفحة {page} من {total}',
  prevPage: 'السابق',
  nextPage: 'التالي',
  exportCenters: 'تصدير السناتر',
  exportInvoices: 'تصدير الفواتير',
  exportCommissions: 'تصدير العمولات',
  export: {
    unauthorized: 'غير مصرح',
    configError: 'خطأ في إعداد الخادم',
  },
});

writeFileSync(join(root, 'messages/en.json'), JSON.stringify(en, null, 2), 'utf8');
writeFileSync(join(root, 'messages/ar.json'), JSON.stringify(ar, null, 2), 'utf8');
console.log('Pagination i18n keys seeded ✓');
