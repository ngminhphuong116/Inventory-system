import { useState } from 'react';
import { App as AntApp, Modal, Input, Button, Popconfirm } from 'antd';
import { reauthenticateAdmin } from '../services/firebase';

interface LockScreenProps {
  isOpen: boolean;
  onUnlock: () => void;
  // Gọi khi người dùng chọn "Đăng xuất" thay vì xác thực lại — ví dụ vì
  // quên mật khẩu, hoặc tài khoản cũ không còn thuộc Firebase project
  // hiện tại (sau khi đổi cấu hình Firebase). Nên xóa luôn
  // warehouse_current_user và đưa người dùng về màn hình Login.
  onLogout: () => void;
}

export default function LockScreen({ isOpen, onUnlock, onLogout }: LockScreenProps) {
  const { message } = AntApp.useApp();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUnlock = async () => {
    setLoading(true);
    const isSuccess = await reauthenticateAdmin(password);
    if (isSuccess) {
      message.success('Đã xác thực thành công!');
      setPassword('');
      onUnlock();
    } else {
      message.error('Mật khẩu không chính xác!');
    }
    setLoading(false);
  };

  return (
    <Modal
      title="Xác thực mật khẩu để tiếp tục"
      open={isOpen}
      closable={false}
      footer={[
        <Popconfirm
          key="logout"
          title="Đăng xuất?"
          description="Bạn sẽ cần đăng nhập lại từ đầu bằng email và mật khẩu."
          okText="Đăng xuất"
          cancelText="Hủy"
          onConfirm={() => {
            setPassword('');
            onLogout();
          }}
        >
          <Button danger>Đăng xuất</Button>
        </Popconfirm>,
        <Button key="submit" type="primary" loading={loading} onClick={handleUnlock}>
          Xác nhận
        </Button>,
      ]}
    >
      <Input.Password
        placeholder="Nhập lại mật khẩu của bạn"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onPressEnter={handleUnlock}
        autoFocus
      />
    </Modal>
  );
}
