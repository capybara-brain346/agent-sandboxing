import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getAuthMe } from "../api/client";

export const AuthRedirectPage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    getAuthMe()
      .then(() => navigate("/repos", { replace: true }))
      .catch(() => navigate("/login", { replace: true }));
  }, [navigate]);

  return (
    <main className="page">
      <p className="page-subtitle">Loading...</p>
    </main>
  );
};
