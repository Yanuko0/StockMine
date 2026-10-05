"use client";
import { useEffect, useRef } from "react";
import { init, dispose, type Chart, type Period, type Point } from "klinecharts";
import { registerAll, chartStyles, CHIP_INDS, type ChipExt, type MAExt } from "@/lib/chart";
import { setPalette } from "@/lib/colors";
import { currentTheme, THEME_EVENT, type Theme } from "@/lib/theme";
import { OVERLAY_NAME, type DrawKind, type DrawExt } from "@/lib/tools";
import type { Bar, TF } from "@/lib/bars";
import type { Drawing, DrawPoint } from "@/lib/data";
import type { TimeMapper } from "@/lib/timeline";

export type SubInd = "VOL" | "TW_KD" | "TW_RSI" | "TW_MACD" | "TW_BIAS" | "TW_MF" | "TW_FOREIGN" | "TW_TRUST" | "TW_DEALER";

interface Props {
  code: string;
  tf: TF;
  bars: Bar[];
  mapper: TimeMapper;
  maPeriods: number[];
  maExt: MAExt;
  subs: SubInd[];
  boll: boolean;
  params: Record<string, number[]>; // 指標參數（KD 9,3,3 / 60,3,3 …）
  chips: Record<string, { ts: number; v: number }[]>; // 籌碼副圖資料（TW_MF / TW_FOREIGN …）
  drawings: Drawing[];
  userId: string | null;
  tool: { kind: DrawKind; color: string; label: string } | null; // 非 null：正在畫
  onCreated: (kind: DrawKind, points: DrawPoint[]) => void;
  onMoved: (id: string, points: DrawPoint[]) => void;
  onSelect: (id: string | null) => void;
  onCross?: (index: number | null) => void; // 十字線移到第幾根（手機版自己畫均線數值用）
}

const isSmall = () => typeof window !== "undefined" && window.innerWidth < 640;

function periodOf(tf: TF): Period {
  switch (tf) {
    case "D": return { type: "day", span: 1 };
    case "W": return { type: "week", span: 1 };
    case "M": return { type: "month", span: 1 };
    default: return { type: "minute", span: parseInt(tf) };
  }
}

function toDrawPoints(mapper: TimeMapper, pts: Array<Partial<Point>>, kind: DrawKind, prev?: DrawPoint[]): DrawPoint[] | null {
  const out: DrawPoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    if (q.value == null) return null;
    const t = kind === "hline"
      ? (prev?.[0]?.t ?? Date.now())
      : mapper.toTime(q.dataIndex ?? 0);
    out.push({ t, v: Math.round(q.value * 100) / 100 });
  }
  return out;
}

