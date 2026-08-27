import type { ReactNode } from "react";
import { Link, useMatch } from "react-router-dom";

const useSurfaceLabel = (): string => {
  const isRepoSelect = useMatch("/");
  const isRepos = useMatch("/repos");
  const isLogin = useMatch("/login");
  const isChatWorkspace = useMatch("/sessions/:sessionId");
  if (isChatWorkspace) return "Chat";
  if (isRepoSelect || isRepos) return "Repos";
  if (isLogin) return "Sign in";
  return "";
};

export const AppShell = ({ children }: { children: ReactNode }) => {
  const surfaceLabel = useSurfaceLabel();

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="topbar__brand">
          Agent Sandboxing
        </Link>
        {surfaceLabel && (
          <>
            <span className="topbar__divider">/</span>
            <span className="topbar__surface">{surfaceLabel}</span>
          </>
        )}
      </header>
      {children}
    </div>
  );
};
