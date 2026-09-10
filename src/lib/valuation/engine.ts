import type {
  Assumptions,
  CompanyRegime,
  Fundamentals,
  OptionCard,
  OptionFlag,
  QualityReport,
  RimYear,
  SensitivityCell,
  ValuationResult,
  YearRow,
} from "./types";
import { scoreQuality } from "./quality";

function finite(n: number): boolean {
  return Number.isFinite(n);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function costOfEquity(a: Assumptions): number {
  return a.rf + a.beta * a.erp + a.specificRisk;
}

export function waccOf(a: Assumptions): number {
  const ke = costOfEquity(a);
  const afterTaxKd = a.preTaxKd * (1 - a.tax);
  const we = a.we;
  const wd = a.wd;
  const sum = we + wd;
  const weN = sum === 0 ? 1 : we / sum;
  const wdN = sum === 0 ? 0 : wd / sum;
  return weN * ke + wdN * afterTaxKd;
}

function gordonPrice(d1: number, ke: number, g: number): number | null {
  if (ke <= g || d1 <= 0) return null;
  return d1 / (ke - g);
}

function normalizeWeights(a: Assumptions): {
  g: number;
  t: number;
  d: number;
  r: number;
  m: number;
} {
  const raw = [
    Math.max(0, a.weightGordon),
    Math.max(0, a.weightTwoStage),
    Math.max(0, a.weightDcf),
    Math.max(0, a.weightRelative),
    Math.max(0, a.weightRim ?? 0),
  ];
  const sum = raw.reduce((s, v) => s + v, 0);
  if (sum <= 0) return { g: 0, t: 0, d: 1, r: 0, m: 0 };
  return {
    g: raw[0] / sum,
    t: raw[1] / sum,
    d: raw[2] / sum,
    r: raw[3] / sum,
    m: raw[4] / sum,
  };
}

export const ROE_PRICE_SHARE: Record<
  CompanyRegime,
  { rim: string; viaPb: string; total: string; note: string }
> = {
  optionality: {
    rim: "0%",
    viaPb: "0%",
    total: "0%",
    note: "市場在買未來選擇權。帳面 ROE 解釋不了溢價，不當成價格。",
  },
  preProfit: {
    rim: "0%",
    viaPb: "0%",
    total: "0%",
    note: "還沒有穩定 ROE，股利與剩餘收益都關。",
  },
  lowMargin: {
    rim: "30%",
    viaPb: "約 10%",
    total: "約 40%",
    note: "代工／通路淨值真實。ROE 決定能不能高於帳面。",
  },
  growthProfit: {
    rim: "20%",
    viaPb: "約 10%",
    total: "約 30%",
    note: "成長仍以 DCF／P/S 為主，RIM 只交叉檢查 ROE−Ke。",
  },
  dividend: {
    rim: "30%",
    viaPb: "約 4%",
    total: "約 34%",
    note: "現金股利是真的；RIM 另外估淨值溢價。",
  },
  compounder: {
    rim: "36%",
    viaPb: "約 7%",
    total: "約 43%",
    note: "低股利、錢留在公司。股東要不要繼續投資，看的就是 ROE 能不能蓋過 Ke。",
  },
};

export const REGIME_META: Record<
  CompanyRegime,
  {
    label: string;
    why: string;
    weights: { g: number; t: number; d: number; r: number; m: number };
  }
> = {
  optionality: {
    label: "高成長選擇權",
    why: "市場在買未來選擇權。帳面與 ROE 解釋不了溢價，RIM 權重 0。加權看現有事業，情境期望另開。",
    weights: { g: 0, t: 0, d: 0.38, r: 0.62, m: 0 },
  },
  preProfit: {
    label: "尚未穩定獲利",
    why: "沒有穩定 ROE。主看 P/S 與離場倍數 DCF。股利與 RIM 都關。",
    weights: { g: 0, t: 0, d: 0.28, r: 0.72, m: 0 },
  },
  lowMargin: {
    label: "低利潤規模事業",
    why: "代工、通路。FCF 一年吵一年，RIM 吃淨值與 ROE；相對估值仍是最大票。",
    weights: { g: 0.04, t: 0.06, d: 0.18, r: 0.42, m: 0.3 },
  },
  growthProfit: {
    label: "高利潤成長股",
    why: "已獲利且利潤高。DCF 與相對並重；ROE 超額用 RIM 交叉，象徵性股利不計。",
    weights: { g: 0, t: 0, d: 0.38, r: 0.42, m: 0.2 },
  },
  dividend: {
    label: "穩定配息股",
    why: "殖利率夠高，股利折現才有資訊量。RIM 把 ROE−Ke 寫進淨值溢價。",
    weights: { g: 0.14, t: 0.18, d: 0.22, r: 0.16, m: 0.3 },
  },
  compounder: {
    label: "現金流複利股",
    why: "低股利、高 ROE，錢留在公司。RIM 與 DCF 並重，Gordon 關閉。",
    weights: { g: 0, t: 0, d: 0.36, r: 0.28, m: 0.36 },
  },
};

export function bookPerShare(f: Fundamentals): number {
  if (f.sharesOut > 0 && f.bookEquity > 0) return f.bookEquity / f.sharesOut;
  if (f.priceToBook && f.priceToBook > 0 && f.price > 0) return f.price / f.priceToBook;
  return 0;
}

/** TTM ROE。淨值過薄時仍回數字，由 rimUsable 決定要不要用。 */
export function trailingRoe(f: Fundamentals): number | null {
  if (f.bookEquity > 0 && Number.isFinite(f.netIncome) && f.netIncome !== 0) {
    const r = f.netIncome / f.bookEquity;
    if (Number.isFinite(r)) return r;
  }
  const bps = bookPerShare(f);
  if (bps > 0 && Number.isFinite(f.eps) && f.eps !== 0) {
    const r = f.eps / bps;
    if (Number.isFinite(r)) return r;
  }
  if (
    f.trailingPE != null &&
    f.trailingPE > 0 &&
    f.priceToBook != null &&
    f.priceToBook > 0
  ) {
    const r = f.priceToBook / f.trailingPE;
    if (Number.isFinite(r) && r !== 0) return r;
  }
  return null;
}

/** 庫藏股把淨值削到接近 0 時，ROE 與 P/B 會同時爆炸，RIM 不能用。 */
export function rimDistorted(f: Fundamentals, roe: number | null): boolean {
  if (roe == null || !Number.isFinite(roe)) return true;
  if (Math.abs(roe) > 0.8) return true;
  const book = f.bookEquity;
  if (book > 0 && f.marketCap > 0 && f.marketCap / book > 25 && Math.abs(roe) > 0.4) {
    return true;
  }
  return false;
}

export function rimUsable(f: Fundamentals, regime: CompanyRegime, roe: number | null): boolean {
  if (regime === "optionality" || regime === "preProfit") return false;
  if (bookPerShare(f) <= 0) return false;
  if (roe == null || !Number.isFinite(roe)) return false;
  if (rimDistorted(f, roe)) return false;
  return true;
}

/** 剩餘收益永續：P/B = (ROE − g) / (Ke − g)。這是 ROE 進相對估值的入口。 */
export function justifiedPb(roe: number | null, ke: number, g: number): number | null {
  if (roe == null || !Number.isFinite(roe) || Math.abs(roe) > 0.8) return null;
  if (!(ke > g) || ke <= 0) return null;
  const pb = (roe - g) / (ke - g);
  if (!Number.isFinite(pb)) return null;
  if (pb <= 0) return clamp(roe / ke, 0.3, 1.2);
  return clamp(pb, 0.4, 16);
}

function runRim(
  f: Fundamentals,
  a: Assumptions,
  ke: number,
): {
  price: number | null;
  book0: number;
  roe0: number | null;
  spread: number | null;
  distorted: boolean;
  applicable: boolean;
  reason: string;
  years: RimYear[];
  explicitPv: number;
  payout: number;
} {
  const bps = bookPerShare(f);
  const roe0 = trailingRoe(f);
  const spread = roe0 != null ? roe0 - ke : null;
  const blank = {
    price: null as number | null,
    book0: bps,
    roe0,
    spread,
    distorted: false,
    applicable: false,
    reason: "",
    years: [] as RimYear[],
    explicitPv: 0,
    payout: 0,
  };
  if (bps <= 0) return { ...blank, reason: "沒有每股淨值，剩餘收益無解。" };
  if (roe0 == null) return { ...blank, reason: "沒有淨利或淨值，算不出 ROE。" };
  if (rimDistorted(f, roe0)) {
    return {
      ...blank,
      distorted: true,
      reason: "ROE 被庫藏股或過薄淨值扭曲（>80% 或市值／淨值過高），RIM 不納入加權。",
    };
  }

  const n = Math.max(1, Math.min(12, Math.round(a.nYears)));
  const payout =
    f.eps > 0 && f.dps > 0
      ? clamp(f.dps / f.eps, 0, 0.9)
      : clamp(a.payoutStable || (f.dps > 0 ? 0.4 : 0.2), 0, 0.9);
  const retention = 1 - payout;
  const years: RimYear[] = [];
  let book = bps;
  let explicitPv = 0;
  for (let t = 1; t <= n; t++) {
    const w = n <= 1 ? 1 : (t - 1) / (n - 1);
    const roeT = roe0 + (ke - roe0) * w;
    const ri = (roeT - ke) * book;
    const df = 1 / Math.pow(1 + ke, t);
    const pv = ri * df;
    explicitPv += pv;
    years.push({ year: t, book, roe: roeT, ri, pv });
    book = book * (1 + roeT * retention);
  }
  const raw = bps + explicitPv;
  if (!finite(raw)) return { ...blank, reason: "RIM 數值無解。" };
  const price = raw > 0 ? raw : Math.max(0.05, 0.2 * bps);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return {
    price,
    book0: bps,
    roe0,
    spread,
    distorted: false,
    applicable: true,
    reason:
      raw <= 0
        ? `剩餘收益大幅為負，推算價已低於 0，改用 20% 淨值當下限。`
        : roe0 > ke
          ? `ROE ${pct(roe0)} 高於 Ke ${pct(ke)}，剩餘收益為正，合理價高於淨值。n 年內 ROE 收到 Ke。`
          : `ROE ${pct(roe0)} 低於 Ke ${pct(ke)}，剩餘收益為負，合理價低於淨值。`,
    years,
    explicitPv,
    payout,
  };
}

export function classifyRegime(f: Fundamentals): CompanyRegime {
  const op = f.operatingMargin ?? (f.revenue ? f.ebit / f.revenue : 0);
  const profitable = f.eps > 0 && op >= 0 && f.revenue > 0;
  const dy = f.price > 0 ? f.dps / f.price : 0;
  const g = f.revenueGrowth ?? 0;
  const roe = trailingRoe(f);
  const distorted = rimDistorted(f, roe);
  const highRoe = roe != null && !distorted && roe >= 0.12;
  const ps =
    f.priceToSales && f.priceToSales > 0
      ? f.priceToSales
      : f.revenue > 0 && f.marketCap > 0
        ? f.marketCap / f.revenue
        : 0;
  const scale = f.revenue >= 5e9 || f.marketCap >= 8e10;
  const pe = f.trailingPE ?? (f.eps > 0 && f.price > 0 ? f.price / f.eps : 0);
  const expensive = ps >= 12 || pe > 50;
  if (f.revenue <= 0) {
    if (f.eps > 0 || (f.trailingPE != null && f.trailingPE > 0) || (f.priceToBook != null && f.priceToBook > 0)) {
      if (highRoe && dy < 0.035) return "compounder";
      return dy >= 0.025 ? "dividend" : "compounder";
    }
    return "preProfit";
  }
  const theme =
    expensive && !highRoe && dy < 0.02 && (scale || ps >= 15 || pe > 80);
  if (theme) return "optionality";
  if (!(profitable && op >= 0.15) && scale && g >= 0.2 && ps >= 12) {
    return "optionality";
  }
  if (!profitable) return "preProfit";
  if (op < 0.08) return "lowMargin";
  if (g >= 0.15 && op >= 0.15) return "growthProfit";
  if (dy >= 0.025) {
    if (highRoe && dy < 0.04) return "compounder";
    return "dividend";
  }
  return "compounder";
}

function yearGrowth(a: Assumptions, t: number, n: number): number {
  if (!a.fadeGrowth || n <= 1) return a.g1;
  const w = 1 - (t - 1) / (n - 1);
  return a.g2 + (a.g1 - a.g2) * Math.max(0, w);
}

function runDcf(f: Fundamentals, a: Assumptions) {
  const ke = costOfEquity(a);
  const wacc = waccOf(a);
  const n = Math.max(1, Math.min(12, Math.round(a.nYears)));
  const years: YearRow[] = [];
  let prevRev = f.revenue;
  let explicitPv = 0;
  let divPv = 0;
  let lastFcff = 0;
  let lastEbitda = 0;
  let lastDiv = f.dps;

  for (let t = 1; t <= n; t++) {
    const gT = yearGrowth(a, t, n);
    const rev = prevRev * (1 + gT);
    const fade = t / n;
    const ebitMargin = a.ebitStart + (a.ebitTarget - a.ebitStart) * fade;
    const ebit = rev * ebitMargin;
    const taxRate = ebit > 0 ? a.tax : 0;
    const nopat = ebit * (1 - taxRate);
    const da = rev * a.daSales;
    const ebitda = ebit + da;
    const capex = rev * a.capexSales;
    const dnwc = (rev - prevRev) * a.nwcSales;
    const fcff = nopat + da - capex - dnwc;
    const df = 1 / Math.pow(1 + wacc, t);
    const pv = fcff * df;
    lastDiv = lastDiv * (1 + a.gDiv1);
    const pvDiv = lastDiv / Math.pow(1 + ke, t);
    explicitPv += pv;
    divPv += pvDiv;
    lastFcff = fcff;
    lastEbitda = ebitda;
    years.push({
      year: t,
      growth: gT,
      revenue: rev,
      ebitMargin,
      ebit,
      nopat,
      da,
      ebitda,
      capex,
      dnwc,
      fcff,
      df,
      pv,
      dividend: lastDiv,
      pvDiv,
    });
    prevRev = rev;
  }

  const usePerp =
    a.terminalMethod === "perpetuity" && wacc > a.g2 && lastFcff > 0;
  const tvRaw = usePerp
    ? (lastFcff * (1 + a.g2)) / (wacc - a.g2)
    : Math.max(0, lastEbitda) * a.exitEbitdaMultiple;
  const tvPv = tvRaw / Math.pow(1 + wacc, n);
  const ev = explicitPv + tvPv;
  const equity = ev - f.netDebt + f.nonCoreAssets - f.minorityInterest;
  const dcf =
    f.sharesOut > 0 && finite(equity) ? equity / f.sharesOut : null;
  const tvShare = ev !== 0 ? tvPv / ev : null;
  return {
    n,
    ke,
    wacc,
    years,
    explicitPv,
    divPv,
    lastFcff,
    lastEbitda,
    tvPv,
    ev,
    equity,
    dcf,
    tvShare,
  };
}

const REV_STEPS: { g: number; label: string }[] = [
  { g: 0.1, label: "營收 +10%" },
  { g: 0.05, label: "營收 +5%" },
  { g: 0, label: "持平" },
  { g: -0.05, label: "營收 −5%" },
  { g: -0.1, label: "營收 −10%" },
];

export function revenueGrowthCases(f: Fundamentals, a: Assumptions) {
  return REV_STEPS.map(({ g, label }) => {
    const path = runDcf(f, {
      ...a,
      g1: g,
      nYears: 3,
      fadeGrowth: false,
    });
    const last = path.years[path.years.length - 1];
    return {
      g,
      label,
      dcf: path.dcf,
      rev3: last?.revenue ?? null,
    };
  });
}

function solveImpliedG1(
  f: Fundamentals,
  a: Assumptions,
): { impliedG1: number | null; impliedG1Capped: boolean } {
  if (f.price <= 0 || f.revenue <= 0 || f.sharesOut <= 0) {
    return { impliedG1: null, impliedG1Capped: false };
  }
  const hiCap = 0.8;
  const pHi = runDcf(f, { ...a, g1: hiCap }).dcf;
  const pLo = runDcf(f, { ...a, g1: 0 }).dcf;
  if (pHi == null || pLo == null) return { impliedG1: null, impliedG1Capped: false };
  if (pHi < f.price) return { impliedG1: hiCap, impliedG1Capped: true };
  if (pLo > f.price) return { impliedG1: 0, impliedG1Capped: false };
  let lo = 0;
  let hi = hiCap;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    const p = runDcf(f, { ...a, g1: mid }).dcf;
    if (p == null) break;
    if (p < f.price) lo = mid;
    else hi = mid;
  }
  return { impliedG1: (lo + hi) / 2, impliedG1Capped: false };
}

