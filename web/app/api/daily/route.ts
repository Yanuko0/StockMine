// 個股日K（共用快取）：同一檔股票 30 分鐘內不管幾個人、幾台裝置看，都只跟 Supabase 拿一次，省流量
// GET /api/daily?code=2330&scope=recent|all   （要帶登入的 Authorization: Bearer <token>）
//   recent：近 2 年（打開個股時用）；all：資料庫裡全部（往左拉、週K / 月K 時用）
import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

export const dynamic = "force-dynamic";

const RECENT_YEARS = 2; // 跟 lib/data.ts 的 RECENT_YEARS 一致
type Row = { date: string; open: number; high: number; low: number; close: number; volume: number };

function twToday(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return Response.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const code = q.get("code") ?? "";
  const scope = q.get("scope") === "all" ? "all" : "recent";
  if (!/^[0-9A-Z]{4,6}$/.test(code)) return Response.json({ error: "bad code" }, { status: 400 });

  const sb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: u } = await sb.auth.getUser(token);
  if (!u.user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const today = twToday();
  const since = scope === "all" ? "1990-01-01"
    : new Date(Date.parse(today) - RECENT_YEARS * 365 * 86400000).toISOString().slice(0, 10);
  // 快取的 key 只有股號、範圍、日期（不含使用者），所以大家共用；登入檢查在上面已經做過
  const load = unstable_cache(async () => {
    const rows: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const r = await sb.from("daily_prices").select("date,open,high,low,close,volume")
        .eq("code", code).gte("date", since).order("date").range(from, from + 999);
      if (r.error) throw new Error(r.error.message);
      rows.push(...(r.data as Row[]));
      if (r.data.length < 1000) break;
    }
    return rows;
  }, ["daily", code, scope, since], { revalidate: 1800, tags: [`daily:${code}`] });

  try {
    const rows = await load();
    return Response.json({ since, rows }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }
}
