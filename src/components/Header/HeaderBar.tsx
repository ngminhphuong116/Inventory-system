import {
  ExclamationCircleOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MinusOutlined,
  PlusOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App as AntApp,
  Avatar,
  Button,
  Dropdown,
  Layout,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import "./HeaderBar.css";

const { Header } = Layout;
const { Text } = Typography;

interface HeaderBarProps {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  darkMode: boolean;
  zoom: number;
  setZoom: (value: number) => void;
  user: {
    email: string;
    role: string;
  };
  onLogout: () => void;
}

const clampZoom = (value: number) => Math.min(150, Math.max(70, value));

export default function HeaderBar({
  collapsed,
  setCollapsed,
  darkMode,
  zoom,
  setZoom,
  user,
  onLogout,
}: HeaderBarProps) {
  const { modal } = AntApp.useApp();
  const handleLogoutClick = () => {
    modal.confirm({
      title: "Xác nhận đăng xuất",
      icon: <ExclamationCircleOutlined style={{ color: "#d9952f" }} />,
      content: "Bạn có chắc chắn muốn đăng xuất khỏi hệ thống không?",
      okText: "Đăng xuất",
      cancelText: "Hủy",
      okButtonProps: { danger: true },
      centered: true,
      onOk: onLogout,
    });
  };

  const menuItems = [
    {
      key: "account",
      label: (
        <div className="header-account-detail">
          <Text type="secondary">Tài khoản</Text>
          <strong>{user?.email || "Chưa cập nhật"}</strong>
        </div>
      ),
    },
    {
      key: "role",
      label: (
        <div className="header-account-detail">
          <Text type="secondary">Vai trò</Text>
          <Tag color={user?.role === "admin" ? "volcano" : "blue"}>
            {user?.role === "admin" ? "QUẢN TRỊ VIÊN" : "NHÂN VIÊN"}
          </Tag>
        </div>
      ),
    },
    { type: "divider" as const },
    {
      key: "logout",
      danger: true,
      icon: <LogoutOutlined />,
      label: "Đăng xuất",
      onClick: handleLogoutClick,
    },
  ];

  return (
    <Header className={`app-header${darkMode ? " app-header-dark" : ""}`}>
      <div className="app-header-brand">
        <Tooltip
          title={
            collapsed
              ? "Mở rộng thanh điều hướng"
              : "Thu gọn thanh điều hướng"
          }
        >
          <Button
            type="text"
            icon={
              collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />
            }
            onClick={() => setCollapsed(!collapsed)}
            aria-label={
              collapsed
                ? "Mở rộng thanh điều hướng"
                : "Thu gọn thanh điều hướng"
            }
            className="app-header-menu-button"
          />
        </Tooltip>

        <div className="app-header-logo">
          <div>
            <strong>QUẢN LÝ KHO HÀNG</strong>
            <span>Inventory operations</span>
          </div>
        </div>
      </div>

      <div className="app-header-tools">
        <div className="app-zoom-control" aria-label="Điều chỉnh thu phóng">
          <Tooltip title="Thu nhỏ">
            <Button
              type="text"
              icon={<MinusOutlined />}
              disabled={zoom <= 70}
              onClick={() => setZoom(clampZoom(zoom - 10))}
              aria-label="Thu nhỏ giao diện"
            />
          </Tooltip>
          <Tooltip title="Đặt lại 100%">
            <Button
              type="text"
              className="app-zoom-value"
              onClick={() => setZoom(100)}
              aria-label={`Mức thu phóng ${zoom}%, nhấn để đặt lại 100%`}
            >
              {zoom}%
            </Button>
          </Tooltip>
          <Tooltip title="Phóng to">
            <Button
              type="text"
              icon={<PlusOutlined />}
              disabled={zoom >= 150}
              onClick={() => setZoom(clampZoom(zoom + 10))}
              aria-label="Phóng to giao diện"
            />
          </Tooltip>
        </div>

        <Dropdown
          menu={{ items: menuItems }}
          placement="bottomRight"
          trigger={["click"]}
        >
          <button className="app-profile-button" type="button">
            <Avatar icon={<UserOutlined />} />
            <span>{user?.email?.split("@")[0] || "Người dùng"}</span>
          </button>
        </Dropdown>
      </div>
    </Header>
  );
}
