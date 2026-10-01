// 內建的通用選股範本（一鍵套用後可以再修改）。條件格式與 pipeline/twstock/screener.py 一致。
// 個人的範本存在資料庫 strategy_templates（只有自己看得到），不放在程式碼裡。
import type { Condition, Strategy } from "./data";

type Preset = { name: string; note: string; conditions: Condition[] };

const UNIVERSE: Condition = { kind: "universe", type: "stock", market: "all" };
const VOL300: Condition = { kind: "compare", tf: "D", left: { src: "volma", n: 5 }, op: ">", right: { src: "value", v: 300 } };

export const PRESETS: Preset[] = [
  {
    name: "箱型突破選股",
    note: "自動判定密集成交區箱型（前 60 日、包住 70% 成交量的價格區間），今天收盤由下往上突破箱頂，而且成交量大於前 60 日均量 1.5 倍。箱高超過 20% 不算箱型。所有數字都可以自己改。",
    conditions: [
      UNIVERSE, VOL300,
      { kind: "vp_box", tf: "D", mode: "break_top", n: 60, va: 70, max_height: 20, vol: 1.5 },
    ],
  },
  {
    name: "箱底佈局選股",
    note: "自動判定密集成交區箱型（前 60 日、包住 70% 成交量），收盤回到箱底上方 20% 箱高以內，而且最低價沒有跌破箱底（容許 1%）。適合在箱型底部分批佈局。所有數字都可以自己改。",
    conditions: [
      UNIVERSE, VOL300,
      { kind: "vp_box", tf: "D", mode: "bottom", n: 60, va: 70, max_height: 20, zone: 20, tol: 1 },
    ],
  },
  {
    name: "月扣三低突破",
    note: "月扣三低線 = 未來三個月要扣掉的月收盤（D1~D3）中最高的那個。今天日K 收盤由下往上突破這條線才算符合。",
    conditions: [
      { kind: "deduct3low", tf: "M", n: 5, mode: "break" },
      UNIVERSE,
    ],
  },
];

export function presetStrategy(p: Preset): Pick<Strategy, "name" | "conditions"> {
  return { name: p.name, conditions: { logic: "AND", conditions: structuredClone(p.conditions), note: p.note } };
}
