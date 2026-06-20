const BOSTA_BASE = 'https://app.bosta.co/api/v2';

export interface BostaCreatePayload {
  centerPhone: string;
  centerAddress: string;
  centerCity: string;
  vendorPhone: string;
  vendorAddress: string;
  vendorCity: string;
  quantity: number;
  reference: string;
  notes?: string;
}

export interface BostaCreateResult {
  success: boolean;
  trackingNumber?: string;
  bostaOrderId?: string;
  error?: string;
}

export async function fetchBostaDeliveryByTracking(trackingNumber: string): Promise<{
  ok: boolean;
  stateCode?: string;
  raw?: unknown;
  error?: string;
}> {
  const tn = trackingNumber.trim();
  if (!tn) return { ok: false, error: 'missing_tracking' };

  try {
    const apiKey = process.env.BOSTA_API_KEY;
    if (!apiKey) {
      return { ok: false, error: 'BOSTA_API_KEY missing' };
    }

    const res = await fetch(`${BOSTA_BASE}/deliveries/business/${encodeURIComponent(tn)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    const raw = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      return {
        ok: false,
        error: typeof raw.message === 'string' ? raw.message : `HTTP ${res.status}`,
        raw,
      };
    }

    const stateObj =
      (raw.state as Record<string, unknown> | undefined) ??
      (raw.State as Record<string, unknown> | undefined);
    const codeRaw =
      stateObj?.code ??
      stateObj?.value ??
      raw.state ??
      raw.type ??
      raw.Status ??
      raw.currentState;
    const stateCode =
      typeof codeRaw === 'string'
        ? codeRaw.toUpperCase().replace(/-/g, '_').trim()
        : codeRaw != null
          ? String(codeRaw).toUpperCase().replace(/-/g, '_').trim()
          : '';

    return { ok: true, stateCode: stateCode || undefined, raw };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createBostaDelivery(payload: BostaCreatePayload): Promise<BostaCreateResult> {
  try {
    const apiKey = process.env.BOSTA_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'BOSTA_API_KEY missing' };
    }

    const res = await fetch(`${BOSTA_BASE}/deliveries`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 10,
        specs: {
          packageType: 'Parcel',
          size: 'SMALL',
          itemsCount: payload.quantity,
        },
        receiver: {
          name: 'TutoringHQ Customer',
          phone: payload.centerPhone.replace(/[^0-9]/g, ''),
          address: {
            firstLine: payload.centerAddress,
            city: payload.centerCity || 'Cairo',
          },
        },
        dropOffAddress: {
          firstLine: payload.vendorAddress,
          city: payload.vendorCity || 'Cairo',
          phone: payload.vendorPhone.replace(/[^0-9]/g, ''),
        },
        businessReference: payload.reference,
        notes: payload.notes ?? '',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[bosta] Create delivery failed:', err);
      return { success: false, error: err };
    }

    const data = (await res.json()) as { trackingNumber?: string; _id?: string };

    return {
      success: true,
      trackingNumber: data.trackingNumber ?? data._id,
      bostaOrderId: data._id,
    };
  } catch (err) {
    console.error('[bosta] Error:', err);
    return { success: false, error: String(err) };
  }
}
