import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RepoScope, RunSnapshot } from "../api/types";

export type ActiveSessionInfo = {
  repo: RepoScope;
  run: RunSnapshot | null;
} | null;

type ActiveSessionContextValue = {
  activeSession: ActiveSessionInfo;
  setActiveSession: (info: ActiveSessionInfo) => void;
};

const ActiveSessionContext = createContext<ActiveSessionContextValue | null>(
  null,
);

export const ActiveSessionProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [activeSession, setActiveSession] = useState<ActiveSessionInfo>(null);
  const value = useMemo(
    () => ({ activeSession, setActiveSession }),
    [activeSession],
  );

  return (
    <ActiveSessionContext.Provider value={value}>
      {children}
    </ActiveSessionContext.Provider>
  );
};

export const useActiveSession = (): ActiveSessionContextValue => {
  const context = useContext(ActiveSessionContext);
  if (!context) {
    throw new Error(
      "useActiveSession must be used within an ActiveSessionProvider",
    );
  }
  return context;
};
