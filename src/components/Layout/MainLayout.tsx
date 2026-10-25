import { useEffect, useState, type CSSProperties } from "react";
import { ConfigProvider, Layout, theme } from "antd";
import { Outlet } from "react-router-dom";
import HeaderBar from "../Header/HeaderBar";
import Sidebar from "../Sidebar/Sidebar";
import "./MainLayout.css";

const { Content } = Layout;

interface MainLayoutProps {
  user: {
    email: string;
    role: "admin" | "staff";
  };
  onLogout: () => void;
}

export default function MainLayout({ user, onLogout }: MainLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [zoom, setZoom] = useState(() => {
    const savedZoom = Number(localStorage.getItem("warehouse_zoom"));
    return Number.isFinite(savedZoom) && savedZoom >= 70 && savedZoom <= 150
      ? savedZoom
      : 100;
  });
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("warehouse_theme") === "dark",
  );

  useEffect(() => {
    localStorage.setItem("warehouse_zoom", String(zoom));
  }, [zoom]);

  useEffect(() => {
    document.body.classList.add("warehouse-shell-active");
    return () => document.body.classList.remove("warehouse-shell-active");
  }, []);

  return (
    <ConfigProvider
      theme={{
        algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <Layout
        className={`app-shell${darkMode ? " app-shell-dark" : ""}`}
      >
        <Sidebar
          collapsed={collapsed}
          user={user}
        />

        <Layout className="app-shell-main">
          <HeaderBar
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            darkMode={darkMode}
            zoom={zoom}
            setZoom={setZoom}
            user={user}
            onLogout={onLogout}
          />

          <Content
            className="app-shell-scroll"
          >
            <div className="app-content-panel">
              <div
                className="app-zoom-surface"
                style={{ zoom: zoom / 100 } as CSSProperties}
              >
                <Outlet context={{ darkMode, setDarkMode }} />
              </div>
            </div>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
