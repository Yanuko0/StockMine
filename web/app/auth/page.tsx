"use client";
// 邀請信 / 登入連結 / 重設密碼 都會導到這裡
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sb } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [needPw, setNeedPw] = useState(false);
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const invited = /type=(invite|recovery|signup)/.test(hash);
    const t = setTimeout(async () => {
      const { data } = await sb().auth.getSession();
      setHasSession(!!data.session);
      if (data.session && !invited) router.replace("/");
      else setNeedPw(invited);
    }, 600);
    return () => clearTimeout(t);
  }, [router]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setMsg("密碼至少 8 碼"); return; }
    const { error } = await sb().auth.updateUser({ password: pw, data: name ? { display_name: name } : undefined });
    if (error) { setMsg(error.message); return; }
    const { data } = await sb().auth.getUser();
    if (name && data.user) await sb().from("profiles").upsert({ id: data.user.id, display_name: name });
    router.replace("/");
  }

  if (hasSession === null) return <div className="p-6 text-muted">驗證中…</div>;
  if (!hasSession) return <div className="p-6">連結已失效，請回到 <a className="text-accent" href="/login">登入頁</a>。</div>;
  if (!needPw) return null;
  return (
    <div className="h-full flex items-center justify-center p-6">
      <form onSubmit={save} className="card w-full max-w-sm p-6 space-y-4">
        <h1 className="text-lg font-bold">設定你的帳號</h1>
        <input className="w-full" placeholder="顯示名稱（畫線時會顯示）" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="w-full" type="password" placeholder="設定密碼（至少 8 碼）" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <button className="btn btn-primary w-full">完成</button>
        {msg && <p className="text-sm text-accent">{msg}</p>}
      </form>
    </div>
  );
}
