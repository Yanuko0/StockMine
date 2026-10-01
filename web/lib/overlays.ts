"use client";
// 畫線工具（KLineChart 自訂 overlay）
import { registerOverlay, type Coordinate, type OverlayFigure } from "klinecharts";

import type { DrawExt } from "./tools";
export type { DrawKind, DrawExt } from "./tools";

const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function line(c: Coordinate[], color: string, dashed = false, size = 1.5): OverlayFigure {
  return { type: "line", attrs: { coordinates: c }, styles: { color, size, style: dashed ? "dashed" : "solid", dashedValue: [4, 3] } };
}
function text(x: number, y: number, t: string, color: string, align = "left", baseline = "bottom"): OverlayFigure {
  return {
    type: "text", ignoreEvent: true,
    attrs: { x, y, text: t, align, baseline },
    styles: { color, size: 11, backgroundColor: "transparent", paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, borderSize: 0 },
  };
}
// 把線段延伸到圖表邊界
function extend(a: Coordinate, b: Coordinate, width: number, both: boolean): Coordinate[] {
  if (a.x === b.x) return [a, { x: a.x, y: b.y > a.y ? 99999 : -99999 }];
  const k = (b.y - a.y) / (b.x - a.x);
  const toX = (x: number) => ({ x, y: a.y + k * (x - a.x) });
  const end = b.x >= a.x ? toX(width) : toX(0);
  return both ? [toX(0), toX(width)] : [a, end];
}

type Ext = DrawExt | undefined;
const colorOf = (e: Ext) => e?.color ?? "#ff4d4f";

export function registerOverlays() {
  const base = {
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: true,
  };

  // 水平線
  registerOverlay<DrawExt>({
    ...base, name: "twHLine", totalStep: 2, needDefaultPointFigure: false,
    createPointFigures: ({ coordinates, bounding, overlay }) => {
      const c = colorOf(overlay.extendData), y = coordinates[0].y;
      const figs = [line([{ x: 0, y }, { x: bounding.width, y }], c)];
      const p = overlay.points[0]?.value;
      const lbl = `${overlay.extendData?.label ? overlay.extendData.label + " " : ""}${p != null ? p.toFixed(2) : ""}`;
      figs.push(text(bounding.width - 4, y - 3, lbl, c, "right"));  // 標籤放右邊，避免擋到左上角的指標數值
      return figs;
    },
  });

  // 趨勢線（線段）
  registerOverlay<DrawExt>({
    ...base, name: "twSegment", totalStep: 3,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const c = colorOf(overlay.extendData);
      const figs = [line(coordinates.slice(0, 2), c)];
      if (overlay.extendData?.label) figs.push(text(coordinates[1].x + 4, coordinates[1].y, overlay.extendData.label, c, "left", "middle"));
      return figs;
    },
  });

  // 射線
  registerOverlay<DrawExt>({
    ...base, name: "twRay", totalStep: 3,
    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (coordinates.length < 2) return [];
      const c = colorOf(overlay.extendData);
      return [line(extend(coordinates[0], coordinates[1], bounding.width, false), c)];
    },
  });

  // 箱型：兩個對角點，上緣 = 壓力、下緣 = 支撐
  registerOverlay<DrawExt>({
    ...base, name: "twRect", totalStep: 3,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const c = colorOf(overlay.extendData);
      const [a, b] = coordinates;
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      const [p1, p2] = overlay.points;
      const hi = Math.max(p1?.value ?? 0, p2?.value ?? 0), lo = Math.min(p1?.value ?? 0, p2?.value ?? 0);
      return [
        { type: "polygon", attrs: { coordinates: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] },
          styles: { style: "stroke_fill", color: c + "22", borderColor: c, borderSize: 1.5 } },
        text(x1 + 4, y0, hi.toFixed(2), c, "left", "middle"),
        text(x1 + 4, y1, lo.toFixed(2), c, "left", "middle"),
        ...(overlay.extendData?.label ? [text(x0 + 4, y0 + 3, overlay.extendData.label, c, "left", "top")] : []),
      ];
    },
  });

  // 平行通道：前兩點是主線，第三點決定平行線位置
  registerOverlay<DrawExt>({
    ...base, name: "twChannel", totalStep: 4,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const c = colorOf(overlay.extendData);
      const [a, b] = coordinates;
      const figs = [line([a, b], c)];
      if (coordinates.length >= 3) {
        const p = coordinates[2];
        const k = a.x === b.x ? 0 : (b.y - a.y) / (b.x - a.x);
        const dy = p.y - (a.y + k * (p.x - a.x));
        figs.push(line([{ x: a.x, y: a.y + dy }, { x: b.x, y: b.y + dy }], c));
        figs.push(line([{ x: a.x, y: a.y + dy / 2 }, { x: b.x, y: b.y + dy / 2 }], c, true, 1));
        figs.push({ type: "polygon", ignoreEvent: true,
          attrs: { coordinates: [a, b, { x: b.x, y: b.y + dy }, { x: a.x, y: a.y + dy }] },
          styles: { style: "fill", color: c + "18" } });
      }
      return figs;
    },
  });

  // 黃金分割
  registerOverlay<DrawExt>({
    ...base, name: "twFib", totalStep: 3,
    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (coordinates.length < 2) return [];
      const c = colorOf(overlay.extendData);
      const [a, b] = coordinates;
      const [pa, pb] = overlay.points;
      const va = pa?.value ?? 0, vb = pb?.value ?? 0;
      const x0 = Math.min(a.x, b.x);
      const figs: OverlayFigure[] = [line([a, b], c, true, 1)];
      FIB.forEach((r) => {
        const y = b.y + (a.y - b.y) * r; // 從終點往回測
        const v = vb + (va - vb) * r;
        figs.push(line([{ x: x0, y }, { x: bounding.width, y }], c, r !== 0 && r !== 1, 1));
        figs.push(text(x0 + 2, y - 2, `${(r * 100).toFixed(1)}%  ${v.toFixed(2)}`, c));
      });
      return figs;
    },
  });

  // 文字標註
  registerOverlay<DrawExt>({
    ...base, name: "twText", totalStep: 2, needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, overlay }) => {
      const c = colorOf(overlay.extendData);
      const p = coordinates[0];
      return [{
        type: "text",
        attrs: { x: p.x, y: p.y, text: overlay.extendData?.label || "文字", align: "left", baseline: "middle" },
        styles: { color: "#000", size: 12, backgroundColor: c, borderRadius: 3, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
      }];
    },
  });
}
