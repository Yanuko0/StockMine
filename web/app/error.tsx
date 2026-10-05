"use client";
// 頁面出錯時的畫面：不讓整個網站變白頁，可以按「再試一次」回來
// 網站剛更新版本時，舊頁面可能抓不到新的程式檔（ChunkLoadError）：自動重新整理一次就好
import { useEffect } from "react";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const chunk = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i
    .test(`${error?.name} ${error?.message}`);

  useEffect(() => {
    console.error(error);
    if (!chunk) return;
    try {
      const k = "stockmine-reloaded";
      if (sessionStorage.getItem(k) !== "1") { sessionStorage.setItem(k, "1"); location.reload(); return; }
      sessionStorage.removeItem(k);
    } catch { /* 沒有 sessionStorage 也沒關係 */ }
  }, [error, chunk]);

  return (
    <div className="page-narrow pt-16 text-center space-y-3">
      <div className="text-[18px] font-semibold">{chunk ? "網站剛更新，正在重新載入…" : "這個畫面出了點問題"}</div>
      <p className="text-sm text-muted">{chunk ? "如果沒有自動重新整理，請按下面的按鈕。" : "可以按「再試一次」，或重新整理頁面。"}</p>
      <div className="flex gap-2 justify-center">
        <button className="btn btn-primary" onClick={() => retry()}>再試一次</button>
        <button className="btn" onClick={() => location.reload()}>重新整理</button>
      </div>
      {error?.digest && <p className="text-[11px] text-faint">錯誤代碼 {error.digest}</p>}
    </div>
  );
}
