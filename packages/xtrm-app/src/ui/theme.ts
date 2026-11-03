import { useEffect, useState } from "react";

/** The shell writes the theme to `documentElement.dataset.theme`; prose that carries its own
 * light/dark pair (pr-lens diagrams) must follow that attribute, not `prefers-color-scheme`. */
export function useThemeAttribute(): "light" | "dark" {
  const read = (): "light" | "dark" => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    setTheme(read());
    return () => observer.disconnect();
  }, []);
  return theme;
}