function bullAssumptions(f: Fundamentals, a: Assumptions): Assumptions {
  const gHist = f.revenueGrowth ?? a.g1;
  return {
    ...a,
    nYears: Math.max(a.nYears, 10),
    g1: clamp(Math.max(a.g1, gHist), 0.2, 0.5),
    g2: Math.min(0.035, Math.max(a.g2, 0.03)),
    ebitTarget: clamp(Math.max(a.ebitTarget, 0.22), 0.18, 0.32),
    fadeGrowth: true,
    terminalMethod: "exit",
    exitEbitdaMultiple: clamp(Math.max(a.exitEbitdaMultiple, 22), 20, 35),
    capexSales: Math.min(a.capexSales, 0.08),
    specificRisk: Math.max(0.005, a.specificRisk - 0.008),
  };
}

export function buildOptionCard(
  f: Fundamentals,
  a: Assumptions,
  dcf: number | null,
  relativeHigh: number | null,
  quality: QualityReport,
): OptionCard {
  const label = quality.label;
  let kind: OptionCard["kind"] = "normal";
  if (label === "optionality") kind = "optionality";
  else if (label === "early") kind = "early";
  else if (label === "shell" || label === "thematic" || label === "survival") kind = "junk";

  const pFail = kind === "optionality" ? 0.2 : kind === "early" ? 0.35 : kind === "junk" ? 0.5 : 0.25;
  const pBase = kind === "optionality" ? 0.45 : kind === "early" ? 0.53 : kind === "junk" ? 0.45 : 0.55;
  const pBull = 1 - pFail - pBase;

  const cashPs = f.sharesOut > 0 ? Math.max(0, -f.netDebt) / f.sharesOut : 0;
  const bookPs = f.sharesOut > 0 && f.bookEquity > 0 ? 0.25 * (f.bookEquity / f.sharesOut) : 0;
  const vFail = Math.max(cashPs, bookPs);
  const vBase = dcf;
  const bull = quality.allowed.bullDcf ? runDcf(f, bullAssumptions(f, a)).dcf : vBase;
  const floor = vBase != null ? vBase * 1.15 : 0;
  const vBullCandidates = [bull ?? 0, quality.allowed.bullDcf ? relativeHigh ?? 0 : 0, quality.allowed.bullDcf ? floor : 0];
  const vBull = Math.max(...vBullCandidates) || bull;

  let expected: number | null = null;
  if (quality.allowed.optionExpected && vFail != null && vBase != null && vBull != null) {
    expected = pFail * vFail + pBase * vBase + pBull * vBull;
  }

  let impliedPBull: number | null = null;
  let impliedCapped = false;
  if (
    quality.allowed.optionExpected &&
    vBull != null &&
    vBase != null &&
    vBull > vFail + 1e-6 &&
    f.price > 0
  ) {
    const rhs = f.price - pBase * vBase - (1 - pBase) * vFail;
    const den = vBull - vFail;
    impliedPBull = rhs / den;
    if (impliedPBull > 0.95) impliedCapped = true;
  }

  const flags: OptionFlag[] = quality.lines.map((l) => ({
    label: l.name,
    points: l.points,
    note: l.rule,
  }));

  let verdict = quality.meaning;
  if (kind === "optionality" || kind === "early") {
    const ip = impliedPBull;
    verdict =
      ip == null
        ? quality.meaning
        : ip > 0.95
          ? `市價已高於樂觀情境，隱含成功機率超過 95%，仍在付純溢價。${quality.meaning}`
          : ip < 0
            ? "市價低於基本情境，選擇權是白送的。"
            : `市價隱含樂觀成功機率約 ${(ip * 100).toFixed(0)}%。你認為真實機率更高才是便宜。`;
  }

  return {
    kind,
    score: quality.q,
    flags,
    pFail,
    pBase,
    pBull,
    vFail,
    vBase,
    vBull: quality.allowed.bullDcf ? vBull : vFail,
    expected,
    impliedPBull,
    impliedCapped,
    verdict,
  };
}

