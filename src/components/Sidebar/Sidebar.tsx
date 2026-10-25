import { useState, useEffect } from "react";
import { Layout, Menu } from "antd";
import { useNavigate, useLocation } from "react-router-dom";
import {
  HomeOutlined,
  AppstoreOutlined,
  InboxOutlined,
  ExportOutlined,
  ShoppingCartOutlined,
  HistoryOutlined,
  BarChartOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import "./Sidebar.css";

const { Sider } = Layout;

interface Props {
  collapsed: boolean;
  user: {
    email: string;
    role: "admin" | "staff";
  };
}

const DAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

export default function Sidebar({ collapsed, user }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hh = String(time.getHours()).padStart(2, "0");
  const mm = String(time.getMinutes()).padStart(2, "0");
  const ss = String(time.getSeconds()).padStart(2, "0");
  const dd = String(time.getDate()).padStart(2, "0");
  const mo = String(time.getMonth() + 1).padStart(2, "0");
  const yy = time.getFullYear();
  const dayName = DAYS[time.getDay()];

  const menuItems = [
    {
      key: "grp-overview",
      type: "group" as const,
      label: collapsed ? null : "TỔNG QUAN",
      children: [
        { key: "/", icon: <HomeOutlined />, label: "Dashboard" },
      ],
    },
    {
      key: "grp-warehouse",
      type: "group" as const,
      label: collapsed ? null : "KHO HÀNG",
      children: [
        { key: "/product", icon: <AppstoreOutlined />, label: "Sản phẩm" },
        { key: "/import", icon: <InboxOutlined />, label: "Nhập kho" },
        { key: "/export", icon: <ExportOutlined />, label: "Xuất kho" },
        { key: "/sales", icon: <ShoppingCartOutlined />, label: "Bán hàng" },
      ],
    },
    {
      key: "grp-report",
      type: "group" as const,
      label: collapsed ? null : "BÁO CÁO",
      children: [
        { key: "/history", icon: <HistoryOutlined />, label: "Lịch sử" },
        user.role === "admin" && { key: "/report", icon: <BarChartOutlined />, label: "Báo cáo" },
      ].filter(Boolean),
    },
    {
      key: "grp-system",
      type: "group" as const,
      label: collapsed ? null : "HỆ THỐNG",
      children: [
        { key: "/setting", icon: <SettingOutlined />, label: "Cài đặt" },
      ],
    },
  ];

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      trigger={null}
      width={240}
      className="vpt-sidebar"
    >
      <div className="vpt-sidebar-userbox">
        {!collapsed && (
          <div className="vpt-clock-wrap">
            {/* Giờ lớn */}
            <div className="vpt-clock-time">
              <span className="vpt-clock-hm">{hh}:{mm}</span>
              <span className="vpt-clock-ss">{ss}</span>
            </div>
            {/* Ngày */}
            <div className="vpt-clock-date">
              <span className="vpt-clock-dayname">{dayName}</span>
              <span className="vpt-clock-sep">·</span>
              <span>{dd}/{mo}/{yy}</span>
            </div>
            {/* Đường kẻ mờ ngăn cách */}
            <div className="vpt-clock-divider" />
          </div>
        )}

        {/* Badge quyền */}
        <div className="vpt-role-wrap">
          {collapsed ? (
            <div className="vpt-role-dot" title={user.role === "admin" ? "Admin" : "Staff"}>
              <SafetyCertificateOutlined />
            </div>
          ) : (
            <div className="vpt-role-pill">
              <SafetyCertificateOutlined />
              <span>{user.role === "admin" ? "Admin" : "Staff"}</span>
            </div>
          )}
        </div>
      </div>

      <Menu
        mode="inline"
        selectedKeys={[location.pathname]}
        onClick={({ key }) => navigate(key)}
        items={menuItems as any}
        className="vpt-sidebar-menu"
      />
    </Sider>
  );
}
