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
          name: 'CenterHQ Customer',
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
