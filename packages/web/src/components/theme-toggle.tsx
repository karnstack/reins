import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/* "system" until the visitor picks explicitly; toggling always lands on an
   explicit light/dark, which is what gets persisted. */
type Theme = "light" | "dark" | "system";

function storedTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const t = localStorage.getItem("theme");
  return t === "light" || t === "dark" ? t : "system";
}

function osPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [osDark, setOsDark] = useState(osPrefersDark);
  /* Hydration never patches attributes, so aria-label would keep the
     server-rendered value; flipping this after mount forces a client render
     with the real state. */
  const [mounted, setMounted] = useState(false);

  const isDark = theme === "dark" || (theme === "system" && osDark);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setOsDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* The pre-paint script in __root.tsx already applied the right class; this
     keeps it in sync from here on. */
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    if (theme !== "system") localStorage.setItem("theme", theme);
  }, [theme, isDark]);

  // Keyboard shortcut: plain "d" toggles the theme (skipped while typing).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "d" && e.key !== "D") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      )
        return;
      setTheme(isDark ? "light" : "dark");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDark]);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={
        mounted ? (isDark ? "Switch to light theme" : "Switch to dark theme") : "Toggle theme"
      }
      title="Toggle theme (D)"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <Sun className="size-4.5 dark:hidden" aria-hidden="true" />
      <Moon className="hidden size-4.5 dark:block" aria-hidden="true" />
    </Button>
  );
}
