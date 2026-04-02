export type CardOrderFulfillmentStatus =
  | 'pending'
  | 'confirmed'
  | 'printing'
  | 'shipped'
  | 'delivered';

export interface AdminCardOrderStudent {
  id: string;
  name: string;
  student_number: string;
  qr_code?: string | null;
}

/** Normalized row returned by GET /api/admin/card-orders */
export interface AdminCardOrderRow {
  id: string;
  center_id: string;
  orderNumber: string;
  center_name: string;
  center_phone: string | null;
  center_logo_url: string | null;
  card_color: string;
  students: AdminCardOrderStudent[];
  quantity: number;
  price_per_card: number;
  delivery_fee: number;
  total_amount: number;
  delivery_address: string | null;
  notes: string | null;
  status: CardOrderFulfillmentStatus;
  created_at: string;
  payment_status: string | null;
}
