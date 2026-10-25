import {
  BACKUP_FORMAT,
  BACKUP_NODE_DEFINITIONS,
  BACKUP_SCHEMA_VERSION,
  MAX_BACKUP_FILE_BYTES,
  type BackupDocument,
  type BackupEnvironment,
  type BackupNode,
  type JsonValue,
} from './backup-types';

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const DOCUMENT_KEYS = [
  'backupFormat', 'schemaVersion', 'appVersion', 'environment', 'createdAt', 'timestamp',
  'createdBy', 'summary', 'checksum', 'data',
] as const;
const ENVIRONMENT_KEYS = ['projectId', 'databaseHost', 'mode', 'companyId', 'branchId', 'scopeKey'] as const;
const NODE_KEYS = BACKUP_NODE_DEFINITIONS.map((node) => node.key);
const USER_PROFILE_FIELDS = new Set([
  'email', 'name', 'role', 'status', 'permissions', 'companyId', 'branchId', 'scopeKey',
  'archived', 'archivedAt', 'archivedByUid', 'createdAt', 'createdByUid', 'updatedAt',
  'updatedByUid', 'deletionRequestedAt', 'deletionRequestedBy', 'deletionError',
]);
const FORBIDDEN_KEY = /(password|passcode|secret|token|credential|session|refresh|api[-_]?key)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeJson(value: unknown, path = 'data'): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} chứa số không hợp lệ.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalizeJson(item, `${path}/${index}`));
  if (isRecord(value)) {
    const normalized: Record<string, JsonValue> = {};
    Object.keys(value).sort().forEach((key) => {
      if (value[key] === undefined) throw new Error(`${path}/${key} chứa undefined.`);
      normalized[key] = normalizeJson(value[key], `${path}/${key}`);
    });
    return normalized;
  }
  throw new Error(`${path} chứa kiểu dữ liệu không được hỗ trợ.`);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export async function sha256(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Trình duyệt không hỗ trợ Web Crypto SHA-256.');
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknownKeys.length) throw new Error(`${label} chứa trường không hỗ trợ: ${unknownKeys.join(', ')}.`);
}

function countNode(value: JsonValue): number {
  if (value === null) return 0;
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length;
  return 1;
}

function assertSafeUsers(value: JsonValue): void {
  if (value === null) return;
  if (!isRecord(value)) throw new Error('Node users phải là object hoặc null.');
  const inspect = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => inspect(item, `${path}/${index}`));
      return;
    }
    if (!isRecord(current)) return;
    Object.entries(current).forEach(([key, child]) => {
      if (FORBIDDEN_KEY.test(key)) throw new Error(`${path}/${key} là trường nhạy cảm không được phép.`);
      inspect(child, `${path}/${key}`);
    });
  };
  Object.entries(value).forEach(([uid, profile]) => {
    if (!isRecord(profile)) throw new Error(`Hồ sơ users/${uid} không hợp lệ.`);
    const sensitive = Object.keys(profile).filter((field) => FORBIDDEN_KEY.test(field));
    if (sensitive.length) throw new Error(`users/${uid} chứa trường nhạy cảm không được phép: ${sensitive.join(', ')}.`);
    const unknown = Object.keys(profile).filter((field) => !USER_PROFILE_FIELDS.has(field));
    if (unknown.length) throw new Error(`users/${uid} chứa trường không được phép: ${unknown.join(', ')}.`);
    inspect(profile, `users/${uid}`);
  });
}

export function assertBackupFile(file: Pick<File, 'name' | 'size'>): void {
  if (!file.name.toLocaleLowerCase('vi').endsWith('.json')) throw new Error('Chỉ chấp nhận tệp có phần mở rộng .json.');
  if (file.size <= 0) throw new Error('Tệp sao lưu đang trống.');
  if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error('Tệp sao lưu vượt quá giới hạn 20 MB.');
}

