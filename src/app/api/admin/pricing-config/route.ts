// /api/admin/pricing-config
//
// GET  : returns the full pricing config snapshot (super_admin / admin / internal_admin).
// PATCH: upserts the supplied subset of keys into platform_config (super_admin only).
//
// Audit: one row per save with action = 'pricing_config_updated', user_id = ctx.userId,
// and details = { changes: [{ key, old, new }, ...], save_source }. Old + new values
// are recorded so a destructive pricing change is reversible from the audit trail.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';
import {
  BANNER_STYLES,
  getPricingConfigSnapshot,
  type BannerStyle,
} from '@/lib/pricingConfig';
import { upsertPlatformConfigRowUpdateInsert } from '@/lib/platformConfigWrite';
import { buildPricingConfigAuditDetails } from '@/lib/pricingConfigAudit';
import {
  SUMMER_ENABLED_KEY,
  SUMMER_FREE_UNTIL_KEY,
  SUMMER_FIRST_CHARGE_FLOOR_KEY,
  SUMMER_TRIAL_DAYS_KEY,
  SUMMER_PAY_WINDOW_DAYS_KEY,
  SUMMER_FIRST_CHARGE_RELEASE_KEY,
} from '@/lib/summer/config';

type PatchBody = Partial<{
  interval: Partial<{
    annualMultiplier: number;
    annualLabelEn: string;
    annualLabelAr: string;
  }>;
  addons: Partial<{
    whatsappParentPack: number;
    cardOrderBase: number;
    shippingCost: number;
  }>;
  banner: Partial<{
    enabled: boolean;
    textEn: string;
    textAr: string;
    subtextEn: string;
    subtextAr: string;
    style: BannerStyle;
    ctaTextEn: string;
    ctaTextAr: string;
    ctaUrl: string;
  }>;
  popup: Partial<{
    enabled: boolean;
    titleEn: string;
    titleAr: string;
    bodyEn: string;
    bodyAr: string;
    promoCode: string;
    ctaTextEn: string;
    ctaTextAr: string;
    ctaUrl: string;
    delaySeconds: number;
  }>;
  summer: Partial<{
    enabled: boolean;
    freeUntil: string;
    firstChargeFloor: string;
    trialDays: number;
    payWindowDays: number;
    firstChargeRelease: 'HELD' | 'RELEASED';
  }>;
}>;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Tighter than the finance gate: pricing config drives revenue, so only
  // super_admin / admin / internal_admin can see it. Accountants get
  // aggregate financials but not the raw multipliers.
  const denied = requireAdminRole(ctx, ['super_admin', 'admin', 'internal_admin']);
  if (denied) return denied;
  const snapshot = await getPricingConfigSnapshot();
  return NextResponse.json({ config: snapshot });
}