export function ddmYieldScale(divYield: number, floor: number, full: number): number {
  const lo = clamp(floor, 0.002, 0.04);
  const hi = Math.max(lo + 0.005, clamp(full, 0.01, 0.08));
  if (divYield <= lo) return 0;
  if (divYield >= hi) return 1;
  return (divYield - lo) / (hi - lo);
}

export function valueStock(
  f: Fundamentals,
  a: Assumptions,
  opts?: { lite?: boolean },
): ValuationResult {
  const ke = costOfEquity(a);
  const wacc = waccOf(a);
  const warnings: string[] = [...f.notes];
  const regime = a.regime ?? classifyRegime(f);
  warnings.push(`公司類型：${REGIME_META[regime].label}。${REGIME_META[regime].why}`);
  const path = runDcf(f, a);
  const n = path.n;
  const {
    years,
    explicitPv,
    divPv,
    tvPv,
    ev,
    equity,
    dcf,
    tvShare,
  } = path;
  const divYield = f.price > 0 ? f.dps / f.price : 0;
  const ddmScale = ddmYieldScale(divYield, a.ddmYieldFloor ?? 0.01, a.ddmYieldFull ?? 0.025);
  const ddmMathOk = f.dps > 0 && a.gDiv2 < ke;
  const ddmApplicable = ddmMathOk && ddmScale > 0;
  const dcfFloor = regime === "optionality" || regime === "preProfit" ? 0.2 : 0.05;
  const dcfTurnaround = a.ebitStart < 0 && (regime === "preProfit" || regime === "optionality");
  const dcfLow = dcf != null && f.price > 0 && dcf > 0 && dcf < f.price * dcfFloor;
  const dcfHigh = dcf != null && f.price > 0 && dcf > f.price * 8;
  const dcfOk =
    dcf != null &&
    finite(dcf) &&
    dcf > 0 &&
    f.sharesOut > 0 &&
    f.revenue > 0 &&
    !dcfTurnaround &&
    !dcfLow &&
    !dcfHigh;
  const dcfFragile = dcfOk && tvShare != null && tvShare > 0.7;
  let dcfSkip = "";
  if (!dcfOk) {
    if (!(f.sharesOut > 0 && f.revenue > 0)) {
      dcfSkip = "缺少營收或股數，DCF 無解。權重已併入相對估值。";
    } else if (dcf == null || !finite(dcf) || dcf <= 0) {
      dcfSkip = "DCF 為負或無解，現有現金流養不活估值。權重已併入相對估值。";
    } else if (dcfTurnaround) {
      dcfSkip =
        "目前還在虧損，把利潤線性收到成熟水準是情境不是基本 DCF。權重已併入相對估值，差額看選擇權分頁。";
    } else if (dcfLow) {
      dcfSkip = `DCF 只有市價的 ${((dcf! / f.price) * 100).toFixed(0)}%，現有現金流解釋不了市價。不當成「便宜」票，權重已併入相對估值。`;
    } else if (dcfHigh) {
      dcfSkip = `DCF 約為市價的 ${(dcf! / f.price).toFixed(1)} 倍，成長或利潤假設過樂觀，不納入加權。`;
    }
  }

  if (a.g2 >= wacc && a.terminalMethod === "perpetuity") {
    warnings.push("終端成長率 ≥ WACC，永續成長公式無解，已改用離場倍數。");
  }

  const gordon =
    f.dps > 0
      ? gordonPrice(f.dps * (1 + a.gDiv2), ke, a.gDiv2)
      : null;
  const gordonImpliedG =
    f.price > 0 && f.dps > 0 ? ke - (f.dps * (1 + a.gDiv2)) / f.price : null;

  let twoStage: number | null = null;
  let twoStageTvPv = 0;
  if (f.dps > 0 && ke > a.gDiv2) {
    const dn = f.dps * Math.pow(1 + a.gDiv1, n);
    const dn1 = dn * (1 + a.gDiv2);
    const tv = dn1 / (ke - a.gDiv2);
    twoStageTvPv = tv / Math.pow(1 + ke, n);
    twoStage = divPv + twoStageTvPv;
  }

  const eps = f.eps;
  const bps = bookPerShare(f);
  const roe = trailingRoe(f);
  const sps = f.sharesOut > 0 ? f.revenue / f.sharesOut : 0;
  const ebitdaPs = f.sharesOut > 0 ? f.ebitda / f.sharesOut : 0;
  const ndPs = f.sharesOut > 0 ? f.netDebt / f.sharesOut : 0;

  const peOk = eps > 0;
  const evOk = ebitdaPs > 0;
  const eveDistorted = (f.evToEbitda ?? 0) > 40;
  const skipEve = regime === "optionality" || eveDistorted;
  const peMarket = f.trailingPE ?? (peOk && eps > 0 ? f.price / eps : 0);
  const peDistorted = peOk && peMarket > Math.max(a.peBase * 2, 60);
  const skipPe = regime === "optionality" || peDistorted;
  const pbJ = justifiedPb(roe, ke, a.g2);
  const impliedPe = peOk ? a.peBase * eps : null;
  const impliedPb = bps > 0 ? a.pbBase * bps : null;
  const impliedPs = sps > 0 ? a.psBase * sps : null;
  const impliedEvEbitda = evOk ? a.evEbitdaBase * ebitdaPs - ndPs : null;

  const rim = runRim(f, a, ke);
  const rimOk =
    rimUsable(f, regime, roe) &&
    rim.applicable &&
    !rim.distorted &&
    rim.price != null &&
    rim.price > 0 &&
    (f.price <= 0 || (rim.price >= f.price * 0.05 && rim.price <= f.price * 8));
  let rimReason = rim.reason;
  if (!rimOk) {
    if (regime === "optionality" || regime === "preProfit") {
      rimReason = "高成長選擇權或尚未獲利：帳面解釋不了市價，剩餘收益不納入加權。";
    } else if (rim.price != null && f.price > 0 && rim.price > 0 && rim.price < f.price * 0.05) {
      rimReason = `RIM 只有市價的 ${((rim.price / f.price) * 100).toFixed(0)}%，目前 ROE 解釋不了溢價，權重已併入相對估值。`;
    } else if (rim.distorted) {
      rimReason = rim.reason;
    } else if (!rimReason) {
      rimReason = "RIM 不適用。";
    }
  }

  const relParts = (pe: number, pb: number, ps: number, eve: number) => {
    const vals: number[] = [];
    if (peOk && !skipPe) vals.push(pe * eps);
    if (bps > 0) vals.push(pb * bps);
    if (sps > 0) vals.push(ps * sps);
    if (evOk && !skipEve) vals.push(eve * ebitdaPs - ndPs);
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };

  const relativeBase = relParts(a.peBase, a.pbBase, a.psBase, a.evEbitdaBase);
  const relativeLow = relParts(a.peLow, a.pbLow, a.psLow, a.evEbitdaLow);
  const relativeHigh = relParts(a.peHigh, a.pbHigh, a.psHigh, a.evEbitdaHigh);

  const w = normalizeWeights({
    ...a,
    weightGordon: ddmApplicable ? a.weightGordon * ddmScale : 0,
    weightTwoStage: ddmApplicable ? a.weightTwoStage * ddmScale : 0,
    weightDcf: dcfOk ? (dcfFragile ? a.weightDcf * 0.5 : a.weightDcf) : 0,
    weightRelative:
      (Number.isFinite(a.weightRelative) ? a.weightRelative : 0.35) +
      (dcfOk ? 0 : Math.max(0, a.weightDcf)) +
      (rimOk ? 0 : Math.max(0, a.weightRim ?? 0)),
    weightRim: rimOk ? Math.max(0, a.weightRim ?? 0) : 0,
  });

  const spsTxt = sps > 0 ? sps.toFixed(2) : "n.m.";
  const models: ValuationResult["models"] = [
    {
      id: "gordon",
      label: "Gordon 股利折現",
      price: ddmApplicable ? gordon : null,
      weight: w.g,
      used: false,
      formula: "P = D1 / (Ke − g2)",
      calc: ddmApplicable
        ? `${(f.dps * (1 + a.gDiv2)).toFixed(3)} / (${(ke * 100).toFixed(1)}% − ${(a.gDiv2 * 100).toFixed(1)}%)`
        : ddmMathOk
          ? `殖利率 ${(divYield * 100).toFixed(2)}% ≤ 下限 ${((a.ddmYieldFloor ?? 0.01) * 100).toFixed(1)}%，只算現金股利約 ${gordon != null ? gordon.toFixed(2) : "—"}，未納入（買回與留存不在此式）`
          : "無穩定股利或 Ke ≤ g，不納入加權",
    },
    {
      id: "twoStage",
      label: "兩階段股利折現",
      price: ddmApplicable ? twoStage : null,
      weight: w.t,
      used: false,
      formula: "P = Σ Dt/(1+Ke)^t + 終端股利現值",
      calc: ddmApplicable
        ? `明確期 ${divPv.toFixed(2)} + 終端 ${twoStageTvPv.toFixed(2)}`
        : ddmMathOk
          ? `殖利率 ${(divYield * 100).toFixed(2)}% ≤ 下限 ${((a.ddmYieldFloor ?? 0.01) * 100).toFixed(1)}%，只算現金股利約 ${twoStage != null ? twoStage.toFixed(2) : "—"}，未納入`
          : "無穩定股利或 Ke ≤ g，不納入加權",
    },
    {
      id: "dcf",
      label: "FCFF DCF",
      price: dcfOk ? dcf : null,
      weight: w.d,
      used: false,
      formula: "每股 = (EV − 淨債務) / 股數",
      calc: dcfOk
        ? f.sharesOut > 0
          ? `EV ${ev.toFixed(0)} − 淨債 ${f.netDebt.toFixed(0)} → 股權 ${equity.toFixed(0)} ÷ ${f.sharesOut.toFixed(0)} 股`
          : "缺少流通股數，無法換成每股"
        : dcfSkip || "DCF 不納入加權",
    },
    {
      id: "rim",
      label: "剩餘收益 RIM",
      price: rimOk ? rim.price : null,
      weight: w.m,
      used: false,
      formula: "P = 每股淨值 + Σ (ROE_t − Ke) × 淨值_{t−1} 的折現",
      calc: rimOk
        ? `淨值 ${bps.toFixed(2)} + 剩餘收益現值 ${rim.explicitPv.toFixed(2)}；ROE ${(roe! * 100).toFixed(1)}% → Ke ${(ke * 100).toFixed(1)}%`
        : rimReason,
    },
    {
      id: "relative",
      label: "相對估值",
      price: relativeBase,
      weight: w.r,
      used: false,
      formula: "可用倍數隱含價的平均",
      calc: `P/S ${a.psBase.toFixed(1)}× × ${spsTxt}；P/B ${a.pbBase.toFixed(1)}×${
        pbJ != null ? `（合理 P/B ${pbJ.toFixed(1)}×）` : ""
      }；P/E ${peOk ? a.peBase.toFixed(1) + "×" : "n.m."}；EV/EBITDA ${a.evEbitdaBase.toFixed(1)}×`,
    },
  ];

  const ranked = models
    .filter((m) => m.weight > 0 && m.price != null && finite(m.price) && m.price > 0)
    .map((m) => m.price as number)
    .sort((x, y) => x - y);
  if (ranked.length >= 3) {
    const mid = ranked[Math.floor(ranked.length / 2)];
    for (const m of models) {
      if (m.weight > 0 && m.price != null && m.price > mid * 2.5) {
        warnings.push(
          `${m.label} ${m.price.toFixed(0)} 遠高於各模型中位數 ${mid.toFixed(0)}，權重已下修，避免單一模型主導。`,
        );
        m.weight *= 0.2;
      }
    }
  }

  const usable = models.filter(
    (m) => m.price != null && finite(m.price) && m.price > 0 && m.weight > 0,
  );
  const fallback = models.filter((m) => m.price != null && finite(m.price!) && m.price! > 0);
  const pool = usable.length ? usable : fallback;
  const rawW = pool.map((m) => (usable.length ? m.weight : 1));
  const wSum = rawW.reduce((s, x) => s + x, 0);
  let acc = 0;
  pool.forEach((m, i) => {
    acc += rawW[i] * m.price!;
  });
  for (const m of models) {
    const i = pool.indexOf(m);
    m.used = i >= 0;
    m.weight = i >= 0 && wSum > 0 ? rawW[i] / wSum : 0;
  }
  const blended = wSum > 0 ? acc / wSum : null;
  const upside =
    blended != null && f.price > 0 ? blended / f.price - 1 : null;

  let status = "資料不足";
  if (blended != null && f.price > 0) {
    if (upside != null && upside > 0.2) status = "顯著低估";
    else if (upside != null && upside > 0.05) status = "略低估";
    else if (upside != null && upside > -0.05) status = "約當合理";
    else if (upside != null && upside > -0.2) status = "略高估";
    else status = "顯著高估";
  } else if (blended != null) {
    status = "已算出合理價";
  }

  const last = years[years.length - 1];
  if (dcfFragile) {
    warnings.push("終端價值佔企業價值超過 70%，DCF 對折現率與終端假設極度敏感，權重已減半。");
  }
  if (!dcfOk && a.weightDcf > 0 && dcfSkip) {
    warnings.push(dcfSkip);
  }
  if (skipPe && peOk) {
    warnings.push("本益比被市價嚴重拉伸，相對估值不納入 P/E，改以 P/S、P/B 為主。");
  }
  if (upside != null && upside < -0.2) {
    warnings.push(
      "合理價低於市價超過 20%：ERP 5%、終端成長 3%、倍數上限會系統性低於熱市。這是模型設定，不是單獨證明泡沫。見匯總「為何常低於市價」。",
    );
  }
  if (last && f.revenue > 0 && last.revenue / f.revenue >= 2) {
    warnings.push(
      `DCF 第 ${n} 年營收已是現在的 ${(last.revenue / f.revenue).toFixed(1)} 倍。近期末成長若未遞減，終端會被這一年的高基期放大。`,
    );
  }
  if (f.eps > 0 && f.fcf < 0) {
    warnings.push("已獲利但自由現金流為負，多半是庫存或資本支出週期，不當成尚未獲利公司去拉高 g1 與目標 EBIT。");
  } else if (f.fcf < 0) {
    warnings.push("基期自由現金流為負，明確預測期可能仍為現金消耗。");
  }
  if (dcf != null && f.price > 0 && dcf > f.price * 3) {
    warnings.push(
      `DCF ${dcf.toFixed(0)} 約為市價的 ${(dcf / f.price).toFixed(1)} 倍，成長或利潤假設可能過樂觀。`,
    );
  }
  if (skipEve) {
    warnings.push("EV/EBITDA 被市價嚴重拉伸時不納入相對平均，改以 P/S、P/B 為主。");
  }
  if (f.eps <= 0) {
    warnings.push("EPS 為負，P/E 與 PEG 不適用，相對估值改以 P/S、P/B 為主。");
  }
  if (!ddmMathOk) {
    warnings.push("無穩定股利或 Ke ≤ g，股利折現權重自動為 0。");
  } else if (ddmScale <= 0) {
    warnings.push(
      `殖利率 ${(divYield * 100).toFixed(2)}% 低於下限 ${((a.ddmYieldFloor ?? 0.01) * 100).toFixed(1)}%，視為象徵性配息，Gordon／兩階段不納入加權。`,
    );
  } else if (ddmScale < 1) {
    warnings.push(
      `殖利率 ${(divYield * 100).toFixed(2)}% 介於 ${((a.ddmYieldFloor ?? 0.01) * 100).toFixed(1)}%–${((a.ddmYieldFull ?? 0.025) * 100).toFixed(1)}%，股利模型權重 × ${ddmScale.toFixed(2)}。`,
    );
  }

  const { impliedG1, impliedG1Capped } = opts?.lite
    ? { impliedG1: null as number | null, impliedG1Capped: false }
    : solveImpliedG1(f, a);
  if (impliedG1 != null && a.fadeGrowth) {
    warnings.push(
      impliedG1Capped
        ? `即使近期末成長 ${((impliedG1) * 100).toFixed(0)}% 並遞減，DCF 仍低於市價，差額可視為選擇權溢價。`
        : `市價隱含近期末成長約 ${(impliedG1 * 100).toFixed(1)}%（模型 g1 ${(a.g1 * 100).toFixed(1)}%，並在 ${n} 年遞減至 g2）。`,
    );
  } else if (impliedG1Capped) {
    warnings.push("市價高於模型 DCF 上界，包含敘事／選擇權溢價，不是 TTM 現金流能解釋的。");
  }

  if (roe != null && rim.distorted) {
    warnings.push(
      `ROE ${(roe * 100).toFixed(0)}% 看起來很高，但淨值過薄（庫藏股常見），不當成超額報酬。RIM 權重為 0。`,
    );
  } else if (rimOk && rim.spread != null) {
    warnings.push(
      rim.spread >= 0
        ? `ROE ${(roe! * 100).toFixed(1)}% − Ke ${(ke * 100).toFixed(1)}% = 超額 ${(rim.spread * 100).toFixed(1)} 個百分點。RIM 估股東留在公司划不划算。`
        : `ROE ${(roe! * 100).toFixed(1)}% 低於 Ke ${(ke * 100).toFixed(1)}%，RIM 會把合理價壓到淨值以下。`,
    );
  } else if (!rimOk && (regime === "optionality" || regime === "preProfit")) {
    warnings.push("高成長選擇權或尚未獲利：帳面解釋不了市價，剩餘收益不納入加權。");
  }

  const quality = scoreQuality(f, ke);
  const option = buildOptionCard(f, a, dcf, relativeHigh, quality);
  if (option.kind === "optionality") {
    warnings.push(
      `品質 ${quality.q}／${quality.labelText}。已另開情境期望，不併入財報加權。`,
    );
  } else if (option.kind === "junk") {
    warnings.push(
      `品質 ${quality.q}／${quality.labelText}：${quality.allowed.note}`,
    );
  } else {
    warnings.push(`品質 ${quality.q}／${quality.labelText}。${quality.meaning}`);
  }

  return {
    ke,
    wacc,
    gordon,
    gordonImpliedG,
    twoStage,
    twoStageDivPv: divPv,
    twoStageTvPv,
    dcf,
    dcfEv: ev,
    dcfEquity: equity,
    dcfExplicitPv: explicitPv,
    dcfTvPv: tvPv,
    dcfTvShare: tvShare,
    relativeBase,
    relativeLow,
    relativeHigh,
    impliedPe,
    impliedPb,
    impliedPs,
    impliedEvEbitda,
    justifiedPb: pbJ,
    roe,
    rim: rimOk ? rim.price : null,
    rimBook: rim.book0,
    rimSpread: rim.spread,
    rimExplicitPv: rim.explicitPv,
    rimDistorted: rim.distorted,
    rimReason,
    rimYears: rim.years,
    blended,
    upside,
    status,
    years,
    warnings,
    ddmApplicable,
    dcfFragile,
    impliedG1,
    impliedG1Capped,
    option,
    quality,
    zones: null,
    revCases: opts?.lite ? [] : revenueGrowthCases(f, a),
    models,
  };
}

