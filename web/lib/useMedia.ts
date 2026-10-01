"use client";
import { useSyncExternalStore } from "react";

/** 目前螢幕是否符合 media query（例如電腦版 min-width: 1024px） */
export function useMedia(q: string, server = false): boolean {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(q); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(q).matches,
    () => server,
  );
}
export const useDesktop = () => useMedia("(min-width: 1024px)");
