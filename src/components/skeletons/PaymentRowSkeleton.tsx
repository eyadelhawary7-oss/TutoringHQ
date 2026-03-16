export default function PaymentRowSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
            <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Student</th>
            <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
            <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Method</th>
            <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
            <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Recorded By</th>
            <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i}>
              <td className="py-3.5 px-4 text-end">
                <div className="h-4 w-20 bg-slate-200 rounded skeleton-pulse ml-auto" />
              </td>
              <td className="py-3.5 px-4 text-end">
                <div className="space-y-1 flex flex-col items-end">
                  <div className="h-4 w-28 bg-slate-200 rounded skeleton-pulse" />
                  <div className="h-3 w-16 bg-slate-100 rounded skeleton-pulse" />
                </div>
              </td>
              <td className="py-3.5 px-4 text-end">
                <div className="h-4 w-16 bg-slate-200 rounded skeleton-pulse ml-auto" />
              </td>
              <td className="py-3.5 px-4 text-end">
                <div className="h-5 w-14 bg-slate-100 rounded skeleton-pulse ml-auto" />
              </td>
              <td className="py-3.5 px-4 text-end">
                <div className="h-5 w-16 bg-slate-100 rounded skeleton-pulse ml-auto" />
              </td>
              <td className="py-3.5 px-4 text-end">
                <div className="h-4 w-20 bg-slate-100 rounded skeleton-pulse ml-auto" />
              </td>
              <td className="py-3.5 px-4 text-end">
                <div className="h-6 w-6 bg-slate-100 rounded skeleton-pulse ml-auto" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
