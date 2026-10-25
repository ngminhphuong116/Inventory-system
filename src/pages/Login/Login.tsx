import { useState, type CSSProperties } from "react";
import { Alert, Button, ConfigProvider, Form, Input, Popconfirm, theme as antdTheme } from "antd";
import {
  BarcodeOutlined,
  DatabaseOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { get, ref } from "firebase/database";
import { getFirebaseInstance, resetFirebaseConfig } from "../../services/firebase";
import { evaluateProfile } from "../../auth/authorization";
import "./Login.css";

interface LoginProps {
  onLoginSuccess: (user: { email: string; role: "admin" | "staff" }) => void;
}

function LoginContent({ onLoginSuccess }: LoginProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resettingConfig, setResettingConfig] = useState(false);
  const { token } = antdTheme.useToken();

  const handleChangeFirebaseConfig = async () => {
    setResettingConfig(true);
    setError(null);

    try {
      await resetFirebaseConfig();
      // Tránh giữ lại phiên đăng nhập thuộc Firebase project cũ khi quay về Setup.
      localStorage.removeItem("warehouse_current_user");
      window.location.reload();
    } catch {
      setError("Không thể xóa cấu hình Firebase. Vui lòng thử lại.");
      setResettingConfig(false);
    }
  };

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);

    try {
      const { auth, rtdb } = getFirebaseInstance();
      const userCredential = await signInWithEmailAndPassword(
        auth,
        values.email,
        values.password,
      );
      const firebaseUser = userCredential.user;
      const snapshot = await get(ref(rtdb, `users/${firebaseUser.uid}`));
      const userData = snapshot.val();

      const decision = evaluateProfile(
        firebaseUser.uid,
        firebaseUser.email,
        userData,
      );
      if (decision.kind === "invalid") {
        await signOut(auth);
        setError(decision.reason === "inactive"
          ? "Tài khoản không hoạt động. Vui lòng liên hệ quản trị viên để được hỗ trợ."
          : decision.reason === "role"
            ? "Vai trò tài khoản không hợp lệ. Vui lòng liên hệ quản trị viên."
            : decision.reason === "email"
              ? "Email tài khoản không hợp lệ. Vui lòng liên hệ quản trị viên."
              : "Không tìm thấy hồ sơ tài khoản hợp lệ.");
        return;
      }

      onLoginSuccess({
        email: decision.userInfo.email,
        role: decision.userInfo.role,
      });
    } catch (err: unknown) {
      const authError = err as { code?: string; message?: string };
      console.error("Lỗi đăng nhập:", err);

      if (
        authError.code === "auth/invalid-credential" ||
        authError.code === "auth/user-not-found" ||
        authError.code === "auth/wrong-password"
      ) {
        setError("Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại.");
      } else if (authError.code === "auth/network-request-failed") {
        setError(
          "Không thể kết nối đến máy chủ. Vui lòng kiểm tra đường truyền mạng.",
        );
      } else {
        setError("Đăng nhập thất bại. Vui lòng thử lại sau.");
      }
    } finally {
      setLoading(false);
    }
  };

  const pageStyle = {
    "--login-text": token.colorText,
    "--login-text-secondary": token.colorTextSecondary,
    "--login-border": token.colorBorder,
  } as CSSProperties;

  return (
    /*
     * THESIS: Một bàn giao ca trực kho rõ ràng; tránh màn hình đăng nhập dạng card nổi.
     * OWN-WORLD: Navy vận hành, bề mặt giấy sáng, chi tiết mã hàng.
     * STORY: Nhận diện hệ thống kho, xác thực tài khoản, tiếp tục phiên làm việc.
     * FIRST VIEWPORT: Tuyên ngôn vận hành bên trái; form gọn, tập trung bên phải.
     * FORM: Split-screen theo mẫu người dùng cung cấp, ưu tiên desktop Electron.
     */
    <main className="login-page" style={pageStyle}>
      <section className="login-showcase" aria-labelledby="login-product-title">
        <div className="login-showcase-inner">
          <header className="login-brand">
            <span className="login-brand-name">QUẢN LÝ KHO HÀNG</span>
          </header>

          <div className="login-product-copy">
            <p className="login-kicker">KHO HÀNG · BÁN HÀNG</p>
            <h1 id="login-product-title">
              Quản lý
              <strong>Kho hàng</strong>
            </h1>
            <p className="login-product-description">
              Kiểm soát tồn kho, nhập xuất và bán hàng trong một không gian vận
              hành tập trung.
            </p>

            <div className="login-operation-cue">
              <span className="login-scan-frame" aria-hidden="true">
                <BarcodeOutlined />
              </span>
              <p>
                Theo dõi hàng hóa
                <strong>chính xác theo từng giao dịch</strong>
              </p>
            </div>
          </div>

          <p className="login-workspace-label">INVENTORY OPERATIONS WORKSPACE</p>
        </div>
      </section>

      <section className="login-access" aria-labelledby="login-heading">
        <div className="login-access-inner">
          <header className="login-heading">
            <p className="login-access-kicker">NHÂN VIÊN VẬN HÀNH</p>
            <h2 id="login-heading">Chào mừng trở lại</h2>
            <p>Đăng nhập để tiếp tục phiên làm việc của bạn.</p>
          </header>

          {error && (
            <Alert
              className="login-alert"
              message={error}
              type="error"
              showIcon
              closable
              onClose={() => setError(null)}
            />
          )}

          <Form
            name="login_form"
            className="login-form"
            layout="vertical"
            requiredMark={false}
            onFinish={onFinish}
            disabled={loading}
          >
            <Form.Item
              label="Tài khoản"
              name="email"
              rules={[
                { required: true, message: "Vui lòng nhập email đăng nhập." },
                { type: "email", message: "Email chưa đúng định dạng." },
              ]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="Nhập email đăng nhập"
                size="large"
                autoComplete="username"
                autoFocus
              />
            </Form.Item>

            <Form.Item
              label="Mật khẩu"
              name="password"
              rules={[{ required: true, message: "Vui lòng nhập mật khẩu." }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="Nhập mật khẩu"
                size="large"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item className="login-submit-item">
              <Button
                type="primary"
                htmlType="submit"
                block
                size="large"
                loading={loading}
              >
                Đăng nhập
              </Button>
            </Form.Item>
          </Form>

          <div className="login-firebase-recovery">
            <p>Đăng nhập nhầm dự án Firebase?</p>
            <Popconfirm
              title="Đổi cấu hình Firebase?"
              description="Cấu hình hiện tại sẽ được xóa trên máy này để bạn kết nối với dự án Firebase khác."
              icon={<WarningOutlined className="login-firebase-warning-icon" />}
              okText="Đổi cấu hình"
              cancelText="Hủy"
              okButtonProps={{ danger: true, loading: resettingConfig }}
              onConfirm={handleChangeFirebaseConfig}
            >
              <Button
                className="login-change-firebase-button"
                type="text"
                icon={<DatabaseOutlined />}
                loading={resettingConfig}
                disabled={loading}
              >
                Đổi cấu hình Firebase
              </Button>
            </Popconfirm>
          </div>

          <footer className="login-access-footer">
            <span>
              <SafetyCertificateOutlined aria-hidden="true" />
              Hệ thống quản lý kho
            </span>
          </footer>
        </div>
      </section>
    </main>
  );
}

export default function Login(props: LoginProps) {
  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#1a2d4d",
          borderRadius: 8,
          controlHeightLG: 56,
        },
      }}
    >
      <LoginContent {...props} />
    </ConfigProvider>
  );
}
