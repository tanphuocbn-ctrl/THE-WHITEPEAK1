import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

export function ThemeToggle({ className = "" }) {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle} data-testid="theme-toggle" title={theme === "light" ? "Chuyển tối" : "Chuyển sáng"}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)] transition-colors hover:text-[var(--text)] ${className}`}>
      {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}
