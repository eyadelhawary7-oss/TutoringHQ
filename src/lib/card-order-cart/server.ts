import type { SupabaseClient } from '@supabase/supabase-js';
import { studentIdsFromOrderStudents } from '@/lib/card-order-cart/studentIdsFromOrder';
import {
  CARD_ORDER_DELIVERED_STATUSES,
  CARD_ORDER_PENDING_CARD_STATUSES,
} from '@/lib/card-order-cart/cardOrderStatuses';

export type CartRow = {
  id: string;
  center_id: string;
  status: string;
  card_style: string | null;
  delivery_governorate: string | null;
  delivery_address: string | null;
  delivery_phone: string | null;
  notes: string | null;
  vendor_notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  last_modified_by: string | null;
  last_modified_by_name: string | null;
  submitted_at: string | null;
  abandoned_at: string | null;
  card_order_id: string | null;
};

export type CartItemRow = {
  id: string;
  cart_id: string;
  kind: 'student' | 'blank';
  student_id: string | null;
  quantity: number;
  saved_for_later: boolean;
  added_at: string;
};

export type HydratedCartItem = CartItemRow & {
  student?: {
    name: string | null;
    student_number: string | null;
    is_active: boolean | null;
    center_id: string | null;
  } | null;
  stale: boolean;
};

export type CartPayload = {
  cart: Omit<CartRow, 'center_id'> | null;
  items: HydratedCartItem[];
  minimumQuantity: number;
};

export async function getCardOrderMinimumQty(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from('platform_config').select('value').eq('key', 'card_order_minimum_quantity').maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.round(n);
}

export async function getCartIdleDays(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from('platform_config').select('value').eq('key', 'card_order_cart_idle_days').maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.round(n);
}

export async function fetchActorName(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.from('users').select('name, phone').eq('id', userId).maybeSingle();
  const row = data as { name?: string | null; phone?: string | null } | null;
  if (!row) return null;
  const name = row.name?.trim();
  if (name) return name;
  const phone = row.phone?.trim();
  return phone || null;
}

export async function ensureOpenCartId(admin: SupabaseClient, centerId: string, userId: string): Promise<string> {
  const { data: open } = await admin
    .from('card_order_carts')
    .select('id')
    .eq('center_id', centerId)
    .eq('status', 'open')
    .maybeSingle();

  if (open && typeof (open as { id?: string }).id === 'string') {
    return (open as { id: string }).id;
  }

  const actorName = await fetchActorName(admin, userId);
  const { data: inserted, error } = await admin
    .from('card_order_carts')
    .insert({
      center_id: centerId,
      status: 'open',
      last_modified_by: userId,
      last_modified_by_name: actorName,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    throw new Error(error?.message ?? 'Could not create cart');
  }
  return (inserted as { id: string }).id;
}

export async function setCartActor(admin: SupabaseClient, cartId: string, userId: string): Promise<void> {
  const actorName = await fetchActorName(admin, userId);
  await admin
    .from('card_order_carts')
    .update({
      last_modified_by: userId,
      last_modified_by_name: actorName,
    })
    .eq('id', cartId);
}

export async function purgeStaleCartItemsForCart(admin: SupabaseClient, cartId: string, centerId: string): Promise<void> {
  const { data: items, error } = await admin
    .from('card_order_cart_items')
    .select('id, kind, student_id')
    .eq('cart_id', cartId)
    .eq('kind', 'student');

  if (error || !items?.length) return;

  const staleIds: string[] = [];
  for (const row of items as { id: string; student_id: string | null }[]) {
    const sid = row.student_id;
    if (!sid) {
      staleIds.push(row.id);
      continue;
    }
    const { data: st } = await admin.from('students').select('id, center_id').eq('id', sid).maybeSingle();
    const center = (st as { center_id?: string | null } | null)?.center_id;
    if (!st || center !== centerId) staleIds.push(row.id);
  }

  if (staleIds.length === 0) return;
  await admin.from('card_order_cart_items').delete().in('id', staleIds);
}

/** Best-effort student card fulfillment status for picker / roster (delivered beats pending). */
export async function fetchStudentCardStatusMap(
  admin: SupabaseClient,
  centerId: string,
  studentIds: string[],
): Promise<Record<string, 'none' | 'pending' | 'delivered'>> {
  const out: Record<string, 'none' | 'pending' | 'delivered'> = {};
  for (const id of studentIds) out[id] = 'none';
  if (studentIds.length === 0) return out;

  const { data: orders } = await admin
    .from('card_orders')
    .select('status, students')
    .eq('center_id', centerId)
    .not('status', 'eq', 'cancelled');

  const rows = orders ?? [];
  const delivered = new Set<string>();
  const pending = new Set<string>();

  for (const r of rows as { status?: string; students?: unknown }[]) {
    const status = String(r.status ?? '');
    const ids = studentIdsFromOrderStudents(r.students);
    if (CARD_ORDER_DELIVERED_STATUSES.has(status)) {
      for (const id of ids) delivered.add(id);
    } else if (CARD_ORDER_PENDING_CARD_STATUSES.has(status)) {
      for (const id of ids) pending.add(id);
    }
  }

  for (const id of studentIds) {
    if (delivered.has(id)) out[id] = 'delivered';
    else if (pending.has(id)) out[id] = 'pending';
    else out[id] = 'none';
  }
  return out;
}

export async function buildCartPayload(
  admin: SupabaseClient,
  centerId: string,
  minimumQuantity: number,
): Promise<CartPayload> {
  const { data: cart } = await admin
    .from('card_order_carts')
    .select('*')
    .eq('center_id', centerId)
    .eq('status', 'open')
    .maybeSingle();

  if (!cart) {
    return { cart: null, items: [], minimumQuantity };
  }

  const c = cart as CartRow;
  await purgeStaleCartItemsForCart(admin, c.id, centerId);

  const { data: itemRows } = await admin
    .from('card_order_cart_items')
    .select('*')
    .eq('cart_id', c.id)
    .order('added_at', { ascending: true });

  const rawItems = (itemRows ?? []) as CartItemRow[];
  const studentIds = rawItems.filter((i) => i.kind === 'student' && i.student_id).map((i) => i.student_id as string);

  const studentsById: Record<
    string,
    { name: string | null; student_number: string | null; is_active: boolean | null; center_id: string | null }
  > = {};
  if (studentIds.length > 0) {
    const { data: studs } = await admin
      .from('students')
      .select('id, name, student_number, is_active, center_id')
      .in('id', studentIds);
    for (const s of studs ?? []) {
      const row = s as {
        id: string;
        name: string | null;
        student_number: string | null;
        is_active: boolean | null;
        center_id: string | null;
      };
      studentsById[row.id] = {
        name: row.name,
        student_number: row.student_number,
        is_active: row.is_active,
        center_id: row.center_id,
      };
    }
  }

  const items: HydratedCartItem[] = rawItems.map((row) => {
    const base = { ...row };
    if (row.kind !== 'student' || !row.student_id) {
      return { ...base, student: null, stale: false };
    }
    const st = studentsById[row.student_id];
    if (!st || st.center_id !== centerId) {
      return {
        ...base,
        student: st
          ? { name: st.name, student_number: st.student_number, is_active: st.is_active, center_id: st.center_id }
          : null,
        stale: true,
      };
    }
    return {
      ...base,
      student: {
        name: st.name,
        student_number: st.student_number,
        is_active: st.is_active,
        center_id: st.center_id,
      },
      stale: false,
    };
  });

  const { center_id: _drop, ...cartRest } = c;
  return {
    cart: cartRest,
    items,
    minimumQuantity,
  };
}
