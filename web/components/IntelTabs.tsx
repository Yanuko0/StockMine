"use client";
// 「情報」：全球強勢族群 ↔ 新聞熱度（手機底部只有一個「情報」分頁，用這裡切換）
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [{ href: "/global", label: "全球族群" }, { href: "/news", label: "新聞熱度" }];

export default function IntelTabs() {
  const path = usePathname();
  return (
    <div className="seg">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-pressed={path.startsWith(t.href)} className="px-3 py-1 text-[13px] rounded-full"
          style={path.startsWith(t.href) ? { background: "var(--panel)", fontWeight: 600 } : { color: "var(--muted)" }}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
