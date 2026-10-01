import type { ReactNode } from "react";
import WatchlistPane from "@/components/WatchlistPane";

// 放在 /stock 這層：切換股票時左側清單不會重新載入
export default function StockLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-full flex">
      <WatchlistPane />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
