"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sb } from "@/lib/supabase";
import { getJobRuns, getSetting, me, myName, setSetting } from "@/lib/data";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";
import InstallApp from "@/components/InstallApp";

function b64ToBytes(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const JOB_NAMES: Record<string, string> = {
  eod: "日K／法人", minutes: "分鐘K", broker: "分點", screen: "選股", margin: "融資融券", backup: "備份",
  "backfill-daily": "補日K", "backfill-minutes": "補分鐘K", "screen-now": "立即選股", intraday: "盤中選股", global: "全球族群",
};

export default function Settings() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [d3, setD3] = useState(5);
  const [offset, setOffset] = useState(0);
  const [pushState, setPushState] = useState<"unsupported" | "off" | "on" | "denied">("off");
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof getJobRuns>>>([]);
  const [msg, setMsg] = useState("");
  const [themePref, setTp] = useState<ThemePref>("dark");
  useEffect(() => setTp(getThemePref()), []);

  useEffect(() => {
    myName().then(setName);
    me().then((u) => setEmail(u?.email ?? ""));
    getSetting<{ ma: number }>("deduct3low", { ma: 5 }).then((v) => setD3(v?.ma ?? 5));
    getSetting<number>("deduct_offset", 0).then((v) => setOffset(Number(v) || 0));
    getJobRuns(30).then(setRuns);
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setPushState("unsupported"); return; }
      if (Notification.permission === "denied") { setPushState("denied"); return; }
      const reg = await navigator.serviceWorker.ready;
      setPushState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })();
  }, []);

  async function saveProfile() {
    const u = await me();
    if (!u) return;
    await sb().from("profiles").upsert({ id: u.id, display_name: name });
    setMsg("已儲存");
  }

  async function togglePush() {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) { setMsg("管理者尚未設定推播金鑰（NEXT_PUBLIC_VAPID_PUBLIC_KEY）"); return; }
    const reg = await navigator.serviceWorker.ready;
    const cur = await reg.pushManager.getSubscription();
    if (cur) {
      await sb().from("push_subscriptions").delete().eq("endpoint", cur.endpoint);
      await cur.unsubscribe();
      setPushState("off");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { setPushState("denied"); return; }
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    const j = sub.toJSON();
    await sb().from("push_subscriptions").upsert({ endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth }, { onConflict: "endpoint" });
    setPushState("on");
  }

  return (
    <div className="page-narrow space-y-4">
      <h1 className="text-[22px] font-bold tracking-tight pt-1">設定</h1>

      <section className="card p-4 space-y-3">
        <h2 className="font-bold">外觀</h2>
        <div className="seg">
          {([["dark", "深色"], ["light", "淺色"], ["system", "跟隨系統"]] as const).map(([k, l]) => (
            <button key={k} aria-pressed={themePref === k} onClick={() => { setThemePref(k); setTp(k); }}>{l}</button>
          ))}
        </div>
        <p className="text-xs text-muted">存在這台裝置。電腦版也可以按左下角的太陽 / 月亮切換。均線期數與顏色在個股頁「⚙ 參數」設定。</p>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-bold">個人</h2>
        <div className="text-sm text-muted">{email}</div>
        <div className="flex gap-2">
          <input className="flex-1" placeholder="顯示名稱" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={saveProfile}>儲存</button>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-bold">扣抵設定（所有人共用，選股也會套用）</h2>
        <label className="flex items-center gap-2 text-sm">
          扣三低使用
          <input className="w-20" type="number" min={4} value={d3} onChange={(e) => setD3(+e.target.value)} />
          期均線（例如月K 5MA）
        </label>
        <label className="flex items-center gap-2 text-sm">
          扣抵位置
          <select value={offset} onChange={(e) => setOffset(+e.target.value)}>
            <option value={0}>下一期要扣掉的K棒（預設）</option>
            <option value={1}>往前一根（對齊部分看盤軟體）</option>
          </select>
        </label>
        <button className="btn btn-primary" onClick={async () => {
          try {
            await setSetting("deduct3low", { ma: Math.max(4, d3) });
            await setSetting("deduct_offset", offset);
            setMsg("扣抵設定已儲存");
          } catch { setMsg("只有管理員可以改共用設定"); }
        }}>儲存</button>
        <p className="text-xs text-muted">若扣抵位置跟三竹智選股差一根，切換「扣抵位置」即可對齊。</p>
      </section>

      <section className="card p-4 space-y-2">
        <h2 className="font-bold">選股推播</h2>
        {pushState === "unsupported" && <p className="text-sm text-muted">此瀏覽器不支援推播。iPhone 需要 iOS 16.4 以上，並先「加入主畫面」後從桌面圖示開啟。</p>}
        {pushState === "denied" && <p className="text-sm text-muted">通知權限被拒絕，請到系統設定開啟。</p>}
        {(pushState === "on" || pushState === "off") && (
          <button className={`btn ${pushState === "on" ? "" : "btn-primary"}`} onClick={togglePush}>
            {pushState === "on" ? "關閉這台裝置的推播" : "開啟這台裝置的推播"}
          </button>
        )}
      </section>

      <div id="install"><InstallApp /></div>

      <section className="card p-4 space-y-2">
        <h2 className="font-bold">排程紀錄</h2>
        <div className="overflow-x-auto -mx-4 px-4">
        <table className="tbl table-fixed">
          <colgroup><col className="w-14" /><col className="w-20" /><col /></colgroup>
          <thead><tr><th>日期</th><th className="text-left!">工作</th><th className="text-left!">狀態</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="align-top">{r.run_date.slice(5)}</td>
                <td className="text-left! align-top">{JOB_NAMES[r.job] ?? r.job}</td>
                <td className={`${r.status === "error" ? "up" : ""} text-left! whitespace-normal break-words align-top`}>{r.status === "ok" ? "✓ " : r.status === "skipped" ? "－ " : "✗ "}{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <button className="btn w-full" onClick={async () => { await sb().auth.signOut(); router.replace("/login"); }}>登出</button>
      {msg && <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-accent text-accent-ink px-4 py-2 rounded-full text-sm" onClick={() => setMsg("")}>{msg}</div>}
    </div>
  );
}
