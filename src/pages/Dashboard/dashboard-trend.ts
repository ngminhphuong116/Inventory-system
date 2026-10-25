export const DASHBOARD_HISTORY_DAYS = 30;
export const DASHBOARD_VISIBLE_DAYS = 7;

export type OperationTrendType = 'Nhập kho' | 'Xuất kho' | 'Bán hàng';

export interface OperationTrendRecord {
  dateKey: string;
  activityType: OperationTrendType;
}

export interface OperationTrendPoint {
  key: string;
  weekday: string;
  shortDate: string;
  'Nhập kho': number;
  'Xuất kho': number;
  'Bán hàng': number;
}

const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function dateFromLocalKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return localDateKey(date) === dateKey ? date : null;
}

export function formatFullTrendDate(dateKey: string) {
  const date = dateFromLocalKey(dateKey);
  if (!date) return dateKey;
  const weekday = new Intl.DateTimeFormat('vi-VN', { weekday: 'long' }).format(date);
  const calendarDate = new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
  return `${weekday.charAt(0).toLocaleUpperCase('vi-VN')}${weekday.slice(1)}, ${calendarDate}`;
}

export function formatTrendRange(points: readonly OperationTrendPoint[]) {
  if (points.length === 0) return 'Chưa có khoảng ngày';
  const format = (point: OperationTrendPoint) => point.key.split('-').reverse().join('/');
  return `${format(points[0])} – ${format(points[points.length - 1])}`;
}

export function buildOperationTrendData(
  records: readonly OperationTrendRecord[],
  today = new Date(),
  historyDays = DASHBOARD_HISTORY_DAYS,
): OperationTrendPoint[] {
  const safeHistoryDays = Math.max(1, Math.trunc(historyDays));
  const totals = new Map<string, Record<OperationTrendType, number>>();

  records.forEach((record) => {
    const current = totals.get(record.dateKey) || {
      'Nhập kho': 0,
      'Xuất kho': 0,
      'Bán hàng': 0,
    };
    current[record.activityType] += 1;
    totals.set(record.dateKey, current);
  });

  return Array.from({ length: safeHistoryDays }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    date.setDate(date.getDate() - (safeHistoryDays - 1 - index));
    const key = localDateKey(date);
    const values = totals.get(key);
    return {
      key,
      weekday: WEEKDAY_LABELS[date.getDay()],
      shortDate: `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`,
      'Nhập kho': values?.['Nhập kho'] ?? 0,
      'Xuất kho': values?.['Xuất kho'] ?? 0,
      'Bán hàng': values?.['Bán hàng'] ?? 0,
    };
  });
}

export function clampTrendWindowStart(
  requestedStart: number,
  totalDays: number,
  visibleDays = DASHBOARD_VISIBLE_DAYS,
) {
  const maxStart = Math.max(0, totalDays - visibleDays);
  return Math.min(maxStart, Math.max(0, Math.trunc(requestedStart)));
}

export function visibleTrendWindow(
  data: readonly OperationTrendPoint[],
  windowStart: number,
  visibleDays = DASHBOARD_VISIBLE_DAYS,
) {
  const start = clampTrendWindowStart(windowStart, data.length, visibleDays);
  return data.slice(start, start + visibleDays);
}
