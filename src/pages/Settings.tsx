import React, { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useLanguage } from '@/contexts/LanguageContext';
import { mockCenter, mockTeam } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { Upload, Copy, Check, ExternalLink, MessageSquare, LogOut, Lock, Camera, Bluetooth, Trash2, Plus } from 'lucide-react';

const TABS = ['general', 'billing', 'team'] as const;
type Tab = typeof TABS[number];

const PERMISSIONS = ['can_scan','can_view_payments','can_view_dashboard','can_manage_students','can_manage_groups','can_manage_settings'] as const;

const PLANS = [
  { key: 'starter', en: 'سنتر صغير', studentLabel: 'حتى 150 طالب/أسبوع', monthly: '2,000', perStudent: '3.33', perStudentLabel: 'جنيه/طالب/أسبوع', setup: '1,000', badge: null },
  { key: 'pro', en: 'سنتر متوسط', studentLabel: 'حتى 500 طالب/أسبوع', monthly: '4,500', perStudent: '2.25', perStudentLabel: 'جنيه/طالب/أسبوع', setup: '2,000', badge: 'الأكثر اختياراً', badgeColor: 'teal' as const },
  { key: 'business', en: 'سنتر كبير', studentLabel: 'حتى 1,000 طالب/أسبوع', monthly: '6,500', perStudent: '1.63', perStudentLabel: 'جنيه/طالب/أسبوع', setup: '3,000', badge: null },
  { key: 'enterprise', en: 'سنتر ضخم', studentLabel: 'حتى 2,000 طالب/أسبوع', monthly: '9,000', perStudent: '1.13', perStudentLabel: 'جنيه/طالب/أسبوع', setup: '5,000', badge: 'الأفضل قيمة', badgeColor: 'green' as const },
  { key: 'top_centers', en: 'ميجا سنتر', studentLabel: '2,000+ طالب/أسبوع', monthly: 'Custom', perStudent: 'مخصص', perStudentLabel: '', setup: 'Custom', badge: null },
];

const SUBJECTS_INIT = ['math', 'science', 'chemistry', 'physics'];

const INVOICES = [
  { id: 'inv1', number: 'PAYPROOF-2026-02-15-a1b2c3d', date: '2026-02-15', amount: 13500, reference: 'INS-789456', status: 'confirmed' },
  { id: 'inv2', number: 'PAYPROOF-2026-02-01-e4f5g6h', date: '2026-02-01', amount: 13500, reference: 'INS-456123', status: 'pending' },
  { id: 'inv3', number: 'PAYPROOF-2026-01-15-i7j8k9l', date: '2026-01-15', amount: 13500, reference: 'INS-654987', status: 'confirmed' },
  { id: 'inv4', number: 'PAYPROOF-2026-01-01-m0n1o2p', date: '2026-01-01', amount: 13500, reference: 'VOD-321654', status: 'confirmed' },
  { id: 'inv5', number: 'PAYPROOF-2025-12-15-q3r4s5t', date: '2025-12-15', amount: 13500, reference: 'INS-147258', status: 'rejected' },
  { id: 'inv6', number: 'PAYPROOF-2025-12-01-u6v7w8x', date: '2025-12-01', amount: 13500, reference: 'BNK-258369', status: 'confirmed' },
  { id: 'inv7', number: 'PAYPROOF-2025-11-15-y9z0a1b', date: '2025-11-15', amount: 13500, reference: 'FWR-369147', status: 'pending' },
  { id: 'inv8', number: 'PAYPROOF-2025-11-01-c2d3e4f', date: '2025-11-01', amount: 13500, reference: 'INS-951753', status: 'confirmed' },
];

