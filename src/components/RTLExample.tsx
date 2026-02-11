import { useTranslations } from 'next-intl';

export default function RTLExample() {
  const t = useTranslations('nav');

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
          RTL-Aware Layout Example
        </h2>
        
        {/* Example: Margin inline start (ms) instead of margin left (ml) */}
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 bg-blue-500 rounded-lg"></div>
          <div className="ms-4">
            <p className="font-semibold text-gray-900 dark:text-white">
              This text has margin-inline-start (ms-4)
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              It will be on the right side in RTL and left side in LTR
            </p>
          </div>
        </div>

        {/* Example: Padding inline start/end */}
        <div className="bg-gray-100 dark:bg-gray-700 rounded-md ps-6 pe-3 py-4 mb-4">
          <p className="text-gray-900 dark:text-white">
            This box has ps-6 (padding-inline-start) and pe-3 (padding-inline-end)
          </p>
        </div>

        {/* Example: Text alignment */}
        <div className="space-y-2 mb-4">
          <p className="text-start text-gray-900 dark:text-white">
            Text aligned to start (text-start)
          </p>
          <p className="text-end text-gray-900 dark:text-white">
            Text aligned to end (text-end)
          </p>
        </div>

        {/* Example: Absolute positioning */}
        <div className="relative h-24 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg mb-4">
          <div className="absolute start-4 top-4 bg-white dark:bg-gray-800 px-4 py-2 rounded shadow">
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              Positioned at start-4
            </span>
          </div>
          <div className="absolute end-4 bottom-4 bg-white dark:bg-gray-800 px-4 py-2 rounded shadow">
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              Positioned at end-4
            </span>
          </div>
        </div>

        {/* Navigation items using translations */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">
            Navigation Items:
          </h3>
          <div className="flex flex-wrap gap-2">
            {['dashboard', 'students', 'scanner', 'payments', 'schedule', 'messages', 'settings'].map((key) => (
              <span
                key={key}
                className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-3 py-1 rounded-full text-sm font-medium"
              >
                {t(key as any)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
          💡 Tip: Always use logical properties
        </h3>
        <ul className="space-y-1 text-sm text-yellow-700 dark:text-yellow-300">
          <li>• Use <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">ms-*</code> instead of <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">ml-*</code></li>
          <li>• Use <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">me-*</code> instead of <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">mr-*</code></li>
          <li>• Use <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">ps-*</code> instead of <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">pl-*</code></li>
          <li>• Use <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">pe-*</code> instead of <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">pr-*</code></li>
          <li>• Use <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">start-*</code> instead of <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">left-*</code></li>
          <li>• Use <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">end-*</code> instead of <code className="bg-yellow-100 dark:bg-yellow-900 px-1 rounded">right-*</code></li>
        </ul>
      </div>
    </div>
  );
}
