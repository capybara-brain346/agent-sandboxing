import type { ReactNode } from "react";
import { Link, useMatch } from "react-router-dom";

const useSurfaceLabel = (): string => {
  const isNewRun = useMatch("/");
  const isRunDetail = useMatch("/tasks/:taskId");
  if (isRunDetail) return "Run detail";
  if (isNewRun) return "New run";
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
