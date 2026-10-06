// 即時報價（證交所「基本市況報導」公開資料，約 5 秒延遲，免費、不用金鑰）
// 瀏覽器不能直接呼叫證交所（跨網域被擋），所以由這裡代轉。
// GET /api/live?codes=2344,4772  →  { quotes: { "2344": { price, prev, open, high, low, vol, date, time } } }
export const dynamic = "force-dynamic";

const MIS = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type LiveQuote = {
  price: number | null; prev: number | null; open: number | null; high: number | null; low: number | null;
  vol: number | null; date: string; time: string;
};

const num = (s: unknown) => {
  const v = parseFloat(String(s ?? ""));
  return isFinite(v) && v > 0 ? v : null;
};
const first = (s: unknown) => num(String(s ?? "").split("_")[0]);

type Row = Record<string, string>;

async function fetchBatch(codes: string[], cookie?: string): Promise<{ rows: Row[]; cookie?: string }> {
  // 不知道是上市還是上櫃：兩個都問，證交所只會回有的那一個
  const ch = codes.flatMap((c) => [`tse_${c}.tw`, `otc_${c}.tw`]).join("|");
  const r = await fetch(`${MIS}?ex_ch=${encodeURIComponent(ch)}&json=1&delay=0&_=${Date.now()}`, {
    headers: { "User-Agent": UA, Referer: "https://mis.twse.com.tw/stock/index.jsp", Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    cache: "no-store", signal: AbortSignal.timeout(6000),
  });
  const js = (await r.json().catch(() => null)) as { msgArray?: Row[] } | null;
  return { rows: js?.msgArray ?? [] };
}

async function session(): Promise<string | undefined> {
  // 有時候證交所要先開過首頁（拿 cookie）才會回資料
  const r = await fetch("https://mis.twse.com.tw/stock/index.jsp", { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(5000) }).catch(() => null);
  return r?.headers.get("set-cookie")?.split(";")[0];
}

function parse(m: Row): [string, LiveQuote] | null {
  const code = m.c;
  if (!code) return null;
  const prev = num(m.y);
  // z = 最新成交價；這一刻沒成交時是 "-"，用最佳買價（再不行用最佳賣價）當現價
  const price = num(m.z) ?? first(m.b) ?? first(m.a) ?? null;
  const d = String(m.d ?? "");
  return [code, {
    price, prev, open: num(m.o), high: num(m.h), low: num(m.l),
    vol: m.v != null && m.v !== "-" ? parseInt(m.v, 10) || 0 : null, // 張
    date: d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "",
    time: String(m.t ?? "").slice(0, 5),
  }];
}

export async function GET(req: Request) {
  const codes = [...new Set((new URL(req.url).searchParams.get("codes") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9A-Z]{4,6}$/.test(s)))].slice(0, 200);
  if (!codes.length) return Response.json({ quotes: {} });
  const parts: string[][] = [];
  for (let i = 0; i < codes.length; i += 40) parts.push(codes.slice(i, i + 40));
  const out: Record<string, LiveQuote> = {};
  try {
    let res = await Promise.all(parts.map((p) => fetchBatch(p).catch(() => ({ rows: [] as Row[] }))));
    if (res.every((x) => !x.rows.length)) {
      const ck = await session();
      if (ck) res = await Promise.all(parts.map((p) => fetchBatch(p, ck).catch(() => ({ rows: [] as Row[] }))));
    }
    for (const x of res) for (const m of x.rows) {
      const p = parse(m);
      if (p && p[1].price != null) out[p[0]] = p[1];
    }
  } catch { /* 拿不到就回空的，網頁會繼續用收盤資料 */ }
  return Response.json({ quotes: out }, { headers: { "Cache-Control": "public, s-maxage=3, stale-while-revalidate=10" } });
}
