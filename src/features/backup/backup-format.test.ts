import { describe, expect, it } from 'vitest';
import {
  assertBackupFile,
  environmentWarnings,
  formatBackupFileName,
  normalizeJson,
  parseBackupDocument,
  sha256,
  stableStringify,
} from './backup-format';
import {
  BACKUP_FORMAT,
  BACKUP_NODE_DEFINITIONS,
  BACKUP_SCHEMA_VERSION,
  MAX_BACKUP_FILE_BYTES,
  type BackupDocument,
  type BackupNode,
  type JsonValue,
} from './backup-types';

async function makeDocument(): Promise<BackupDocument> {
  const data = Object.fromEntries(BACKUP_NODE_DEFINITIONS.map(({ key }) => [key, null])) as Record<BackupNode, JsonValue>;
  data.products = { b: { name: 'B', quantity: 2 }, a: { name: 'A', quantity: 1 } };
  const timestamp = Date.UTC(2026, 7, 3, 4, 5, 6);
  return {
    backupFormat: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: '1.0.0',
    environment: { projectId: 'demo', databaseHost: 'demo.firebasedatabase.app', mode: 'legacy-root' },
    createdAt: new Date(timestamp).toISOString(),
    timestamp,
    createdBy: { uid: 'admin-1', email: 'admin@example.com' },
    summary: Object.fromEntries(BACKUP_NODE_DEFINITIONS.map(({ key }) => [key, key === 'products' ? 2 : 0])) as Record<BackupNode, number>,
    checksum: await sha256(data),
    data,
  };
}

async function withFreshChecksum(document: BackupDocument): Promise<string> {
  return JSON.stringify({ ...document, checksum: await sha256(document.data) });
}

