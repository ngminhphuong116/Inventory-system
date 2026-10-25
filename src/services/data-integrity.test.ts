import { describe, expect, it } from 'vitest';
import {
  assertValidPathSegment,
  createOperationId,
  formatFirebaseError,
  normalizeOptionalText,
  normalizeProductCode,
  parseSafeNumber,
} from './data-integrity';

describe('Firebase path segment validation', () => {
  it.each(['', '   '])('rejects an empty segment: %j', (value) => {
    expect(() => assertValidPathSegment(value, 'companyId'))
      .toThrowError(/companyId không được để trống/);
  });

  it.each(['a.b', 'a#b', 'a$b', 'a[b', 'a]b', 'a/b'])(
    'rejects a forbidden Firebase key character in %s',
    (value) => {
      expect(() => assertValidPathSegment(value, 'categoryId'))
        .toThrowError(/categoryId chứa ký tự không hợp lệ/);
    },
  );

  it('keeps valid stable IDs unchanged', () => {
    expect(assertValidPathSegment('-Oabc_123', 'productId')).toBe('-Oabc_123');
    expect(createOperationId()).toMatch(/^[^.#$[\]/]+$/);
  });
});

describe('data normalization', () => {
  it('normalizes optional text without inventing fallback data', () => {
    expect(normalizeOptionalText(undefined)).toBe('');
    expect(normalizeOptionalText('  Nhà   cung cấp A  ')).toBe('Nhà cung cấp A');
    expect(normalizeOptionalText('Nhóm A.#$[]')).toBe('Nhóm A.#$[]');
  });

  it('normalizes product codes and rejects blank codes', () => {
    expect(normalizeProductCode('  vp-001 ')).toBe('VP-001');
    expect(() => normalizeProductCode('   ')).toThrowError(/không được để trống/);
  });

  it.each([
    ['1.234', 1234],
    ['1,234', 1234],
    ['125000', 125000],
    [500, 500],
  ])('parses a safe Vietnamese-formatted integer: %j', (value, expected) => {
    expect(parseSafeNumber(value, 'Giá bán', { min: 0 })).toBe(expected);
  });

  it('rejects unsafe, negative and non-numeric values', () => {
    expect(() => parseSafeNumber(-1, 'Số lượng', { min: 0 })).toThrow();
    expect(() => parseSafeNumber('abc', 'Số lượng', { min: 0 })).toThrow();
    expect(() => parseSafeNumber(Number.MAX_VALUE, 'Số lượng', { min: 0 })).toThrow();
  });

  it('formats known Firebase failures without exposing sensitive messages', () => {
    expect(formatFirebaseError({ code: 'database/permission-denied' }))
      .toMatch(/không có quyền/);
    expect(formatFirebaseError({ message: 'token secret=abc' }))
      .not.toContain('abc');
  });
});
