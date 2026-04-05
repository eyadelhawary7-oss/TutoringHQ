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

forceSet(en, {
  charts: {
    noData: 'No data yet',
    noDataSub: 'Data will appear here once centers start using CenterHQ',
    vsLastMonth: 'vs last month',
    vsLastWeek: 'vs last week',
    mrrOverTime: 'Revenue Over Time',
    centersOverTime: 'Centers Over Time',
    centersByPlan: 'Centers by Plan',
    centersByStatus: 'Centers by Status',
    paymentStatus: 'Payment Status',
    attendanceOverTime: 'Attendance Over Time',
    revenueByPlan: 'Revenue by Plan',
    newCenters: 'New Centers',
    churnRate: 'Churn Rate',
    activeParents: 'Active Parents',
    packRevenue: 'Pack Revenue',
    totalRevenue: 'Total Revenue',
    activeCenters: 'Active Centers',
    totalStudents: 'Total Students',
    collectionRate: 'Collection Rate',
    trend: 'Trend',
    revenueByBranch: 'Revenue by Branch',
    studentsByBranch: 'Students by Branch',
    paymentMethods: 'Payment Methods',
    weeklyAttendance: 'Weekly Attendance',
    monthlyRevenue: 'Monthly Revenue',
  },
});

forceSet(ar, {
  charts: {
    noData: 'لا توجد بيانات بعد',
    noDataSub: 'ستظهر البيانات هنا عندما تبدأ السناتر باستخدام CenterHQ',
    vsLastMonth: 'مقارنة بالشهر الماضي',
    vsLastWeek: 'مقارنة بالأسبوع الماضي',
    mrrOverTime: 'الإيرادات عبر الزمن',
    centersOverTime: 'السناتر عبر الزمن',
    centersByPlan: 'السناتر حسب الباقة',
    centersByStatus: 'السناتر حسب الحالة',
    paymentStatus: 'حالة المدفوعات',
    attendanceOverTime: 'الحضور عبر الزمن',
    revenueByPlan: 'الإيرادات حسب الباقة',
    newCenters: 'سناتر جديدة',
    churnRate: 'معدل التسرب',
    activeParents: 'أولياء أمور نشطون',
    packRevenue: 'إيرادات الباقة',
    totalRevenue: 'إجمالي الإيرادات',
    activeCenters: 'سناتر نشطة',
    totalStudents: 'إجمالي الطلاب',
    collectionRate: 'معدل التحصيل',
    trend: 'الاتجاه',
    revenueByBranch: 'الإيرادات حسب الفرع',
    studentsByBranch: 'الطلاب حسب الفرع',
    paymentMethods: 'طرق الدفع',
    weeklyAttendance: 'الحضور الأسبوعي',
    monthlyRevenue: 'الإيرادات الشهرية',
  },
});

writeFileSync(join(root, 'messages/en.json'), JSON.stringify(en, null, 2), 'utf8');
writeFileSync(join(root, 'messages/ar.json'), JSON.stringify(ar, null, 2), 'utf8');
console.log('Chart i18n seeded ✓');
