import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuthMe } from "../api/client";

const errorMessage = (code: string | null): string | null => {
  if (code === "auth_state_invalid")
    return "The GitHub sign-in expired. Try again.";
  if (code === "github_oauth_failed")
    return "GitHub sign-in failed. Try again.";
  return code ? "The sign-in link is no longer valid. Try again." : null;
};

export const LoginPage = () => {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const params = new URLSearchParams(window.location.search);
  const signInError = errorMessage(params.get("error"));

  useEffect(() => {
    getAuthMe()
      .then(() => navigate("/repos", { replace: true }))
      .catch(() => setChecking(false));
  }, [navigate]);

  if (checking)
    return (
      <main className="page login-page">
        <p className="page-subtitle">Checking session...</p>
      </main>
    );

  return (
    <main className="page login-page">
      <div className="login-page__eyebrow">AGENT SANDBOXING</div>
      <h1>Work through the code, not around it.</h1>
      <p className="page-subtitle">
        Connect GitHub, choose a repository and branch, and open a focused agent
        workspace.
      </p>
      {signInError && <p className="alert alert--error">{signInError}</p>}
      <a className="button login-page__button" href="/auth/github/start">
        Continue with GitHub
      </a>
      <p className="login-page__note">
        We use GitHub OAuth for repository visibility and a GitHub App for
        workspace access.
      </p>
    </main>
  );
};
