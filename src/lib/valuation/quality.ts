import type {
  Fundamentals,
  QualityLabel,
  QualityLine,
  QualityReport,
  SurvivalGate,
} from "./types";

const FX: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  HKD: 0.128,
  CNY: 0.14,
  TWD: 0.031,
  JPY: 0.0067,
  KRW: 0.00072,
  CHF: 1.12,
  CAD: 0.73,
  AUD: 0.66,
  SGD: 0.74,
  INR: 0.012,
  BRL: 0.18,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function toUsd(amount: number, currency: string): number {
  const fx = FX[currency.toUpperCase()] ?? 1;
  return amount * fx;
}

function money(n: number, ccy: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T ${ccy}`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B ${ccy}`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M ${ccy}`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K ${ccy}`;
  return `${sign}${abs.toFixed(2)} ${ccy}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export const QUALITY_BANDS = [
  { min: 75, max: 100, name: "優質事業", meaning: "有規模、有現金流或高利潤。用正常 DCF／相對估值。" },
  { min: 55, max: 74, name: "可投資事業", meaning: "已是真生意。用分型加權，不必開爆發帳。" },
  { min: 30, max: 54, name: "早期事業", meaning: "有一點基期與跑道，選擇權只能低權重。" },
  { min: 0, max: 29, name: "研發殼", meaning: "還沒產品化。禁止用樂觀 DCF 追市價。" },
];

export const LABEL_META: Record<
  QualityLabel,
  { text: string; meaning: string }
> = {
  survival: {
    text: "存活風險",
    meaning: "24 個月內可能先燒完或先被稀釋。只估現金／清算，不開選擇權帳。",
  },
  shell: {
    text: "研發殼",
    meaning: "高倍數多半是題材。財報價可算，樂觀權重最高 5%。",
  },
  early: {
    text: "早期事業",
    meaning: "有基期與跑道，但引擎未穩。可開低權重選擇權，必須看隱含成功機率。",
  },
  investable: {
    text: "可投資事業",
    meaning: "已是生意。用 DCF／相對／股利分型，不必為市價另開爆發帳。",
  },
  quality: {
    text: "優質事業",
    meaning: "規模與現金流品質夠。貴的話是溢價，不是「還沒入帳的選擇權」。",
  },
  optionality: {
    text: "真選擇權",
    meaning: "大規模 + 已有引擎 + 市場在買未來。另開情境期望，不併入財報加權。",
  },
  thematic: {
    text: "題材溢價",
    meaning: "很貴但品質或規模不夠。不准用 SPCX 那套把合理價往上修。",
  },
};

function psOf(f: Fundamentals): number {
  if (f.priceToSales && f.priceToSales > 0) return f.priceToSales;
  if (f.revenue > 0 && f.marketCap > 0) return f.marketCap / f.revenue;
  return 0;
}

export function scoreQuality(f: Fundamentals): QualityReport {
  const ccy = f.currency || "USD";
  const revUsd = toUsd(f.revenue, ccy);
  const mcapUsd = toUsd(f.marketCap, ccy);
  const cashUsd = toUsd(f.totalCash, ccy);
  const op = f.operatingMargin ?? (f.revenue ? f.ebit / f.revenue : 0);
  const g = f.revenueGrowth ?? 0;
  const absGrowth = f.revenue * Math.max(0, g);
  const absGrowthUsd = toUsd(absGrowth, ccy);
  const ebitdaM = f.revenue > 0 ? f.ebitda / f.revenue : 0;
  const fcfM = f.revenue > 0 ? f.fcf / f.revenue : 0;
  const lite = f.revenue <= 0 && (f.eps > 0 || ((f.trailingPE ?? 0) > 0));
  const profitable = f.eps > 0 && op >= 0;
  const burn = Math.max(-f.fcf, -f.ebitda, 0);
  const runwayYears =
    !profitable && burn > 0 && f.totalCash > 0 ? f.totalCash / burn : profitable ? Infinity : null;
  const ps = psOf(f);
  const pe = f.trailingPE ?? 0;
  const expensive = ps >= 12 || pe > 45;

  const gates: SurvivalGate[] = [];
  const runwayTriggered = !profitable && runwayYears != null && runwayYears < 1;
  gates.push({
    id: "runway",
    name: "現金跑道",
    triggered: runwayTriggered,
    rule: "未獲利且 現金 ÷ max(−FCF, −EBITDA) < 12 個月",
    value:
      profitable
        ? "已獲利，不適用"
        : runwayYears == null
          ? "無法計算"
          : `${runwayYears.toFixed(2)} 年（現金 ${money(f.totalCash, ccy)}）`,
  });
  const scaleMismatch = mcapUsd < 3e8 && revUsd < 2e7 && op < -0.5;
  gates.push({
    id: "scale",
    name: "規模錯配",
    triggered: scaleMismatch,
    rule: "市值 < 3 億美元 且 營收 < 2,000 萬美元 且 營業利益率 < −50%",
    value: `市值 ${money(f.marketCap, ccy)} · 營收 ${money(f.revenue, ccy)} · 利益率 ${pct(op)}`,
  });
  gates.push({
    id: "dilution",
    name: "稀釋",
    triggered: false,
    rule: "近一年流通股增加 > 20%（目前資料不足，不觸發）",
    value: "資料不足，略過",
  });
  const survival = gates.some((g) => g.triggered);

  const lines: QualityLine[] = [];

  let a = 0;
  let aRule = "營收 < 2,000 萬美元 → 0";
  if (lite) {
    a = 12;
    aRule = "本次沒抓到營收，不把已上市股票當零營收新創 → 12";
  } else if (revUsd >= 2e10) {
    a = 20;
    aRule = "營收 ≥ 200 億美元 → 20";
  } else if (revUsd >= 5e9) {
    a = 16;
    aRule = "營收 50–200 億美元 → 16";
  } else if (revUsd >= 1e9) {
    a = 12;
    aRule = "營收 10–50 億美元 → 12";
  } else if (revUsd >= 1e8) {
    a = 8;
    aRule = "營收 1–10 億美元 → 8";
  } else if (revUsd >= 2e7) {
    a = 4;
    aRule = "營收 2,000 萬–1 億美元 → 4";
  }
  lines.push({
    id: "scale",
    name: "A 規模",
    points: a,
    max: 20,
    rule: aRule,
    why: `營收 ${money(f.revenue, ccy)}（約 ${money(revUsd, "USD")}）。看絕對金額，不看百分比。`,
  });

  let b = 0;
  let bRule = "EBITDA 與 FCF 皆負 → 0";
  if (lite && f.eps > 0) {
    b = 12;
    bRule = "有正 EPS／本益比，本次沒抓到 EBITDA → 12";
  } else if (f.fcf > 0 && fcfM >= 0.08) {
    b = 20;
    bRule = "FCF>0 且 FCF／營收 ≥ 8% → 20";
  } else if (f.ebitda > 0 && ebitdaM >= 0.1) {
    b = 16;
    bRule = "EBITDA>0 且利潤率 ≥ 10% → 16";
  } else if (f.ebitda > 0) {
    b = 12;
    bRule = "EBITDA>0 → 12";
  } else if (f.eps > 0 && f.fcf < 0) {
    b = 6;
    bRule = "EPS>0 但 FCF<0 → 6";
  }
  lines.push({
    id: "engine",
    name: "B 現金流引擎",
    points: b,
    max: 20,
    rule: bRule,
    why: `EBITDA ${money(f.ebitda, ccy)} · FCF ${money(f.fcf, ccy)} · EPS ${f.eps.toFixed(2)}。`,
  });

  let c = 0;
  let cRule = "營業利益率 < −20% → 0";
  if (lite && f.eps > 0) {
    c = 12;
    cRule = "未提供營業利益率，依正 EPS 給中性 12";
  } else if (op >= 0.15) {
    c = 20;
    cRule = "營業利益率 ≥ 15% → 20";
  } else if (op >= 0.08) {
    c = 14;
    cRule = "營業利益率 8–15% → 14";
  } else if (op >= 0) {
    c = 8;
    cRule = "營業利益率 0–8%（含代工薄利）→ 8";
  } else if (op >= -0.2) {
    c = 4;
    cRule = "營業利益率 −20–0% → 4";
  }
  lines.push({
    id: "unit",
    name: "C 單位經濟",
    points: c,
    max: 20,
    rule: cRule,
    why: `營業利益率 ${pct(op)}。不因「以後會變軟體」先給滿分。`,
  });

  let d = 0;
  let dRule = "成長不足或基期過小";
  if (lite) {
    d = 8;
    dRule = "本次沒有營收成長序列 → 中性 8";
  } else if (g >= 0.2 && absGrowthUsd >= 5e7) {
    d = g >= 0.4 ? 20 : 16;
    dRule = "成長 ≥ 20% 且年增額 ≥ 5,000 萬美元 → 16–20";
  } else if (g >= 0.2 && absGrowthUsd < 1e7) {
    d = 4;
    dRule = "成長 ≥ 20% 但年增額 < 1,000 萬美元 → 最多 4（百分比不可信）";
  } else if (g >= 0.08 && revUsd >= 1e8) {
    d = 12;
    dRule = "成長 8–20% 且基期夠大 → 12";
  } else if (g < 0 && profitable) {
    d = 4;
    dRule = "負成長但已獲利，可能是週期 → 4";
  } else if (g >= 0.2) {
    d = 8;
    dRule = "成長 ≥ 20%、年增額介於中間 → 8";
  }
  lines.push({
    id: "growth",
    name: "D 成長品質",
    points: d,
    max: 20,
    rule: dRule,
    why: `成長 ${pct(g)} · 年增約 ${money(absGrowth, ccy)}。百分比要配絕對增量。`,
  });

  let e = 0;
  let eRule = "虧損且跑道短 → 0";
  const ebitdaOk = f.ebitda > 0;
  const ndToEbitda = ebitdaOk ? f.netDebt / f.ebitda : Infinity;
  if (f.netDebt < 0 && (profitable || (runwayYears != null && runwayYears >= 2))) {
    e = 20;
    eRule = "淨現金，且已獲利或跑道 ≥ 2 年 → 20";
  } else if (f.netDebt < 0 && runwayYears != null && runwayYears >= 1) {
    e = 12;
    eRule = "淨現金但跑道 12–24 月 → 12";
  } else if (ebitdaOk && ndToEbitda < 2) {
    e = 12;
    eRule = "有息負債／EBITDA < 2 → 12";
  } else if (profitable) {
    e = 6;
    eRule = "淨債偏高但已獲利 → 6";
  } else if (runwayYears != null && runwayYears >= 1) {
    e = 4;
    eRule = "虧損 + 跑道 12–18 月 → 4";
  }
  lines.push({
    id: "balance",
    name: "E 資產負債",
    points: e,
    max: 20,
    rule: eRule,
    why: `現金 ${money(f.totalCash, ccy)} · 淨債務 ${money(f.netDebt, ccy)} · 跑道 ${
      runwayYears == null ? "n.a." : Number.isFinite(runwayYears) ? `${runwayYears.toFixed(2)} 年` : "已獲利"
    }。`,
  });

  lines.push({
    id: "shares",
    name: "F 每股穩定",
    points: 10,
    max: 20,
    rule: "流通股年增資料不足 → 中性 10",
    why: "沒有股數年增序列時不假裝穩定，也不誤判稀釋。",
  });

  const traps: QualityLine[] = [];
  if (ps >= 15 && revUsd < 5e7) {
    traps.push({
      id: "trap-ps",
      name: "小營收高 P/S",
      points: -15,
      max: 0,
      rule: "P/S ≥ 15 且營收 < 5,000 萬美元 → −15",
      why: `P/S ${ps.toFixed(1)}x，基期太小，倍數不可當品質。`,
    });
  }
  if (g > 0.5 && revUsd < 3e7) {
    traps.push({
      id: "trap-g",
      name: "微小基期高成長",
      points: -10,
      max: 0,
      rule: "營收成長 > 50% 且基期 < 3,000 萬美元 → −10",
      why: "從極小基期跳升的百分比沒有資訊量。",
    });
  }
  const ex = (f.exchange || "").toUpperCase();
  if (/\b(NCM|NGM|PNK|OTC|TWO|TAI.*OTC)\b/.test(ex) || ex.includes("CAPITAL")) {
    traps.push({
      id: "trap-ex",
      name: "小盤交易所",
      points: -5,
      max: 0,
      rule: "CM／櫃買／OTC → −5",
      why: `交易所 ${f.exchange || "未標示"}，流動性與資訊覆蓋較差。`,
    });
  }

  const raw = lines.reduce((s, x) => s + x.points, 0) + traps.reduce((s, x) => s + x.points, 0);
  const q = clamp(raw, 0, 100);

  let label: QualityLabel = "shell";
  if (survival) label = "survival";
  else if (lite && f.eps > 0) label = q >= 55 ? "investable" : "early";
  else if (expensive && (q < 40 || revUsd < 1e8)) label = "thematic";
  else if (q < 30 || (a === 0 && b === 0)) label = "shell";
  else if (q >= 55 && expensive && revUsd >= 1e9 && (f.ebitda > 0 || ebitdaM > -0.03)) {
    label = "optionality";
  } else if (q >= 75) label = "quality";
  else if (q >= 55) label = "investable";
  else if (q >= 30 && revUsd >= 2e7 && runwayYears != null && (runwayYears >= 1.5 || profitable)) {
    label = "early";
  } else label = "shell";

  const meta = LABEL_META[label];
  const allowed = (() => {
    if (label === "survival") {
      return {
        blend: true,
        optionExpected: false,
        bullDcf: false,
        note: "只把財報價當參考，情境期望關閉；以現金／清算為底。",
      };
    }
    if (label === "shell" || label === "thematic") {
      return {
        blend: true,
        optionExpected: false,
        bullDcf: false,
        note: "不准用樂觀爆發 DCF 追市價。選擇權帳不顯示期望價。",
      };
    }
    if (label === "early") {
      return {
        blend: true,
        optionExpected: true,
        bullDcf: true,
        note: "可開低權重選擇權（樂觀約 12%）。必須對照隱含成功機率。",
      };
    }
    if (label === "optionality") {
      return {
        blend: true,
        optionExpected: true,
        bullDcf: true,
        note: "財報加權與情境期望分開看。後者才是市場在買的選擇權。",
      };
    }
    return {
      blend: true,
      optionExpected: false,
      bullDcf: false,
      note: "用分型加權即可。貴是溢價，不必另開爆發帳。",
    };
  })();

  return {
    q,
    label,
    labelText: meta.text,
    meaning: meta.meaning,
    allowed,
    runwayYears: runwayYears == null || !Number.isFinite(runwayYears) ? (profitable ? null : runwayYears) : runwayYears,
    revUsd,
    lines,
    traps,
    gates,
    bands: QUALITY_BANDS,
  };
}
