import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    return localStorage.getItem("cubeboxtimer_dark") === "true";
  });

  useEffect(() => {
    document.body.classList.toggle("dark", dark);
    localStorage.setItem("cubeboxtimer_dark", String(dark));
  }, [dark]);

  const toggleDark = useCallback(() => setDark((d) => !d), []);
  const value = useMemo(() => ({ dark, toggleDark }), [dark, toggleDark]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
