import { lazy, Suspense, useCallback, useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Spin } from "antd";
import { signOut } from "firebase/auth";

import MainLayout from "../components/Layout/MainLayout";
import Login from "../pages/Login/Login";
import AccessDenied from "../components/AccessDenied";
import LockScreen from "../components/LockScreen";
import { useUserRole } from "../hooks/Useuserrole";
import { UserAuthorizationProvider } from "../auth/UserAuthorizationContext";
import { tryGetFirebaseInstance } from "../services/firebase";

const Dashboard = lazy(() => import("../pages/Dashboard/Dashboard"));
const Product = lazy(() => import("../pages/Product/Product"));
const ImportPage = lazy(() => import("../pages/ImportStock/Import"));
const ExportPage = lazy(() => import("../pages/Export/Export"));
const History = lazy(() => import("../pages/History/History"));
const Report = lazy(() => import("../pages/ReportStock/Report"));
const Setting = lazy(() => import("../pages/Setting/Setting"));
const SalesPage = lazy(() => import("../pages/Sales/Sales"));

type CurrentUser = { email: string; role: 'admin' | 'staff' };

function RouteLoading() {
  return <Spin style={{ display: "block", margin: "40px auto" }} />;
}

function AuthorizedRoutes({
  user,
  isLocked,
  onUnlock,
  onLogout,
}: {
  user: CurrentUser;
  isLocked: boolean;
  onUnlock: () => void;
  onLogout: () => void;
}) {
  const { hasPermission, isAdmin, loading } = useUserRole();
  if (loading) return <RouteLoading />;

  return (
    <>
      <LockScreen isOpen={isLocked} onUnlock={onUnlock} onLogout={onLogout} />
      <HashRouter>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route element={<MainLayout user={user} onLogout={onLogout} />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/product" element={hasPermission('product') ? <Product /> : <AccessDenied />} />
              <Route path="/sales" element={hasPermission('sales') ? <SalesPage /> : <AccessDenied />} />
              <Route path="/import" element={hasPermission('import') ? <ImportPage /> : <AccessDenied />} />
              <Route path="/export" element={hasPermission('export') ? <ExportPage /> : <AccessDenied />} />
              <Route path="/history" element={hasPermission('history') ? <History /> : <AccessDenied />} />
              <Route path="/setting" element={<Setting />} />
              <Route path="/report" element={isAdmin ? <Report /> : <AccessDenied />} />
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </>
  );
}

export default function AppRouter() {
  const [user, setUser] = useState<CurrentUser | null>(() => {
    const savedUser = localStorage.getItem("warehouse_current_user");
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [isLocked, setIsLocked] = useState(() =>
    localStorage.getItem("warehouse_current_user") !== null
  );

  const handleLoginSuccess = useCallback((userData: CurrentUser) => {
    setUser(userData);
    setIsLocked(false);
    localStorage.setItem("warehouse_current_user", JSON.stringify(userData));
  }, []);

  const handleLogout = useCallback(async () => {
    setUser(null);
    setIsLocked(false);
    localStorage.removeItem("warehouse_current_user");
    try {
      const instance = tryGetFirebaseInstance();
      if (instance?.auth.currentUser) await signOut(instance.auth);
    } catch (error) {
      console.error("Firebase sign-out failed", error);
    }
  }, []);

  if (!user) return <Login onLoginSuccess={handleLoginSuccess} />;

  return (
    <UserAuthorizationProvider onSessionInvalid={handleLogout}>
      <AuthorizedRoutes
        user={user}
        isLocked={isLocked}
        onUnlock={() => setIsLocked(false)}
        onLogout={handleLogout}
      />
    </UserAuthorizationProvider>
  );
}
