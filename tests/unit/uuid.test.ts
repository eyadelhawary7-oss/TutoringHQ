import { describe, expect, it } from 'vitest';
import { isUuid, keepValidUuids } from '@/lib/uuid';

describe('isUuid', () => {
  it('accepts a canonical lowercase UUID', () => {
    expect(isUuid('11111111-2222-3333-4444-555555555555')).toBe(true);
  });

  it('accepts an uppercase UUID', () => {
    expect(isUuid('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isUuid('')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid({})).toBe(false);
  });

  it('rejects strings with wrong shape', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('11111111-2222-3333-4444')).toBe(false);
    expect(isUuid('11111111222233334444555555555555')).toBe(false);
  });
});

describe('keepValidUuids', () => {
  it('returns only valid UUIDs from a mixed list', () => {
    const ids = [
      '11111111-2222-3333-4444-555555555555',
      '',
      'not-a-uuid',
      '22222222-3333-4444-5555-666666666666',
      null as unknown as string,
      undefined as unknown as string,
    ];
    expect(keepValidUuids(ids)).toEqual([
      '11111111-2222-3333-4444-555555555555',
      '22222222-3333-4444-5555-666666666666',
    ]);
  });

  it('returns empty array when input is empty', () => {
    expect(keepValidUuids([])).toEqual([]);
  });

  it('returns empty array when no entries are valid', () => {
    expect(keepValidUuids(['', 'bad', null])).toEqual([]);
  });
});
