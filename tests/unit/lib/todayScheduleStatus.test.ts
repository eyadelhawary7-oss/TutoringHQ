import { describe, it, expect } from 'vitest';
import { classifyTodaySchedule } from '@/lib/todayScheduleStatus';

describe('classifyTodaySchedule', () => {
  it('marks a slot billed once its end_time has passed', () => {
    const result = classifyTodaySchedule(
      [{ id: 'a', start_time: '08:00:00', end_time: '09:00:00' }],
      10 * 60,
    );
    expect(result.get('a')).toBe('billed');
  });

  it('marks the single soonest not-yet-ended slot as next', () => {
    const slots = [
      { id: 'later1', start_time: '18:00:00', end_time: '19:00:00' },
      { id: 'next', start_time: '14:00:00', end_time: '16:00:00' },
      { id: 'later2', start_time: '16:30:00', end_time: '17:30:00' },
      { id: 'billed', start_time: '08:00:00', end_time: '09:00:00' },
    ];
    const result = classifyTodaySchedule(slots, 10 * 60);
    expect(result.get('billed')).toBe('billed');
    expect(result.get('next')).toBe('next');
    expect(result.get('later1')).toBe('later');
    expect(result.get('later2')).toBe('later');
  });

  it('treats a slot in progress (started, not yet ended) as not-yet-over', () => {
    // 14:30 is inside 14:00-16:00, so this slot has not "ended" - it should
    // still be eligible to be picked as `next`, not `billed`.
    const result = classifyTodaySchedule(
      [{ id: 'inProgress', start_time: '14:00:00', end_time: '16:00:00' }],
      14 * 60 + 30,
    );
    expect(result.get('inProgress')).toBe('next');
  });

  it('picks the earliest start among several not-yet-ended slots as next', () => {
    const slots = [
      { id: 'x', start_time: '12:00:00', end_time: '13:00:00' },
      { id: 'y', start_time: '11:00:00', end_time: '12:30:00' },
    ];
    const result = classifyTodaySchedule(slots, 10 * 60);
    expect(result.get('y')).toBe('next');
    expect(result.get('x')).toBe('later');
  });

  it('returns an empty map for an empty schedule', () => {
    const result = classifyTodaySchedule([], 10 * 60);
    expect(result.size).toBe(0);
  });

  it('marks every slot billed once the whole day has passed', () => {
    const slots = [
      { id: 'a', start_time: '08:00:00', end_time: '09:00:00' },
      { id: 'b', start_time: '10:00:00', end_time: '11:00:00' },
    ];
    const result = classifyTodaySchedule(slots, 23 * 60);
    expect(result.get('a')).toBe('billed');
    expect(result.get('b')).toBe('billed');
  });
});
