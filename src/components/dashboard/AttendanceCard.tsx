'use client';

interface AttendanceCardProps {
  count: number;
  label: string;
}

export default function AttendanceCard({ count, label }: AttendanceCardProps) {
  return (
    <div className="bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl shadow-lg p-6 text-white">
      <p className="text-sm text-white/80">{label}</p>
      <p className="text-5xl font-bold mt-2">{count}</p>
    </div>
  );
}
