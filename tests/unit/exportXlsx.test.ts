import { describe, expect, it } from 'vitest';
import { buildDashboardExcelBuffer } from '@/lib/excel-export';

describe('export xlsx (exceljs)', () => {
  it('buildDashboardExcelBuffer produces non-empty PK ZIP (Open XML)', async () => {
    const buf = await buildDashboardExcelBuffer({
      students: [
        {
          id: '1',
          name: 'سنتر تجريبي',
          phone: '+201234567890',
          parent_phone: '',
          subject: 'Math',
          balance: 0,
          qr_code: 'QR1',
        },
      ],
      attendance: [{ student_name: 'أحمد', scanned_at: new Date().toISOString(), payment_status_at_scan: 'paid' }],
      payments: [{ student_name: 'أحمد', amount: 1500, method: 'cash', paid_at: new Date().toISOString(), recorded_by: 'admin' }],
    });

    const u8 = new Uint8Array(buf instanceof ArrayBuffer ? buf : new Uint8Array(buf));
    expect(u8.byteLength).toBeGreaterThan(0);
    expect(u8[0]).toBe(0x50);
    expect(u8[1]).toBe(0x4b);
    expect(u8[2]).toBe(0x03);
    expect(u8[3]).toBe(0x04);
  });
});
