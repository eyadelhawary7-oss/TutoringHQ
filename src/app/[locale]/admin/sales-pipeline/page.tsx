'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { formatPercent } from '@/lib/formatNumber';
import { SectionHeader } from '@/components/shared';

const PIPELINE_STAGES = ['prospect', 'contacted', 'demo_scheduled', 'converted'] as const;
type PipelineStage = (typeof PIPELINE_STAGES)[number];

interface SalesLead {
  id: string;
  name: string;
  contact_person: string;
  phone: string;
  area: string;
  source: string;
  stage: PipelineStage;
  notes: string;
}

type AreaKey =
  | 'NasrCity'
  | 'Heliopolis'
  | 'Maadi'
  | 'October'
  | 'SheikhZayed'
  | 'Dokki'
  | 'Mohandeseen'
  | 'Other';

const AREAS: AreaKey[] = [
  'NasrCity',
  'Heliopolis',
  'Maadi',
  'October',
  'SheikhZayed',
  'Dokki',
  'Mohandeseen',
  'Other',
];

const AREA_LABEL_KEY: Record<AreaKey, string> = {
  NasrCity: 'areaNasrCity',
  Heliopolis: 'areaHeliopolis',
  Maadi: 'areaMaadi',
  October: 'areaOctober',
  SheikhZayed: 'areaSheikhZayed',
  Dokki: 'areaDokki',
  Mohandeseen: 'areaMohandeseen',
  Other: 'areaOther',
};

type SourceKey = 'Referral' | 'WalkIn' | 'Whatsapp' | 'SocialMedia' | 'ColdCall' | 'Other';

const SOURCES: SourceKey[] = ['Referral', 'WalkIn', 'Whatsapp', 'SocialMedia', 'ColdCall', 'Other'];

const SOURCE_LABEL_KEY: Record<SourceKey, string> = {
  Referral: 'sourceReferral',
  WalkIn: 'sourceWalkIn',
  Whatsapp: 'sourceWhatsapp',
  SocialMedia: 'sourceSocialMedia',
  ColdCall: 'sourceColdCall',
  Other: 'sourceOther',
};

