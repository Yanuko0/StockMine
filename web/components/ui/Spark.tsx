// 走勢小圖（近 20 日收盤）。fluid = 寬度跟著外框；area = 底下塗色（三竹的走勢圖樣子）
export default function Spark({ data, w = 64, h = 22, fluid = false, area = false }: { data: number[]; w?: number; h?: number; fluid?: boolean; area?: boolean }) {
  if (data.length < 2) return <svg width={fluid ? "100%" : w} height={h} />;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  const up = data[data.length - 1] >= data[0];
  const c = up ? "var(--up)" : "var(--down)";
  return (
    <svg width={fluid ? "100%" : w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio={fluid ? "none" : undefined} className="overflow-visible block" aria-hidden>
      {area && <polygon points={`0,${h} ${pts} ${w},${h}`} fill={c} opacity={0.18} />}
      <polyline points={pts} fill="none" stroke={c} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
