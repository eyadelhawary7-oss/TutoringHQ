/**
 * AI natural language query - Arabic/English questions about center data
 * Uses Claude Haiku to generate SQL, executes via Supabase, returns Arabic summary
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { parseBodyWithLimit } from '@/lib/validate';

const SYSTEM_PROMPT = `You are a data assistant for an Egyptian tutoring center management platform called CenterHQ.
The user asks questions in Arabic or English about their center's data.
You must respond ONLY with valid JSON (no markdown, no explanation outside JSON):
{ "sql": "SELECT ...", "explanation_ar": "Arabic explanation of what you searched" }

Available tables (always filter by center_id = $1):
- students: id, name, phone, is_active, balance_due, lifecycle_status, created_at
- attendance_scans: id, student_id, center_id, scanned_at, payment_method, confirmed, amount
- payments: id, student_id, center_id, amount, method, paid_at, confirmed, recorded_by
- student_groups: id, center_id, name, capacity, subject, fee (groups)
- student_group_members: group_id, student_id (links students to groups)

Rules:
- ONLY SELECT statements. Reject any DELETE, UPDATE, INSERT, DROP, ALTER, TRUNCATE.
- Always include WHERE center_id = $1 or join to a table that filters by center_id.
- Return maximum 50 rows (add LIMIT 50 if not present).
- Use Arabic-friendly column aliases in SELECT (e.g. SELECT name AS الاسم).
- For date questions: use Cairo timezone (UTC+2): AT TIME ZONE 'Africa/Cairo'
- For 'this week': scanned_at >= date_trunc('week', NOW() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo'
- For 'today': DATE(scanned_at AT TIME ZONE 'Africa/Cairo') = (CURRENT_DATE AT TIME ZONE 'Africa/Cairo')::date
- For payments today: DATE(paid_at AT TIME ZONE 'Africa/Cairo') = (CURRENT_DATE AT TIME ZONE 'Africa/Cairo')::date`;

const FORBIDDEN = /\b(DELETE|UPDATE|INSERT|DROP|ALTER|TRUNCATE)\b/i;

async function getUserContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { centerId: userRecord.center_id as string, supabaseAdmin };
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
    }

    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question) {
      return NextResponse.json({ error: 'question required' }, { status: 400 });
    }

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim();

    let parsed: { sql?: string; explanation_ar?: string };
    try {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned) as { sql?: string; explanation_ar?: string };
    } catch {
      return NextResponse.json(
        { error: 'parse_error', message: 'تعذر فهم السؤال, حاول بطريقة مختلفة' },
        { status: 400 }
      );
    }

    const sql = parsed.sql?.trim();
    if (!sql) {
      return NextResponse.json(
        { error: 'no_sql', message: 'تعذر فهم السؤال, حاول بطريقة مختلفة' },
        { status: 400 }
      );
    }

    if (FORBIDDEN.test(sql)) {
      return NextResponse.json({ error: 'forbidden_query' }, { status: 400 });
    }

    const { data: rows, error: rpcError } = await ctx.supabaseAdmin.rpc('ai_execute_query', {
      p_sql: sql,
      p_center_id: ctx.centerId,
    });

    if (rpcError) {
      console.error('[ai/query] RPC error:', rpcError);
      return NextResponse.json(
        { error: 'query_error', message: 'تعذر تنفيذ الاستعلام, حاول بصياغة أخرى' },
        { status: 500 }
      );
    }

    const rowList = Array.isArray(rows) ? rows : (rows ? JSON.parse(rows as string) : []);
    const rowCount = rowList.length;

    // Generate natural Arabic summary
    const summaryPrompt = `Based on this query result, write a brief natural Arabic summary (1-2 sentences) for the user.
Query: ${question}
Explanation: ${parsed.explanation_ar ?? ''}
Row count: ${rowCount}
Sample row keys: ${rowCount > 0 ? Object.keys(rowList[0] as object).join(', ') : 'none'}

Respond with ONLY the Arabic summary, no JSON, no quotes.`;

    const summaryResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: summaryPrompt }],
    });

    const answerAr = summaryResponse.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim() || (rowCount === 0 ? 'لا توجد نتائج.' : `تم العثور على ${rowCount} نتيجة.`);

    return NextResponse.json({
      answer_ar: answerAr,
      rows: rowList,
      row_count: rowCount,
      explanation_ar: parsed.explanation_ar ?? '',
    });
  } catch (err) {
    console.error('[ai/query] Error:', err);
    return NextResponse.json(
      { error: 'server_error', message: 'حدث خطأ, حاول مرة أخرى لاحقاً' },
      { status: 500 }
    );
  }
}
