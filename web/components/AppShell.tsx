"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { sb } from "@/lib/supabase";
import Icon, { type IconName } from "@/components/ui/Icon";
import SearchPalette, { openSearch } from "@/components/SearchPalette";
import { applyTheme, currentTheme, getThemePref, setThemePref, THEME_EVENT, type Theme } from "@/lib/theme";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "首頁", icon: "home" },
  { href: "/screener", label: "選股", icon: "filter" },
  { href: "/plan", label: "建倉", icon: "layers" },
  { href: "/settings", label: "我的", icon: "settings" },
];

const PUBLIC = ["/login", "/auth"];

function ThemeToggle({ className = "" }: { className?: string }) {
  const [t, setT] = useState<Theme>("dark");
  useEffect(() => {
    setT(currentTheme());
    const on = (e: Event) => setT((e as CustomEvent<Theme>).detail);
    window.addEventListener(THEME_EVENT, on);
    return () => window.removeEventListener(THEME_EVENT, on);
  }, []);
  return (
    <button className={`icon-btn ${className}`} title={t === "dark" ? "切換淺色" : "切換深色"}
      onClick={() => setThemePref(t === "dark" ? "light" : "dark")}>
      <Icon name={t === "dark" ? "sun" : "moon"} />
    </button>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const isPublic = PUBLIC.some((p) => path.startsWith(p));

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    // 「跟隨系統」時，系統切換深淺色要跟著變
    const mq = matchMedia("(prefers-color-scheme: light)");
    const on = () => { if (getThemePref() === "system") applyTheme("system"); };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    let alive = true;
    sb().auth.getSession().then(({ data }) => {
      if (!alive) return;
      setAuthed(!!data.session);
      setReady(true);
    });
    const { data: sub } = sb().auth.onAuthStateChange((_e, s) => setAuthed(!!s));
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (ready && !authed && !isPublic) router.replace("/login");
  }, [ready, authed, isPublic, router]);

  // 預先載入各分頁，切換時不用等
  useEffect(() => { if (authed) NAV.forEach((n) => router.prefetch(n.href)); }, [authed, router]);

  if (isPublic) return <main className="h-full overflow-y-auto">{children}</main>;
  if (!ready || !authed) {
    return (
      <div className="h-full flex items-center justify-center">
        <img src="/icon-192.png" alt="" className="w-12 h-12 rounded-2xl opacity-80 animate-pulse" />
      </div>
    );
  }

  const inStock = path.startsWith("/stock/");
  const isOn = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="h-full flex">
      {/* 電腦：左側導覽列 */}
      <aside className="hidden lg:flex flex-col items-center w-[68px] shrink-0 border-r border-line bg-panel py-3 gap-1">
        <Link href="/" className="mb-3" title="掘股 StockMine"><img src="/icon-192.png" alt="掘股" className="w-9 h-9 rounded-xl" /></Link>
        <button className="icon-btn !w-11 !h-11 mb-2" title="搜尋（Ctrl+K，或直接打股號）" onClick={() => openSearch()}>
          <Icon name="search" />
        </button>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} title={n.label}
            className={`flex flex-col items-center gap-0.5 w-14 py-2 rounded-xl text-[11px] transition-colors ${isOn(n.href) ? "text-accent" : "text-muted hover:text-text hover:bg-panel-2"}`}
            style={isOn(n.href) ? { background: "var(--accent-bg)" } : undefined}>
            <Icon name={n.icon} className="w-[22px] h-[22px]" />
            {n.label}
          </Link>
        ))}
        <div className="mt-auto"><ThemeToggle /></div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <main className={`flex-1 min-h-0 overflow-y-auto scroll-thin ${inStock ? "" : "pb-[calc(84px+env(safe-area-inset-bottom))] lg:pb-0"}`}>
          {children}
        </main>

        {/* 手機：底部分頁列（三竹式的浮動膠囊；個股頁隱藏，讓 K 線更大） */}
        {!inStock && (
          <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 px-3 pt-1.5" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
            <div className="glass border border-line rounded-full flex p-1 shadow-[var(--shadow)]">
              {NAV.slice(0, 2).map((n) => <Tab key={n.href} {...n} on={isOn(n.href)} />)}
              <button className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-full text-[11px] text-muted" onClick={() => openSearch()}>
                <Icon name="search" className="w-6 h-6" stroke={1.7} />搜尋
              </button>
              {NAV.slice(2).map((n) => <Tab key={n.href} {...n} on={isOn(n.href)} />)}
            </div>
          </nav>
        )}
      </div>
      <SearchPalette />
    </div>
  );
}

function Tab({ href, label, icon, on }: { href: string; label: string; icon: IconName; on: boolean }) {
  return (
    <Link href={href} className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-full text-[11px] transition-colors ${on ? "text-accent bg-panel-2 font-semibold" : "text-muted"}`}>
      <Icon name={icon} className="w-6 h-6" stroke={on ? 2.1 : 1.7} />
      {label}
    </Link>
  );
}

export { ThemeToggle };
