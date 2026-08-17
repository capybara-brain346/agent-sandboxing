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
        caught instanceof ApiError ? caught.message : "Failed to create run",
      );
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <div className="page-header">
        <h1>New run</h1>
        <p className="page-subtitle">
          Start an agent run in a sandbox against a repository.
        </p>
      </div>
      <div className="panel">
        <div className="panel__body">
          <form onSubmit={onSubmit} className="form">
            <div className="field">
              <label className="field__label" htmlFor="repoRef">
                Repo ref
              </label>
              <input
                id="repoRef"
                value={repoRef}
                onChange={(event) => setRepoRef(event.target.value)}
                required
              />
              <span className="field__hint">
                Path or reference to the repository the sandbox checks out.
              </span>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="instructions">
                Instructions
              </label>
              <textarea
                id="instructions"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                rows={8}
                required
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="image">
                Image (optional)
              </label>
              <input
                id="image"
                value={image}
                onChange={(event) => setImage(event.target.value)}
                placeholder="node:22-bookworm"
              />
              <span className="field__hint">
                Defaults to the sandbox's built-in image when left blank.
              </span>
            </div>
            {error && <p className="alert alert--error">{error}</p>}
            <button type="submit" className="button" disabled={submitting}>
              {submitting ? "Starting…" : "Start run"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
};
