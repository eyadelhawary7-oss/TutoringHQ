// /api/admin/pricing-config
//
// GET  : returns the full pricing config snapshot (any admin role).
// PATCH: upserts the supplied subset of keys into platform_config (super_admin only).
//
// Audit: one row per save with action = 'pricing_config_updated', user_id = ctx.userId,
// and details = { changed_keys: [...] }. Key names only — never the values.

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

type PatchBody = Partial<{
  interval: Partial<{
    monthlyMultiplier: number;
    annualMultiplier: number;
    annualLabelEn: string;
    annualLabelAr: string;
  }>;
  addons: Partial<{
    whatsappParentPack: number;
    cardOrderBase: number;
    shippingCost: number;
  }>;
  promo: Partial<{
    enabled: boolean;
    discountPct: number;
    applicableIntervals: string[];
    endDate: string | null;
    spotsTotal: number | null;
    spotsUsed: number;
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
}>;

const ALLOWED_PROMO_INTERVALS = new Set(['monthly', 'quarterly', 'annual']);

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    if (i.monthlyMultiplier !== undefined) {
      if (!isNum(i.monthlyMultiplier) || i.monthlyMultiplier <= 0 || i.monthlyMultiplier > 5) {
        errors.push('interval.monthlyMultiplier must be a number between 0 and 5');
      } else updates.push({ key: 'pricing.interval.monthly_multiplier', value: i.monthlyMultiplier });
    }
    if (i.annualMultiplier !== undefined) {
      if (!isNum(i.annualMultiplier) || i.annualMultiplier <= 0 || i.annualMultiplier > 5) {
        errors.push('interval.annualMultiplier must be a number between 0 and 5');
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

  // ── Promo ────────────────────────────────────────────────────────────────
  if (body.promo) {
    const p = body.promo;
    if (p.enabled !== undefined) {
      if (typeof p.enabled !== 'boolean') errors.push('promo.enabled must be boolean');
      else updates.push({ key: 'pricing.promo.enabled', value: p.enabled });
    }
    if (p.discountPct !== undefined) {
      if (!isNum(p.discountPct) || p.discountPct < 0 || p.discountPct > 100) {
        errors.push('promo.discountPct must be between 0 and 100');
      } else updates.push({ key: 'pricing.promo.discount_pct', value: p.discountPct });
    }
    if (p.applicableIntervals !== undefined) {
      if (!Array.isArray(p.applicableIntervals)) {
        errors.push('promo.applicableIntervals must be an array');
      } else {
        const cleaned = p.applicableIntervals.filter(
          (s) => typeof s === 'string' && ALLOWED_PROMO_INTERVALS.has(s),
        );
        updates.push({ key: 'pricing.promo.applicable_intervals', value: cleaned });
      }
    }
    if (p.endDate !== undefined) {
      if (p.endDate === null || p.endDate === '') {
        updates.push({ key: 'pricing.promo.end_date', value: null });
      } else if (!isStr(p.endDate) || Number.isNaN(new Date(p.endDate).getTime())) {
        errors.push('promo.endDate must be ISO date string or null');
      } else {
        updates.push({ key: 'pricing.promo.end_date', value: p.endDate });
      }
    }
    if (p.spotsTotal !== undefined) {
      if (p.spotsTotal === null) {
        updates.push({ key: 'pricing.promo.spots_total', value: null });
      } else if (!isNum(p.spotsTotal) || p.spotsTotal < 0) {
        errors.push('promo.spotsTotal must be a non-negative number or null');
      } else {
        updates.push({ key: 'pricing.promo.spots_total', value: Math.floor(p.spotsTotal) });
      }
    }
    if (p.spotsUsed !== undefined) {
      if (!isNum(p.spotsUsed) || p.spotsUsed < 0) {
        errors.push('promo.spotsUsed must be a non-negative number');
      } else updates.push({ key: 'pricing.promo.spots_used', value: Math.floor(p.spotsUsed) });
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

  if (errors.length > 0) {
    return NextResponse.json({ error: 'validation_failed', issues: errors }, { status: 400 });
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const saveSource =
    request.headers.get('x-chq-pricing-save-source') ?? request.headers.get('X-CHQ-Pricing-Save-Source') ?? 'unknown';

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
      details: { changed_keys: updates.map((u) => u.key) },
    });
  } catch (auditErr) {
    console.error('[PATCH /api/admin/pricing-config] audit_log', auditErr);
  }

  const snapshot = await getPricingConfigSnapshot();
  return NextResponse.json({ config: snapshot, updated_keys: updates.length });
}