export default function Settings() {
  const { t } = useTranslation();
  const { locale, setLocale } = useLanguage();
  const [tab, setTab] = useState<Tab>('general');
  const [students, setStudents] = useState(250);
  const [subjects, setSubjects] = useState(SUBJECTS_INIT);
  const [newSubject, setNewSubject] = useState('');
  const [scannerMode, setScannerMode] = useState<'camera' | 'bluetooth'>('camera');
  const [copied, setCopied] = useState(false);

  const calcCost = (n: number) => {
    if (n <= 150) return n * 4;
    if (n <= 500) return n * 3;
    if (n <= 1000) return n * 2.5;
    if (n <= 2000) return n * 2;
    return n * 1.75;
  };
  const weekly = calcCost(students);
  const monthly = Math.round(weekly * 4.333);
  const rate = students <= 150 ? 4 : students <= 500 ? 3 : students <= 1000 ? 2.5 : students <= 2000 ? 2 : 1.75;

  const copyCode = () => {
    navigator.clipboard.writeText(mockCenter.referral_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 md:p-6 space-y-5 animate-fade-in">
      <h1 className="text-xl font-bold text-foreground">{t('settings.title')}</h1>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl border border-border w-fit" style={{ background: 'hsl(var(--muted))' }}>
        {TABS.map(tab_key => (
          <button
            key={tab_key}
            onClick={() => setTab(tab_key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === tab_key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
          >
            {tab_key === 'general' ? t('settings.general') : tab_key === 'billing' ? t('settings.billing') : t('settings.team')}
          </button>
        ))}
      </div>

      {/* ═══ GENERAL TAB ═══ */}
      {tab === 'general' && (
        <div className="space-y-4 max-w-2xl">
          {/* Section 1: Center Info */}
          <div className="ch-card p-5 space-y-4">
            <h3 className="font-bold text-foreground">{t('settings.centerName')}</h3>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center text-muted-foreground border border-border">
                <Upload size={20} />
              </div>
              <button className="px-3 py-1.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-muted">{t('settings.uploadLogo')}</button>
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-foreground mb-1.5">{t('settings.centerName')}</label>
                <input defaultValue={mockCenter.name} className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <button className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white shrink-0" style={{ background: 'hsl(var(--primary))' }}>{t('common.save')}</button>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('settings.centerPhone')}</label>
              <input defaultValue={mockCenter.phone} dir="ltr" className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>

          {/* Section 2: Subject Management */}
          <div className="ch-card p-5 space-y-3">
            <h3 className="font-bold text-foreground">Subject Management</h3>
            <div className="space-y-2">
              {subjects.map((s, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <span className="text-sm text-foreground">{s}</span>
                  <div className="flex gap-2">
                    <button className="text-xs text-muted-foreground hover:text-foreground">{t('common.edit')}</button>
                    <button onClick={() => setSubjects(prev => prev.filter((_, j) => j !== i))} className="text-xs text-destructive">{t('common.delete')}</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newSubject} onChange={e => setNewSubject(e.target.value)} placeholder="Add subject..." className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm" />
              <button onClick={() => { if (newSubject.trim()) { setSubjects(prev => [...prev, newSubject.trim()]); setNewSubject(''); } }} className="px-3 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'hsl(var(--primary))' }}>{t('common.add')}</button>
            </div>
          </div>

          {/* Section 3: Team shortcut */}
          <div className="ch-card p-5 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-foreground">{t('settings.team')}</h3>
              <p className="text-sm text-muted-foreground">Manage assistants & teachers</p>
            </div>
            <button onClick={() => setTab('team')} className="px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1" style={{ background: 'hsl(var(--primary))' }}>
              Manage Team <ExternalLink size={14} />
            </button>
          </div>

          {/* Section 4: Scanner Settings */}
          <div className="ch-card p-5">
            <h3 className="font-bold text-foreground mb-1">Scanner Settings</h3>
            <p className="text-sm text-muted-foreground mb-3">Default Mode</p>
            <div className="flex gap-1 p-1 rounded-xl border border-border w-fit" style={{ background: 'hsl(var(--muted))' }}>
              <button onClick={() => setScannerMode('camera')} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors', scannerMode === 'camera' ? 'text-white' : 'text-muted-foreground')} style={scannerMode === 'camera' ? { background: 'hsl(var(--primary))' } : {}}>
                <Camera size={16} /> {t('scan.camera')}
              </button>
              <button onClick={() => setScannerMode('bluetooth')} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors', scannerMode === 'bluetooth' ? 'text-white' : 'text-muted-foreground')} style={scannerMode === 'bluetooth' ? { background: 'hsl(var(--primary))' } : {}}>
                <Bluetooth size={16} /> {t('scan.bluetooth')}
              </button>
            </div>
          </div>

          {/* Section 5: Referral Program */}
          <div className="ch-card p-5 space-y-3">
            <h3 className="font-bold text-foreground">Referral Program</h3>
            <p className="text-sm text-muted-foreground">شارك الكود مع سنتر تاني واحصل على ٤٠٪ من أول شهر!</p>
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg font-bold text-foreground px-4 py-2 rounded-lg bg-muted border border-border">{mockCenter.referral_code}</span>
              <button onClick={copyCode} className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted transition-colors">
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm text-green-700 font-medium">Total earned from referrals: 0 EGP</p>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Referral rewards</p>
              <p className="text-xs text-muted-foreground">No referral rewards yet</p>
            </div>
          </div>

          {/* Section 6: Language */}
          <div className="ch-card p-5">
            <label className="block text-sm font-medium text-foreground mb-2">{t('settings.language')}</label>
            <div className="flex gap-2">
              {(['ar','en'] as const).map(loc => (
                <button key={loc} onClick={() => setLocale(loc)} className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${locale === loc ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                  {loc === 'ar' ? t('settings.arabic') : t('settings.english')}
                </button>
              ))}
            </div>
          </div>

          {/* Section 7: Billing shortcut */}
          <div className="ch-card p-5 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-foreground">{t('settings.billing')}</h3>
              <p className="text-sm text-muted-foreground">Manage plan, pricing, and subscriptions.</p>
            </div>
            <button onClick={() => setTab('billing')} className="px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1" style={{ background: 'hsl(var(--primary))' }}>
              Billing Settings <ExternalLink size={14} />
            </button>
          </div>

          {/* Section 8: WhatsApp Support */}
          <div className="ch-card p-5 border-s-4" style={{ borderInlineStartColor: 'hsl(var(--primary))' }}>
            <div className="flex items-start gap-3">
              <MessageSquare size={20} className="text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-foreground">For WhatsApp integration, contact our support team: support@centerhq.com</p>
                <p className="text-sm text-muted-foreground mt-1">لتفعيل خدمة الرسائل، تواصل مع فريق الدعم: support@centerhq.com</p>
              </div>
            </div>
          </div>

          {/* Section 9: Account */}
          <div className="ch-card p-5">
            <h3 className="font-bold text-foreground mb-3">Account</h3>
            <div className="flex gap-3">
              <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-border text-foreground hover:bg-muted transition-colors">
                <Lock size={14} /> Change PIN
              </button>
              <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-destructive hover:bg-destructive/90 transition-colors">
                <LogOut size={14} /> {t('nav.logout')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BILLING TAB ═══ */}
      {tab === 'billing' && (
        <div className="space-y-4 max-w-3xl">
          {/* Current Plan */}
          <div className="ch-card p-5 border-s-4" style={{ borderInlineStartColor: 'hsl(var(--primary))' }}>
            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold mb-3" style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>
              {t('settings.currentPlan')}
            </span>
            <h3 className="font-bold text-foreground mb-4">Your current plan</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div><p className="text-muted-foreground text-xs mb-1">Plan</p><p className="font-semibold text-foreground">سنتر متوسط</p></div>
              <div><p className="text-muted-foreground text-xs mb-1">Monthly fee</p><p className="font-semibold text-foreground font-mono">4,500 EGP</p></div>
              <div><p className="text-muted-foreground text-xs mb-1">Students/week</p><p className="font-semibold text-foreground font-mono">≤500</p></div>
              <div><p className="text-muted-foreground text-xs mb-1">تكلفة/طالب/أسبوع</p><p className="font-semibold text-foreground font-mono">2.25 جنيه/طالب/أسبوع</p></div>
            </div>
          </div>

          {/* Fixed Monthly Plans */}
          <div>
            <h3 className="font-bold text-foreground mb-3">Fixed Monthly Plans</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {PLANS.map(p => (
                <div key={p.key} className={cn('ch-card p-4 relative', p.key === 'pro' && 'ring-2 ring-primary')} style={p.key === 'top_centers' ? { border: '2px solid #F59E0B', boxShadow: '0 0 12px rgba(245, 158, 11, 0.3), 0 0 0 1px #F59E0B', background: 'linear-gradient(135deg, #FFFBEB 0%, #FFFFFF 100%)' } : {}}>
                  {p.badge && (
                    <span className={cn(
                      'absolute top-2 end-2 px-2 py-0.5 rounded-full text-[10px] font-bold border',
                      p.badgeColor === 'teal' ? 'bg-teal-100 text-teal-700 border-teal-200' : 'bg-green-100 text-green-700 border-green-200'
                    )}>{p.badge}</span>
                  )}
                  <div className="font-bold text-foreground text-sm">{p.en}</div>
                  <div className="text-xl font-black font-mono text-foreground mt-1">{p.monthly}</div>
                  {p.setup !== 'Custom' && <div className="text-xs text-muted-foreground">جنيه/شهر</div>}
                  <p className="mt-1" dir="rtl" style={{ color: '#64748B', fontSize: '13px' }}>• {p.studentLabel}</p>
                  {p.perStudentLabel ? (
                    <p dir="rtl" style={{ color: '#64748B', fontSize: '13px' }}>• {p.perStudent} جنيه/طالب/أسبوع</p>
                  ) : (
                    <p dir="rtl" style={{ color: '#64748B', fontSize: '13px' }}>• تسعير مخصص حسب الاحتياج</p>
                  )}
                  {p.setup !== 'Custom' && (
                    <div className="mt-2 pt-2 border-t border-border text-muted-foreground" style={{ fontSize: '12px' }}>
                      رسوم تفعيل لمرة واحدة: <span className="font-mono font-bold">{p.setup}</span> جنيه
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* PAYG Calculator */}
          <div className="ch-card p-5">
            <h3 className="font-bold text-foreground mb-1">Pay-As-You-Go (Option B)</h3>
            <p className="text-sm text-muted-foreground mb-4">Estimate weekly cost based on students/week</p>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">{t('settings.studentsSlider')}</span>
                  <span className="font-bold font-mono text-foreground">{students}</span>
                </div>
                <input type="range" min={0} max={2500} step={10} value={students} onChange={e => setStudents(Number(e.target.value))} className="w-full accent-primary" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl p-3 border border-border">
                  <p className="text-xs text-muted-foreground">{t('settings.weeklyCost')}</p>
                  <p className="text-xl font-black font-mono mt-1">{weekly.toFixed(0)} <span className="text-sm text-muted-foreground">EGP</span></p>
                </div>
                <div className="rounded-xl p-3 border border-border">
                  <p className="text-xs text-muted-foreground">{t('settings.monthlyCost')}</p>
                  <p className="text-xl font-black font-mono mt-1">{monthly.toLocaleString()} <span className="text-sm text-muted-foreground">EGP</span></p>
                </div>
                <div className="rounded-xl p-3 border border-border">
                  <p className="text-xs text-muted-foreground">Rate tier</p>
                  <p className="text-xl font-black font-mono mt-1">{rate} <span className="text-sm text-muted-foreground">EGP/student</span></p>
                </div>
                <div className="rounded-xl p-3 border border-border">
                  <p className="text-xs text-muted-foreground">vs Fixed</p>
                  <p className={cn('text-sm font-bold mt-1', monthly > 4500 ? 'text-destructive' : 'text-green-600')}>
                    {monthly > 4500 ? 'Fixed plan is better!' : 'PAYG is cheaper!'}
                  </p>
                </div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
                PAYG: {monthly.toLocaleString()} EGP/month vs Pro: 4,500 EGP/month. {monthly > 4500 ? `Fixed plan saves ${(monthly - 4500).toLocaleString()} EGP.` : `You save ${(4500 - monthly).toLocaleString()} EGP with PAYG.`}
              </div>
              <p className="text-xs text-muted-foreground">For information only. Use Request Plan Change to switch.</p>
            </div>
          </div>

          {/* Change Plan */}
          <div className="ch-card p-5">
            <h3 className="font-bold text-foreground mb-1">Want to change your plan?</h3>
            <p className="text-sm text-muted-foreground mb-3">Changes take effect from the 1st of next month only</p>
            <button className="px-6 py-3 rounded-xl text-sm font-semibold text-white" style={{ background: 'hsl(var(--primary))' }}>Request Plan Change</button>
            <a href="https://wa.me/201001963432?text=I want to change my plan" target="_blank" rel="noopener" className="block text-sm text-primary hover:underline mt-2">Request via WhatsApp →</a>
          </div>

          {/* Invoice History */}
          <div className="ch-card p-5">
            <h3 className="font-bold text-foreground mb-3">{t('settings.invoiceHistory')}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead style={{ background: 'hsl(var(--muted))' }}>
                  <tr>
                    <th className="text-start px-3 py-2 font-medium text-muted-foreground text-xs">Invoice #</th>
                    <th className="text-start px-3 py-2 font-medium text-muted-foreground text-xs">{t('common.date')}</th>
                    <th className="text-start px-3 py-2 font-medium text-muted-foreground text-xs">{t('common.amount')}</th>
                    <th className="text-start px-3 py-2 font-medium text-muted-foreground text-xs hidden md:table-cell">Reference</th>
                    <th className="text-start px-3 py-2 font-medium text-muted-foreground text-xs">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {INVOICES.map(inv => (
                    <tr key={inv.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{inv.number.substring(0, 24)}…</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{inv.date}</td>
                      <td className="px-3 py-2 font-mono font-bold text-foreground">{inv.amount.toLocaleString()} EGP</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground hidden md:table-cell">{inv.reference}</td>
                      <td className="px-3 py-2">
                        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                          inv.status === 'confirmed' ? 'badge-confirmed' : inv.status === 'pending' ? 'badge-pending' : 'bg-destructive/10 text-destructive'
                        )}>
                          {inv.status === 'confirmed' ? 'Paid' : inv.status === 'pending' ? 'Pending' : 'Rejected'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment Methods */}
          <div className="ch-card p-5">
            <h3 className="font-bold text-foreground mb-3">Payment Methods</h3>
            <p className="text-sm text-muted-foreground mb-2">Transfer to InstaPay (Mobile Number):</p>
            <div className="flex items-center gap-3 mb-3">
              <span className="font-mono text-lg font-bold text-foreground px-4 py-2 rounded-lg bg-muted border border-border">01001963432</span>
              <button onClick={() => navigator.clipboard.writeText('01001963432')} className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm border border-border hover:bg-muted"><Copy size={14} /> Copy</button>
            </div>
            <p className="text-sm text-muted-foreground">Bank Transfer: Coming Soon</p>
          </div>

          {/* Submit Payment Proof */}
          <div className="ch-card p-5 space-y-3">
            <h3 className="font-bold text-foreground">Submit Payment Proof</h3>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Transfer Amount (EGP)</label>
              <input type="number" defaultValue={13500} className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">InstaPay Transaction Reference</label>
              <input placeholder="e.g. 123456789" className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Transfer Screenshot (optional)</label>
              <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-border text-sm text-muted-foreground hover:bg-muted"><Upload size={14} /> Choose File</button>
            </div>
            <button className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: 'hsl(var(--primary))' }}>{t('settings.submitPayment')}</button>
            <p className="text-xs text-muted-foreground">After submitting, you'll be asked to send a WhatsApp confirmation to our team for faster processing.</p>
          </div>
        </div>
      )}

      {/* ═══ TEAM TAB ═══ */}
      {tab === 'team' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'hsl(var(--primary))' }}>
              <Plus size={14} /> {t('settings.inviteMember')}
            </button>
          </div>
          <div className="ch-card overflow-hidden">
            <table className="w-full text-sm">
              <thead style={{ background: 'hsl(var(--muted))' }}>
                <tr>
                  <th className="text-start px-4 py-3 font-medium text-muted-foreground">{t('common.name')}</th>
                  <th className="text-start px-4 py-3 font-medium text-muted-foreground">{t('common.phone')}</th>
                  <th className="text-start px-4 py-3 font-medium text-muted-foreground">{t('settings.role')}</th>
                  <th className="text-start px-4 py-3 font-medium text-muted-foreground">{t('common.status')}</th>
                  <th className="text-start px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">{t('settings.permissions')}</th>
                </tr>
              </thead>
              <tbody>
                {mockTeam.map(m => (
                  <tr key={m.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">{m.name}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground text-xs" dir="ltr">{m.phone}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold border border-border text-muted-foreground">
                        {t(`settings.${m.role}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={m.is_active ? 'badge-confirmed' : 'badge-late'}>
                        {m.is_active ? t('common.active') : t('common.inactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {PERMISSIONS.filter(p => m[p]).slice(0, 3).map(p => (
                          <span key={p} className="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground">{t(`settings.${p}`)}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
