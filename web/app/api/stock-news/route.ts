// 個股新聞：Google 新聞 RSS（搜尋「股名」，涵蓋經濟日報、工商時報、鉅亨、MoneyDJ…）＋ Yahoo 股市個股 RSS
// 免費、不用金鑰；結果快取 30 分鐘。只回傳標題、時間、來源、連結（不轉載內文）
export const dynamic = "force-dynamic";

type Item = { ts: string; title: string; source: string; url: string; summary: string };

const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const strip = (s: string) => decode(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const tag = (xml: string, t: string) => xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "";

function parseRss(xml: string, fallback: string): Item[] {
  const out: Item[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    let title = strip(tag(it, "title"));
    const pub = tag(it, "pubDate");
    const d = new Date(decode(pub).trim());
    if (!title || isNaN(+d)) continue;
    let source = strip(tag(it, "source"));
    const sm = title.match(/\s+-\s+([^-]{1,20})$/);
    if (sm) { source = source || sm[1].trim(); title = title.slice(0, sm.index).trim(); }
    out.push({ ts: d.toISOString(), title, source: source || fallback, url: strip(tag(it, "link")), summary: strip(tag(it, "description")).slice(0, 160) });
  }
  return out;
}

async function get(url: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/rss+xml, */*" }, next: { revalidate: 1800 } });
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = u.searchParams.get("code") ?? "";
  const name = (u.searchParams.get("name") ?? "").slice(0, 20);
  if (!/^\d{4,6}[A-Z]?$/.test(code) || !name || /["<>]/.test(name)) return Response.json({ items: [] }, { status: 400 });
  const days = Math.min(90, Math.max(3, Number(u.searchParams.get("days")) || 30));
  const q = encodeURIComponent(`"${name}" when:${days}d`);
  const [g, y] = await Promise.all([
    get(`https://news.google.com/rss/search?q=${q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`),
    get(`https://tw.stock.yahoo.com/rss?s=${code}`),
  ]);
  const all = [...parseRss(g, "Google 新聞"), ...parseRss(y, "Yahoo 股市")]
    .filter((x) => x.title.includes(name) || x.title.includes(code) || x.summary.includes(name));
  // 不同媒體轉載同一則：標題去掉標點後一樣的只留最早的
  const seen = new Map<string, Item>();
  for (const x of all.sort((a, b) => a.ts.localeCompare(b.ts))) {
    const k = x.title.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
    if (!seen.has(k)) seen.set(k, x);
  }
  const items = [...seen.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 60);
  return Response.json({ items }, { headers: { "Cache-Control": "s-maxage=1800, stale-while-revalidate=3600" } });
}
