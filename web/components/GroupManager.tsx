"use client";
import { useState } from "react";
import { deleteGroup, saveGroup, type UserGroup } from "@/lib/data";

/** 自訂族群：例如「AI 伺服器」= 2382 3231 6669。選股結果會優先用自訂族群分組（只有自己看得到）。 */
export default function GroupManager({ groups, onClose }: { groups: UserGroup[]; onClose: () => void }) {
  const [list, setList] = useState(groups.map((g) => ({ ...g, text: g.codes.join(" ") })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function saveAll() {
    setBusy(true); setErr("");
    try {
      for (const [i, g] of list.entries()) {
        const codes = [...new Set(g.text.split(/[\s,，、]+/).map((x) => x.trim()).filter(Boolean))];
        if (!g.name.trim()) continue;
        await saveGroup({ id: g.id || undefined, name: g.name.trim(), codes, sort: i });
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold">自訂族群</h3>
        <p className="text-xs text-muted">官方只有「產業別」（例：半導體業）。想用概念股分組（例：AI 伺服器、CoWoS）就在這裡建立，選股結果會優先用這裡的分組。只有你看得到。</p>
        {list.map((g, i) => (
          <div key={g.id || `n${i}`} className="border border-line rounded-lg p-2 space-y-1.5">
            <div className="flex gap-2">
              <input className="flex-1" placeholder="族群名稱" value={g.name}
                onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <button className="text-muted text-sm" onClick={async () => {
                if (g.id) await deleteGroup(g.id);
                setList(list.filter((_, j) => j !== i));
              }}>刪除</button>
            </div>
            <textarea className="w-full text-sm" rows={2} placeholder="股票代號，用空白或逗號分開：2382 3231 6669" value={g.text}
              onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          </div>
        ))}
        <button className="btn w-full" onClick={() => setList([...list, { id: "", name: "", codes: [], sort: list.length, text: "" }])}>＋ 新增族群</button>
        {err && <p className="text-sm text-red-400">{err.includes("user_groups") ? "請先在 Supabase 執行 006_groups.sql" : err}</p>}
        <div className="flex gap-2">
          <button className="btn flex-1" onClick={onClose}>取消</button>
          <button className="btn btn-primary flex-1" disabled={busy} onClick={saveAll}>儲存</button>
        </div>
      </div>
    </div>
  );
}
