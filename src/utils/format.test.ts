import { describe, expect, it } from 'vitest';
import { formatDateTimeVi, formatNumberVi, formatVnd, toSafeNumber } from './format';

describe('safe display formatting', () => {
  it.each([
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    ['not-a-number', 0],
    ['1234', 1234],
    [undefined, 0],
  ])('converts %p to a finite number', (value, expected) => {
    expect(toSafeNumber(value)).toBe(expected);
  });

  it('never displays NaN or Infinity as a number or currency', () => {
    expect(formatNumberVi(Number.NaN)).toBe('0');
    expect(formatVnd(Number.POSITIVE_INFINITY)).toBe('0 ₫');
  });

  it('formats valid date values and rejects invalid calendar dates', () => {
    expect(formatDateTimeVi('2026-07-26 09:30')).toBe('26/07/2026 09:30');
    expect(formatDateTimeVi('2026-02-31 09:30')).toBe('---');
    expect(formatDateTimeVi(Number.NaN)).toBe('---');
  });

  it('uses a neutral placeholder for missing values', () => {
    expect(formatDateTimeVi()).toBe('---');
    expect(formatDateTimeVi('')).toBe('---');
  });
});
