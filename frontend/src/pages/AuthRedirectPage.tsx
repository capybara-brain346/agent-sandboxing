import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { getAuthMe } from "@/api/client";

export const AuthRedirectPage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    getAuthMe()
      .then(() => navigate("/repos", { replace: true }))
      .catch(() => navigate("/login", { replace: true }));
  }, [navigate]);

  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 text-fg-subtle">
      <Loader2 className="size-5 animate-spin" />
      <p className="text-sm">Loading…</p>
    </main>
  );
};
