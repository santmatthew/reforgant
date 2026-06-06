/** Theme selection (impure: touches the DOM root + localStorage). */

export interface ThemeDef {
  id: string;
  name: string;
  swatch: string; // accent color shown in the switcher
}

export const THEMES: ThemeDef[] = [
  { id: "forge", name: "Forge", swatch: "#f0813f" },
  { id: "clean", name: "Clean", swatch: "#2f6feb" },
  { id: "paper", name: "Paper", swatch: "#c75d2c" },
  { id: "terminal", name: "Terminal", swatch: "#54d36a" },
  { id: "blueprint", name: "Blueprint", swatch: "#4cc8e8" },
];

const KEY = "reforgant.theme";
const DEFAULT = "forge";

export function loadTheme(): string {
  try {
    const t = localStorage.getItem(KEY);
    if (t && THEMES.some((x) => x.id === t)) return t;
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

export function applyTheme(id: string): void {
  document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

export function currentTheme(): string {
  return document.documentElement.getAttribute("data-theme") ?? DEFAULT;
}
