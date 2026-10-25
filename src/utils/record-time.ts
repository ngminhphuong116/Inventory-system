const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const TIME_FIELDS = [
  'createdAt',
  'updatedAt',
  'timestamp',
  'date',
  'importDate',
  'exportDate',
  'saleDate',
] as const;

function vietnamWallClockTimestamp(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
    || check.getUTCHours() !== hour
    || check.getUTCMinutes() !== minute
    || check.getUTCSeconds() !== second
  ) return 0;
  return utc - VIETNAM_OFFSET_MS;
}

export function parseRecordTimestamp(value: unknown): number {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value < 100_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  if (!text) return 0;
  if (/^\d{10,13}$/.test(text)) return parseRecordTimestamp(Number(text));

  const yearFirst = text.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (yearFirst) {
    return vietnamWallClockTimestamp(
      Number(yearFirst[1]),
      Number(yearFirst[2]),
      Number(yearFirst[3]),
      Number(yearFirst[4] || 0),
      Number(yearFirst[5] || 0),
      Number(yearFirst[6] || 0),
    );
  }

  const dayFirst = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (dayFirst) {
    return vietnamWallClockTimestamp(
      Number(dayFirst[3]),
      Number(dayFirst[2]),
      Number(dayFirst[1]),
      Number(dayFirst[4] || 0),
      Number(dayFirst[5] || 0),
      Number(dayFirst[6] || 0),
    );
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function resolveRecordTimestamp(record: Record<string, unknown>) {
  for (const field of TIME_FIELDS) {
    const timestamp = parseRecordTimestamp(record[field]);
    if (timestamp) return timestamp;
  }
  return 0;
}

export function withSortTimestamp<T extends object>(record: T): T & { sortTimestamp: number } {
  return {
    ...record,
    sortTimestamp: resolveRecordTimestamp(record as Record<string, unknown>),
  };
}

function recordKey(record: Record<string, unknown>) {
  return String(record.key ?? record.id ?? '');
}

function normalizedSortTimestamp(record: Record<string, unknown>) {
  const stored = Number(record.sortTimestamp);
  return Number.isFinite(stored) && stored > 0
    ? stored
    : resolveRecordTimestamp(record);
}

export function sortRecordsNewestFirst<T extends object>(records: T[]): T[] {
  return [...records].sort((left, right) => {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const primary = normalizedSortTimestamp(b) - normalizedSortTimestamp(a);
    if (primary) return primary;
    const created = parseRecordTimestamp(b.createdAt) - parseRecordTimestamp(a.createdAt);
    if (created) return created;
    const updated = parseRecordTimestamp(b.updatedAt) - parseRecordTimestamp(a.updatedAt);
    if (updated) return updated;
    return recordKey(b).localeCompare(recordKey(a));
  });
}

export function paginateSortedRecords<T>(
  records: T[],
  page: number,
  pageSize: number,
) {
  const start = Math.max(0, page - 1) * pageSize;
  return records.slice(start, start + pageSize);
}

export function formatRecordTimeVi(record: Record<string, unknown>) {
  const timestamp = resolveRecordTimestamp(record);
  if (!timestamp) return 'Không xác định';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

export function recordVietnamDateKey(record: Record<string, unknown>) {
  const timestamp = resolveRecordTimestamp(record);
  if (!timestamp) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
