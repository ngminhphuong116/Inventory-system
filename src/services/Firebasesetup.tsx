import { useState } from "react";
import { App as AntApp, Form, Input, Button, Card, Typography, Alert, Steps } from "antd";
import { DatabaseOutlined, CheckCircleOutlined, SettingOutlined } from "@ant-design/icons";
import {
  reinitFirebase,
  resetFirebaseConfig,
  type FirebaseConfig,
} from "../services/firebase";

const { Title, Text, Paragraph } = Typography;

interface Props {
  onSetupComplete: () => void;
}

export default function FirebaseSetup({ onSetupComplete }: Props) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const handleSubmit = async (values: FirebaseConfig) => {
    setLoading(true);
    setError(null);
    try {
      // Kiểm tra định dạng databaseURL cơ bản trước khi khởi tạo,
      // tránh lỗi khó hiểu phát sinh từ Firebase SDK khi URL sai định dạng.
      if (!/^https:\/\/.+\.(firebasedatabase\.app|firebaseio\.com)\/?$/.test(values.databaseURL.trim())) {
        throw new Error("INVALID_URL_FORMAT");
      }

      const instance = await reinitFirebase(values);
      if (!instance.auth) throw new Error("INIT_FAILED");

      message.success("Kết nối Firebase thành công!");
      setStep(2);
      setTimeout(() => onSetupComplete(), 1200);
    } catch (err: unknown) {
      await resetFirebaseConfig();
      console.error("Lỗi kết nối Firebase:", err);
      const errorMessage = err instanceof Error ? err.message : "";
      setError(
        errorMessage === "INVALID_URL_FORMAT"
          ? "Database URL không đúng định dạng. Phải có dạng https://...firebasedatabase.app hoặc https://...firebaseio.com"
          : errorMessage.startsWith("Firebase project không hợp lệ")
            ? errorMessage
          : "Không thể kết nối Firebase. Vui lòng kiểm tra lại thông tin cấu hình."
      );
      setStep(0);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #f0f7ff 0%, #e6f4ff 100%)", padding: "24px"
    }}>
      <div style={{ width: "100%", maxWidth: 560 }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%", background: "#1890ff",
            display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16
          }}>
            <DatabaseOutlined style={{ fontSize: 28, color: "#fff" }} />
          </div>
          <Title level={3} style={{ margin: 0 }}>Thiết lập cơ sở dữ liệu</Title>
          <Text type="secondary">Nhập thông tin Firebase để bắt đầu sử dụng hệ thống</Text>
        </div>

        {/* Steps */}
        <Steps
          current={step}
          style={{ marginBottom: 24 }}
          items={[
            { title: "Cấu hình", icon: <SettingOutlined /> },
            { title: "Kết nối", icon: <DatabaseOutlined /> },
            { title: "Hoàn tất", icon: <CheckCircleOutlined /> },
          ]}
        />

        <Card variant="borderless" style={{ borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
          {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}

          {step === 2 ? (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <CheckCircleOutlined style={{ fontSize: 48, color: "#52c41a" }} />
              <Title level={4} style={{ marginTop: 16 }}>Kết nối thành công!</Title>
              <Text type="secondary">Đang chuyển đến màn hình đăng nhập...</Text>
            </div>
          ) : (
            <>
              <Paragraph type="secondary" style={{ marginBottom: 16, fontSize: 13 }}>
                Lấy thông tin tại: <strong>Firebase Console → Project Settings → Your apps → Web app → firebaseConfig</strong>
              </Paragraph>

              <Form
                form={form}
                layout="vertical"
                onFinish={handleSubmit}
                autoComplete="off"
              >
                <Form.Item label="API Key" name="apiKey" rules={[{ required: true, message: "Nhập API Key" }]}>
                  <Input placeholder="AIzaSy..." />
                </Form.Item>
                <Form.Item label="Auth Domain" name="authDomain" rules={[{ required: true }]}>
                  <Input placeholder="your-app.firebaseapp.com" />
                </Form.Item>
                <Form.Item label="Database URL" name="databaseURL" rules={[{ required: true, message: "Nhập Database URL" }]}>
                  <Input placeholder="https://your-app-default-rtdb.asia-southeast1.firebasedatabase.app" />
                </Form.Item>
                <Form.Item label="Project ID" name="projectId" rules={[{ required: true, message: "Nhập Project ID" }]}>
                  <Input placeholder="your-firebase-project-id" />
                </Form.Item>
                <Form.Item label="Storage Bucket" name="storageBucket" rules={[{ required: true }]}>
                  <Input placeholder="your-app.firebasestorage.app" />
                </Form.Item>
                <Form.Item label="Messaging Sender ID" name="messagingSenderId" rules={[{ required: true }]}>
                  <Input placeholder="123456789" />
                </Form.Item>
                <Form.Item label="App ID" name="appId" rules={[{ required: true }]}>
                  <Input placeholder="1:123456789:web:abcdef..." />
                </Form.Item>

                <Form.Item style={{ marginTop: 8, marginBottom: 0 }}>
                  <Button
                    type="primary" htmlType="submit" block size="large"
                    loading={loading} icon={<DatabaseOutlined />}
                    onClick={() => setStep(1)}
                  >
                    Kết nối Firebase
                  </Button>
                </Form.Item>
              </Form>
            </>
          )}
        </Card>

        <Text type="secondary" style={{ display: "block", textAlign: "center", marginTop: 16, fontSize: 12 }}>
          Thông tin cấu hình được lưu cục bộ trên máy này và không gửi đi đâu khác.
        </Text>
      </div>
    </div>
  );
}
