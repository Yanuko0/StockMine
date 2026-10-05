"use client";
import { TOOLS, type DrawKind } from "@/lib/tools";
import type { Drawing } from "@/lib/data";

export const COLORS = ["#ff4d4f", "#00c853", "#ffd400", "#33ccff", "#ff66cc", "#b47cff", "#ff9900", "#ffffff"];

interface Props {
  active: DrawKind | null;
  setActive: (k: DrawKind | null) => void;
  color: string;
  setColor: (c: string) => void;
  label: string;
  setLabel: (s: string) => void;
  selected: Drawing | null;
  mineSelected: boolean;
  onRecolor: (c: string) => void;
  onRelabel: (s: string) => void;
  onDelete: () => void;
  priv: boolean;                          // 新畫的線：只有我看得到
  setPriv: (v: boolean) => void;
  onTogglePrivate: (v: boolean) => void;  // 已選取的線
}

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d={d} /></svg>;
}

export default function DrawToolbar(p: Props) {
  const tool = TOOLS.find((t) => t.kind === p.active);
  return (
    <div className="border-b border-line bg-panel px-2 py-1.5 space-y-1.5">
      <div className="flex gap-1 overflow-x-auto no-scrollbar">
        {TOOLS.map((t) => (
          <button key={t.kind} title={t.label}
            className={`flex flex-col items-center min-w-[3.6rem] px-1.5 py-1 rounded-md text-[11px] whitespace-nowrap ${p.active === t.kind ? "bg-accent text-accent-ink" : "text-text"}`}
            onClick={() => p.setActive(p.active === t.kind ? null : t.kind)}>
            <Icon d={t.icon} />{t.label}
          </button>
        ))}
      </div>

      {(
        <div className="flex items-center gap-2 text-xs">
          <div className="flex gap-1">
            {COLORS.map((c) => (
              <button key={c} aria-label={c} onClick={() => p.setColor(c)}
                className={`w-5 h-5 rounded-full border ${p.color === c ? "border-white" : "border-transparent"}`} style={{ background: c }} />
            ))}
          </div>
          <input className="flex-1 min-w-0 py-0.5 text-xs" placeholder={p.active === "text" ? "要寫的文字" : "標籤（選填）"}
            value={p.label} onChange={(e) => p.setLabel(e.target.value)} />
          <label className="flex items-center gap-1 whitespace-nowrap" title="勾選後只有你看得到這條線">
            <input type="checkbox" checked={p.priv} onChange={(e) => p.setPriv(e.target.checked)} />🔒私人
          </label>
        </div>
      )}
      {tool && <div className="text-[11px] text-accent">{tool.label}：{tool.hint}（會自動吸附到 K 棒的開高低收）</div>}
    </div>
  );
}
