/**
 * Export dormant center operational data to Google Drive (CSV per table), then delete rows.
 * Financial records (invoices, audit_log) are kept; centers row is updated to status rejected.
 */

import { google } from 'googleapis';
import { Readable } from 'stream';
import type { SupabaseClient } from '@supabase/supabase-js';

const EXPORT_TABLES = [
  'students',
  'payments',
  'attendance_scans',
  'student_group_members',
  'student_groups',
  'schedule_slots',
  'rooms',
  'paid_parents',
  'announcement_blasts',
  'card_orders',
] as const;

function getDrive() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  return google.drive({ version: 'v3', auth });
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n');
}

async function uploadCsv(
  drive: ReturnType<typeof getDrive>,
  parentId: string,
  filename: string,
  csv: string,
): Promise<void> {
  const stream = Readable.from([csv]);
  await drive.files.create({
    requestBody: { name: filename, parents: [parentId], mimeType: 'text/csv' },
    media: { mimeType: 'text/csv', body: stream },
    fields: 'id',
  });
}

async function getOrCreateFolder(drive: ReturnType<typeof getDrive>, parentId: string, name: string): Promise<string> {
  const existing = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (existing.data.files?.[0]?.id) return existing.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return created.data.id ?? parentId;
}

export async function exportDormantCenterToDrive(
  supabase: SupabaseClient,
  centerId: string,
  labelYmd: string,
): Promise<{ folderId: string | null; files: string[]; errors: string[] }> {
  const rootFolderId = process.env.BACKUP_DRIVE_FOLDER_ID;
  const out = { folderId: null as string | null, files: [] as string[], errors: [] as string[] };
  if (!rootFolderId || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    out.errors.push('missing_drive_or_credentials');
    return out;
  }

  try {
    const drive = getDrive();
    const purgeRoot = await getOrCreateFolder(drive, rootFolderId, 'dormant_center_purge');
    const folderName = `${centerId.slice(0, 8)}_${labelYmd}`;
    const folderId = await getOrCreateFolder(drive, purgeRoot, folderName);
    out.folderId = folderId;

    for (const table of EXPORT_TABLES) {
      try {
        if (table === 'student_group_members') {
          const { data: groups } = await supabase.from('student_groups').select('id').eq('center_id', centerId);
          const gids = (groups ?? []).map((g: { id: string }) => g.id);
          if (gids.length === 0) {
            await uploadCsv(drive, folderId, `${table}.csv`, '');
            out.files.push(table);
            continue;
          }
          const { data, error } = await (supabase as unknown as { from: (t: string) => ReturnType<SupabaseClient['from']> })
            .from(table)
            .select('*')
            .in('group_id', gids)
            .limit(100000);
          if (error) throw error;
          await uploadCsv(drive, folderId, `${table}.csv`, toCSV((data ?? []) as Record<string, unknown>[]));
        } else {
          // Dynamic table name - not all tables exist in generated types
          const { data, error } = await (supabase as unknown as { from: (t: string) => ReturnType<SupabaseClient['from']> })
            .from(table)
            .select('*')
            .eq('center_id', centerId)
            .limit(100000);
          if (error) throw error;
          await uploadCsv(drive, folderId, `${table}.csv`, toCSV((data ?? []) as Record<string, unknown>[]));
        }
        out.files.push(table);
      } catch (e) {
        out.errors.push(`${table}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    out.errors.push(`drive: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

/** Calendar months between dormancy_date (YYYY-MM-DD) and today (YYYY-MM-DD), inclusive of month delta. */
export function monthsSinceDormancy(dormancyYmd: string, todayYmd: string): number {
  const [y1, m1, d1] = dormancyYmd.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = todayYmd.slice(0, 10).split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) months -= 1;
  return Math.max(0, months);
}

export async function purgeDormantCenterOperationalData(
  supabase: SupabaseClient,
  centerId: string,
): Promise<{ deleted: string[]; errors: string[] }> {
  const deleted: string[] = [];
  const errors: string[] = [];

  const runDelete = async (label: string, op: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await op;
    if (error) errors.push(`${label}: ${error.message}`);
    else deleted.push(label);
  };

  await runDelete('attendance_scans', supabase.from('attendance_scans').delete().eq('center_id', centerId));
  await runDelete('payments', supabase.from('payments').delete().eq('center_id', centerId));

  const { data: groups } = await supabase.from('student_groups').select('id').eq('center_id', centerId);
  const gids = (groups ?? []).map((g: { id: string }) => g.id);
  if (gids.length > 0) {
    await runDelete(
      'student_group_members',
      supabase.from('student_group_members').delete().in('group_id', gids),
    );
  }

  await runDelete('students', supabase.from('students').delete().eq('center_id', centerId));
  await runDelete('student_groups', supabase.from('student_groups').delete().eq('center_id', centerId));
  await runDelete('schedule_slots', supabase.from('schedule_slots').delete().eq('center_id', centerId));
  await runDelete('rooms', supabase.from('rooms').delete().eq('center_id', centerId));
  await runDelete('paid_parents', supabase.from('paid_parents').delete().eq('center_id', centerId));
  await runDelete('announcement_blasts', supabase.from('announcement_blasts').delete().eq('center_id', centerId));
  // card_order_events no longer cascades from card_orders (append-only history
  // rule), so the purge clears the events for this center's orders explicitly.
  const { data: orders } = await supabase.from('card_orders').select('id').eq('center_id', centerId);
  const orderIds = (orders ?? []).map((o: { id: string }) => o.id);
  if (orderIds.length > 0) {
    await runDelete(
      'card_order_events',
      supabase.from('card_order_events').delete().in('card_order_id', orderIds),
    );
  }
  await runDelete('card_orders', supabase.from('card_orders').delete().eq('center_id', centerId));

  const { error: ppErr } = await supabase.from('parent_pack_monthly_counts').delete().eq('center_id', centerId);
  if (!ppErr) deleted.push('parent_pack_monthly_counts');

  return { deleted, errors };
}
