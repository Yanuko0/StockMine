"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { searchStocks, type Stock } from "@/lib/data";

export default function StockSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Stock[]>([]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => searchStocks(q).then((r) => alive && setList(r)).catch(() => {}), 120);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  function go(code: string) {
    setQ(""); setList([]);
    router.push(`/stock/${code}`);
  }

  return (
    <div className="relative">
      <input
        className="w-full text-base py-2.5"
        placeholder="輸入股號或名稱，例如 2330、台積電"
        value={q}
        autoFocus={autoFocus}
        inputMode="search"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && list[0]) go(list[0].code); }}
      />
      {list.length > 0 && (
        <ul className="absolute z-30 inset-x-0 mt-1 card max-h-80 overflow-y-auto">
          {list.map((s) => (
            <li key={s.code}>
              <button className="w-full flex justify-between px-4 py-2.5 text-left hover:bg-line" onClick={() => go(s.code)}>
                <span><b className="mr-2">{s.code}</b>{s.name}</span>
                <span className="text-muted text-xs">{s.market === "TWSE" ? "上市" : "上櫃"}{s.kind === "etf" ? "・ETF" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
