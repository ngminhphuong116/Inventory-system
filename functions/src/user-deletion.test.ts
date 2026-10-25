import { describe, expect, it, vi } from 'vitest';
import {
  assertDeletionAllowed,
  deleteUserWorkflow,
  UserDeletionError,
} from './user-deletion.js';

const activeAdmin = { role: 'admin', status: 'active' };
const activeUser = { role: 'user', status: 'active' };

describe('user deletion authorization', () => {
  it('allows an active admin to delete a regular user', () => {
    expect(() => assertDeletionAllowed('admin', activeAdmin, 'user', activeUser)).not.toThrow();
  });

  it('rejects a non-admin caller', () => {
    expect(() => assertDeletionAllowed('user', activeUser, 'other', activeUser))
      .toThrowError(/quản trị viên/);
  });

  it('rejects self deletion', () => {
    expect(() => assertDeletionAllowed('admin', activeAdmin, 'admin', activeAdmin))
      .toThrowError(/tự xóa/);
  });

  it('rejects a missing target profile', () => {
    expect(() => assertDeletionAllowed('admin', activeAdmin, 'missing', null))
      .toThrowError(/Không tìm thấy/);
  });
});

function dependencies() {
  return {
    markDeleting: vi.fn(async () => undefined),
    revokeTokens: vi.fn(async () => undefined),
    deleteAuthUser: vi.fn(async () => undefined),
    markDisabledAfterAuthError: vi.fn(async () => undefined),
    removeProfile: vi.fn(async () => undefined),
    isAuthUserNotFound: (error: unknown) =>
      (error as { code?: string })?.code === 'auth/user-not-found',
  };
}

describe('idempotent user deletion workflow', () => {
  it('marks deleting, revokes tokens, deletes auth, then removes profile', async () => {
    const deps = dependencies();
    await deleteUserWorkflow(deps);
    expect(deps.markDeleting).toHaveBeenCalledOnce();
    expect(deps.revokeTokens).toHaveBeenCalledOnce();
    expect(deps.deleteAuthUser).toHaveBeenCalledOnce();
    expect(deps.removeProfile).toHaveBeenCalledOnce();
  });

  it('can finish a retry when Authentication is already deleted', async () => {
    const deps = dependencies();
    deps.revokeTokens.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    await deleteUserWorkflow(deps);
    expect(deps.removeProfile).toHaveBeenCalledOnce();
  });

  it('locks the profile if Authentication deletion fails', async () => {
    const deps = dependencies();
    deps.deleteAuthUser.mockRejectedValueOnce(new Error('auth unavailable'));
    await expect(deleteUserWorkflow(deps)).rejects.toBeInstanceOf(UserDeletionError);
    expect(deps.markDisabledAfterAuthError).toHaveBeenCalledOnce();
    expect(deps.removeProfile).not.toHaveBeenCalled();
  });

  it('returns a retryable error if profile removal fails after auth deletion', async () => {
    const deps = dependencies();
    deps.removeProfile.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(deleteUserWorkflow(deps)).rejects.toThrowError(/gọi lại/);
  });
});
