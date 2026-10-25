export const toSafeNumber = (value: unknown, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const formatNumberVi = (value: unknown) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(toSafeNumber(value));

export const formatVnd = (value: unknown) => `${formatNumberVi(value)} ₫`;

export const parseVndInput = (value?: string) => {
  const normalized = String(value || '').replace(/[^\d-]/g, '');
  return Number(normalized) || 0;
};

export const formatDateTimeVi = (value?: string | number) => {
  if (value === undefined || value === null || value === '') return '---';
  if (typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isFinite(value) || Number.isNaN(date.getTime())) return '---';
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!match) return value.trim() || '---';
  const parsed = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0),
  );
  if (
    parsed.getFullYear() !== Number(match[1]) ||
    parsed.getMonth() !== Number(match[2]) - 1 ||
    parsed.getDate() !== Number(match[3]) ||
    parsed.getHours() !== Number(match[4] || 0) ||
    parsed.getMinutes() !== Number(match[5] || 0)
  ) return '---';
  return `${match[3]}/${match[2]}/${match[1]}${match[4] ? ` ${match[4]}:${match[5]}` : ''}`;
};
