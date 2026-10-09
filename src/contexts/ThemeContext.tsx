import React, { createContext, useContext, useEffect, useState } from "react";
import type { ThemeMode } from "../styles/whatsapp-theme";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  waTheme: ThemeMode;
  toggleWaTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("theme") as Theme;
    if (saved === 'light' || saved === 'dark') return saved;
    // Padrão claro (estilo Apple/landing). Quem já escolheu um tema antes,
    // inclusive dark, é respeitado — ninguém é forçado a mudar.
    return "light";
  });

  // Atendimento acompanha a mesma preferência do restante do CRM.
  const waTheme: ThemeMode = theme;

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (waTheme === "light") {
      root.setAttribute("data-theme", "light");
    } else {
      root.removeAttribute("data-theme");
    }
    localStorage.setItem("wa-theme", waTheme);
  }, [waTheme]);

  const toggleTheme = () => setTheme((prev) => (prev === "light" ? "dark" : "light"));
  const toggleWaTheme = toggleTheme;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, waTheme, toggleWaTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
