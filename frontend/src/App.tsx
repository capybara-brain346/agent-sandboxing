import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { RepoSelectPage } from "./pages/RepoSelectPage";
import { ChatWorkspacePage } from "./pages/ChatWorkspacePage";
import { LoginPage } from "./pages/LoginPage";
import { AuthRedirectPage } from "./pages/AuthRedirectPage";

const App = () => (
  <AppShell>
    <Routes>
      <Route path="/" element={<AuthRedirectPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/repos" element={<RepoSelectPage />} />
      <Route path="/sessions/:sessionId" element={<ChatWorkspacePage />} />
    </Routes>
  </AppShell>
);

export default App;
