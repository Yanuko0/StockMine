import { DEFAULT_MA, type MaLine } from "./colors";

const KEY = "maConf";
export function loadMa(): MaLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null") as MaLine[] | null;
    if (Array.isArray(v) && v.length && v.every((x) => x.n > 0 && typeof x.color === "string")) return v;
  } catch { /* */ }
  return DEFAULT_MA.map((m) => ({ ...m }));
}
export function saveMa(v: MaLine[]) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* */ }
}
