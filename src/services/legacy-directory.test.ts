import { describe, expect, it } from 'vitest';
import {
  adaptDirectoryNode,
  adaptDirectorySources,
  adaptEmbeddedProductDirectories,
  mergeDirectoryItems,
  normalizeDirectoryNameKey,
  resolveSupplierReference,
  supplierNameFromRecord,
} from './legacy-directory';

describe('legacy directory adapter', () => {
  it('reads root categories keyed by ID and legacy direct values', () => {
    const result = adaptDirectorySources({
      kind: 'category',
      source: 'legacy-root',
      primary: {
        catA: { name: 'THẺ', id: 'catA' },
        catB: 'Máy in',
      },
      alias: null,
      products: null,
    });
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'catA', name: 'THẺ', source: 'legacy-root' }),
      expect.objectContaining({ id: 'catB', name: 'Máy in', source: 'legacy-root' }),
    ]));
  });

  it('reads scoped category aliases and records missing an id', () => {
    const result = adaptDirectorySources({
      kind: 'category',
      source: 'scoped',
      primary: {},
      alias: [{ categoryName: 'Thiết bị mạng' }],
      products: {},
    });
    expect(result[0]).toMatchObject({
      id: '0',
      name: 'Thiết bị mạng',
      source: 'scoped',
      originNode: 'productCategories',
    });
  });

  it('recovers a supplier embedded in a legacy product', () => {
    const result = adaptEmbeddedProductDirectories({
      p1: { supplierName: 'Cty TNHH SX MÁY IN NHIỆT' },
    }, 'supplier');
    expect(result[0]).toMatchObject({
      name: 'Cty TNHH SX MÁY IN NHIỆT',
      source: 'embedded-product',
      originNode: 'products',
    });
    expect(result[0].id).toMatch(/^legacy-/);
  });

  it('deduplicates names without regard to case or repeated whitespace', () => {
    const merged = mergeDirectoryItems(
      [{
        id: 'canonical',
        key: 'canonical',
        name: 'ĐỐI  TÁC A',
        source: 'scoped',
        originNode: 'suppliers',
      }],
      [{
        id: 'embedded',
        key: 'embedded',
        name: ' đối tác a ',
        source: 'embedded-product',
        originNode: 'products',
      }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('canonical');
    expect(normalizeDirectoryNameKey(' ĐỐI   TÁC ')).toBe('đối tác');
  });

  it('normalizes a supplier using the current schema', () => {
    const result = adaptDirectoryNode({
      'supplier-new': {
        id: 'supplier-new',
        name: 'Nhà cung cấp mới',
        status: 'active',
        archived: false,
        createdAt: 1_700_000_000_000,
      },
    }, 'supplier', 'scoped', 'suppliers');

    expect(result[0]).toMatchObject({
      id: 'supplier-new',
      key: 'supplier-new',
      name: 'Nhà cung cấp mới',
      status: 'active',
      archived: false,
      createdAt: 1_700_000_000_000,
    });
  });

  it('normalizes a legacy supplier and keeps supplierId as a lookup alias', () => {
    const result = adaptDirectoryNode({
      'firebase-legacy-key': {
        supplierId: 'SUPPLIER-LEGACY-01',
        supplierName: 'Nhà cung cấp legacy',
        createdAt: '1700000000000',
      },
    }, 'supplier', 'legacy-root', 'partners');

    expect(result[0]).toMatchObject({
      id: 'firebase-legacy-key',
      key: 'firebase-legacy-key',
      name: 'Nhà cung cấp legacy',
      legacyIds: ['SUPPLIER-LEGACY-01'],
      status: 'active',
      archived: false,
      createdAt: 1_700_000_000_000,
    });
  });

  it('treats a missing supplier status as active', () => {
    const result = adaptDirectoryNode({
      'supplier-without-status': { name: 'Thiếu trạng thái' },
    }, 'supplier', 'legacy-root', 'suppliers');

    expect(result[0]).toMatchObject({
      id: 'supplier-without-status',
      status: 'active',
      archived: false,
    });
  });

  it('normalizes a legacy supplier stored as a direct string value', () => {
    const result = adaptDirectoryNode({
      'string-snapshot-key': 'Nhà cung cấp dạng chuỗi',
    }, 'supplier', 'legacy-root', 'suppliers');

    expect(result[0]).toMatchObject({
      id: 'string-snapshot-key',
      key: 'string-snapshot-key',
      name: 'Nhà cung cấp dạng chuỗi',
      status: 'active',
      archived: false,
      legacyValue: true,
    });
  });

  it('uses the Firebase snapshot key when id and key fields are missing or blank', () => {
    const result = adaptDirectoryNode({
      'firebase-snapshot-key': {
        id: '',
        key: '',
        supplierName: 'Dùng snapshot key',
      },
    }, 'supplier', 'legacy-root', 'suppliers');

    expect(result[0]).toMatchObject({
      id: 'firebase-snapshot-key',
      key: 'firebase-snapshot-key',
      name: 'Dùng snapshot key',
    });
  });

  it('displays a ticket that only stores supplierName without assigning an id', () => {
    const ticket = { supplierName: 'Nhà cung cấp trên phiếu cũ' };

    expect(supplierNameFromRecord(ticket)).toBe('Nhà cung cấp trên phiếu cũ');
    expect(resolveSupplierReference(ticket, [{
      id: 'same-name-id',
      key: 'same-name-id',
      name: 'Nhà cung cấp trên phiếu cũ',
      source: 'scoped',
      originNode: 'suppliers',
    }])).toEqual({ supplierName: 'Nhà cung cấp trên phiếu cũ' });
  });

  it('keeps the supplier name and leaves the id empty when an id no longer exists', () => {
    const resolution = resolveSupplierReference({
      supplierId: 'missing-id',
      supplierName: 'Nhà cung cấp đã xóa khỏi directory',
    }, [{
      id: 'other-id',
      key: 'other-id',
      name: 'Nhà cung cấp đã xóa khỏi directory',
      source: 'scoped',
      originNode: 'suppliers',
    }]);

    expect(resolution).toEqual({
      supplierName: 'Nhà cung cấp đã xóa khỏi directory',
    });
  });

  it('resolves a legacy supplierId alias to the Firebase snapshot key', () => {
    const [supplier] = adaptDirectoryNode({
      'firebase-key': {
        supplierId: 'legacy-business-id',
        supplierName: 'Nhà cung cấp cũ',
      },
    }, 'supplier', 'legacy-root', 'suppliers');

    expect(resolveSupplierReference({
      supplierId: 'legacy-business-id',
      supplierName: 'Nhà cung cấp cũ',
    }, [supplier])).toEqual({
      supplierId: 'firebase-key',
      supplierName: 'Nhà cung cấp cũ',
    });
  });
});
