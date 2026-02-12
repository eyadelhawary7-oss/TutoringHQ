'use client';

export default function SentryTestPage() {
  function throwError() {
    throw new Error('🧪 Test error from CenterHQ');
  }

  return (
    <div dir="ltr" className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 max-w-sm w-full">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Sentry Test
        </h1>
        <button
          onClick={throwError}
          className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors"
        >
          Throw Test Error
        </button>
      </div>
    </div>
  );
}
