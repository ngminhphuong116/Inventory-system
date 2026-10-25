export interface UserProfile {
  role?: string;
  status?: string;
}

export class UserDeletionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export function assertDeletionAllowed(
  callerUid: string,
  caller: UserProfile | null,
  targetUid: string,
  target: UserProfile | null,
) {
  if (!caller || caller.role !== 'admin' || caller.status === 'disabled' || caller.status === 'deleting') {
    throw new UserDeletionError('permission-denied', 'Chỉ quản trị viên đang hoạt động được phép xóa tài khoản.');
  }
  if (callerUid === targetUid) {
    throw new UserDeletionError('failed-precondition', 'Quản trị viên không thể tự xóa tài khoản của mình.');
  }
  if (!target) throw new UserDeletionError('not-found', 'Không tìm thấy hồ sơ người dùng.');
  if (target.role === 'admin') {
    throw new UserDeletionError('failed-precondition', 'Không thể xóa tài khoản quản trị viên bằng chức năng này.');
  }
}

export async function deleteUserWorkflow(deps: {
  markDeleting: () => Promise<void>;
  revokeTokens: () => Promise<void>;
  deleteAuthUser: () => Promise<void>;
  markDisabledAfterAuthError: (error: unknown) => Promise<void>;
  removeProfile: () => Promise<void>;
  isAuthUserNotFound: (error: unknown) => boolean;
}): Promise<void> {
  await deps.markDeleting();
  try {
    await deps.revokeTokens();
    await deps.deleteAuthUser();
  } catch (error) {
    if (!deps.isAuthUserNotFound(error)) {
      await deps.markDisabledAfterAuthError(error);
      throw new UserDeletionError(
        'auth-delete-failed',
        'Không thể xóa tài khoản Authentication; hồ sơ đã bị khóa an toàn.',
      );
    }
  }

  try {
    await deps.removeProfile();
  } catch {
    throw new UserDeletionError(
      'profile-delete-failed',
      'Authentication đã xóa; cần gọi lại để hoàn tất xóa hồ sơ.',
    );
  }
}
