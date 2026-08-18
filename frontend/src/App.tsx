import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { RepoSelectPage } from "./pages/RepoSelectPage";
import { ChatWorkspacePage } from "./pages/ChatWorkspacePage";

const App = () => (
  <AppShell>
    <Routes>
      <Route path="/" element={<RepoSelectPage />} />
      <Route path="/sessions/:sessionId" element={<ChatWorkspacePage />} />
    </Routes>
  </AppShell>
);

export default App;
