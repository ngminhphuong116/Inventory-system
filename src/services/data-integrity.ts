const FORBIDDEN_FIREBASE_KEY_CHARACTERS = /[.#$[\]/]/;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export class DataValidationError extends Error {
  readonly code = 'invalid-argument';

  constructor(message: string) {
    super(message);
    this.name = 'DataValidationError';
  }
}

export function assertValidPathSegment(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== 'string') {
    throw new DataValidationError(`${fieldName} phải là chuỗi ký tự.`);
  }

  const segment = value.trim();
  if (!segment) {
    throw new DataValidationError(`${fieldName} không được để trống.`);
  }
  if (segment.length > 128) {
    throw new DataValidationError(`${fieldName} không được vượt quá 128 ký tự.`);
  }
  if (FORBIDDEN_FIREBASE_KEY_CHARACTERS.test(segment)) {
    throw new DataValidationError(
      `${fieldName} chứa ký tự không hợp lệ. Không dùng ".", "#", "$", "[", "]" hoặc "/".`,
    );
  }
  if (containsControlCharacter(segment)) {
    throw new DataValidationError(`${fieldName} chứa ký tự điều khiển không hợp lệ.`);
  }

  return segment;
}

export function normalizeOptionalText(
  value: unknown,
  maxLength = 500,
): string {
  if (value == null) return '';
  const normalized = String(value).trim().replace(/\s+/g, ' ');
  return normalized.slice(0, maxLength);
}

export function normalizeProductCode(value: unknown): string {
  const code = normalizeOptionalText(value, 64).toUpperCase();
  if (!code) {
    throw new DataValidationError('Mã hàng hóa không được để trống.');
  }
  if (containsControlCharacter(code)) {
    throw new DataValidationError('Mã hàng hóa chứa ký tự điều khiển không hợp lệ.');
  }
  return code;
}

export function parseSafeNumber(
  value: unknown,
  fieldName: string,
  options: {
    min?: number;
    max?: number;
    integer?: boolean;
  } = {},
): number {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, integer = true } = options;
  let parsed: number;

  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string') {
    const compact = value.trim().replace(/\s/g, '');
    if (!compact) {
      throw new DataValidationError(`${fieldName} không được để trống.`);
    }

    const thousandsPattern = /^[-+]?\d{1,3}([.,]\d{3})+$/;
    const normalized = thousandsPattern.test(compact)
      ? compact.replace(/[.,]/g, '')
      : compact.replace(',', '.');
    parsed = Number(normalized);
  } else {
    parsed = Number.NaN;
  }

  if (
    !Number.isFinite(parsed)
    || (integer && !Number.isSafeInteger(parsed))
    || parsed < min
    || parsed > max
  ) {
    const range = min === Number.MIN_SAFE_INTEGER && max === Number.MAX_SAFE_INTEGER
      ? ''
      : ` trong khoảng ${min.toLocaleString('vi-VN')}–${max.toLocaleString('vi-VN')}`;
    throw new DataValidationError(
      `${fieldName} phải là ${integer ? 'số nguyên' : 'số'} hợp lệ${range}.`,
    );
  }

  return parsed;
}

export function createOperationId(): string {
  const operationId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return assertValidPathSegment(operationId, 'operationId');
}

export function formatFirebaseError(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === 'string'
    ? candidate.code.replace(/^database\//, '')
    : '';
  const message = typeof candidate?.message === 'string'
    ? candidate.message.trim()
    : '';

  if (error instanceof DataValidationError) return error.message;
  if (code === 'permission-denied' || code === 'PERMISSION_DENIED') {
    return 'Bạn không có quyền thực hiện thao tác này trong kho hiện tại.';
  }
  if (code === 'network-request-failed' || code === 'unavailable') {
    return 'Không thể kết nối Firebase. Kiểm tra mạng rồi thử lại; dữ liệu chưa được ghi.';
  }
  if (code === 'unauthenticated') {
    return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  }
  if (code === 'aborted') {
    return 'Dữ liệu vừa được người khác cập nhật. Vui lòng tải lại và thử lại.';
  }
  if (message && !/api[-_ ]?key|password|token|secret/i.test(message)) {
    return message;
  }
  return 'Không thể hoàn tất thao tác. Vui lòng thử lại.';
}
