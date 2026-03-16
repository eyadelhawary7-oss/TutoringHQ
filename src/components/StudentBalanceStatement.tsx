'use client';

export interface StudentBalanceStatementProps {
  student: {
    name: string;
    student_number: string;
    phone: string;
    groups: string[];
    balance_due: number;
  };
  payments: {
    paid_at: string;
    amount: number;
    method: string;
    status: 'confirmed' | 'pending';
    recorded_by_name: string | null;
  }[];
  centerName: string;
  centerLogo: string | null;
  dateFrom: string;
  dateTo: string;
}

export function StudentBalanceStatement(props: StudentBalanceStatementProps) {
  const {
    student,
    payments,
    centerName,
    centerLogo,
    dateFrom,
    dateTo,
  } = props;

  const confirmedTotal = payments
    .filter((p) => p.status === 'confirmed')
    .reduce((sum, p) => sum + p.amount, 0);
  const pendingTotal = payments
    .filter((p) => p.status === 'pending')
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <div dir="rtl" className="text-sm text-slate-900 bg-white p-6">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div className="font-bold text-lg">{centerName}</div>
        {centerLogo && (
          <img src={centerLogo} alt="logo" className="max-h-12 object-contain" />
        )}
      </div>
      <h2 className="text-center font-bold text-xl mb-4">كشف حساب الطالب</h2>
      <hr className="border-black mb-4" />

      {/* Student Info */}
      <div className="grid grid-cols-2 gap-2 mb-4 text-right">
        <span className="text-slate-500">الاسم</span>
        <span>{student.name}</span>
        <span className="text-slate-500">رقم الطالب</span>
        <span className="font-mono">{student.student_number}</span>
        <span className="text-slate-500">التليفون</span>
        <span>{student.phone}</span>
        <span className="text-slate-500">المجموعات</span>
        <span>
          {student.groups.length > 0 ? student.groups.join(' • ') : 'غير محدد'}
        </span>
        <span className="text-slate-500">الفترة</span>
        <span>
          {dateFrom} إلى {dateTo}
        </span>
      </div>
      <hr className="border-black mb-4" />

      {/* Payments Table */}
      <table className="w-full text-sm mb-4">
        <thead>
          <tr className="border-b border-black">
            <th className="text-right py-1">التاريخ</th>
            <th className="text-right py-1">المبلغ (جنيه)</th>
            <th className="text-right py-1">الطريقة</th>
            <th className="text-right py-1">الحالة</th>
            <th className="text-right py-1">سجّله</th>
          </tr>
        </thead>
        <tbody>
          {payments.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center py-4 text-gray-400">
                لا توجد مدفوعات في هذه الفترة
              </td>
            </tr>
          ) : (
            payments.map((p, i) => (
              <tr
                key={i}
                className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
              >
                <td className="py-1">
                  {new Date(p.paid_at).toLocaleDateString('ar-EG', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </td>
                <td className="py-1 font-bold font-mono text-right">
                  {p.amount.toLocaleString('ar-EG')}
                </td>
                <td className="py-1">{p.method}</td>
                <td className="py-1">
                  {p.status === 'confirmed' ? 'مؤكد ✓' : 'معلق'}
                </td>
                <td className="py-1">{p.recorded_by_name ?? '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Summary */}
      <div className="border-t-2 border-black pt-3 text-right font-bold space-y-1">
        <div>إجمالي المدفوع: {confirmedTotal.toLocaleString('ar-EG')} جنيه</div>
        <div>إجمالي المعلق: {pendingTotal.toLocaleString('ar-EG')} جنيه</div>
        <div>الرصيد الحالي: {student.balance_due.toLocaleString('ar-EG')} جنيه</div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-xs text-gray-400">
        <div>CenterHQ — centerhq.com</div>
        <div>
          تاريخ الإصدار:{' '}
          {new Date().toLocaleDateString('ar-EG', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </div>
      </div>
    </div>
  );
}
