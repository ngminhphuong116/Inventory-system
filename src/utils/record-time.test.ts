import { describe, expect, it } from 'vitest';
import {
  formatRecordTimeVi,
  paginateSortedRecords,
  parseRecordTimestamp,
  sortRecordsNewestFirst,
  withSortTimestamp,
} from './record-time';

describe('legacy record time normalization', () => {
  it('sorts records on the same day by time descending', () => {
    const result = sortRecordsNewestFirst([
      { key: 'early', date: '26/07/2026 08:00' },
      { key: 'late', date: '26/07/2026 18:30' },
    ]);
    expect(result.map((item) => item.key)).toEqual(['late', 'early']);
  });

  it('sorts correctly across months instead of comparing display strings', () => {
    const result = sortRecordsNewestFirst([
      { key: 'june', date: '20/06/2026 10:00' },
      { key: 'july', date: '01/07/2026 09:00' },
    ]);
    expect(result[0].key).toBe('july');
  });

  it('normalizes Unix seconds and milliseconds to the same instant', () => {
    expect(parseRecordTimestamp(1_721_980_800)).toBe(1_721_980_800_000);
    expect(parseRecordTimestamp(1_721_980_800_000)).toBe(1_721_980_800_000);
  });

  it('parses ISO, yyyy-MM-dd and dd/MM/yyyy formats', () => {
    expect(parseRecordTimestamp('2026-07-26T03:00:00.000Z')).toBeGreaterThan(0);
    expect(parseRecordTimestamp('2026-07-26 10:00')).toBeGreaterThan(0);
    expect(parseRecordTimestamp('26/07/2026 10:00')).toBeGreaterThan(0);
  });

  it('pushes missing or invalid time to the end with a clear fallback', () => {
    const result = sortRecordsNewestFirst([
      { key: 'missing' },
      { key: 'valid', createdAt: 1_721_980_800_000 },
      { key: 'invalid', date: '31/02/2026 10:00' },
    ]);
    expect(result[0].key).toBe('valid');
    expect(withSortTimestamp({ key: 'missing' }).sortTimestamp).toBe(0);
    expect(formatRecordTimeVi({ date: 'not-a-date' })).toBe('Không xác định');
  });

  it('applies pagination after sorting', () => {
    const sorted = sortRecordsNewestFirst([
      { key: 'one', createdAt: 1 },
      { key: 'three', createdAt: 3 },
      { key: 'two', createdAt: 2 },
    ]);
    expect(paginateSortedRecords(sorted, 2, 2).map((item) => item.key)).toEqual(['one']);
  });

  it('sorts records that have already been normalized to sortTimestamp', () => {
    const sorted = sortRecordsNewestFirst([
      { key: 'older', sortTimestamp: 100 },
      { key: 'newer', sortTimestamp: 200 },
    ]);
    expect(sorted.map((item) => item.key)).toEqual(['newer', 'older']);
  });
});
