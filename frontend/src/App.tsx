import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { NewTaskPage } from "./pages/NewTaskPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";

const App = () => (
  <AppShell>
    <Routes>
      <Route path="/" element={<NewTaskPage />} />
      <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
    </Routes>
  </AppShell>
);

export default App;
