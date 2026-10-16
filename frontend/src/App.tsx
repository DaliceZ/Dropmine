import { TransferPage } from "./pages/transfer";
import { PreferencesProvider } from "./contexts/PreferencesContext";

export function App() {
  return (
    <PreferencesProvider>
      <TransferPage />
    </PreferencesProvider>
  );
}
