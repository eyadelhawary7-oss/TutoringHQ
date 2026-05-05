import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit } from '@/lib/validate';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const { centerId, supabaseAdmin } = auth;

    const [yearsRes, periodsRes, holidaysRes] = await Promise.all([
      supabaseAdmin
        .from('academic_years')
        .select('id, name, start_date, end_date, is_current, created_at')
        .eq('center_id', centerId)
        .order('start_date', { ascending: false }),
      supabaseAdmin
        .from('academic_periods')
        .select('id, academic_year_id, period_type, name, start_date, end_date, attendance_context')
        .eq('center_id', centerId)
        .order('start_date', { ascending: true }),
      supabaseAdmin
        .from('holidays')
        .select('id, name, english_name, date, is_recurring')
        .eq('center_id', centerId)
        .order('date', { ascending: true }),
    ]);

    const years = yearsRes.data ?? [];
    const periods = periodsRes.data ?? [];
    const holidays = holidaysRes.data ?? [];

    const currentYear = years.find((y: { is_current: boolean }) => y.is_current) ?? years[0] ?? null;

    return NextResponse.json({
      years,
      periods,
      holidays,
      currentYear,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const { centerId, supabaseAdmin } = auth;
    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;

    const action = body?.action as string;
    if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 });

    if (action === 'create_year') {
      const { name, start_date, end_date } = body;
      if (!name || !start_date || !end_date) {
        return NextResponse.json({ error: 'Missing name, start_date, or end_date' }, { status: 400 });
      }
      // Unset current on others
      await supabaseAdmin
        .from('academic_years')
        .update({ is_current: false })
        .eq('center_id', centerId);
      const { data, error } = await supabaseAdmin
        .from('academic_years')
        .insert({
          center_id: centerId,
          name,
          start_date,
          end_date,
          is_current: true,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ year: data });
    }

    if (action === 'update_year') {
      const { id, name, start_date, end_date, is_current } = body;
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
      if (is_current) {
        await supabaseAdmin
          .from('academic_years')
          .update({ is_current: false })
          .eq('center_id', centerId);
      }
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (name != null) updates.name = name;
      if (start_date != null) updates.start_date = start_date;
      if (end_date != null) updates.end_date = end_date;
      if (is_current != null) updates.is_current = is_current;
      const { data, error } = await supabaseAdmin
        .from('academic_years')
        .update(updates)
        .eq('id', id)
        .eq('center_id', centerId)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ year: data });
    }

    if (action === 'create_period') {
      const { academic_year_id, period_type, name, start_date, end_date, attendance_context } = body;
      if (!academic_year_id || !period_type || !name || !start_date || !end_date) {
        return NextResponse.json({ error: 'Missing required period fields' }, { status: 400 });
      }
      const validTypes = ['exam', 'holiday', 'peak', 'normal'];
      if (!validTypes.includes(String(period_type))) {
        return NextResponse.json({ error: 'Invalid period_type' }, { status: 400 });
      }
      const { data, error } = await supabaseAdmin
        .from('academic_periods')
        .insert({
          academic_year_id,
          center_id: centerId,
          period_type,
          name,
          start_date,
          end_date,
          attendance_context: attendance_context ?? null,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ period: data });
    }

    if (action === 'update_period') {
      const { id, period_type, name, start_date, end_date, attendance_context } = body;
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (period_type != null) updates.period_type = period_type;
      if (name != null) updates.name = name;
      if (start_date != null) updates.start_date = start_date;
      if (end_date != null) updates.end_date = end_date;
      if (attendance_context !== undefined) updates.attendance_context = attendance_context;
      const { data, error } = await supabaseAdmin
        .from('academic_periods')
        .update(updates)
        .eq('id', id)
        .eq('center_id', centerId)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ period: data });
    }

    if (action === 'delete_period') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
      const { error } = await supabaseAdmin
        .from('academic_periods')
        .delete()
        .eq('id', id)
        .eq('center_id', centerId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (action === 'create_holiday') {
      const { name, english_name, date, is_recurring } = body;
      const nameTrim = typeof name === 'string' ? name.trim() : '';
      const enTrim = typeof english_name === 'string' ? english_name.trim() : '';
      const primaryName = nameTrim || enTrim;
      if (!primaryName || !date) return NextResponse.json({ error: 'Missing name or date' }, { status: 400 });
      const { data, error } = await supabaseAdmin
        .from('holidays')
        .insert({
          center_id: centerId,
          name: primaryName,
          english_name: enTrim || null,
          date,
          is_recurring: is_recurring ?? false,
        })
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ holiday: data });
    }

    if (action === 'update_holiday') {
      const { id, name, english_name, date, is_recurring } = body;
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
      const updates: Record<string, unknown> = {};
      if (name != null) updates.name = typeof name === 'string' ? name.trim() : name;
      if (english_name !== undefined) {
        updates.english_name =
          typeof english_name === 'string' && english_name.trim() !== '' ? english_name.trim() : null;
      }
      if (date != null) updates.date = date;
      if (is_recurring !== undefined) updates.is_recurring = is_recurring;
      const { data, error } = await supabaseAdmin
        .from('holidays')
        .update(updates)
        .eq('id', id)
        .eq('center_id', centerId)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ holiday: data });
    }

    if (action === 'delete_holiday') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
      const { error } = await supabaseAdmin
        .from('holidays')
        .delete()
        .eq('id', id)
        .eq('center_id', centerId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
