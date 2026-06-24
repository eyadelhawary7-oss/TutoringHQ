import { describe, it, expect } from 'vitest';
import { isPaymobTokenCallback } from '@/lib/savedCard/handleTokenCallback';
import { parsePaymobTokenCallback } from '@/lib/savedCard/saveCard';

describe('isPaymobTokenCallback — webhook routing (2f)', () => {
  it('detects a TOKEN-typed callback', () => {
    expect(isPaymobTokenCallback({ type: 'TOKEN', obj: { token: 'tok', masked_pan: '1111' } })).toBe(true);
  });

  it('detects a token payload by shape (token + masked pan), no type field', () => {
    expect(isPaymobTokenCallback({ obj: { token: 'tok_x', masked_pan: '512345xxxxxx2346' } })).toBe(true);
  });

  it('does NOT treat a normal transaction callback as a token callback', () => {
    expect(isPaymobTokenCallback({ obj: { id: 9, success: true, order: { id: 1 } } })).toBe(false);
  });
});

describe('parsePaymobTokenCallback — token capture extracts last4, never the PAN (2f)', () => {
  it('parses a real-shaped TOKEN callback obj', () => {
    const card = parsePaymobTokenCallback({
      id: 123,
      token: 'tok_abc',
      masked_pan: '400000xxxxxx4242',
      card_subtype: 'Visa',
      order_id: 'ord_9',
      exp_month: 9,
      exp_year: 31,
    });
    expect(card).not.toBeNull();
    expect(card!.token).toBe('tok_abc');
    expect(card!.last4).toBe('4242');
    expect(card!.expYear).toBe(2031);
    expect(JSON.stringify(card)).not.toContain('400000');
  });
});
