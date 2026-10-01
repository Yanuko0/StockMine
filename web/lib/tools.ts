// 畫線工具清單（不依賴 klinecharts，伺服器端也能載入）
export type DrawKind = "hline" | "segment" | "ray" | "rect" | "channel" | "fib" | "text";

export const TOOLS: { kind: DrawKind; label: string; icon: string; steps: number; hint: string }[] = [
  { kind: "hline", label: "水平線", icon: "M3 12h18", steps: 1, hint: "點一下價位" },
  { kind: "segment", label: "趨勢線", icon: "M4 19L20 5", steps: 2, hint: "點起點、再點終點" },
  { kind: "ray", label: "射線", icon: "M4 19L20 5M16 5h4v4", steps: 2, hint: "點起點、再點方向" },
  { kind: "rect", label: "箱型", icon: "M4 7h16v10H4z", steps: 2, hint: "點箱子的兩個對角" },
  { kind: "channel", label: "通道", icon: "M3 15L15 5M9 19L21 9", steps: 3, hint: "點兩點畫趨勢線，第三點決定通道寬度" },
  { kind: "fib", label: "黃金分割", icon: "M3 5h18M3 9h18M3 12h18M3 16h18M3 19h18", steps: 2, hint: "點波段起點、再點終點" },
  { kind: "text", label: "文字", icon: "M5 5h14M12 5v14", steps: 1, hint: "點位置後輸入文字" },
];

export const OVERLAY_NAME: Record<DrawKind, string> = {
  hline: "twHLine", segment: "twSegment", ray: "twRay", rect: "twRect",
  channel: "twChannel", fib: "twFib", text: "twText",
};

export interface DrawExt { color: string; label: string; mine: boolean }

