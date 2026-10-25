import { describe, expect, it } from 'vitest';
import {
  canAccessAdminOnlyRoute,
  evaluateProfile,
} from './authorization';

describe('realtime authorization profile mapping', () => {
  it('authorizes an active admin with full permissions', () => {
    const result = evaluateProfile('admin-1', 'admin@gmail.com', {
      email: 'admin@gmail.com',
      role: 'admin',
      status: 'active',
    });

    expect(result.kind).toBe('authorized');
    if (result.kind === 'authorized') {
      expect(result.userInfo.role).toBe('admin');
      expect(result.userInfo.permissions).toEqual({
        product: true,
        sales: true,
        import: true,
        export: true,
        history: true,
        report: true,
      });
    }
  });

  it('authorizes an active staff account', () => {
    const result = evaluateProfile('staff-1', 'staff@gmail.com', {
      email: 'staff@gmail.com',
      role: 'staff',
      status: 'active',
    });

    expect(result.kind).toBe('authorized');
    if (result.kind === 'authorized') {
      expect(result.userInfo.role).toBe('staff');
      expect(result.userInfo.email).toBe('staff@gmail.com');
    }
  });

  it('authorizes active staff without companyId or branchId', () => {
    const result = evaluateProfile('staff-no-scope', 'staff@gmail.com', {
      email: 'staff@gmail.com',
      role: 'staff',
      status: 'active',
    });

    expect(result.kind).toBe('authorized');
  });

  it.each(['disabled', 'locked', 'deleting', undefined])(
    'rejects staff when status is %s',
    (status) => {
      expect(evaluateProfile('staff-1', 'staff@gmail.com', {
        email: 'staff@gmail.com',
        role: 'staff',
        status,
      })).toEqual({ kind: 'invalid', reason: 'inactive' });
    },
  );

  it.each(['user', 'manager', '', null])('rejects unsupported role %s', (role) => {
    expect(evaluateProfile('u1', 'user@gmail.com', {
      email: 'user@gmail.com',
      role,
      status: 'active',
    })).toEqual({ kind: 'invalid', reason: 'role' });
  });

  it('rejects a missing profile', () => {
    expect(evaluateProfile('missing', 'missing@gmail.com', null))
      .toEqual({ kind: 'invalid', reason: 'missing' });
  });

  it.each([
    ['not-an-email', 'not-an-email'],
    ['staff@gmail.com', ''],
    ['staff@gmail.com', 'another@gmail.com'],
  ])('rejects invalid or mismatched email %s / %s', (authEmail, profileEmail) => {
    expect(evaluateProfile('u1', authEmail, {
      email: profileEmail,
      role: 'staff',
      status: 'active',
    })).toEqual({ kind: 'invalid', reason: 'email' });
  });

  it('uses the fixed staff page permissions and ignores legacy profile permissions', () => {
    const result = evaluateProfile('staff-1', 'staff@gmail.com', {
      email: 'staff@gmail.com',
      role: 'staff',
      status: 'active',
      permissions: {
        product: false,
        sales: false,
        import: false,
        export: false,
        history: false,
        report: true,
      },
    });

    expect(result.kind).toBe('authorized');
    if (result.kind === 'authorized') {
      expect(result.userInfo.permissions).toEqual({
        product: true,
        sales: true,
        import: true,
        export: true,
        history: true,
        report: false,
      });
      expect(canAccessAdminOnlyRoute(result.userInfo)).toBe(false);
    }
  });

  it('allows an admin to access admin-only routes', () => {
    const result = evaluateProfile('admin-1', 'admin@gmail.com', {
      email: 'admin@gmail.com',
      role: 'admin',
      status: 'active',
    });

    expect(result.kind).toBe('authorized');
    if (result.kind === 'authorized') {
      expect(canAccessAdminOnlyRoute(result.userInfo)).toBe(true);
    }
  });
});
