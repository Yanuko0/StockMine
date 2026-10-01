"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sb } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    const { error } = await sb().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setMsg("登入失敗：" + error.message);
    else router.replace("/");
  }

  async function magic() {
    if (!email) { setMsg("請先輸入 Email"); return; }
    setBusy(true);
    const { error } = await sb().auth.signInWithOtp({
      email, options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/auth` },
    });
    setBusy(false);
    setMsg(error ? "寄送失敗：" + error.message : "已寄出登入連結，請到信箱點擊");
  }

  return (
    <div className="h-full flex items-center justify-center p-6">
      <form onSubmit={login} className="card w-full max-w-sm p-6 space-y-4">
        <div className="text-center">
          <img src="/icon-192.png" alt="" className="w-16 h-16 mx-auto rounded-2xl" />
          <h1 className="text-xl font-bold mt-2">掘股 <span className="text-muted text-sm font-normal">StockMine</span></h1>
          <p className="text-muted text-sm">僅限受邀使用者</p>
        </div>
        <input className="w-full" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <input className="w-full" type="password" placeholder="密碼" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <button className="btn btn-primary w-full" disabled={busy}>登入</button>
        <button type="button" className="btn w-full" onClick={magic} disabled={busy}>寄登入連結到信箱</button>
        {msg && <p className="text-sm text-center text-accent">{msg}</p>}
      </form>
    </div>
  );
}