export async function parseBackupDocument(text: string): Promise<BackupDocument> {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('Không thể đọc JSON. Hãy chọn đúng tệp sao lưu do ứng dụng tạo.');
  }
  if (!isRecord(input)) throw new Error('Tệp sao lưu phải là một đối tượng JSON.');
  assertKnownKeys(input, DOCUMENT_KEYS, 'Tệp sao lưu');
  if (input.backupFormat !== BACKUP_FORMAT) throw new Error('Định dạng tệp sao lưu không đúng.');
  if (input.schemaVersion !== BACKUP_SCHEMA_VERSION) throw new Error('Phiên bản schema sao lưu chưa được hỗ trợ.');
  if (typeof input.appVersion !== 'string' || !input.appVersion.trim()) throw new Error('Thiếu phiên bản ứng dụng.');
  if (!isRecord(input.environment)) throw new Error('Thiếu thông tin môi trường Firebase.');
  assertKnownKeys(input.environment, ENVIRONMENT_KEYS, 'Môi trường');
  if (typeof input.environment.projectId !== 'string' || typeof input.environment.databaseHost !== 'string') {
    throw new Error('Project ID hoặc database host không hợp lệ.');
  }
  if (input.environment.mode !== 'legacy-root' && input.environment.mode !== 'scoped-branch') {
    throw new Error('Chế độ phạm vi dữ liệu không hợp lệ.');
  }
  if (input.environment.mode === 'scoped-branch' && (
    typeof input.environment.companyId !== 'string'
    || typeof input.environment.branchId !== 'string'
    || typeof input.environment.scopeKey !== 'string'
  )) throw new Error('Thiếu thông tin công ty/chi nhánh trong tệp.');
  const parsedCreatedAt = typeof input.createdAt === 'string' ? Date.parse(input.createdAt) : Number.NaN;
  if (!Number.isFinite(parsedCreatedAt)) throw new Error('createdAt không hợp lệ.');
  if (!Number.isSafeInteger(input.timestamp) || Math.abs(parsedCreatedAt - Number(input.timestamp)) > 1_000) {
    throw new Error('timestamp không khớp createdAt.');
  }
  if (!isRecord(input.createdBy) || typeof input.createdBy.uid !== 'string' || typeof input.createdBy.email !== 'string') {
    throw new Error('Thông tin người tạo bản sao lưu không hợp lệ.');
  }
  assertKnownKeys(input.createdBy, ['uid', 'email'], 'Người tạo');
  if (!isRecord(input.summary) || !isRecord(input.data)) throw new Error('Tệp không có summary hoặc data hợp lệ.');
  const rawSummary = input.summary as Record<string, unknown>;
  assertKnownKeys(rawSummary, NODE_KEYS, 'Summary');
  const rawData = input.data as Record<string, unknown>;
  assertKnownKeys(rawData, NODE_KEYS, 'Dữ liệu sao lưu');
  const missingNodes = NODE_KEYS.filter((node) => !(node in rawData));
  if (missingNodes.length) throw new Error(`Dữ liệu sao lưu thiếu node: ${missingNodes.join(', ')}.`);
  if (typeof input.checksum !== 'string' || !CHECKSUM_PATTERN.test(input.checksum)) {
    throw new Error('Checksum không đúng định dạng SHA-256.');
  }
  const data = normalizeJson(rawData) as Record<BackupNode, JsonValue>;
  assertSafeUsers(data.users);
  if (await sha256(data) !== input.checksum) throw new Error('Checksum không khớp; tệp có thể đã bị sửa hoặc hỏng.');
  const summary = {} as Record<BackupNode, number>;
  NODE_KEYS.forEach((node) => {
    summary[node] = countNode(data[node]);
    if (rawSummary[node] !== summary[node]) throw new Error(`Summary của node ${node} không khớp dữ liệu.`);
  });
  return {
    backupFormat: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: input.appVersion,
    environment: input.environment as unknown as BackupEnvironment,
    createdAt: input.createdAt as string,
    timestamp: Number(input.timestamp),
    createdBy: { uid: input.createdBy.uid as string, email: input.createdBy.email as string },
    summary,
    checksum: input.checksum,
    data,
  };
}

export function formatBackupFileName(date: Date, prefix = 'inventory-backup'): string {
  const part = (value: number) => String(value).padStart(2, '0');
  return `${prefix}_${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}_${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}.json`;
}

export function serializeBackup(document: BackupDocument): string {
  return `${JSON.stringify(normalizeJson(document), null, 2)}\n`;
}

export function environmentWarnings(source: BackupEnvironment, current: BackupEnvironment): string[] {
  const warnings: string[] = [];
  if (source.projectId !== current.projectId) warnings.push('Firebase project của tệp khác project hiện tại.');
  if (source.databaseHost !== current.databaseHost) warnings.push('Database host của tệp khác database hiện tại.');
  if (source.mode !== current.mode) warnings.push('Mô hình phạm vi dữ liệu của tệp khác môi trường hiện tại.');
  if (source.mode === 'scoped-branch' && current.mode === 'scoped-branch' && source.scopeKey !== current.scopeKey) {
    warnings.push('Tệp được tạo từ công ty/chi nhánh khác.');
  }
  return warnings;
}
