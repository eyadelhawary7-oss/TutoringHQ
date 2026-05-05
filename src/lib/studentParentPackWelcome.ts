import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import { WA_TEMPLATES } from '@/lib/parentPack';

export async function syncParentPackActiveParentsForCenter(
  supabaseAdmin: SupabaseClient,
  centerId: string,
): Promise<void> {
  const { count } = await supabaseAdmin
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('center_id', centerId)
    .eq('parent_pack_opted_in', true)
    .not('parent_phone', 'is', null)
    .eq('is_active', true);

  await supabaseAdmin
    .from('centers')
    .update({ parent_pack_active_parents: count ?? 0 })
    .eq('id', centerId);
}

/**
 * After student create/update from /api/db: optional welcome + always refresh active parent count.
 */
export async function afterStudentWriteParentPackEffects(
  supabaseAdmin: SupabaseClient,
  args:
    | {
        kind: 'insert';
        centerId: string;
        skipParentWelcome?: boolean;
        row: {
          id: string;
          name: string;
          parent_phone: string | null;
          parent_pack_opted_in?: boolean | null;
        };
      }
    | {
        kind: 'update';
        centerId: string;
        studentId: string;
        body: Record<string, unknown>;
        prev: { parent_pack_opted_in: boolean | null; parent_phone: string | null } | null;
        row: {
          id: string;
          name: string;
          parent_phone: string | null;
          parent_pack_opted_in?: boolean | null;
        };
      },
): Promise<void> {
  if (args.kind === 'insert') {
    const shouldSendWelcome =
      args.row.parent_pack_opted_in === true && !!args.row.parent_phone?.trim();

    if (shouldSendWelcome && !args.skipParentWelcome) {
      const { data: ctr } = await supabaseAdmin
        .from('centers')
        .select('name, parent_pack_enabled')
        .eq('id', args.centerId)
        .maybeSingle();

      if (ctr?.parent_pack_enabled === true) {
        await sendTemplateMessage(args.centerId, args.row.parent_phone!, WA_TEMPLATES.PARENT_WELCOME, {
          '1': args.row.name,
          '2': ctr?.name ?? '',
          '3': args.row.name,
        });
      }
    }
    await syncParentPackActiveParentsForCenter(supabaseAdmin, args.centerId);
    return;
  }

  const optedIn = args.body.parent_pack_opted_in === true;
  if (!optedIn) {
    await syncParentPackActiveParentsForCenter(supabaseAdmin, args.centerId);
    return;
  }

  const phoneRaw =
    args.body.parent_phone !== undefined
      ? (args.body.parent_phone as string | null)
      : args.prev?.parent_phone;
  const phone = phoneRaw?.trim() ? phoneRaw : null;

  const shouldSendWelcome =
    optedIn && args.prev?.parent_pack_opted_in !== true && !!phone;

  if (shouldSendWelcome) {
    const { data: ctr } = await supabaseAdmin
      .from('centers')
      .select('name, parent_pack_enabled')
      .eq('id', args.centerId)
      .maybeSingle();

    if (ctr?.parent_pack_enabled === true) {
      await sendTemplateMessage(args.centerId, phone!, WA_TEMPLATES.PARENT_WELCOME, {
        '1': args.row.name,
        '2': ctr?.name ?? '',
        '3': args.row.name,
      });
    }
  }

  await syncParentPackActiveParentsForCenter(supabaseAdmin, args.centerId);
}

/** Row toggle on students list (PATCH /api/parent-pack/student/[id]). */
export async function afterStudentPackToggle(
  supabaseAdmin: SupabaseClient,
  centerId: string,
  student: {
    name: string;
    parent_phone: string | null;
  },
  optedIn: boolean,
  prevOptedIn: boolean | null,
): Promise<void> {
  const { data: ctr } = await supabaseAdmin
    .from('centers')
    .select('name, parent_pack_enabled')
    .eq('id', centerId)
    .maybeSingle();

  if (
    optedIn &&
    prevOptedIn !== true &&
    !!student.parent_phone?.trim() &&
    ctr?.parent_pack_enabled === true
  ) {
    await sendTemplateMessage(centerId, student.parent_phone!, WA_TEMPLATES.PARENT_WELCOME, {
      '1': student.name,
      '2': ctr?.name ?? '',
      '3': student.name,
    });
  }
  await syncParentPackActiveParentsForCenter(supabaseAdmin, centerId);
}
