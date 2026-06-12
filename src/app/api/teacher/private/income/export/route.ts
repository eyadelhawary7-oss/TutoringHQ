import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import {
  cairoDateKey,
  parseCairoYmd,
  startOfUtcInstantForCairoCalendarDay,
} from '@/lib/cairo/day';

const ROUTE_TAG = 'api/teacher/private/income/export';

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function serverError(step: string, err: { message: string }): NextResponse {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/** Same teacher-take fallback chain as /api/teacher/center-cuts. */
function teacherCut(row: {
  teacher_net: number | string | null;
  snap_teacher_pct: number | string | null;
  amount_billed: number | string | null;
}): number {
  const net = row.teacher_net == null ? null : Number(row.teacher_net);
  if (net != null && Number.isFinite(net)) return net;
  const pct = row.snap_teacher_pct == null ? null : Number(row.snap_teacher_pct);
  const billed = row.amount_billed == null ? null : Number(row.amount_billed);
  if (pct != null && Number.isFinite(pct) && billed != null && Number.isFinite(billed)) {
    return (pct / 100) * billed;
  }
  return 0;
}

// CSV copy lives here (server route - next-intl message catalogs are a client
// concern). en mirrors messages/en.json tone, ar mirrors ar.json.
const CSV_TEXT = {
  en: {
    headers: ['Date', 'Group', 'Student', 'Amount (EGP)', 'Type', 'Status'],
    typeLesson: 'Private class',
    typeCenterFee: 'Center cut',
    statusPaid: 'Paid',
    statusPending: 'Pending',
    statusOther: (s: string) => s,
  },
  ar: {
    headers: ['التاريخ', 'المجموعة', 'الطالب', 'المبلغ (جنيه)', 'النوع', 'الحالة'],
    typeLesson: 'حصة خاصة',
    typeCenterFee: 'نصيبك من السنتر',
    statusPaid: 'مدفوع',
    statusPending: 'معلّق',
    statusOther: (s: string) => s,
  },
} as const;

function csvField(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

type ExportTxnRow = {
  id: string;
  created_at: string;
  kind: string;
  status: string | null;
  amount_billed: number | string | null;
  teacher_net: number | string | null;
  snap_teacher_pct: number | string | null;
  group_id: string | null;
  student_id: string | null;
};

/**
 * GET /api/teacher/private/income/export?period=current|all[&year=&month=][&locale=en|ar]
 * CSV download of the teacher's own transactions (lesson + center_fee), all
 * time or one Cairo calendar month (created_at window). PRIVATE data:
 * requireTeacherPrivateAccess gates it; every query is teacher-scoped via the
 * service-role client and is_test rows are excluded. Group/student names are
 * display data: a failed name lookup degrades to blank cells, never a 500.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const period = params.get('period') === 'all' ? 'all' : 'current';
  const locale = params.get('locale') === 'en' ? 'en' : 'ar';
  const text = CSV_TEXT[locale];

  // Resolve the Cairo month window for period=current (defaults to this month).
  let windowLabel = 'all';
  let startIso: string | null = null;
  let endIso: string | null = null;
  if (period === 'current') {
    const today = parseCairoYmd(cairoDateKey());
    let y = today.y;
    let m = today.m;
    if (params.get('year') !== null || params.get('month') !== null) {
      const yearParam = Number(params.get('year'));
      const monthParam = Number(params.get('month'));
      const valid =
        Number.isInteger(yearParam) &&
        Number.isInteger(monthParam) &&
        yearParam >= 2000 &&
        yearParam <= 2100 &&
        monthParam >= 1 &&
        monthParam <= 12;
      if (!valid) {
        return NextResponse.json(
          { error: 'Invalid request', code: 'invalid_month' },
          { status: 400 },
        );
      }
      y = yearParam;
      m = monthParam;
    }
    const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
    startIso = startOfUtcInstantForCairoCalendarDay(
      `${y}-${String(m).padStart(2, '0')}-01`,
    ).toISOString();
    endIso = startOfUtcInstantForCairoCalendarDay(
      `${next.y}-${String(next.m).padStart(2, '0')}-01`,
    ).toISOString();
    windowLabel = `${y}-${String(m).padStart(2, '0')}`;
  }

  // CORE: the transaction rows themselves (paginated past the 1000-row cap).
  const rows: ExportTxnRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = auth.supabaseAdmin
      .from('transactions')
      .select(
        'id, created_at, kind, status, amount_billed, teacher_net, snap_teacher_pct, group_id, student_id',
      )
      .eq('teacher_id', auth.userId)
      .eq('is_test', false)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (startIso && endIso) {
      query = query.gte('created_at', startIso).lt('created_at', endIso);
    }
    const { data, error } = await query;
    if (error) return serverError('transactions', error);
    const batch = (data ?? []) as ExportTxnRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  // BEST-EFFORT: group and student display names.
  const groupName = new Map<string, string | null>();
  const studentName = new Map<string, string | null>();
  const groupIds = Array.from(new Set(rows.map((r) => r.group_id).filter(Boolean))) as string[];
  const studentIds = Array.from(
    new Set(rows.map((r) => r.student_id).filter(Boolean)),
  ) as string[];
  if (groupIds.length > 0) {
    const { data, error } = await auth.supabaseAdmin
      .from('student_groups')
      .select('id, name')
      .in('id', groupIds);
    if (error) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'group_names');
        Sentry.captureMessage(`export group-name lookup failed: ${error.message}`, 'warning');
      });
    } else {
      for (const g of (data ?? []) as { id: string; name: string | null }[]) {
        groupName.set(g.id, g.name);
      }
    }
  }
  if (studentIds.length > 0) {
    const { data, error } = await auth.supabaseAdmin
      .from('students')
      .select('id, name')
      .in('id', studentIds);
    if (error) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'student_names');
        Sentry.captureMessage(`export student-name lookup failed: ${error.message}`, 'warning');
      });
    } else {
      for (const s of (data ?? []) as { id: string; name: string | null }[]) {
        studentName.set(s.id, s.name);
      }
    }
  }

  const lines: string[] = [text.headers.map(csvField).join(',')];
  for (const r of rows) {
    const amount =
      r.kind === 'center_fee' ? round2(teacherCut(r)) : round2(Number(r.amount_billed) || 0);
    const type = r.kind === 'center_fee' ? text.typeCenterFee : text.typeLesson;
    const status =
      r.status === 'paid'
        ? text.statusPaid
        : r.status === 'pending'
          ? text.statusPending
          : text.statusOther(String(r.status ?? ''));
    lines.push(
      [
        csvField(cairoDateKey(new Date(r.created_at))),
        csvField((r.group_id ? groupName.get(r.group_id) : null) ?? ''),
        csvField((r.student_id ? studentName.get(r.student_id) : null) ?? ''),
        // Plain machine-readable number; spreadsheet apps localize display.
        csvField(amount.toFixed(2)),
        csvField(type),
        csvField(status),
      ].join(','),
    );
  }

  // BOM so Excel detects UTF-8 and renders Arabic correctly.
  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
  const filename = `centerhq-income-${windowLabel}-${cairoDateKey()}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
