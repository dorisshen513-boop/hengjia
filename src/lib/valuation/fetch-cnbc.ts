import type { Fundamentals } from "./types";

/** CNBC quote JSON sends Access-Control-Allow-Origin: *. Works on GitHub Pages. */

function n(v: unknown): number {
  if (v == null || v === "") return 0;
  const x = Number(String(v).replace(/,/g, "").replace(/%/g, ""));
  return Number.isFinite(x) ? x : 0;
}

function pct(v: unknown): number {
  const x = n(v);
  if (x === 0) return 0;
  return Math.abs(x) > 1 ? x / 100 : x;
}

/**
 * CNBC 常同時給完整數字與「10.69M」「3949.55M」這種縮寫。
 * view 的數字部分必須先去掉 T/B/M，否則 Number("10.69M") 是 NaN，
 * 百萬級營收會再乘一次變成兆。
 */
export function scaleCnbcMoney(raw: unknown, view?: unknown): number {
  const v = n(raw);
  if (v === 0) return 0;
  const vs = String(view ?? "").replace(/,/g, "").trim();
  const suffix = (vs.match(/([TBM])\s*$/i)?.[1] ?? "").toUpperCase();
  const viewNum = n(vs.replace(/[TBM]\s*$/i, ""));
  const abs = Math.abs(v);
  if (viewNum > 0 && suffix) {
    const factor = suffix === "T" ? 1e12 : suffix === "B" ? 1e9 : 1e6;
    if (abs / viewNum > 50) return v;
    return v * factor;
  }
  if (suffix === "T") return abs >= 1e11 ? v : v * 1e12;
  if (suffix === "B") return abs >= 1e8 ? v : v * 1e9;
  if (suffix === "M") return abs >= 1e8 ? v : v * 1e6;
  return v;
}

export function reconcileShares(shares: number, price: number, marketCap: number): number {
  if (!(price > 0)) return shares;
  const fromCap = marketCap > 0 ? marketCap / price : 0;
  const capSane = fromCap > 1e5 && fromCap < 5e11;
  const sharesSane = shares > 1e5 && shares < 5e11;
  if (capSane && (!sharesSane || shares / fromCap > 10 || fromCap / Math.max(shares, 1) > 10)) {
    return fromCap;
  }
  return shares;
}

/** 營收與市值／本益銷售比對不上時，用 P/S 反推，避免相對估值被錯單位炸開。 */
export function reconcileRevenue(revenue: number, marketCap: number, psales: number): number {
  if (psales > 0.05 && marketCap > 0) {
    const fromPs = marketCap / psales;
    if (fromPs > 0 && (revenue <= 0 || revenue / fromPs > 8 || fromPs / revenue > 8)) {
      return fromPs;
    }
  }
  if (marketCap > 0 && revenue > marketCap * 40) return 0;
  return revenue;
}

function scaleEbitda(raw: unknown, view?: unknown): number {
  const scaled = scaleCnbcMoney(raw, view);
  if (Math.abs(scaled) >= 1e8) return scaled;
  const v = n(raw);
  if (Math.abs(v) > 1 && Math.abs(v) < 1e6) return v * 1e6;
  return scaled || v;
}

type CnbcQuote = {
  symbol?: string;
  last?: string;
  name?: string;
  exchange?: string;
  currencyCode?: string;
  code?: string;
  FundamentalData?: Record<string, string>;
};

