import { Route, Routes } from "react-router-dom";
import { NewTaskPage } from "./pages/NewTaskPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";

const App = () => (
  <Routes>
    <Route path="/" element={<NewTaskPage />} />
    <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
  </Routes>
);

export default App;
