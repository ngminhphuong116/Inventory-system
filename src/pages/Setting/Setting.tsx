import { useOutletContext } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Form,
  Input,
  Popconfirm,
  Row,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { 
  FormatPainterOutlined, 
  InfoCircleOutlined,
  DatabaseOutlined,
  SaveOutlined,
  WarningOutlined
} from '@ant-design/icons';
import {
  dbService,
  type BusinessSettings,
} from '../../components/Db';
import { useUserRole } from '../../hooks/Useuserrole'; // Nhớ kiểm tra lại đường dẫn import hook
import { resetFirebaseConfig } from '../../services/firebase';
import { formatFirebaseError } from '../../services/data-integrity';
import UserManagement from '../../components/UserManagement';
import BackupRestorePanel from '../../features/backup/BackupRestorePanel';
import "../Dashboard/Dashboard.css";

const { Title, Text } = Typography;

interface ContextType { 
  darkMode: boolean; 
  setDarkMode?: (val: boolean) => void; 
}

export default function Setting() {
  const { message } = AntApp.useApp();
  const { darkMode, setDarkMode } = useOutletContext<ContextType>();
  const [businessForm] = Form.useForm<BusinessSettings>();
  const { isAdmin } = useUserRole();
  const [resetting, setResetting] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);

  useEffect(() => dbService.onBusinessSettings((settings) => {
    businessForm.setFieldsValue(settings);
  }), [businessForm]);

  const handleToggleTheme = (checked: boolean) => {
    if (setDarkMode) {
      setDarkMode(checked);
      localStorage.setItem('warehouse_theme', checked ? 'dark' : 'light');
    }
  };

  const handleResetFirebase = async () => {
    setResetting(true);
    try {
      await resetFirebaseConfig();
      // Quan trọng: phải xóa luôn user đã lưu, nếu không LockScreen sẽ cố
      // xác thực lại tài khoản CŨ trên Firebase project MỚI (không tồn tại
      // tài khoản đó) → luôn báo sai mật khẩu, kẹt người dùng không lối thoát.
      localStorage.removeItem('warehouse_current_user');
      message.success('Đã xóa cấu hình Firebase. Ứng dụng sẽ tải lại...');
      setTimeout(() => window.location.reload(), 1000);
    } catch {
      message.error('Không thể xóa cấu hình Firebase. Vui lòng thử lại.');
      setResetting(false);
    }
  };

  const handleSaveBusiness = async (values: BusinessSettings) => {
    setSavingBusiness(true);
    try {
      await dbService.saveBusinessSettings(values);
      message.success('Đã lưu thông tin doanh nghiệp.');
    } catch (error: unknown) {
      message.error(formatFirebaseError(error));
    } finally {
      setSavingBusiness(false);
    }
  };

  return (
    <div className="setting-page" style={{ padding: 24, minHeight: '100vh', background: darkMode ? '#141414' : '#f5f7fa' }}>
      
      <Title style={{ fontSize: 32, fontWeight: 650, lineHeight: 1.25, letterSpacing: '-0.015em', marginBottom: 24, color: darkMode ? '#fff' : '#000' }}>
        Cài đặt hệ thống
      </Title>

      <Row gutter={[24, 24]}>
        {/* CỘT TRÁI: GIAO DIỆN & THÔNG TIN */}
        <Col xs={24} lg={12}>
          <Card
            title={<><InfoCircleOutlined /> Thông tin doanh nghiệp</>}
            variant="borderless"
            style={{ borderRadius: 8, marginBottom: 24 }}
          >
            <Form
              form={businessForm}
              layout="vertical"
              onFinish={handleSaveBusiness}
              disabled={!isAdmin || savingBusiness}
              initialValues={{ businessName: '', address: '', phone: '' }}
            >
              <Form.Item
                label="Tên doanh nghiệp"
                name="businessName"
                rules={[
                  { required: true, whitespace: true, message: 'Tên doanh nghiệp không được để trống.' },
                  { max: 200, message: 'Tên doanh nghiệp không được vượt quá 200 ký tự.' },
                ]}
              >
                <Input maxLength={200} />
              </Form.Item>
              <Form.Item label="Địa chỉ" name="address">
                <Input.TextArea rows={2} maxLength={300} />
              </Form.Item>
              <Form.Item label="Số điện thoại" name="phone">
                <Input maxLength={50} />
              </Form.Item>
              {isAdmin && (
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SaveOutlined />}
                  loading={savingBusiness}
                >
                  Lưu thông tin doanh nghiệp
                </Button>
              )}
            </Form>
          </Card>

          <Card title={<><FormatPainterOutlined /> Giao diện</>} variant="borderless" style={{ borderRadius: 8, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text strong>Chế độ Ban đêm (Dark Mode)</Text>
              <Switch checked={darkMode} onChange={handleToggleTheme} />
            </div>
          </Card>

          <Card title={<><InfoCircleOutlined /> Thông tin phần mềm</>} variant="borderless" style={{ borderRadius: 8, marginBottom: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><Text strong>Phiên bản:</Text><Tag color="blue">v1.0.0</Tag></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><Text strong>Database:</Text><Tag color="green">Firebase Realtime</Tag></div>
            </div>
          </Card>

          {/* MỌI USER ĐỀU CÓ THỂ ĐỔI/RESET CẤU HÌNH FIREBASE — có Popconfirm cảnh báo kỹ */}
          <Card 
            title={<><DatabaseOutlined /> Cấu hình cơ sở dữ liệu</>} 
            variant="borderless"
            style={{ borderRadius: 8, borderLeft: '3px solid #ff4d4f' }}
          >
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              Đổi sang một Firebase project khác (ví dụ: dùng cho công ty/chi nhánh khác trên máy này).
              Sau khi xác nhận, bạn sẽ cần đăng nhập lại với tài khoản thuộc project Firebase mới.
            </Text>
            <Popconfirm
              title="Đổi cấu hình Firebase?"
              description={
                <span>
                  Máy này sẽ ngắt kết nối khỏi database hiện tại.<br />
                  Bạn cần thông tin Firebase mới (databaseURL, apiKey...) để kết nối lại.<br />
                  Nếu không có sẵn thông tin này, hãy liên hệ quản trị viên trước khi tiếp tục.
                </span>
              }
              icon={<WarningOutlined style={{ color: '#ff4d4f' }} />}
              okText="Xác nhận đổi"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
              onConfirm={handleResetFirebase}
            >
              <Button danger icon={<DatabaseOutlined />} loading={resetting}>
                Đổi cấu hình Firebase
              </Button>
            </Popconfirm>
          </Card>
        </Col>

        {/* CỘT PHẢI: QUẢN LÝ TÀI KHOẢN (CHỈ ADMIN THẤY) */}
        {isAdmin && (
          <Col xs={24} lg={12}>
            <UserManagement />
          </Col>
        )}
        {isAdmin && (
          <Col xs={24}>
            <BackupRestorePanel />
          </Col>
        )}
      </Row>
    </div>
  );
}
