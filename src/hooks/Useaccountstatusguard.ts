import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { ref, onValue, off, type DataSnapshot } from 'firebase/database';
import { App as AntApp } from 'antd';
import { getFirebaseInstance } from '../services/firebase';

/**
 * Lắng nghe real-time trạng thái (status) của chính tài khoản đang đăng nhập.
 * Nếu tài khoản không còn trạng thái active, người dùng sẽ tự động bị đăng xuất
 * ngay lập tức (không cần load lại trang).
 *
 * Gắn hook này ở tầng cao nhất sau khi đã đăng nhập, ví dụ trong MainLayout.
 *
 * @param onForceLogout callback chạy sau khi signOut thành công (vd: cập nhật state user ở App.tsx)
 */
export function useAccountStatusGuard(onForceLogout: () => void) {
  const { message } = AntApp.useApp();
  const [uid, setUid] = useState<string | null>(null);
  // Tránh trigger logout nhiều lần nếu Firebase bắn callback lặp lại
  const hasTriggeredRef = useRef(false);

  // Theo dõi xem ai đang đăng nhập (đổi tài khoản thì đổi luôn listener bên dưới)
  useEffect(() => {
    // Hook này chỉ nên gắn sau khi đã đăng nhập (vd: MainLayout), tức là
    // chắc chắn đã qua FirebaseSetup, nên getFirebaseInstance() không nên throw.
    // Vẫn bọc try/catch để tránh crash nếu thứ tự render thay đổi sau này.
    let auth;
    try {
      auth = getFirebaseInstance().auth;
    } catch {
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      hasTriggeredRef.current = false;
      setUid(firebaseUser?.uid ?? null);
    });
    return () => unsubscribe();
  }, []);

  // Lắng nghe real-time status/{uid} của chính người đang đăng nhập
  useEffect(() => {
    if (!uid) return;

    let rtdb;
    try {
      rtdb = getFirebaseInstance().rtdb;
    } catch {
      return;
    }
    const statusRef = ref(rtdb, `users/${uid}/status`);

    const handler = (snapshot: DataSnapshot) => {
      const status = snapshot.val();
      if (status !== 'active' && !hasTriggeredRef.current) {
        hasTriggeredRef.current = true;
        message.warning('Tài khoản của bạn không hoạt động. Bạn sẽ được đăng xuất...');
        setTimeout(async () => {
          try {
            const { auth } = getFirebaseInstance();
            await signOut(auth);
          } catch {
            // Firebase đã bị reset (vd: do resetFirebaseConfig) — bỏ qua, vẫn gọi callback bên dưới
          }
          onForceLogout();
        }, 1500);
      }
    };

    onValue(statusRef, handler);
    return () => off(statusRef, 'value', handler);
  }, [message, uid, onForceLogout]);
}
