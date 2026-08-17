import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, createTask } from "../api/client";

export const NewTaskPage = () => {
  const navigate = useNavigate();
  const [repoRef, setRepoRef] = useState("./repo");
  const [instructions, setInstructions] = useState("");
  const [image, setImage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await createTask({
        repoRef,
        instructions,
        ...(image.trim() ? { image: image.trim() } : {}),
      });
      navigate(`/tasks/${response.taskId}`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Failed to create task",
      );
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <h1>New Task</h1>
      <form onSubmit={onSubmit} className="task-form">
        <label>
          Repo ref
          <input
            value={repoRef}
            onChange={(event) => setRepoRef(event.target.value)}
            required
          />
        </label>
        <label>
          Instructions
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={6}
            required
          />
        </label>
        <label>
          Image (optional)
          <input
            value={image}
            onChange={(event) => setImage(event.target.value)}
            placeholder="node:22-bookworm"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create task"}
        </button>
      </form>
    </main>
  );
};
