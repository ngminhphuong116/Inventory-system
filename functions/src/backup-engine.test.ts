import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  BUSINESS_BACKUP_NODES,
  applyRestoreToRoot,
  auditIntegrity,
  buildBackupDocument,
  checksumData,
  compareRestore,
  extractBusinessData,
  isActiveAdminProfile,
  relationshipWarnings,
  stableStringify,
  validateBackupDocument,
  type BackupDocument,
  type BackupEnvironment,
  type BackupNode,
  type JsonValue,
} from './backup-engine.js';

const root = () => ({
  products: {
    p1: { name: 'Bút', quantity: 5, categoryId: 'c1', supplierId: 's1' },
  },
  categories: { c1: { name: 'Văn phòng phẩm' } },
  suppliers: { s1: { name: 'Nhà cung cấp A' } },
  salesTickets: {
    t1: { createdByUid: 'admin', items: [{ productId: 'p1', quantity: 1 }] },
  },
  users: {
    admin: { email: 'admin@example.com', name: 'Admin', role: 'admin', status: 'active', refreshToken: 'forbidden' },
    staff: { email: 'staff@example.com', name: 'Staff', role: 'staff', status: 'active', scopeKey: 'co__br' },
    outsider: { email: 'out@example.com', role: 'staff', status: 'active', scopeKey: 'other__br' },
  },
  companies: {
    co: {
      branches: {
        br: {
          products: { scoped: { name: 'Scoped', quantity: 2 } },
          settings: { businessName: 'Chi nhánh' },
        },
      },
    },
  },
  restoreJobs: { active: { jobId: 'keep' } },
});

const legacyEnvironment: BackupEnvironment = {
  projectId: 'demo-project',
  databaseHost: 'demo.firebasedatabase.app',
  mode: 'legacy-root',
};

function documentFrom(value = root(), environment = legacyEnvironment): BackupDocument {
  return buildBackupDocument({
    root: value,
    environment,
    appVersion: '1.0.0',
    createdBy: { uid: 'admin', email: 'admin@example.com' },
    now: Date.UTC(2026, 7, 3, 4, 5, 6),
  });
}

