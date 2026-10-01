// 主題：深色（預設）/ 淺色 / 跟隨系統。存在這台裝置。
export type ThemePref = "dark" | "light" | "system";
export type Theme = "dark" | "light";
const KEY = "theme";
export const THEME_EVENT = "stockmine-theme";

export function getThemePref(): ThemePref {
  try { return (localStorage.getItem(KEY) as ThemePref) || "dark"; } catch { return "dark"; }
}
export function resolveTheme(p: ThemePref = getThemePref()): Theme {
  if (p === "system") return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  return p;
}
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
export function applyTheme(p: ThemePref = getThemePref()) {
  const t = resolveTheme(p);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#f3f4f6" : "#0a0c10");
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: t }));
}
export function setThemePref(p: ThemePref) {
  try { localStorage.setItem(KEY, p); } catch { /* 私密模式 */ }
  applyTheme(p);
}

/** 放在 <head>，第一次畫面出來前就套用主題，避免閃白 */
export const THEME_BOOT = `(function(){try{var p=localStorage.getItem("${KEY}")||"dark";var t=p==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;