export async function PATCH(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = requireAdminRole(ctx, ['super_admin']);
  if (denied) return denied;

  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }

  let body: PatchBody;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const updates: Array<{ key: string; value: unknown }> = [];
  const errors: string[] = [];

  // ── Interval ─────────────────────────────────────────────────────────────
  if (body.interval) {
    const i = body.interval;
    if (i.annualMultiplier !== undefined) {
      // Annual multiplier = months charged per year (annual total = monthly × this).
      // 10 → "true 2 months free". Allow 1..12.
      if (!isNum(i.annualMultiplier) || i.annualMultiplier <= 0 || i.annualMultiplier > 12) {
        errors.push('interval.annualMultiplier must be a number between 0 and 12 (months charged per year)');
      } else updates.push({ key: 'pricing.interval.annual_multiplier', value: i.annualMultiplier });
    }
    if (i.annualLabelEn !== undefined) {
      if (!isStr(i.annualLabelEn) || i.annualLabelEn.length > 60) {
        errors.push('interval.annualLabelEn must be a string up to 60 chars');
      } else updates.push({ key: 'pricing.interval.annual_label_en', value: i.annualLabelEn });
    }
    if (i.annualLabelAr !== undefined) {
      if (!isStr(i.annualLabelAr) || i.annualLabelAr.length > 60) {
        errors.push('interval.annualLabelAr must be a string up to 60 chars');
      } else updates.push({ key: 'pricing.interval.annual_label_ar', value: i.annualLabelAr });
    }
  }

  // ── Add-ons (note: reuses existing keys, not pricing.addon.*) ───────────
  if (body.addons) {
    const a = body.addons;
    if (a.whatsappParentPack !== undefined) {
      if (!isNum(a.whatsappParentPack) || a.whatsappParentPack < 0) {
        errors.push('addons.whatsappParentPack must be a non-negative number');
      } else updates.push({ key: 'pack_price_per_parent', value: a.whatsappParentPack });
    }
    if (a.cardOrderBase !== undefined) {
      if (!isNum(a.cardOrderBase) || a.cardOrderBase < 0) {
        errors.push('addons.cardOrderBase must be a non-negative number');
      } else updates.push({ key: 'qr_card_price', value: a.cardOrderBase });
    }
    if (a.shippingCost !== undefined) {
      if (!isNum(a.shippingCost) || a.shippingCost < 0) {
        errors.push('addons.shippingCost must be a non-negative number');
      } else updates.push({ key: 'pricing.shipping.default_cost', value: a.shippingCost });
    }
  }

  // ── Banner ───────────────────────────────────────────────────────────────
  if (body.banner) {
    const b = body.banner;
    if (b.enabled !== undefined) {
      if (typeof b.enabled !== 'boolean') errors.push('banner.enabled must be boolean');
      else updates.push({ key: 'pricing.banner.enabled', value: b.enabled });
    }
    const stringKeys: Array<[keyof typeof b, string]> = [
      ['textEn', 'pricing.banner.text_en'],
      ['textAr', 'pricing.banner.text_ar'],
      ['subtextEn', 'pricing.banner.subtext_en'],
      ['subtextAr', 'pricing.banner.subtext_ar'],
      ['ctaTextEn', 'pricing.banner.cta_text_en'],
      ['ctaTextAr', 'pricing.banner.cta_text_ar'],
      ['ctaUrl', 'pricing.banner.cta_url'],
    ];
    for (const [field, dbKey] of stringKeys) {
      const v = b[field];
      if (v !== undefined) {
        if (!isStr(v) || v.length > 500) {
          errors.push(`banner.${String(field)} must be a string up to 500 chars`);
        } else updates.push({ key: dbKey, value: v });
      }
    }
    if (b.style !== undefined) {
      if (!isStr(b.style) || !(BANNER_STYLES as readonly string[]).includes(b.style)) {
        errors.push(`banner.style must be one of ${BANNER_STYLES.join(', ')}`);
      } else updates.push({ key: 'pricing.banner.style', value: b.style });
    }
  }

  // ── Popup ────────────────────────────────────────────────────────────────
  if (body.popup) {
    const p = body.popup;
    if (p.enabled !== undefined) {
      if (typeof p.enabled !== 'boolean') errors.push('popup.enabled must be boolean');
      else updates.push({ key: 'landing.popup.enabled', value: p.enabled });
    }
    const popupStringKeys: Array<[keyof typeof p, string]> = [
      ['titleEn', 'landing.popup.title_en'],
      ['titleAr', 'landing.popup.title_ar'],
      ['bodyEn', 'landing.popup.body_en'],
      ['bodyAr', 'landing.popup.body_ar'],
      ['promoCode', 'landing.popup.promo_code'],
      ['ctaTextEn', 'landing.popup.cta_text_en'],
      ['ctaTextAr', 'landing.popup.cta_text_ar'],
      ['ctaUrl', 'landing.popup.cta_url'],
    ];
    for (const [field, dbKey] of popupStringKeys) {
      const v = p[field];
      if (v !== undefined) {
        if (!isStr(v) || v.length > 500) {
          errors.push(`popup.${String(field)} must be a string up to 500 chars`);
        } else updates.push({ key: dbKey, value: v });
      }
    }
    if (p.delaySeconds !== undefined) {
      if (!isNum(p.delaySeconds) || p.delaySeconds < 0 || p.delaySeconds > 60) {
        errors.push('popup.delaySeconds must be a number between 0 and 60');
      } else updates.push({ key: 'landing.popup.delay_seconds', value: p.delaySeconds });
    }
  }

  // ── Summer 2026 (master switch, dates, counts, HELD/RELEASED hold) ─────────
  if (body.summer) {
    const s = body.summer;
    if (s.enabled !== undefined) {
      if (typeof s.enabled !== 'boolean') errors.push('summer.enabled must be boolean');
      else updates.push({ key: SUMMER_ENABLED_KEY, value: s.enabled });
    }
    if (s.freeUntil !== undefined) {
      if (!isStr(s.freeUntil) || !YMD_RE.test(s.freeUntil)) errors.push('summer.freeUntil must be YYYY-MM-DD');
      else updates.push({ key: SUMMER_FREE_UNTIL_KEY, value: s.freeUntil });
    }
    if (s.firstChargeFloor !== undefined) {
      if (!isStr(s.firstChargeFloor) || !YMD_RE.test(s.firstChargeFloor)) {
        errors.push('summer.firstChargeFloor must be YYYY-MM-DD');
      } else updates.push({ key: SUMMER_FIRST_CHARGE_FLOOR_KEY, value: s.firstChargeFloor });
    }
    if (s.trialDays !== undefined) {
      if (!isNum(s.trialDays) || s.trialDays < 0 || s.trialDays > 365) {
        errors.push('summer.trialDays must be a number between 0 and 365');
      } else updates.push({ key: SUMMER_TRIAL_DAYS_KEY, value: Math.floor(s.trialDays) });
    }
    if (s.payWindowDays !== undefined) {
      if (!isNum(s.payWindowDays) || s.payWindowDays < 1 || s.payWindowDays > 30) {
        errors.push('summer.payWindowDays must be a number between 1 and 30');
      } else updates.push({ key: SUMMER_PAY_WINDOW_DAYS_KEY, value: Math.floor(s.payWindowDays) });
    }
    if (s.firstChargeRelease !== undefined) {
      if (s.firstChargeRelease !== 'HELD' && s.firstChargeRelease !== 'RELEASED') {
        errors.push('summer.firstChargeRelease must be HELD or RELEASED');
      } else updates.push({ key: SUMMER_FIRST_CHARGE_RELEASE_KEY, value: s.firstChargeRelease });
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: 'validation_failed', issues: errors }, { status: 400 });
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const saveSource =
    request.headers.get('x-chq-pricing-save-source') ?? request.headers.get('X-CHQ-Pricing-Save-Source') ?? 'unknown';

  // Capture prior values per key BEFORE writing, so the audit row records the
  // before/after pair. Missing rows (first write of a key) report old=null.
  const priorByKey = new Map<string, unknown>();
  {
    const keysToFetch = updates.map((u) => u.key);
    const { data: priorRows } = await ctx.supabaseAdmin
      .from('platform_config')
      .select('key, value')
      .in('key', keysToFetch);
    for (const row of priorRows ?? []) {
      const r = row as { key?: string; value?: unknown };
      if (typeof r.key === 'string') {
        priorByKey.set(r.key, r.value ?? null);
      }
    }
  }

  for (const u of updates) {
    const trigger = `[PATCH /api/admin/pricing-config] save_source=${saveSource} platform_config.key=${u.key}`;
    const result = await upsertPlatformConfigRowUpdateInsert(
      ctx.supabaseAdmin,
      {
        key: u.key,
        value: u.value,
        updated_at: nowIso,
        updated_by: ctx.userId,
      },
      trigger,
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.message ?? 'platform_config write failed' }, { status: 500 });
    }
  }

  try {
    await ctx.supabaseAdmin.from('audit_log').insert({
      user_id: ctx.userId,
      action: 'pricing_config_updated',
      details: buildPricingConfigAuditDetails(updates, priorByKey, saveSource),
    });
  } catch (auditErr) {
    console.error('[PATCH /api/admin/pricing-config] audit_log', auditErr);
  }

  const snapshot = await getPricingConfigSnapshot();
  return NextResponse.json({ config: snapshot, updated_keys: updates.length });
}
