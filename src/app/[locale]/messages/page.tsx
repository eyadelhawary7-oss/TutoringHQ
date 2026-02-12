'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/Navbar';

interface WhatsAppMessage {
  id: string;
  to_phone: string;
  message_type: string;
  template_name: string | null;
  body: string;
  status: string;
  created_at: string;
  student_id: string | null;
}

interface IncomingMessage {
  id: string;
  from_phone: string;
  from_name: string | null;
  message_type: string;
  body: string;
  timestamp: string;
}

export default function MessagesPage() {
  const t = useTranslations('nav');
  const tMsg = useTranslations('messages');
  
  const [outbound, setOutbound] = useState<WhatsAppMessage[]>([]);
  const [incoming, setIncoming] = useState<IncomingMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'outbound' | 'incoming'>('outbound');
  const [centerId, setCenterId] = useState<string | null>(null);
  const [monthlyUsage, setMonthlyUsage] = useState<number>(0);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();

      if (!meData?.user?.center_id) return;
      setCenterId(meData.user.center_id);

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [outboundRes, incomingRes, usageRes] = await Promise.all([
        dbSelect({
          table: 'whatsapp_messages',
          select: 'id, to_phone, message_type, template_name, body, status, created_at, student_id',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
          order: { column: 'created_at', ascending: false },
          limit: 100,
        }),
        dbSelect({
          table: 'whatsapp_incoming',
          select: 'id, from_phone, from_name, message_type, body, timestamp',
          order: { column: 'timestamp', ascending: false },
          limit: 100,
        }),
        dbSelect({
          table: 'whatsapp_messages',
          select: 'id',
          filters: [
            { column: 'center_id', op: 'eq', value: meData.user.center_id },
            { column: 'created_at', op: 'gte', value: monthStart.toISOString() },
          ],
        }),
      ]);

      if (outboundRes.data) setOutbound(outboundRes.data as WhatsAppMessage[]);
      if (usageRes.data) setMonthlyUsage((usageRes.data as unknown[]).length);
      if (incomingRes.data) setIncoming(incomingRes.data as IncomingMessage[]);
      setIsLoading(false);
    };
    load();
  }, []);

  const MESSAGE_QUOTA = 1000;
  const isOverQuota = monthlyUsage >= MESSAGE_QUOTA;

  const statusColors: Record<string, string> = {
    sent: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    delivered: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    read: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.217l-.271-.162-2.87.853.853-2.87-.162-.271A8 8 0 1112 20z"/>
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">WhatsApp Messages</h1>
            </div>
            <div className="flex items-center gap-4">
              <div className={`rounded-lg border px-4 py-2 ${isOverQuota ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-600' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
                <span className="text-xs text-gray-500 dark:text-gray-400">Messages this month</span>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {monthlyUsage} {isOverQuota && `/ ${MESSAGE_QUOTA} (over quota)`}
                </p>
              </div>
              <Link
                href="/messages/compose"
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg"
              >
                {tMsg('compose')}
              </Link>
            </div>
          </div>

          {isOverQuota && (
            <div className="mb-6 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 p-4">
              <p className="text-amber-800 dark:text-amber-200 text-sm font-medium">
                You have exceeded your monthly message quota ({MESSAGE_QUOTA}). Contact support to upgrade your plan or resolve overage billing.
              </p>
            </div>
          )}

          {/* Tabs */}
          <div className="flex bg-white dark:bg-gray-800 rounded-lg shadow p-1 mb-6 w-fit">
            <button
              onClick={() => setActiveTab('outbound')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'outbound'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Sent ({outbound.length})
            </button>
            <button
              onClick={() => setActiveTab('incoming')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'incoming'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Received ({incoming.length})
            </button>
          </div>

          {isLoading ? (
            <div className="text-center py-16">
              <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <>
              {/* Outbound Messages */}
              {activeTab === 'outbound' && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
                  {outbound.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">
                      <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                        <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.217l-.271-.162-2.87.853.853-2.87-.162-.271A8 8 0 1112 20z"/>
                      </svg>
                      <p className="text-lg font-medium mb-1">No messages sent yet</p>
                      <p className="text-sm">Go to Payments and click &quot;Send Reminders&quot; to send WhatsApp payment reminders</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">To</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Type</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Message</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Status</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {outbound.map((msg) => (
                            <tr key={msg.id} className="border-b border-gray-100 dark:border-gray-700/50">
                              <td className="px-4 py-3 font-mono text-gray-900 dark:text-white">{msg.to_phone}</td>
                              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{msg.template_name || msg.message_type}</td>
                              <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-xs truncate">{msg.body}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[msg.status] || 'bg-gray-100 text-gray-800'}`}>
                                  {msg.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                                {new Date(msg.created_at).toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Incoming Messages */}
              {activeTab === 'incoming' && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
                  {incoming.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">
                      <p className="text-lg font-medium mb-1">No incoming messages</p>
                      <p className="text-sm">Incoming WhatsApp messages will appear here once the webhook is configured</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                      {incoming.map((msg) => (
                        <div key={msg.id} className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-green-700 dark:text-green-300">
                                {(msg.from_name || msg.from_phone).slice(0, 2).toUpperCase()}
                              </span>
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {msg.from_name || msg.from_phone}
                                </span>
                                <span className="text-xs text-gray-400">
                                  {new Date(msg.timestamp).toLocaleString()}
                                </span>
                              </div>
                              <p className="text-gray-600 dark:text-gray-400 mt-1">{msg.body}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
