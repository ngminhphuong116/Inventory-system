export type AccountRole = 'admin' | 'staff' | 'user';
export type AccountStatus = 'active' | 'disabled';
export type AccountAction = 'lock' | 'unlock' | 'archive' | 'restore';

export interface AccountRecord {
  key: string;
  email: string;
  role: AccountRole;
  lastLogin: string;
  status: AccountStatus;
  archived: boolean;
  createdAt?: number;
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function normalizeAccountRecord(
  key: string,
  value: Record<string, unknown> | null | undefined,
): AccountRecord {
  const source = value || {};
  const role: AccountRole = source.role === 'admin' || source.isAdmin === true
    ? 'admin'
    : source.role === 'user' ? 'user' : 'staff';
  const disabled = source.status === 'disabled'
    || source.status === 'deleting'
    || source.isActive === false
    || source.isLocked === true;

  return {
    key,
    email: text(source.email) || 'Chưa có email',
    role,
    lastLogin: text(source.lastLogin) || 'Chưa có dữ liệu',
    status: disabled ? 'disabled' : 'active',
    archived: source.archived === true,
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : undefined,
  };
}

export function normalizeAccountEntries(
  value: Record<string, Record<string, unknown>> | null | undefined,
): AccountRecord[] {
  return Object.entries(value || {})
    .map(([key, account]) => normalizeAccountRecord(key, account))
    .sort((left, right) => left.email.localeCompare(right.email, 'vi'));
}

export function accountActionBlockReason(
  actor: Pick<AccountRecord, 'key' | 'role'>,
  target: Pick<AccountRecord, 'key' | 'role' | 'archived'>,
  action: AccountAction,
): string | null {
  if (actor.role !== 'admin') return 'Chỉ quản trị viên được phép quản lý tài khoản.';
  if (actor.key === target.key) return 'Bạn không thể thao tác trên tài khoản của chính mình.';
  if (target.role === 'admin') {
    return 'Không thể khóa hoặc lưu trữ tài khoản quản trị viên từ ứng dụng phía máy khách.';
  }
  if (action === 'restore' && !target.archived) return 'Tài khoản này chưa được lưu trữ.';
  if (action === 'archive' && target.archived) return 'Tài khoản này đã được lưu trữ.';
  return null;
}

export function withArchivedState(
  current: Record<string, unknown>,
  archived: boolean,
  actorUid: string,
  now: number,
): Record<string, unknown> {
  return {
    ...current,
    status: archived ? 'disabled' : 'active',
    archived,
    ...(archived
      ? { archivedAt: now, archivedByUid: actorUid }
      : { restoredAt: now, restoredByUid: actorUid }),
  };
}
