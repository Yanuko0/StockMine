// 加入關注時：請 GitHub Actions 馬上抓這檔今天的分點
// 需要 Vercel 環境變數：GITHUB_PAT（只給這個 repo 的 Actions 寫入權限）、GITHUB_REPO（例如 yourname/StockMine）
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { data, error } = await createClient(url, anon).auth.getUser(token);
  if (error || !data.user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code || !/^[0-9A-Z]{4,6}$/.test(code)) return Response.json({ ok: false, error: "bad code" }, { status: 400 });

  // 只在交易日盤後（台灣時間 15:00~23:59）才有當天分點
  const twHour = (new Date().getUTCHours() + 8) % 24;
  if (twHour < 15) return Response.json({ ok: true, skipped: "尚未收盤，今晚排程會自動抓" });

  const pat = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO;
  if (!pat || !repo) return Response.json({ ok: true, skipped: "未設定 GITHUB_PAT" });

  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/broker-now.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { codes: code } }),
  });
  return Response.json({ ok: r.ok, status: r.status });
}
