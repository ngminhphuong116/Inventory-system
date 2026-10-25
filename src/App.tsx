import { useState } from "react";
import { App as AntApp, ConfigProvider } from "antd";
import AppRouter from "./router/AppRouter";
import FirebaseSetup from "./services/Firebasesetup";
import { hasFirebaseConfig } from "./services/firebase";
import { APP_FONT_FAMILY } from "./theme/typography";

export default function App() {
  const [isConfigured, setIsConfigured] = useState<boolean>(() =>
    hasFirebaseConfig(),
  );

  return (
    <ConfigProvider
      theme={{
        token: {
          fontFamily: APP_FONT_FAMILY,
          fontSize: 14,
          fontWeightStrong: 600,
          lineHeight: 1.55,
        },
      }}
    >
      <AntApp>
        {!isConfigured ? (
          <FirebaseSetup onSetupComplete={() => setIsConfigured(true)} />
        ) : (
          <AppRouter />
        )}
      </AntApp>
    </ConfigProvider>
  );
}