describe('server backup engine', () => {
  it.each([
    [{ role: 'admin', status: 'active' }, true],
    [{ role: 'admin', status: 'disabled' }, false],
    [{ role: 'staff', status: 'active' }, false],
    [null, false],
  ])('recognizes active admin profiles %#', (profile, expected) => {
    expect(isActiveAdminProfile(profile)).toBe(expected);
  });

  it('extracts only allowlisted business nodes', () => {
    const data = extractBusinessData(root(), { mode: 'legacy-root' });
    expect(Object.keys(data)).toEqual(BUSINESS_BACKUP_NODES);
    expect('restoreJobs' in data).toBe(false);
    expect('companies' in data).toBe(false);
  });

  it('removes token-like fields from user profiles', () => {
    const users = extractBusinessData(root(), { mode: 'legacy-root' }).users as Record<string, JsonValue>;
    expect(users.admin).not.toHaveProperty('refreshToken');
  });

  it('extracts the selected scoped branch', () => {
    const data = extractBusinessData(root(), { mode: 'scoped-branch', companyId: 'co', branchId: 'br', scopeKey: 'co__br' });
    expect(data.products).toHaveProperty('scoped');
    expect(data.products).not.toHaveProperty('p1');
  });

  it('filters users by scope key for scoped backups', () => {
    const data = extractBusinessData(root(), { mode: 'scoped-branch', companyId: 'co', branchId: 'br', scopeKey: 'co__br' });
    expect(data.users).toHaveProperty('staff');
    expect(data.users).not.toHaveProperty('outsider');
    expect(data.users).not.toHaveProperty('admin');
  });

  it('builds required metadata and deterministic checksum', () => {
    const document = documentFrom();
    expect(document).toMatchObject({
      backupFormat: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '1.0.0',
    });
    expect(document.checksum).toBe(checksumData(document.data));
    expect(document.summary.products).toBe(1);
  });

  it('produces the same checksum for different key insertion order', () => {
    expect(checksumData({ b: 2, a: 1 })).toBe(checksumData({ a: 1, b: 2 }));
  });

  it('rejects non-finite numbers before hashing', () => {
    expect(() => stableStringify({ bad: Number.NaN })).toThrow('số không hợp lệ');
  });

  it('validates a document built by the server', () => {
    expect(validateBackupDocument(documentFrom()).checksum).toHaveLength(64);
  });

  it('rejects a tampered document', () => {
    const document = documentFrom();
    (document.data.products as Record<string, JsonValue>).p1 = { quantity: 999 };
    expect(() => validateBackupDocument(document)).toThrow('Checksum không khớp');
  });

  it('rejects unknown nodes even with a fresh checksum', () => {
    const document = documentFrom();
    const data = document.data as Record<string, JsonValue>;
    data.secrets = { token: 'no' };
    document.checksum = checksumData(data);
    expect(() => validateBackupDocument(document)).toThrow('không hỗ trợ');
  });

  it('rejects credential-like fields in imported users', () => {
    const document = documentFrom();
    const users = document.data.users as Record<string, JsonValue>;
    users.admin = { email: 'admin@example.com', role: 'admin', status: 'active', passwordHash: 'nope' };
    document.checksum = checksumData(document.data);
    expect(() => validateBackupDocument(document)).toThrow('nhạy cảm');
  });

  it('rejects summary counts that do not match data', () => {
    const document = documentFrom();
    document.summary.products = 999;
    expect(() => validateBackupDocument(document)).toThrow('Summary');
  });

  it('counts merge additions, updates, conflicts and unchanged values', () => {
    const current = extractBusinessData({ products: { a: { q: 1 }, b: { q: 2 } } }, { mode: 'legacy-root' });
    const incoming = extractBusinessData({ products: { a: { q: 1 }, b: { q: 3 }, c: { q: 1 } } }, { mode: 'legacy-root' });
    expect(compareRestore(current, incoming, ['products'], 'merge')[0]).toMatchObject({ added: 1, updated: 1, conflicts: 1, unchanged: 1, removed: 0 });
  });

  it('counts records removed by replace', () => {
    const current = extractBusinessData({ products: { a: {}, old: {} } }, { mode: 'legacy-root' });
    const incoming = extractBusinessData({ products: { a: {} } }, { mode: 'legacy-root' });
    expect(compareRestore(current, incoming, ['products'], 'replace')[0].removed).toBe(1);
  });

  it('merge keeps current records missing from an empty backup node', () => {
    const document = documentFrom({ users: root().users });
    const restored = applyRestoreToRoot({ root: root(), document, selectedNodes: ['products'], mode: 'merge', scope: { mode: 'legacy-root' }, actorUid: 'admin' });
    expect(restored.products).toHaveProperty('p1');
  });

  it('merge replaces records with colliding IDs and preserves other records', () => {
    const incoming = root();
    incoming.products.p1.quantity = 9;
    Object.assign(incoming.products, { p2: { name: 'Mới', quantity: 1 } });
    const restored = applyRestoreToRoot({ root: root(), document: documentFrom(incoming), selectedNodes: ['products'], mode: 'merge', scope: { mode: 'legacy-root' }, actorUid: 'admin' });
    expect((restored.products as Record<string, { quantity: number }>).p1.quantity).toBe(9);
    expect(restored.products).toHaveProperty('p2');
    expect(restored.restoreJobs).toEqual({ active: { jobId: 'keep' } });
  });

  it('replace affects only selected nodes', () => {
    const incoming = root();
    incoming.products = {} as typeof incoming.products;
    incoming.categories = { c2: { name: 'Khác' } };
    const restored = applyRestoreToRoot({ root: root(), document: documentFrom(incoming), selectedNodes: ['products'], mode: 'replace', scope: { mode: 'legacy-root' }, actorUid: 'admin' });
    expect(restored.products).toEqual({});
    expect(restored.categories).toHaveProperty('c1');
  });

  it('restores a scoped branch without touching root business data', () => {
    const environment: BackupEnvironment = { projectId: 'demo', databaseHost: 'demo.db', mode: 'scoped-branch', companyId: 'co', branchId: 'br', scopeKey: 'co__br' };
    const incoming = root();
    incoming.companies.co.branches.br.products.scoped.quantity = 8;
    const restored = applyRestoreToRoot({ root: root(), document: documentFrom(incoming, environment), selectedNodes: ['products'], mode: 'replace', scope: environment, actorUid: 'admin' });
    expect((restored.products as Record<string, { quantity: number }>).p1.quantity).toBe(5);
    const companies = restored.companies as typeof incoming.companies;
    expect(companies.co.branches.br.products.scoped.quantity).toBe(8);
  });

  it('blocks replacing users when the current admin would be lost', () => {
    const incoming = root();
    delete incoming.users.admin;
    expect(() => applyRestoreToRoot({ root: root(), document: documentFrom(incoming), selectedNodes: ['users'], mode: 'replace', scope: { mode: 'legacy-root' }, actorUid: 'admin' })).toThrow('admin hiện tại');
  });

  it('allows merging users without deleting the current admin', () => {
    const incoming = root();
    delete incoming.users.admin;
    const restored = applyRestoreToRoot({ root: root(), document: documentFrom(incoming), selectedNodes: ['users'], mode: 'merge', scope: { mode: 'legacy-root' }, actorUid: 'admin' });
    expect(restored.users).toHaveProperty('admin');
  });

  it.each([
    [['salesTickets'] as BackupNode[], 'sản phẩm'],
    [['operations'] as BackupNode[], 'chứng từ'],
    [['categories'] as BackupNode[], 'Danh mục'],
    [['users'] as BackupNode[], 'Authentication'],
    [['auditLogs'] as BackupNode[], 'Audit'],
  ])('warns about risky relationship selection %#', (nodes, expected) => {
    expect(relationshipWarnings(nodes).join(' ')).toContain(expected);
  });

  it('reports invalid stock, missing directory and missing ticket references', () => {
    const data = extractBusinessData({
      products: { p1: { quantity: -1, categoryId: 'missing', supplierId: 'missing' } },
      salesTickets: { t1: { createdByUid: 'ghost', items: [{ productId: 'ghost-product' }] } },
      users: {},
    }, { mode: 'legacy-root' });
    const codes = auditIntegrity(data).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['INVALID_STOCK', 'MISSING_CATEGORY', 'MISSING_SUPPLIER', 'MISSING_PRODUCT', 'MISSING_CREATOR']));
  });

  it('returns no integrity issue for a consistent snapshot', () => {
    expect(auditIntegrity(extractBusinessData(root(), { mode: 'legacy-root' }))).toEqual([]);
  });
});