export function sensitivityMatrix(
  f: Fundamentals,
  a: Assumptions,
): SensitivityCell[] {
  const baseW = waccOf(a);
  const waccs = [-0.03, -0.015, 0, 0.015, 0.03].map((d) =>
    clamp(baseW + d, 0.04, 0.3),
  );
  const g2s = [-0.01, -0.005, 0, 0.005, 0.01].map((d) =>
    clamp(a.g2 + d, 0, 0.06),
  );
  const uniqW = Array.from(new Set(waccs.map((x) => +x.toFixed(4))));
  const uniqG = Array.from(new Set(g2s.map((x) => +x.toFixed(4))));
  const cells: SensitivityCell[] = [];
  for (const w of uniqW) {
    for (const g of uniqG) {
      const path = runDcf(f, {
        ...a,
        g2: g,
        beta: 0,
        erp: 0,
        specificRisk: 0,
        rf: w,
        we: 1,
        wd: 0,
        terminalMethod:
          w > g && a.terminalMethod === "perpetuity"
            ? "perpetuity"
            : a.terminalMethod,
      });
      cells.push({ wacc: w, g2: g, price: path.dcf });
    }
  }
  return cells;
}

export function suggestAssumptions(
  f: Fundamentals,
  rf: number,
): Assumptions {
  const op = f.operatingMargin ?? (f.revenue ? f.ebit / f.revenue : 0);
  const regime = classifyRegime(f);
  const optionality = regime === "optionality";
  const preProfit = regime === "preProfit";
  const lowMargin = regime === "lowMargin";
  const lite = f.revenue <= 0 && !preProfit && !optionality;
  const gHist = f.revenueGrowth;
  const gCap = optionality ? 0.4 : preProfit ? 0.45 : lowMargin ? 0.12 : 0.25;
  const g1 = clamp(gHist != null ? gHist : optionality ? 0.25 : preProfit ? 0.2 : 0.06, 0.02, gCap);
  const g2 = 0.03;
  const ebitStart = clamp(op, -1, 0.5);
  const ebitTarget = optionality
    ? clamp(Math.max(op, 0.18), 0.12, 0.28)
    : preProfit
      ? 0.06
      : lowMargin
        ? clamp(op + 0.005, 0.015, 0.08)
        : clamp(Math.max(op, 0.08), 0.04, 0.35);
  const beta = clamp(f.beta || (optionality ? 1.15 : 1), 0.4, 2.8);
  const specific = optionality
    ? f.marketCap > 1e11 ? 0.015 : 0.025
    : preProfit
      ? 0.035
      : lite
        ? 0.008
        : f.marketCap > 0 && f.marketCap < 2e9
          ? 0.02
          : f.fcf < 0
            ? 0.01
            : 0.005;
  const dpsOn = f.dps > 0.01;
  const psOwn = f.priceToSales && f.priceToSales > 0 ? f.priceToSales : 4;
  const pbOwn = f.priceToBook && f.priceToBook > 0 ? f.priceToBook : 2.5;
  const peOwn = f.trailingPE && f.trailingPE > 0 ? f.trailingPE : 18;
  const eveOwn = f.evToEbitda && f.evToEbitda > 0 ? f.evToEbitda : 12;
  const peCap =
    optionality || regime === "compounder" || regime === "growthProfit" ? 45 : lowMargin ? 22 : 32;
  const eveCap = optionality ? 32 : regime === "compounder" || regime === "growthProfit" ? 24 : 18;
  const psCap = optionality ? 42 : preProfit ? 20 : 25;
  const w = REGIME_META[regime].weights;
  const psJustified = clamp(g1 / 0.012, 10, 40);
  const psBase = optionality
    ? clamp(0.55 * psJustified + 0.45 * Math.min(psOwn, 50), 8, 42)
    : clamp(psOwn * (preProfit ? 0.75 : 1), 0.05, psCap);
  const roe = trailingRoe(f);
  const keEst = rf + beta * 0.05 + specific;
  const pbJ = justifiedPb(roe, keEst, g2);
  const useJustifiedPb =
    pbJ != null &&
    !rimDistorted(f, roe) &&
    (regime === "compounder" ||
      regime === "dividend" ||
      regime === "lowMargin" ||
      regime === "growthProfit");
  const pbBase = useJustifiedPb
    ? clamp(0.45 * pbOwn + 0.55 * pbJ, 0.5, 18)
    : clamp(pbOwn, 0.8, 20);

  return {
    nYears: optionality ? 8 : 5,
    g1,
    g2,
    gDiv1: dpsOn ? clamp(g1 * 0.7, 0.02, 0.12) : 0,
    gDiv2: dpsOn ? g2 : 0,
    ebitStart,
    ebitTarget,
    tax: preProfit && !optionality ? 0 : 0.21,
    daSales: optionality ? 0.06 : preProfit ? 0.08 : 0.04,
    capexSales: optionality ? 0.09 : preProfit ? 0.12 : lowMargin ? 0.03 : 0.055,
    nwcSales: optionality ? 0.025 : lowMargin ? 0.03 : 0.05,
    payoutHigh: dpsOn ? 0.4 : 0,
    payoutStable: dpsOn ? 0.55 : 0,
    terminalMethod: optionality || preProfit ? "exit" : "perpetuity",
    exitEbitdaMultiple: optionality ? clamp(eveOwn, 16, 28) : clamp(eveOwn, 6, eveCap),
    rf,
    beta,
    erp: 0.05,
    specificRisk: specific,
    preTaxKd: rf + 0.02,
    we: f.netDebt > 0 ? 0.8 : 0.9,
    wd: f.netDebt > 0 ? 0.2 : 0.1,
    weightGordon: w.g,
    weightTwoStage: w.t,
    weightDcf: w.d,
    weightRelative: w.r,
    weightRim: w.m,
    ddmYieldFloor: 0.01,
    ddmYieldFull: 0.025,
    regime,
    peBase: clamp(peOwn, 8, peCap),
    peLow: clamp(peOwn * 0.7, 6, Math.min(25, peCap)),
    peHigh: clamp(peOwn * 1.3, 10, Math.min(55, peCap + 10)),
    pbBase,
    pbLow: clamp((useJustifiedPb ? pbBase : pbOwn) * 0.65, 0.5, 12),
    pbHigh: clamp((useJustifiedPb ? pbBase : pbOwn) * 1.3, 1, 28),
    psBase,
    psLow: optionality ? clamp(psBase * 0.7, 6, 30) : clamp(psOwn * 0.7, 0.03, 12),
    psHigh: optionality
      ? clamp(Math.max(psBase * 1.25, Math.min(psOwn, 55)), 10, 55)
      : clamp(psOwn * 1.4, 0.08, Math.max(psCap, 30)),
    evEbitdaBase: optionality ? clamp(eveOwn, 12, 32) : clamp(eveOwn, 6, eveCap),
    evEbitdaLow: optionality ? clamp(eveOwn * 0.6, 8, 22) : clamp(eveOwn * 0.7, 4, 14),
    evEbitdaHigh: optionality ? clamp(eveOwn * 1.1, 16, 40) : clamp(eveOwn * 1.25, 8, eveCap + 4),
    pegBase: 1.2,
    fadeGrowth: true,
  };
}
