export type UserRole = 'admin' | 'staff';

export interface UserPermissions {
  product: boolean;
  sales: boolean;
  import: boolean;
  export: boolean;
  history: boolean;
  report: boolean;
}

export interface UserInfo {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active';
  permissions: UserPermissions;
}

export const DEFAULT_PERMISSIONS: UserPermissions = {
  product: true,
  sales: true,
  import: true,
  export: true,
  history: true,
  report: false,
};
export type ProfileDecision =
  | { kind: 'authorized'; userInfo: UserInfo }
  | { kind: 'invalid'; reason: 'missing' | 'inactive' | 'role' | 'email' };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canAccessAdminOnlyRoute(userInfo: Pick<UserInfo, 'role'> | null): boolean {
  return userInfo?.role === 'admin';
}

export function evaluateProfile(
  uid: string,
  email: string | null,
  data: Record<string, unknown> | null,
): ProfileDecision {
  if (!data) return { kind: 'invalid', reason: 'missing' };
  if (data.status !== 'active') return { kind: 'invalid', reason: 'inactive' };
  if (data.role !== 'admin' && data.role !== 'staff') {
    return { kind: 'invalid', reason: 'role' };
  }
  const authenticatedEmail = (email || '').trim().toLowerCase();
  const profileEmail = typeof data.email === 'string'
    ? data.email.trim().toLowerCase()
    : '';
  if (
    !EMAIL_PATTERN.test(authenticatedEmail)
    || !EMAIL_PATTERN.test(profileEmail)
    || authenticatedEmail !== profileEmail
  ) {
    return { kind: 'invalid', reason: 'email' };
  }
  const role: UserRole = data.role;

  return {
    kind: 'authorized',
    userInfo: {
      uid,
      email: authenticatedEmail,
      name: typeof data.name === 'string' ? data.name : authenticatedEmail,
      role,
      status: 'active',
      permissions: role === 'admin'
        ? { product: true, sales: true, import: true, export: true, history: true, report: true }
        : { ...DEFAULT_PERMISSIONS },
    },
  };
}
