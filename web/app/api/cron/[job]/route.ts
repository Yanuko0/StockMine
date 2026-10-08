// 準時的排程：Vercel Cron 到點呼叫這裡 → 請 GitHub 馬上執行對應的工作（手動觸發不會像 GitHub 自己的排程一樣延遲好幾小時）
// 時間設定在 web/vercel.json；需要 Vercel 環境變數 CRON_SECRET（自己設一串亂碼）、GITHUB_PAT、GITHUB_REPO
export const dynamic = "force-dynamic";

// 網址 → GitHub workflow 檔名（「-2」是同一個工作的第二次，避免第一次剛好太早或失敗）
const JOBS: Record<string, string> = { global: "global.yml", news: "news.yml" };

export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  // Vercel Cron 會自動帶 Authorization: Bearer <CRON_SECRET>；沒設定就一律拒絕，避免別人亂觸發
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { job } = await ctx.params;
  const wf = JOBS[job.replace(/-\d+$/, "")];
  if (!wf) return Response.json({ ok: false, error: "unknown job" }, { status: 404 });
  const pat = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO;
  if (!pat || !repo) return Response.json({ ok: false, error: "尚未設定 GITHUB_PAT / GITHUB_REPO" }, { status: 500 });
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main" }),
  });
  return Response.json({ ok: r.ok, job, status: r.status, error: r.ok ? undefined : (await r.text()).slice(0, 200) }, { status: r.ok ? 200 : 502 });
}