describe('backup JSON format', () => {
  it('sorts object keys recursively before serialization', () => {
    expect(stableStringify({ z: 1, a: { d: 2, b: 1 } })).toBe('{"a":{"b":1,"d":2},"z":1}');
  });

  it.each([
    ['undefined', { value: undefined }],
    ['NaN', { value: Number.NaN }],
    ['Infinity', { value: Number.POSITIVE_INFINITY }],
    ['function', { value: () => true }],
    ['bigint', { value: BigInt(1) }],
  ])('rejects unsupported JSON value: %s', (_label, input) => {
    expect(() => normalizeJson(input)).toThrow();
  });

  it('uses the required backup filename shape', () => {
    expect(formatBackupFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe('inventory-backup_2026-01-02_03-04-05.json');
  });

  it('uses a pre-restore filename prefix', () => {
    expect(formatBackupFileName(new Date(2026, 0, 2, 3, 4, 5), 'pre-restore-backup')).toBe('pre-restore-backup_2026-01-02_03-04-05.json');
  });

  it.each([
    [{ name: 'backup.txt', size: 10 }, 'phần mở rộng'],
    [{ name: 'backup.json', size: 0 }, 'đang trống'],
    [{ name: 'backup.JSON', size: MAX_BACKUP_FILE_BYTES + 1 }, '20 MB'],
  ])('rejects invalid file envelope %#', (file, message) => {
    expect(() => assertBackupFile(file as File)).toThrow(message);
  });

  it('accepts JSON extension case-insensitively at the size limit', () => {
    expect(() => assertBackupFile({ name: 'BACKUP.JSON', size: MAX_BACKUP_FILE_BYTES } as File)).not.toThrow();
  });

  it('parses a valid document and recalculates summary', async () => {
    const parsed = await parseBackupDocument(JSON.stringify(await makeDocument()));
    expect(parsed.summary.products).toBe(2);
    expect(parsed.checksum).toHaveLength(64);
  });

  it('rejects invalid JSON text', async () => {
    await expect(parseBackupDocument('{nope')).rejects.toThrow('Không thể đọc JSON');
  });

  it('rejects a top-level array', async () => {
    await expect(parseBackupDocument('[]')).rejects.toThrow('đối tượng JSON');
  });

  it.each([
    ['backupFormat', 'other', 'Định dạng'],
    ['schemaVersion', 99, 'schema'],
    ['appVersion', '', 'phiên bản ứng dụng'],
    ['createdAt', 'not-a-date', 'createdAt'],
    ['timestamp', 1, 'timestamp'],
    ['checksum', 'bad', 'Checksum'],
  ])('rejects invalid %s', async (field, value, message) => {
    const document = await makeDocument();
    const changed = { ...document, [field]: value };
    await expect(parseBackupDocument(JSON.stringify(changed))).rejects.toThrow(message);
  });

  it('rejects unknown top-level fields', async () => {
    await expect(parseBackupDocument(JSON.stringify({ ...(await makeDocument()), secret: true }))).rejects.toThrow('không hỗ trợ');
  });

  it('rejects unknown environment fields', async () => {
    const document = await makeDocument();
    document.environment = { ...document.environment, apiKey: 'nope' } as typeof document.environment;
    await expect(parseBackupDocument(JSON.stringify(document))).rejects.toThrow('Môi trường chứa trường');
  });

  it('rejects an invalid environment mode', async () => {
    const document = await makeDocument();
    document.environment.mode = 'other' as 'legacy-root';
    await expect(parseBackupDocument(JSON.stringify(document))).rejects.toThrow('phạm vi');
  });

  it('requires scope identifiers for scoped backups', async () => {
    const document = await makeDocument();
    document.environment.mode = 'scoped-branch';
    await expect(parseBackupDocument(JSON.stringify(document))).rejects.toThrow('công ty/chi nhánh');
  });

  it('rejects invalid creator metadata', async () => {
    const document = await makeDocument();
    document.createdBy = { uid: 'admin-1' } as typeof document.createdBy;
    await expect(parseBackupDocument(JSON.stringify(document))).rejects.toThrow('người tạo');
  });

  it('rejects an unknown data node', async () => {
    const document = await makeDocument();
    const data = document.data as Record<string, JsonValue>;
    data.authTokens = {};
    document.checksum = await sha256(data);
    await expect(parseBackupDocument(JSON.stringify(document))).rejects.toThrow('không hỗ trợ');
  });

  it('rejects a missing allowlisted node', async () => {
    const document = await makeDocument();
    delete (document.data as Partial<Record<BackupNode, JsonValue>>).vouchers;
    document.checksum = await sha256(document.data);
    await expect(parseBackupDocument(JSON.stringify(document))).rejects.toThrow('thiếu node');
  });

  it('detects data tampering through SHA-256', async () => {
    const document = await makeDocument();
    (document.data.products as Record<string, JsonValue>).a = { quantity: 999 };
    await expect(parseBackupDocument(JSON.stringify(document))).rejects.toThrow('Checksum không khớp');
  });

  it('rejects credential-like fields inside user profiles', async () => {
    const document = await makeDocument();
    document.data.users = { admin: { email: 'admin@example.com', role: 'admin', status: 'active', refreshToken: 'secret' } };
    document.summary.users = 1;
    document.checksum = await sha256(document.data);
    await expect(parseBackupDocument(JSON.stringify(document))).rejects.toThrow('nhạy cảm');
  });

  it('rejects summary metadata that does not match data', async () => {
    const document = await makeDocument();
    document.summary.products = 99;
    await expect(parseBackupDocument(JSON.stringify(document))).rejects.toThrow('Summary');
  });

  it('accepts a fully described scoped environment', async () => {
    const document = await makeDocument();
    document.environment = {
      ...document.environment,
      mode: 'scoped-branch',
      companyId: 'company-a',
      branchId: 'branch-a',
      scopeKey: 'company-a__branch-a',
    };
    await expect(parseBackupDocument(await withFreshChecksum(document))).resolves.toMatchObject({ environment: { mode: 'scoped-branch' } });
  });

  it('reports every relevant environment mismatch', () => {
    expect(environmentWarnings(
      { projectId: 'a', databaseHost: 'a.db', mode: 'scoped-branch', scopeKey: 'a__one' },
      { projectId: 'b', databaseHost: 'b.db', mode: 'scoped-branch', scopeKey: 'b__two' },
    )).toHaveLength(3);
  });

  it('returns no environment warning for identical targets', () => {
    const environment = { projectId: 'a', databaseHost: 'a.db', mode: 'legacy-root' as const };
    expect(environmentWarnings(environment, environment)).toEqual([]);
  });
});
