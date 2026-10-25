import { initializeApp, getApps, deleteApp } from "firebase/app";
import type { FirebaseApp } from "firebase/app";
import { getAuth, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import type { Auth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import type { Database } from "firebase/database";
import { getFunctions } from "firebase/functions";
import type { Functions } from "firebase/functions";

export const FIREBASE_FUNCTIONS_REGION = "us-central1";

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

interface FirebaseInstance {
  app: FirebaseApp;
  auth: Auth;
  rtdb: Database;
  functions: Functions;
}

function createFirebaseInstance(app: FirebaseApp): FirebaseInstance {
  return {
    app,
    auth: getAuth(app),
    rtdb: getDatabase(app),
    functions: getFunctions(app, FIREBASE_FUNCTIONS_REGION),
  };
}

function getBrowserStorage(): Storage | null {
  return typeof globalThis.localStorage === "undefined"
    ? null
    : globalThis.localStorage;
}

// ✅ Khởi tạo Firebase động từ config lưu trong localStorage
function initFirebase(): FirebaseInstance | null {
  const saved = getBrowserStorage()?.getItem("firebase_config");
  if (!saved) return null;

  try {
    const config: FirebaseConfig = JSON.parse(saved);

    if (getApps().length > 0) {
      const app = getApps()[0];
      return createFirebaseInstance(app);
    }

    const app = initializeApp(config);
    return createFirebaseInstance(app);
  } catch {
    return null;
  }
}

let _instance = initFirebase();

/**
 * Lấy instance Firebase hiện tại (app, auth, rtdb).
 * Throw lỗi nếu chưa setup config — ép caller phải kiểm tra hasFirebaseConfig()
 * hoặc đảm bảo hook/component này chỉ render sau khi đã setup xong (sau FirebaseSetup).
 */
export const getFirebaseInstance = (): FirebaseInstance => {
  if (!_instance) {
    throw new Error(
      "Firebase chưa được khởi tạo. Hãy đảm bảo người dùng đã hoàn tất màn hình FirebaseSetup trước khi gọi getFirebaseInstance()."
    );
  }
  return _instance;
};

/**
 * Bản an toàn, không throw — dùng ở nơi cần kiểm tra "đã có config chưa"
 * mà không muốn try/catch (vd: AppRouter quyết định hiện Setup hay không).
 */
export const tryGetFirebaseInstance = (): FirebaseInstance | null => _instance;

// Gọi sau khi user lưu config mới
export const reinitFirebase = async (config: FirebaseConfig) => {
  for (const app of getApps()) {
    await deleteApp(app);
  }
  getBrowserStorage()?.setItem("firebase_config", JSON.stringify(config));
  const app = initializeApp(config);
  _instance = createFirebaseInstance(app);
  return _instance;
};

// Hàm xác thực lại mật khẩu
export const reauthenticateAdmin = async (password: string): Promise<boolean> => {
  const instance = tryGetFirebaseInstance();
  if (!instance) return false;
  const user = instance.auth.currentUser;
  if (user && user.email) {
    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
      return true;
    } catch {
      return false;
    }
  }
  return false;
};

export const hasFirebaseConfig = (): boolean => {
  return Boolean(getBrowserStorage()?.getItem("firebase_config"));
};

/**
 * Xóa config hiện tại, dùng cho nút "Đổi công ty / Reset Firebase".
 * Sau khi gọi, nhớ điều hướng người dùng về màn hình FirebaseSetup
 * (ví dụ reload trang hoặc set state ở App.tsx).
 */
export const resetFirebaseConfig = async (): Promise<void> => {
  for (const app of getApps()) {
    await deleteApp(app);
  }
  getBrowserStorage()?.removeItem("firebase_config");
  _instance = null;
};
