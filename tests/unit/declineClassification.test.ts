import { describe, it, expect } from 'vitest';
import { classifyPaymobDecline } from '@/lib/savedCard/declineClassification';

describe('classifyPaymobDecline', () => {
  it('routes 3DS / OTP / authentication-required declines to the OTP fallback (auth_required)', () => {
    expect(classifyPaymobDecline({ message: '3DS authentication required' })).toBe('auth_required');
    expect(classifyPaymobDecline({ message: 'OTP not provided' })).toBe('auth_required');
    expect(classifyPaymobDecline({ code: '3DS' })).toBe('auth_required');
    // The bank's catch-all refusal of an unauthenticated MIT.
    expect(classifyPaymobDecline({ code: '05', message: 'Do not honour' })).toBe('auth_required');
  });

  it('classifies a dead/unusable card as hard_final (no retry, needs new card)', () => {
    expect(classifyPaymobDecline({ code: '54', message: 'Expired card' })).toBe('hard_final');
    expect(classifyPaymobDecline({ code: '43', message: 'Stolen card' })).toBe('hard_final');
    expect(classifyPaymobDecline({ message: 'invalid card' })).toBe('hard_final');
  });

  it('classifies transient declines as soft_retryable', () => {
    expect(classifyPaymobDecline({ code: '51', message: 'Insufficient funds' })).toBe('soft_retryable');
    expect(classifyPaymobDecline({ code: '91', message: 'Issuer unavailable' })).toBe('soft_retryable');
    expect(classifyPaymobDecline({ message: 'Please try again later' })).toBe('soft_retryable');
  });

  it('defaults an unknown decline to the safe manual fallback (auth_required), never a blind retry', () => {
    expect(classifyPaymobDecline({ code: 'ZZZ', message: 'mysterious' })).toBe('auth_required');
    expect(classifyPaymobDecline({})).toBe('auth_required');
  });
});