export default function AdminSalesPipelinePage() {
  const t = useTranslations('admin');
  const tPipeline = useTranslations('pipeline');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedLead, setSelectedLead] = useState<SalesLead | null>(null);
  const [form, setForm] = useState<{
    name: string;
    contactPerson: string;
    phone: string;
    area: string;
    source: string;
    stage: PipelineStage;
    notes: string;
  }>({
    name: '',
    contactPerson: '',
    phone: '',
    area: '',
    source: '',
    stage: 'prospect',
    notes: '',
  });

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  useEffect(() => {
    closeMainSidebar?.();
  }, [closeMainSidebar]);

  const leadsByStage = useMemo((): Record<PipelineStage, SalesLead[]> => {
    const buckets: Record<PipelineStage, SalesLead[]> = {
      prospect: [],
      contacted: [],
      demo_scheduled: [],
      converted: [],
    };
    for (const l of leads) buckets[l.stage].push(l);
    return buckets;
  }, [leads]);

  const stats = useMemo(() => {
    const contacted = leads.filter((l) => l.stage === 'contacted').length;
    const demo_scheduled = leads.filter((l) => l.stage === 'demo_scheduled').length;
    const converted = leads.filter((l) => l.stage === 'converted').length;
    const conversionRate =
      leads.length > 0
        ? formatPercent(Math.round((converted / leads.length) * 100), locale)
        : formatPercent(0, locale);
    return { contacted, demo_scheduled, converted, conversionRate };
  }, [leads, locale]);

  const submitLead = () => {
    if (!form.name.trim()) return;
    setLeads((prev) => [
      ...prev,
      {
        id: `sl-${Date.now()}`,
        name: form.name.trim(),
        contact_person: form.contactPerson,
        phone: form.phone,
        area: form.area,
        source: form.source,
        stage: form.stage,
        notes: form.notes,
      },
    ]);
    setForm({ name: '', contactPerson: '', phone: '', area: '', source: '', stage: 'prospect', notes: '' });
    setShowAdd(false);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 min-h-screen w-full bg-[var(--color-surface-0)]">
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/sales-pipeline" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.push('/admin')}
                className="p-1.5 rounded-lg hover:bg-muted"
                aria-label={tCommon('back')}
              >
                <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
              </button>
              <h1 className="text-xl font-bold">{t('salesPipeline')}</h1>
            </div>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary"
            >
              <Plus size={16} />
              {t('addLead')}
            </button>
          </div>

          <div className="mb-3"><SectionHeader title={tCommon('sectionAtAGlance')} /></div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {([
              { statKey: 'totalLeads' as const, value: leads.length },
              { statKey: 'contacted' as const, value: stats.contacted },
              { statKey: 'demo_scheduled' as const, value: stats.demo_scheduled },
              { statKey: 'converted' as const, value: stats.converted },
              { statKey: 'conversionRate' as const, value: stats.conversionRate },
            ] as const).map(({ statKey, value }) => (
              <div
                key={statKey}
                className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6"
              >
                <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">{value}</div>
                <div className="text-sm text-[var(--color-text-secondary)]">{tPipeline(statKey)}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {PIPELINE_STAGES.map((stage) => (
              <div key={stage} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm text-[var(--color-text-primary)]">
                    {tPipeline(stage)}
                  </h3>
                  <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                    {leadsByStage[stage].length}
                  </span>
                </div>
                <div className="space-y-2">
                  {leadsByStage[stage].map((lead) => (
                    <div
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow"
                    >
                      <p className="font-semibold text-sm text-[var(--color-text-primary)]">{lead.name}</p>
                      <p className="text-xs text-[var(--color-text-secondary)]">{lead.contact_person}</p>
                      <p className="text-xs font-mono text-[var(--color-text-secondary)] mt-1" dir="ltr">
                        {lead.phone}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-[var(--color-text-secondary)]">{lead.area}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
                          {lead.source}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>

      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 max-w-md mx-4 w-full max-h-[90vh] overflow-y-auto bg-[var(--color-surface-1)] text-start"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-[var(--color-text-primary)] mb-4">{tPipeline('modalTitle')}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {tPipeline('centerNameLabel')}
                </label>
                <input
                  placeholder={tPipeline('centerNamePlaceholder')}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {tPipeline('contactPersonLabel')}
                </label>
                <input
                  placeholder={tPipeline('contactPersonPlaceholder')}
                  value={form.contactPerson}
                  onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {tPipeline('phoneLabel')}
                </label>
                <input
                  placeholder="01x xxxx xxxx"
                  type="tel"
                  dir="ltr"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {tPipeline('areaLabel')}
                </label>
                <select
                  value={form.area}
                  onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
                >
                  <option value="">{tPipeline('areaLabel')}</option>
                  {AREAS.map((a) => (
                    <option key={a} value={tPipeline(AREA_LABEL_KEY[a])}>
                      {tPipeline(AREA_LABEL_KEY[a])}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {tPipeline('sourceLabel')}
                </label>
                <select
                  value={form.source}
                  onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
                >
                  <option value="">{tPipeline('sourceLabel')}</option>
                  {SOURCES.map((s) => (
                    <option key={s} value={tPipeline(SOURCE_LABEL_KEY[s])}>
                      {tPipeline(SOURCE_LABEL_KEY[s])}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {tPipeline('stageLabel')}
                </label>
                <select
                  value={form.stage}
                  onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value as PipelineStage }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
                >
                  {PIPELINE_STAGES.map((st) => (
                    <option key={st} value={st}>
                      {tPipeline(st)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {tPipeline('notesLabel')}
                </label>
                <textarea
                  placeholder={tPipeline('notesPlaceholder')}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm h-20 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 rounded-lg text-sm border border-border"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={submitLead}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary"
              >
                {tPipeline('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedLead && (
        <div className="fixed inset-0 z-50" onClick={() => setSelectedLead(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute top-0 end-0 bottom-0 w-full max-w-md overflow-y-auto rounded-s-2xl border-s border-border bg-[var(--color-surface-1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-bold text-[var(--color-text-primary)] text-lg">{selectedLead.name}</h2>
              <button
                type="button"
                onClick={() => setSelectedLead(null)}
                className="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs text-[var(--color-text-secondary)] mb-0.5">{t('contactPerson')}</p>
                <p className="font-medium text-[var(--color-text-primary)]">{selectedLead.contact_person}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-secondary)] mb-0.5">{tCommon('phone')}</p>
                <p className="font-medium text-[var(--color-text-primary)]" dir="ltr">{selectedLead.phone}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-secondary)] mb-0.5">{t('area')}</p>
                <p className="font-medium text-[var(--color-text-primary)]">{selectedLead.area}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-secondary)] mb-0.5">{t('source')}</p>
                <p className="font-medium text-[var(--color-text-primary)]">{selectedLead.source}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-secondary)] mb-0.5">{t('notes')}</p>
                <p className="font-medium text-[var(--color-text-primary)]">{selectedLead.notes}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-secondary)] mb-1">{t('changeStage')}</p>
                <select
                  value={selectedLead.stage}
                  onChange={(e) => {
                    const newStage = e.target.value as PipelineStage;
                    setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? { ...l, stage: newStage } : l)));
                    setSelectedLead({ ...selectedLead, stage: newStage });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
                >
                  {PIPELINE_STAGES.map((st) => (
                    <option key={st} value={st}>
                      {tPipeline(st)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLeads((prev) => prev.filter((l) => l.id !== selectedLead.id));
                  setSelectedLead(null);
                }}
                className="w-full px-4 py-2 rounded-lg text-sm font-semibold text-destructive border border-destructive/30 hover:bg-destructive/10"
              >
                {t('deleteLead')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
