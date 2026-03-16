export default function ScannerSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="aspect-[4/3] max-h-[60vh] w-full rounded-xl bg-slate-900 skeleton-pulse overflow-hidden flex items-center justify-center">
        <div className="w-16 h-16 rounded-full border-4 border-teal-500/50 border-t-teal-400 skeleton-pulse" />
      </div>
      <div className="flex justify-center">
        <div className="h-12 w-48 rounded-xl bg-teal-100 skeleton-pulse" />
      </div>
    </div>
  );
}
