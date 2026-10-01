"use client";
import { useState } from "react";
import { DEFAULT_PARAMS } from "@/lib/chart";
import { DEFAULT_MA, MA_SWATCHES, type MaLine } from "@/lib/colors";

const ROWS: { name: string; label: string; fields: string[]; presets?: number[][] }[] = [
  { name: "TW_KD", label: "KD", fields: ["天數", "K 平滑", "D 平滑"], presets: [[9, 3, 3], [60, 3, 3]] },
  { name: "TW_RSI", label: "RSI", fields: ["短", "長"] },
  { name: "TW_MACD", label: "MACD", fields: ["快線", "慢線", "訊號"] },
  { name: "TW_BIAS", label: "乖離", fields: ["短", "長"] },
  { name: "TW_BOLL", label: "布林通道", fields: ["天數", "倍數"], presets: [[20, 2]] },
];

/** 自動箱型（密集成交區）參數 */
export interface BoxConf { n: number; va: number; bins: number; maxHeight: number; profile: boolean }
export const DEFAULT_BOX: BoxConf = { n: 60, va: 70, bins: 50, maxHeight: 20, profile: true };

function BoxEditor({ v, set }: { v: BoxConf; set: (b: BoxConf) => void }) {
  const num = (k: keyof BoxConf, label: string, min: number, max: number, step = 1) => (
    <label className="flex-1 text-xs text-muted">{label}
      <input inputMode="numeric" className="w-full mt-0.5 text-sm num" value={String(v[k])}
        onChange={(e) => { const x = +e.target.value; if (Number.isFinite(x)) set({ ...v, [k]: Math.max(min, Math.min(max, Math.round(x / step) * step)) }); }} />
    </label>
  );
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-bold">箱型（密集成交區）</span>
        <span className="text-xs text-muted">用分價量自動找箱頂、箱底</span>
      </div>
      <div className="flex gap-2">
        {num("n", "看前幾天", 10, 250)}{num("va", "包住成交量 %", 30, 95, 5)}{num("maxHeight", "箱高上限 %", 3, 60)}{num("bins", "價格格數", 10, 100)}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.profile} onChange={(e) => set({ ...v, profile: e.target.checked })} />右側顯示分價量</label>
      <button className="btn btn-sm btn-ghost text-muted" onClick={() => set({ ...DEFAULT_BOX })}>箱型恢復預設</button>
    </div>
  );
}

