import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { RepoSelectPage } from "./pages/RepoSelectPage";
import { ChatWorkspacePage } from "./pages/ChatWorkspacePage";
import { LoginPage } from "./pages/LoginPage";
import { AuthRedirectPage } from "./pages/AuthRedirectPage";

const App = () => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<AppShell />}>
      <Route path="/" element={<AuthRedirectPage />} />
      <Route path="/repos" element={<RepoSelectPage />} />
      <Route path="/sessions/:sessionId" element={<ChatWorkspacePage />} />
    </Route>
  </Routes>
);

export default App;
