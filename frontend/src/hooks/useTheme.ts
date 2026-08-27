export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "theme";

export const getInitialTheme = (): ThemeMode => {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
};

export const applyTheme = (mode: ThemeMode): void => {
  document.documentElement.classList.toggle("dark", mode === "dark");
};

export const persistTheme = (mode: ThemeMode): void => {
  window.localStorage.setItem(STORAGE_KEY, mode);
};
