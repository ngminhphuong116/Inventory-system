import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { off, onValue, ref, type DataSnapshot } from 'firebase/database';
import { App as AntApp } from 'antd';
import { getFirebaseInstance } from '../services/firebase';
import {
  canAccessAdminOnlyRoute,
  evaluateProfile,
  type UserInfo,
  type UserPermissions,
} from './authorization';

export interface UserAuthorizationValue {
  userInfo: UserInfo | null;
  loading: boolean;
  isAdmin: boolean;
  hasPermission: (key: keyof UserPermissions) => boolean;
}

export const UserAuthorizationContext = createContext<UserAuthorizationValue | null>(null);

export function UserAuthorizationProvider({
  children,
  onSessionInvalid,
}: {
  children: ReactNode;
  onSessionInvalid: () => void;
}) {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(true);
  const invalidatedRef = useRef(false);

  const invalidateSession = useCallback(async (notice: string) => {
    if (invalidatedRef.current) return;
    invalidatedRef.current = true;
    message.warning(notice);
    try {
      await signOut(getFirebaseInstance().auth);
    } finally {
      setUserInfo(null);
      onSessionInvalid();
    }
  }, [message, onSessionInvalid]);

  useEffect(() => {
    const { auth, rtdb } = getFirebaseInstance();
    let unsubscribeProfile: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      unsubscribeProfile?.();
      unsubscribeProfile = undefined;
      invalidatedRef.current = false;

      if (!firebaseUser) {
        setUserInfo(null);
        setLoading(false);
        if (!invalidatedRef.current) {
          invalidatedRef.current = true;
          message.warning('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
          onSessionInvalid();
        }
        return;
      }

      setLoading(true);
      const profileRef = ref(rtdb, `users/${firebaseUser.uid}`);
      const handler = (snapshot: DataSnapshot) => {
        if (!snapshot.exists()) {
          setLoading(false);
          void invalidateSession('Hồ sơ tài khoản không còn tồn tại. Vui lòng đăng nhập lại.');
          return;
        }

        const decision = evaluateProfile(firebaseUser.uid, firebaseUser.email, snapshot.val());
        if (decision.kind === 'invalid') {
          setLoading(false);
          const notice = decision.reason === 'missing'
            ? 'Không tìm thấy hồ sơ tài khoản. Vui lòng liên hệ quản trị viên.'
            : decision.reason === 'role'
              ? 'Vai trò tài khoản không hợp lệ. Vui lòng liên hệ quản trị viên.'
              : decision.reason === 'email'
                ? 'Email tài khoản không hợp lệ. Vui lòng liên hệ quản trị viên.'
                : 'Tài khoản của bạn không hoạt động. Bạn sẽ được đăng xuất.';
          void invalidateSession(notice);
          return;
        }
        setUserInfo(decision.userInfo);
        setLoading(false);
      };

      onValue(profileRef, handler, () => {
        setLoading(false);
        void invalidateSession('Không thể xác minh quyền tài khoản. Vui lòng đăng nhập lại.');
      });
      unsubscribeProfile = () => off(profileRef, 'value', handler);
    });

    return () => {
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, [invalidateSession, message, onSessionInvalid]);

  const value = useMemo<UserAuthorizationValue>(() => ({
    userInfo,
    loading,
    isAdmin: canAccessAdminOnlyRoute(userInfo),
    hasPermission: (key) => {
      if (!userInfo) return false;
      return userInfo.role === 'admin' || Boolean(userInfo.permissions[key]);
    },
  }), [loading, userInfo]);

  return (
    <UserAuthorizationContext.Provider value={value}>
      {children}
    </UserAuthorizationContext.Provider>
  );
}
