import { describe, expect, it } from 'vitest';
import {
  accountActionBlockReason,
  normalizeAccountRecord,
  withArchivedState,
  type AccountRecord,
} from './account-management';

const account = (
  key: string,
  role: AccountRecord['role'],
  archived = false,
): AccountRecord => ({
  key,
  email: `${key}@example.com`,
  role,
  lastLogin: 'Chưa có dữ liệu',
  status: 'active',
  archived,
});

describe('account management policy', () => {
  it('allows an admin to lock staff', () => {
    expect(accountActionBlockReason(account('admin', 'admin'), account('staff', 'staff'), 'lock'))
      .toBeNull();
  });

  it('blocks staff from locking an admin', () => {
    expect(accountActionBlockReason(account('staff', 'staff'), account('admin', 'admin'), 'lock'))
      .toContain('Chỉ quản trị viên');
  });

  it('blocks an admin from locking or archiving self', () => {
    const admin = account('admin', 'admin');
    expect(accountActionBlockReason(admin, admin, 'lock')).toContain('chính mình');
    expect(accountActionBlockReason(admin, admin, 'archive')).toContain('chính mình');
  });

  it('blocks changing any admin, which also protects the last active admin', () => {
    expect(
      accountActionBlockReason(account('admin-1', 'admin'), account('admin-2', 'admin'), 'archive'),
    ).toContain('quản trị viên');
  });

  it('soft-archives without deleting identity or historical fields', () => {
    const source = { email: 'staff@example.com', role: 'staff', createdBy: 'admin-old' };
    expect(withArchivedState(source, true, 'admin', 10)).toMatchObject({
      email: 'staff@example.com',
      role: 'staff',
      createdBy: 'admin-old',
      status: 'disabled',
      archived: true,
      archivedAt: 10,
    });
  });

  it('normalizes legacy accounts without writing back', () => {
    expect(normalizeAccountRecord('legacy', {
      email: null,
      isAdmin: true,
      isLocked: true,
    })).toEqual(expect.objectContaining({
      key: 'legacy',
      email: 'Chưa có email',
      role: 'admin',
      status: 'disabled',
      archived: false,
    }));
  });

  it('ignores obsolete company and branch scope fields', () => {
    expect(normalizeAccountRecord('staff', {
      email: 'staff@example.com',
      role: 'staff',
      status: 'active',
      companyId: 'legacy-company',
      branchId: 'legacy-branch',
      scopeKey: 'legacy-company__legacy-branch',
    })).not.toMatchObject({
      companyId: expect.anything(),
      branchId: expect.anything(),
      scopeKey: expect.anything(),
    });
  });
});