export async function fetchCnbc(ticker: string): Promise<Partial<Fundamentals> | null> {
  const rawSym = ticker.replace(/\.(US|NASDAQ|NYSE)$/i, "").toUpperCase();
  const aliases: Record<string, string> = { "BRK-B": "BRK.B", "BRK-A": "BRK.A" };
  const sym = aliases[rawSym] ?? rawSym;
  if (!sym || sym.includes("/") || /\.(TW|TWO)$/i.test(sym)) return null;
  try {
    const url =
      `https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols=${encodeURIComponent(sym)}` +
      `&partnerId=2&requestMethod=quick&exthrs=1&noform=1&fund=1&extended=1&output=json`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (typeof window === "undefined") {
      headers["User-Agent"] =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
      headers.Referer = "https://www.cnbc.com/";
    }
    const res = await fetch(url, {
      credentials: "omit",
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      QuickQuoteResult?: { QuickQuote?: CnbcQuote | CnbcQuote[] };
    };
    const raw = data.QuickQuoteResult?.QuickQuote;
    const row = Array.isArray(raw) ? raw[0] : raw;
    if (!row || row.code === "1" || !row.last) return null;
    const price = n(row.last);
    if (price <= 0) return null;
    const fd = row.FundamentalData ?? {};
    const sharesRaw = scaleCnbcMoney(fd.sharesout, fd.sharesoutView) || n(fd.sharesout);
    const marketCap =
      scaleCnbcMoney(fd.mktcap, fd.mktcapView) || (sharesRaw > 0 ? sharesRaw * price : 0);
    const sharesOut = reconcileShares(sharesRaw, price, marketCap);
    const ps = n(fd.psales);
    const revenueRaw = scaleCnbcMoney(fd.revenuettm, fd.revenuettmView);
    const revenue = reconcileRevenue(revenueRaw, marketCap, ps);
    const ebitda = scaleEbitda(fd.TTMEBITD, fd.TTMEBITDView);
    const netMargin = pct(fd.NETPROFTTM);
    const epsReported = n(fd.eps);
    const niFromEps = sharesOut > 0 && epsReported ? epsReported * sharesOut : 0;
    const niFromMargin = netMargin && revenue ? netMargin * revenue : 0;
    const netIncome = niFromEps || niFromMargin;
    const roe = pct(fd.ROETTM);
    const bookEquity = roe > 0.01 && netIncome ? netIncome / roe : 0;
    const de = pct(fd.DEBTEQTYQ);
    const totalDebt = de && bookEquity ? de * bookEquity : 0;
    const eps = epsReported || (sharesOut > 0 && netIncome ? netIncome / sharesOut : 0);
    const dps = n(fd.dividend);
    const pe = n(fd.pe);
    const ebit = ebitda > 0 ? ebitda * 0.82 : netIncome;
    const op = revenue > 0 && ebit ? ebit / revenue : netMargin || null;
    const notes = ["美股行情取自 CNBC 公開報價（不經 Yahoo 代理）。"];
    if (sharesRaw > 0 && Math.abs(sharesOut / sharesRaw - 1) > 0.2) {
      notes.push("流通股單位已用市值／股價校正，避免百萬／十億被乘兩次。");
    }
    if (revenueRaw > 0 && revenue > 0 && Math.abs(revenue / revenueRaw - 1) > 0.5) {
      notes.push("營收單位已用市值／本益銷售比校正，避免百萬被乘成兆。");
    }
    return {
      ticker: ticker.toUpperCase(),
      name: row.name || ticker.toUpperCase(),
      currency: row.currencyCode || "USD",
      exchange: row.exchange || "",
      price,
      sharesOut: sharesOut || (marketCap > 0 ? marketCap / price : 0),
      marketCap: marketCap || sharesOut * price,
      beta: n(fd.beta) || 1,
      revenue,
      ebit,
      ebitda,
      netIncome,
      bookEquity,
      dps,
      eps,
      fcf: 0,
      totalCash: 0,
      totalDebt,
      netDebt: totalDebt,
      operatingMargin: op,
      dividendYield: dps && price ? dps / price : pct(fd.dividendyield) || null,
      trailingPE: pe > 0 ? pe : eps > 0 ? price / eps : null,
      priceToBook: bookEquity > 0 && marketCap > 0 ? marketCap / bookEquity : null,
      priceToSales: ps || (revenue > 0 && marketCap > 0 ? marketCap / revenue : null),
      evToEbitda: ebitda > 0 ? (marketCap + totalDebt) / ebitda : null,
      source: "CNBC 公開報價／財報",
      notes,
    };
  } catch {
    return null;
  }
}

export async function fetchCnbcRf(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols=US10Y&partnerId=2&requestMethod=quick&output=json",
      { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      QuickQuoteResult?: { QuickQuote?: { last?: string } | Array<{ last?: string }> };
    };
    const raw = data.QuickQuoteResult?.QuickQuote;
    const row = Array.isArray(raw) ? raw[0] : raw;
    const y = n(row?.last);
    if (y > 0.5 && y < 20) return y / 100;
    return null;
  } catch {
    return null;
  }
}

