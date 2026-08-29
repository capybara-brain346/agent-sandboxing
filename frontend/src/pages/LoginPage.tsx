import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { getAuthMe } from "@/api/client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

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

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="flex w-full max-w-md flex-col items-start gap-6">
        <span className="flex items-center gap-1.5 font-mono text-2xs font-semibold tracking-widest text-fg-subtle uppercase">
          <Sparkles className="size-3.5 text-brand" />
          Agent Sandboxing
        </span>

        {checking ? (
          <p className="text-sm text-fg-subtle">Checking session…</p>
        ) : (
          <>
            <h1 className="text-3xl leading-tight font-semibold text-balance text-fg sm:text-4xl">
              Work through the code, not around it.
            </h1>
            <p className="text-sm text-fg-muted">
              Connect GitHub, choose a repository and branch, and open a focused
              agent workspace.
            </p>

            {signInError && <Alert variant="error">{signInError}</Alert>}

            <Button asChild size="lg" className="w-fit">
              <a href="/auth/github/start">Continue with GitHub</a>
            </Button>

            <p className="text-xs text-fg-subtle">
              We use GitHub OAuth for repository visibility and a GitHub App for
              workspace access.
            </p>
          </>
        )}
      </div>
    </main>
  );
};
