// 儲存策略 / 按「立即選股」：請 GitHub Actions 馬上用現有資料跑這個策略（盤中用盤中價，盤後用收盤價）
// 需要 Vercel 環境變數：GITHUB_PAT、GITHUB_REPO（和「立即抓分點」共用）
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // 用使用者自己的身分查策略：查得到 = 是他自己的（策略只有主人看得到）
  const sb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: u } = await sb.auth.getUser(token);
  if (!u.user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { strategy } = (await req.json().catch(() => ({}))) as { strategy?: string };
  if (!strategy || !/^[0-9a-f-]{36}$/.test(strategy)) return Response.json({ ok: false, error: "bad id" }, { status: 400 });
  const { data: s } = await sb.from("strategies").select("id").eq("id", strategy).maybeSingle();
  if (!s) return Response.json({ ok: false, error: "not found" }, { status: 404 });

  const pat = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO;
  if (!pat || !repo) return Response.json({ ok: false, error: "尚未設定 GITHUB_PAT / GITHUB_REPO" });
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/screen-now.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { strategy } }),
  });
  return Response.json({ ok: r.ok, status: r.status, error: r.ok ? undefined : (await r.text()).slice(0, 200) });
}

// 查「立即選股」最近一次在 GitHub 的執行狀況（網頁每 20 秒問一次；失敗時馬上告訴使用者）
export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return Response.json({ ok: false }, { status: 401 });
  const sb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: u } = await sb.auth.getUser(token);
  if (!u.user) return Response.json({ ok: false }, { status: 401 });
  const pat = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO;
  if (!pat || !repo) return Response.json({ ok: false });
  const since = new URL(req.url).searchParams.get("since") ?? "";
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/screen-now.yml/runs?per_page=5&event=workflow_dispatch`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
  });
  if (!r.ok) return Response.json({ ok: false, status: r.status });
  const j = (await r.json()) as { workflow_runs?: { status: string; conclusion: string | null; html_url: string; created_at: string }[] };
  const run = (j.workflow_runs ?? []).find((x) => !since || x.created_at >= since.slice(0, 19));
  return Response.json({ ok: true, run: run ? { status: run.status, conclusion: run.conclusion, url: run.html_url } : null });
}
