import Navbar from "@/components/Navbar";
import RTLExample from "@/components/RTLExample";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

export default function Home() {
  const t = useTranslations('nav');
  
  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-black py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 pt-8">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
              CenterHQ
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400 mb-2">
              {t('dashboard')}
            </p>
            <p className="text-gray-500 dark:text-gray-500">
              Internationalized Next.js Application with Arabic (RTL) and English Support
            </p>
          </div>
          
          <RTLExample />
          
          <div className="mt-8 text-center space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Switch languages using the dropdown in the navbar above
            </p>
            <Link
              href="/demo"
              className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold rounded-lg shadow-lg transition-all transform hover:scale-105"
            >
              View Full Demo
              <svg className="w-5 h-5 ms-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
