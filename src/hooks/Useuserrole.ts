import { useContext } from 'react';
import {
  UserAuthorizationContext,
} from '../auth/UserAuthorizationContext';
import type { UserPermissions, UserRole } from '../auth/authorization';

export type { UserPermissions, UserRole };

/**
 * Nguồn quyền dùng chung của toàn ứng dụng. Provider duy nhất lắng nghe realtime
 * users/{uid}; mọi component đọc cùng một state nên không tạo listener trùng.
 */
export function useUserRole() {
  const value = useContext(UserAuthorizationContext);
  if (!value) {
    throw new Error('useUserRole phải được dùng bên trong UserAuthorizationProvider.');
  }
  return value;
}
