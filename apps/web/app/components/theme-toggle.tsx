"use client";

import { setTheme, useTheme } from "../lib/theme";

/** Botón para alternar entre modo claro y modo oscuro. */
export function ThemeToggle({ className = "" }: Readonly<{ className?: string }>) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "Cambiar a modo oscuro" : "Cambiar a modo claro";
  return (
    <button aria-label={label} className={`theme-toggle ${className}`} onClick={() => setTheme(next)} title={label} type="button">
      {theme === "dark" ? (
        <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
      <span>{theme === "dark" ? "Modo claro" : "Modo oscuro"}</span>
    </button>
  );
}
