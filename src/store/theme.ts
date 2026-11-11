import { create } from "zustand";
import { getSetting, setSetting } from "../lib/db";

export type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  ready: boolean;
  init: () => Promise<void>;
  toggle: () => Promise<void>;
  setTheme: (t: Theme) => Promise<void>;
}

const applyTheme = (theme: Theme) => {
  const root = document.documentElement;
  // Enable the smooth transition class only during the swap.
  root.classList.add("theme-transition");
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  // Remove the transition class after the animation completes so it doesn't
  // interfere with component-level motion.
  window.setTimeout(() => root.classList.remove("theme-transition"), 400);
};

export const useTheme = create<ThemeState>((set, get) => ({
  theme: "light",
  ready: false,
  init: async () => {
    let theme: Theme = "light";
    try {
      const stored = await getSetting("theme");
      if (stored === "light" || stored === "dark") {
        theme = stored;
      } else if (
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      ) {
        theme = "dark";
      }
    } catch {
      // DB not ready yet (first run); fall back to light.
    }
    applyTheme(theme);
    set({ theme, ready: true });
  },
  setTheme: async (t) => {
    applyTheme(t);
    set({ theme: t });
    try {
      await setSetting("theme", t);
    } catch {
      /* ignore persistence errors */
    }
  },
  toggle: async () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    await get().setTheme(next);
  },
}));