export default function KChart(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<Chart | null>(null);
  const barsRef = useRef<Bar[]>(p.bars);
  const subPanes = useRef<Record<string, string>>({});
  const cb = useRef(p);
  useEffect(() => { cb.current = p; });

  // 建立圖表
  useEffect(() => {
    registerAll();
    const node = el.current!;
    const theme = currentTheme();
    setPalette(theme);
    const c = init(node, { locale: "zh-TW", timezone: "Asia/Taipei", styles: theme });
    if (!c) return;
    c.setStyles(chartStyles(theme) as never);
    const onTheme = (e: Event) => {
      const t = (e as CustomEvent<Theme>).detail;
      setPalette(t);
      c.setStyles(t);
      c.setStyles(chartStyles(t) as never);
    };
    window.addEventListener(THEME_EVENT, onTheme);
    c.setSymbol({ ticker: p.code, pricePrecision: 2, volumePrecision: 0 });
    c.setPeriod(periodOf(p.tf));
    c.setDataLoader({ getBars: ({ callback }) => callback(barsRef.current as never, false) });
    // 手機：均線數值改在圖表上方用一行顯示（畫在圖上會兩三行、蓋到 K 棒）
    c.createIndicator({ name: "TW_MA", paneId: "candle_pane", calcParams: p.maPeriods, extendData: p.maExt,
      ...(isSmall() ? { createTooltipDataSource: () => ({ name: "", calcParamsText: "", legends: [], features: [] }) } : {}) }, true);
    c.subscribeAction("onCrosshairChange", (d) => {
      const x = d as { dataIndex?: number; paneId?: string } | undefined;
      cb.current.onCross?.(x && x.paneId ? x.dataIndex ?? null : null);
    });
    // 主圖的價格範圍只看「畫面上的 K 棒」：離很遠的長天期均線不會把 K 棒擠到上面（看不到的均線會畫到畫面外）
    c.overrideYAxis({
      paneId: "candle_pane",
      gap: { top: 0.1, bottom: 0.06 },
      createRange: ({ chart: ch, defaultRange }) => {
        const list = ch.getDataList();
        const vr = ch.getVisibleRange();
        let hi = -Infinity, lo = Infinity;
        for (let i = Math.max(0, vr.from); i < Math.min(list.length, vr.to); i++) {
          const d = list[i];
          if (d.high > hi) hi = d.high;
          if (d.low < lo) lo = d.low;
        }
        if (!isFinite(hi) || !isFinite(lo)) return defaultRange;
        const pad = (hi - lo) * 0.04 || hi * 0.01;
        const f = lo - pad, t = hi + pad, r = t - f;
        return { ...defaultRange, from: f, to: t, range: r, realFrom: f, realTo: t, realRange: r, displayFrom: f, displayTo: t, displayRange: r };
      },
    });
    // 最後一根 K 棒右邊只留一點空間（預設留很多，K 棒看起來偏左、偏上）
    c.setOffsetRightDistance(window.innerWidth < 640 ? 14 : 36);
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(node);
    return () => { window.removeEventListener(THEME_EVENT, onTheme); ro.disconnect(); dispose(node); chart.current = null; subPanes.current = {}; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 資料 / 週期
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    barsRef.current = p.bars;
    c.setSymbol({ ticker: p.code, pricePrecision: 2, volumePrecision: 0 });
    c.setPeriod(periodOf(p.tf));
    c.resetData();
  }, [p.bars, p.tf, p.code]);

  useEffect(() => {
    chart.current?.overrideIndicator({ name: "TW_MA", paneId: "candle_pane", calcParams: p.maPeriods, extendData: p.maExt });
  }, [p.maPeriods, p.maExt]);

  // 副圖
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const want = new Set(p.subs);
    for (const [name, paneId] of Object.entries(subPanes.current)) {
      if (!want.has(name as SubInd)) { c.removeIndicator({ paneId }); delete subPanes.current[name]; }
    }
    p.subs.forEach((name) => {
      if (!subPanes.current[name]) {
        const id = c.createIndicator({
          name, paneId: `pane_${name}`,
          ...(p.params[name] ? { calcParams: p.params[name] } : name === "VOL" && isSmall() ? { calcParams: [5, 10] } : {}),
          ...(name in CHIP_INDS ? { extendData: { series: p.chips[name] ?? [], intraday: p.tf.endsWith("m") } satisfies ChipExt } : {}),
        }, false);
        if (id) {
          subPanes.current[name] = `pane_${name}`;
          c.setPaneOptions({ id: `pane_${name}`, height: isSmall() ? 66 : 96 }); // 副圖矮一點，主圖 K 棒才夠大
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 參數變動由下方 overrideIndicator 處理
  }, [p.subs]);

  // 籌碼副圖資料
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    for (const [name, paneId] of Object.entries(subPanes.current)) {
      if (name in CHIP_INDS) {
        c.overrideIndicator({ name, paneId, extendData: { series: p.chips[name] ?? [], intraday: p.tf.endsWith("m") } satisfies ChipExt });
      }
    }
  }, [p.chips, p.tf, p.subs]);

  // 布林通道（主圖）
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    if (p.boll) c.createIndicator({ name: "TW_BOLL", paneId: "candle_pane", calcParams: p.params.TW_BOLL }, true);
    else c.removeIndicator({ paneId: "candle_pane", name: "TW_BOLL" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.boll]);

  // 指標參數
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    for (const [name, paneId] of Object.entries(subPanes.current)) {
      if (p.params[name]) c.overrideIndicator({ name, paneId, calcParams: p.params[name] });
    }
    if (p.boll && p.params.TW_BOLL) c.overrideIndicator({ name: "TW_BOLL", paneId: "candle_pane", calcParams: p.params.TW_BOLL });
  }, [p.params, p.subs, p.boll]);

  // 共享畫線：用時間換算成這個週期的 K 棒位置
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.removeOverlay({ groupId: "drawings" });
    const L = p.bars.length;
    if (!L) return;
    p.drawings.forEach((d) => {
      const mine = d.created_by === p.userId;
      const points = d.points.map((pt) => ({
        dataIndex: d.kind === "hline" ? L - 1 : p.mapper.toIndex(pt.t),
        value: pt.v,
      }));
      c.createOverlay({
        name: OVERLAY_NAME[d.kind], id: `d_${d.id}`, groupId: "drawings", paneId: "candle_pane",
        lock: !mine, mode: "weak_magnet", points,
        extendData: { color: d.color, label: d.label ?? "", mine } satisfies DrawExt,
        onSelected: () => cb.current.onSelect(d.id),
        onDeselected: () => cb.current.onSelect(null),
        onPressedMoveEnd: (e) => {
          const pts = toDrawPoints(cb.current.mapper, e.overlay.points, d.kind, d.points);
          if (pts) cb.current.onMoved(d.id, pts);
        },
      });
    });
  }, [p.drawings, p.userId, p.bars, p.mapper]);

  // 畫線模式
  useEffect(() => {
    const c = chart.current;
    if (!c || !p.tool) return;
    const kind = p.tool.kind;
    const id = c.createOverlay({
      name: OVERLAY_NAME[kind], groupId: "drawing", paneId: "candle_pane", mode: "weak_magnet",
      extendData: { color: p.tool.color, label: p.tool.label, mine: true } satisfies DrawExt,
      onDrawEnd: (e) => {
        const pts = toDrawPoints(cb.current.mapper, e.overlay.points, kind);
        setTimeout(() => c.removeOverlay({ groupId: "drawing" }), 0);
        if (pts) cb.current.onCreated(kind, pts);
      },
    });
    return () => { if (id) c.removeOverlay({ groupId: "drawing" }); };
  }, [p.tool]);

  return <div ref={el} className="w-full h-full" />;
}
