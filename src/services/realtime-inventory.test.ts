import { describe, expect, it } from 'vitest';
import {
  buildWarehousePath,
  permissionsForRole,
  type WarehouseScope,
} from './realtime-inventory';

function scope(role: 'admin' | 'staff'): WarehouseScope {
  return {
    uid: `${role}-1`,
    email: `${role}@example.com`,
    role,
    permissions: role === 'admin'
      ? { product: true, import: true, export: true, sales: true }
      : { product: false, import: false, export: false, sales: true },
  };
}

describe('root warehouse path construction', () => {
  it('uses the existing Firebase root for both admin and staff', () => {
    expect(buildWarehousePath(scope('admin'))).toBeNull();
    expect(buildWarehousePath(scope('staff'))).toBeNull();
  });

  it('uses the same product path for admin and staff', () => {
    expect(buildWarehousePath(scope('admin'), 'products')).toBe('products');
    expect(buildWarehousePath(scope('staff'), 'products')).toBe('products');
  });

  it.each(['products', 'importTickets', 'exportTickets', 'salesTickets']) (
    'never constructs an undefined or null tenant path for %s',
    (node) => {
      const adminPath = buildWarehousePath(scope('admin'), node);
      const staffPath = buildWarehousePath(scope('staff'), node);
      expect(adminPath).toBe(node);
      expect(staffPath).toBe(node);
      expect(`${adminPath}${staffPath}`).not.toMatch(/tenants\/(undefined|null)/);
      expect(`${adminPath}${staffPath}`).not.toContain('companies/');
    },
  );

  it('rejects invalid Firebase node names for every role', () => {
    expect(() => buildWarehousePath(scope('staff'), 'bad.node'))
      .toThrowError(/database node chứa ký tự không hợp lệ/);
  });
});

describe('staff service policy', () => {
  it('allows staff sales creation but blocks product, import, and export mutations', () => {
    expect(permissionsForRole('staff')).toEqual({
      product: false,
      import: false,
      export: false,
      sales: true,
    });
  });

  it('keeps every existing mutation permission for admin', () => {
    expect(permissionsForRole('admin')).toEqual({
      product: true,
      import: true,
      export: true,
      sales: true,
    });
  });
});
