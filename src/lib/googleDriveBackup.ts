import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { isTemplateApproved } from '@/lib/centerNotify';
import { tCronBackup as tBackup } from '@/lib/cronBackupI18n';
import { formatNumber } from '@/lib/formatNumber';

/** Gate backup-complete WA on internal ops template in Meta registry. */
const BACKUP_COMPLETE_WA_TEMPLATE = 'chq_internal_churn_alert';

const WHATSAPP_META_TEST_PHONE_NUMBER_ID = '1013787185158313';

function waPhoneNumberId(): string | null {
  return process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID || null;
}

function shouldSkipWaForTestPhoneId(): boolean {
  const phoneId = waPhoneNumberId();
  return !phoneId || phoneId === WHATSAPP_META_TEST_PHONE_NUMBER_ID;
}

async function waSendingEnabled(client: SupabaseClient): Promise<boolean> {
  const { data: cfg } = await client
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  return cfg?.value !== false;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type DriveClient = ReturnType<typeof google.drive>;

function getDriveClient(): DriveClient {
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
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ];
  return lines.join('\n');
}

async function uploadToDrive(
  drive: DriveClient,
  folderId: string,
  filename: string,
  content: string,
): Promise<string> {
  const stream = Readable.from([content]);
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
      mimeType: 'text/csv',
    },
    media: {
      mimeType: 'text/csv',
      body: stream,
    },
    fields: 'id,name,size',
  });
  return res.data.id ?? '';
}

async function getOrCreateFolder(
  drive: DriveClient,
  parentId: string,
  name: string,
): Promise<string> {
  const existing = await drive.files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
  });
  if (existing.data.files && existing.data.files.length > 0) {
    return existing.data.files[0].id!;
  }
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });
  return created.data.id!;
}

const FULL_EXPORT_TABLES = [
  'centers',
  'invoices',
  'payments',
  'renewal_history',
  'commissions',
  'commission_payouts',
  'commission_audit_log',
  'referrals',
  'referral_reward_records',
  'staff',
  'center_assignments',
  'plan_requests',
  'withdrawal_requests',
  'card_orders',
  'student_groups',
  'users',
] as const;

const RECENT_EXPORT_TABLES = [
  { table: 'students', dateCol: 'created_at', days: 36500 },
  { table: 'attendance_scans', dateCol: 'scanned_at', days: 90 },
  { table: 'audit_log', dateCol: 'created_at', days: 90 },
] as const;

export interface BackupResult {
  type: 'weekly' | 'monthly';
  date: string;
  folderId: string;
  files: Array<{ table: string; rows: number; fileId: string }>;
  totalRows: number;
  errors: string[];
  durationMs: number;
}

export async function runBackup(type: 'weekly' | 'monthly'): Promise<BackupResult> {
  const startTime = Date.now();
  const rootFolderId = process.env.BACKUP_DRIVE_FOLDER_ID;
  const today = new Date().toISOString().split('T')[0];
  const monthLabel = today.slice(0, 7);

  if (!rootFolderId) {
    throw new Error(tBackup('errorMissingDriveFolder'));
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error(tBackup('errorMissingGoogleCredentials'));
  }

  const drive = getDriveClient();

  const typeFolderId = await getOrCreateFolder(drive, rootFolderId, type);

  const dateFolderName = type === 'weekly' ? today : monthLabel;
  const dateFolderId = await getOrCreateFolder(drive, typeFolderId, dateFolderName);

  const files: BackupResult['files'] = [];
  const errors: string[] = [];

  for (const table of FULL_EXPORT_TABLES) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .order('id', { ascending: true })
        .limit(500000);

      if (error) {
        errors.push(`${table}: ${error.message}`);
        continue;
      }

      const rows = data ?? [];
      const csv = toCSV(rows as Record<string, unknown>[]);
      const fileId = await uploadToDrive(drive, dateFolderId, `${table}.csv`, csv);
      files.push({ table, rows: rows.length, fileId });
    } catch (err) {
      errors.push(`${table}: ${String(err)}`);
    }
  }

  for (const { table, dateCol, days } of RECENT_EXPORT_TABLES) {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const { data, error } = await supabase
        .from(table)
        .select('*')
        .gte(dateCol, since.toISOString())
        .order(dateCol, { ascending: true })
        .limit(500000);

      if (error) {
        errors.push(`${table}: ${error.message}`);
        continue;
      }

      const rows = data ?? [];
      const csv = toCSV(rows as Record<string, unknown>[]);
      const label = days >= 36500 ? 'full' : `last${days}d`;
      const fileId = await uploadToDrive(drive, dateFolderId, `${table}_${label}.csv`, csv);
      files.push({ table, rows: rows.length, fileId });
    } catch (err) {
      errors.push(`${table}: ${String(err)}`);
    }
  }

  const totalRows = files.reduce((s, f) => s + f.rows, 0);
  const durationMs = Date.now() - startTime;

  return {
    type,
    date: today,
    folderId: dateFolderId,
    files,
    totalRows,
    errors,
    durationMs,
  };
}

export async function notifyBackupComplete(result: BackupResult): Promise<void> {
  const phone = process.env.BACKUP_NOTIFY_PHONE;
  if (!phone) return;

  const typeLabel =
    result.type === 'weekly' ? tBackup('waTypeWeekly') : tBackup('waTypeMonthly');
  const title =
    result.errors.length === 0 ? tBackup('waTitleSuccess') : tBackup('waTitlePartial');
  const duration = (result.durationMs / 1000).toFixed(1);
  const fileCount = result.files.length;
  const totalRows = formatNumber(result.totalRows, 'ar');

  const lines = [
    title,
    tBackup('waLineType', { type: typeLabel }),
    tBackup('waLineDate', { date: result.date }),
    tBackup('waLineFiles', { count: fileCount }),
    tBackup('waLineRows', { total: totalRows }),
    tBackup('waLineDuration', { seconds: duration }),
  ];

  if (result.errors.length > 0) {
    lines.push(
      tBackup('waLineErrors', {
        count: result.errors.length,
        list: result.errors.slice(0, 3).join(', '),
      }),
    );
  }

  lines.push(tBackup('waLineDrive', { folderId: result.folderId }));

  const message = lines.join('\n');

  try {
    if (!(await isTemplateApproved(BACKUP_COMPLETE_WA_TEMPLATE, supabase))) {
      console.warn(
        `[googleDriveBackup] skipped — template not approved: ${BACKUP_COMPLETE_WA_TEMPLATE}`,
      );
      return;
    }

    if (!(await waSendingEnabled(supabase))) {
      console.warn('[googleDriveBackup] skipped — wa_sending_enabled is false');
      return;
    }

    if (shouldSkipWaForTestPhoneId()) {
      console.warn(
        '[googleDriveBackup] skipped — Meta test PHONE_NUMBER_ID or missing phone number ID',
      );
      return;
    }

    const phoneId = waPhoneNumberId();
    const token = process.env.WHATSAPP_TOKEN;
    if (!phoneId || !token) {
      console.warn('[googleDriveBackup] skipped — missing WHATSAPP_TOKEN or phone number ID');
      return;
    }

    await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: message },
      }),
    });
  } catch {
    console.error(tBackup('logWaFailed'));
  }
}