function MaEditor({ ma, setMa }: { ma: MaLine[]; setMa: (v: MaLine[]) => void }) {
  const [pick, setPick] = useState<number | null>(null);
  const upd = (i: number, p: Partial<MaLine>) => setMa(ma.map((m, j) => (j === i ? { ...m, ...p } : m)));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-bold">均線</span>
        <span className="text-xs text-muted">最多 8 條，期數和顏色都可以改</span>
      </div>
      {ma.map((m, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={m.on} onChange={(e) => upd(i, { on: e.target.checked })} aria-label="顯示" />
            <span className="text-sm text-muted">MA</span>
            <input inputMode="numeric" className="w-20 text-sm num" value={m.n || ""}
              onChange={(e) => upd(i, { n: Math.max(0, Math.min(600, Math.round(+e.target.value) || 0)) })} />
            <button className="w-8 h-8 rounded-lg border border-line shrink-0" style={{ background: m.color }} aria-label="選顏色"
              onClick={() => setPick(pick === i ? null : i)} />
            <span className="flex-1 h-[3px] rounded-full" style={{ background: m.color }} />
            <button className="text-muted text-xs px-1" onClick={() => setMa(ma.filter((_, j) => j !== i))}>刪除</button>
          </div>
          {pick === i && (
            <div className="flex flex-wrap gap-1.5 pl-6">
              {MA_SWATCHES.map((c) => (
                <button key={c} className={`w-7 h-7 rounded-full border-2 ${m.color.toLowerCase() === c ? "border-accent" : "border-line"}`} style={{ background: c }}
                  onClick={() => { upd(i, { color: c }); setPick(null); }} aria-label={c} />
              ))}
              <label className="w-7 h-7 rounded-full border-2 border-line overflow-hidden relative cursor-pointer" title="自訂顏色"
                style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}>
                <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={m.color} onChange={(e) => upd(i, { color: e.target.value })} />
              </label>
            </div>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        {ma.length < 8 && <button className="btn btn-sm" onClick={() => setMa([...ma, { n: 30, color: MA_SWATCHES[(ma.length + 1) % MA_SWATCHES.length], on: true }])}>＋ 新增均線</button>}
        <button className="btn btn-sm btn-ghost text-muted" onClick={() => setMa(DEFAULT_MA.map((m) => ({ ...m })))}>均線恢復預設</button>
      </div>
    </div>
  );
}

export default function IndicatorParams({ value, onChange, onClose, ma, onMa, box, onBox }: {
  value: Record<string, number[]>; onChange: (v: Record<string, number[]>) => void; onClose: () => void;
  ma: MaLine[]; onMa: (v: MaLine[]) => void; box: BoxConf; onBox: (b: BoxConf) => void;
}) {
  const [boxDraft, setBoxDraft] = useState<BoxConf>(box);
  const [maDraft, setMaDraft] = useState<MaLine[]>(() => ma.map((m) => ({ ...m })));
  const [draft, setDraft] = useState<Record<string, string[]>>(
    () => Object.fromEntries(ROWS.map((r) => [r.name, (value[r.name] ?? DEFAULT_PARAMS[r.name]).map(String)])));

  function save() {
    const out: Record<string, number[]> = { ...value };
    for (const r of ROWS) {
      const nums = draft[r.name].map(Number);
      const ok = nums.every((x, i) => Number.isFinite(x) && x > 0 && (r.name === "TW_BOLL" && i === 1 ? x <= 10 : Number.isInteger(x) && x <= 500));
      out[r.name] = ok ? nums : DEFAULT_PARAMS[r.name];
    }
    onChange(out);
    // 期數重複或是 0 的拿掉
    const seen = new Set<number>();
    onMa(maDraft.filter((m) => m.n > 0 && !seen.has(m.n) && seen.add(m.n)));
    onBox(boxDraft);
    onClose();
  }

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-lg">指標參數</h3>
        <MaEditor ma={maDraft} setMa={setMaDraft} />
        <div className="border-t border-line" />
        <BoxEditor v={boxDraft} set={setBoxDraft} />
        <div className="border-t border-line" />
        {ROWS.map((r) => (
          <div key={r.name} className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-16 font-bold">{r.label}</span>
              {r.presets?.map((p) => {
                const on = draft[r.name].join(",") === p.join(",");
                return <button key={p.join()} className={`chip ${on ? "chip-on" : ""}`}
                  onClick={() => setDraft({ ...draft, [r.name]: p.map(String) })}>{p.join(",")}</button>;
              })}
            </div>
            <div className="flex gap-2">
              {r.fields.map((f, i) => (
                <label key={f} className="flex-1 text-xs text-muted">
                  {f}
                  <input inputMode="decimal" className="w-full mt-0.5 text-sm tabular-nums"
                    value={draft[r.name][i] ?? ""}
                    onChange={(e) => { const v = [...draft[r.name]]; v[i] = e.target.value; setDraft({ ...draft, [r.name]: v }); }} />
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <button className="btn" onClick={() => setDraft(Object.fromEntries(ROWS.map((r) => [r.name, DEFAULT_PARAMS[r.name].map(String)])))}>恢復預設</button>
          <button className="btn btn-primary ml-auto" onClick={save}>套用</button>
        </div>
        <p className="text-xs text-muted">參數只存在這台裝置。選股條件裡的 KD 可以另外指定參數。</p>
      </div>
    </div>
  );
}
