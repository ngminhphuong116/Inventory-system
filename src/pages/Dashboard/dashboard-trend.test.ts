import { describe, expect, it } from 'vitest';
import {
  buildOperationTrendData,
  clampTrendWindowStart,
  formatFullTrendDate,
  formatTrendRange,
  visibleTrendWindow,
} from './dashboard-trend';

describe('dashboard operation trend', () => {
  const today = new Date(2026, 7, 3, 12, 0, 0);

  it('builds 30 ascending local days and keeps zero-activity days', () => {
    const data = buildOperationTrendData([
      { dateKey: '2026-08-03', activityType: 'Bán hàng' },
      { dateKey: '2026-08-03', activityType: 'Bán hàng' },
      { dateKey: '2026-07-28', activityType: 'Nhập kho' },
    ], today, 30);

    expect(data).toHaveLength(30);
    expect(data[0].key).toBe('2026-07-05');
    expect(data.at(-1)).toMatchObject({ key: '2026-08-03', 'Bán hàng': 2 });
    expect(data.find((point) => point.key === '2026-07-28')).toMatchObject({
      shortDate: '28/07',
      'Nhập kho': 1,
      'Xuất kho': 0,
    });
  });

  it('defaults to the latest seven days and crosses month boundaries safely', () => {
    const data = buildOperationTrendData([], today, 30);
    const maxStart = clampTrendWindowStart(Number.POSITIVE_INFINITY, data.length, 7);
    const visible = visibleTrendWindow(data, maxStart, 7);

    expect(maxStart).toBe(23);
    expect(visible.map((point) => point.key)).toEqual([
      '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31',
      '2026-08-01', '2026-08-02', '2026-08-03',
    ]);
    expect(formatTrendRange(visible)).toBe('28/07/2026 – 03/08/2026');
  });

  it('clamps navigation at the oldest and newest available dates', () => {
    expect(clampTrendWindowStart(-10, 30, 7)).toBe(0);
    expect(clampTrendWindowStart(99, 30, 7)).toBe(23);
  });

  it('formats a full Vietnamese tooltip date', () => {
    expect(formatFullTrendDate('2026-07-28')).toContain('28/07/2026');
  });
});
