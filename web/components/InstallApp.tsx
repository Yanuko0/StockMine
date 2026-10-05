"use client";
// 加入手機桌面（PWA）＋分享網址
// Android / 電腦 Chrome、Edge：瀏覽器會給「安裝」事件，按一下就跳出系統的安裝視窗
// iPhone / iPad：蘋果不給網頁自動安裝，顯示圖解步驟（分享 → 加入主畫面）
import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
declare global { interface Window { __bip?: BIPEvent | null } }

// 越早接住越好（AppShell 一載入就會 import 這個檔案）
if (typeof window !== "undefined" && !("__bipHooked" in window)) {
  (window as unknown as Record<string, boolean>).__bipHooked = true;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); window.__bip = e as BIPEvent; window.dispatchEvent(new Event("bip-ready")); });
  window.addEventListener("appinstalled", () => { window.__bip = null; window.dispatchEvent(new Event("bip-ready")); });
}

export function useInstallState() {
  const [s, setS] = useState({ standalone: false, ios: false, iosSafari: false, canPrompt: false, android: false });
  useEffect(() => {
    const upd = () => {
      const ua = navigator.userAgent;
      const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      setS({ standalone, ios, iosSafari: ios && !/CriOS|FxiOS|EdgiOS|Line\//.test(ua), canPrompt: !!window.__bip, android: /Android/.test(ua) });
    };
    upd();
    window.addEventListener("bip-ready", upd);
    return () => window.removeEventListener("bip-ready", upd);
  }, []);
  return s;
}

export async function shareApp(): Promise<string> {
  const url = location.origin;
  const data = { title: "掘股 StockMine", text: "台股 K 線、扣抵、籌碼、分點與選股", url };
  try {
    if (navigator.share) { await navigator.share(data); return ""; }
  } catch { return ""; }
  try { await navigator.clipboard.writeText(url); return "網址已複製，可以貼給朋友"; } catch { return url; }
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-6 h-6 rounded-full bg-accent text-accent-ink text-[13px] font-bold flex items-center justify-center shrink-0 num">{n}</span>
      <div className="text-[15px] leading-relaxed pt-px">{children}</div>
    </div>
  );
}

/** 設定頁用的完整區塊 */
export default function InstallApp() {
  const st = useInstallState();
  const [guide, setGuide] = useState<"ios" | "android" | null>(null);
  const [msg, setMsg] = useState("");

  async function install() {
    if (window.__bip) {
      await window.__bip.prompt();
      const r = await window.__bip.userChoice.catch(() => ({ outcome: "dismissed" }));
      if (r.outcome === "accepted") { window.__bip = null; setMsg("已安裝，可以從桌面圖示開啟"); }
      return;
    }
    setGuide(st.ios ? "ios" : "android");
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <img src="/icon-192.png" alt="" className="w-12 h-12 rounded-[14px] shadow" />
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-[16px]">掘股 App</h2>
          <p className="text-[12px] text-muted">加到手機桌面，像 App 一樣全螢幕開啟、可以收推播</p>
        </div>
      </div>
      {st.standalone ? (
        <p className="text-sm text-[#34c759]">✓ 你現在就是用 App 開啟的</p>
      ) : (
        <button className="btn btn-primary w-full !min-h-[44px]" onClick={install}>
          <Icon name="plus" className="w-4 h-4" stroke={2.4} />{st.ios ? "加入主畫面（iPhone / iPad）" : "安裝 App"}
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn !min-h-[40px]" onClick={() => setGuide("ios")}>iPhone 怎麼裝</button>
        <button className="btn !min-h-[40px]" onClick={() => setGuide("android")}>Android 怎麼裝</button>
      </div>
      <button className="btn btn-ghost w-full text-accent" onClick={async () => setMsg(await shareApp())}>
        <Icon name="share" className="w-4 h-4" /> 分享網址給朋友
      </button>
      <p className="text-[12px] text-muted">朋友要先由你在 Supabase 開帳號才能登入（網站不開放自己註冊）。</p>
      {msg && <p className="text-[13px] text-accent break-all">{msg}</p>}

      {guide && (
        <div className="modal-wrap" onClick={() => setGuide(null)}>
          <div className="modal space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center">
              <h3 className="font-bold text-[17px] flex-1">{guide === "ios" ? "加到 iPhone / iPad 主畫面" : "安裝到 Android"}</h3>
              <button className="icon-btn" onClick={() => setGuide(null)}><Icon name="close" /></button>
            </div>
            {guide === "ios" ? (
              <div className="space-y-3">
                {st.ios && !st.iosSafari && <p className="text-[13px] text-up">建議用 Safari 開啟這個網址再加入（其他瀏覽器也可以，但推播只有 Safari 加入的 App 才收得到）。</p>}
                <Step n={1}>用 <b>Safari</b> 打開這個網站</Step>
                <Step n={2}>點下方（iPad 在右上）的 <b>分享</b> 按鈕 <span className="inline-flex align-middle"><Icon name="share" className="w-5 h-5 text-accent" /></span></Step>
                <Step n={3}>往下滑，點 <b>「加入主畫面」</b></Step>
                <Step n={4}>右上角按 <b>「新增」</b>，桌面就會出現掘股的圖示</Step>
                <p className="text-[12px] text-muted">要收推播：從桌面圖示打開 App →「我的」→「開啟這台裝置的推播」（需要 iOS 16.4 以上）。</p>
              </div>
            ) : (
              <div className="space-y-3">
                <Step n={1}>用 <b>Chrome</b> 打開這個網站</Step>
                <Step n={2}>點右上角 <b>⋮</b> 選單</Step>
                <Step n={3}>點 <b>「安裝應用程式」</b>或<b>「加到主畫面」</b></Step>
                <Step n={4}>按 <b>「安裝」</b>，桌面和 App 清單就會出現掘股</Step>
                <p className="text-[12px] text-muted">電腦版 Chrome / Edge：網址列右邊有一個「安裝」小圖示，點下去也能裝成桌面 App。</p>
              </div>
            )}
            <button className="btn w-full" onClick={() => setGuide(null)}>知道了</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** 首頁上方的小提示：手機還沒安裝時才出現，可以關掉 */
export function InstallBanner() {
  const st = useInstallState();
  const [hide, setHide] = useState(true);
  useEffect(() => { try { setHide(localStorage.getItem("installBannerOff") === "1"); } catch { setHide(false); } }, []);
  if (hide || st.standalone || !(st.ios || st.android)) return null;
  return (
    <div className="card p-3 flex items-center gap-3 lg:hidden">
      <img src="/icon-192.png" alt="" className="w-10 h-10 rounded-xl" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[15px]">把掘股加到主畫面</div>
        <div className="text-[12px] text-muted">全螢幕開啟、收選股推播</div>
      </div>
      <a href="/settings#install" className="btn btn-primary btn-sm">怎麼裝</a>
      <button className="icon-btn !w-8 !h-8" aria-label="不要再顯示" onClick={() => { setHide(true); try { localStorage.setItem("installBannerOff", "1"); } catch { /* */ } }}>
        <Icon name="close" className="w-4 h-4" />
      </button>
    </div>
  );
}
