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
  return x > 1 ? x / 100 : x;
}

/** Raw dollars if already large; otherwise scale from the "*M"/"*B" view string. */
function money(raw: unknown, view?: unknown): number {
  const v = n(raw);
  if (v === 0) return 0;
  const vs = String(view ?? "").trim();
  if (/B$/i.test(vs) && v < 1e8) return v * 1e9;
  if (/M$/i.test(vs) && v < 1e10) return v * 1e6;
  return v;
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
  const sym = ticker.replace(/\.(US|NASDAQ|NYSE)$/i, "");
  if (!sym || sym.includes("/") || /\.(TW|TWO)$/i.test(sym)) return null;
  try {
    const url =
      `https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols=${encodeURIComponent(sym)}` +
      `&partnerId=2&requestMethod=quick&exthrs=1&noform=1&fund=1&extended=1&output=json`;
    const res = await fetch(url, {
      credentials: "omit",
      cache: "no-store",
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
    const sharesOut = money(fd.sharesout, fd.sharesoutView) || n(fd.sharesout);
    const marketCap = money(fd.mktcap, fd.mktcapView) || (sharesOut > 0 ? sharesOut * price : 0);
    const revenue = money(fd.revenuettm, fd.revenuettmView);
    const ebitda = money(fd.TTMEBITD, `${fd.TTMEBITD ?? ""}M`);
    const netMargin = pct(fd.NETPROFTTM);
    const netIncome = netMargin && revenue ? netMargin * revenue : 0;
    const roe = pct(fd.ROETTM);
    const bookEquity = roe > 0.01 && netIncome ? netIncome / roe : 0;
    const de = pct(fd.DEBTEQTYQ);
    const totalDebt = de && bookEquity ? de * bookEquity : 0;
    const eps = n(fd.eps) || (sharesOut > 0 && netIncome ? netIncome / sharesOut : 0);
    const dps = n(fd.dividend);
    const pe = n(fd.pe);
    const ps = n(fd.psales);
    const ebit = ebitda > 0 ? ebitda * 0.82 : netIncome;
    const op = revenue > 0 && ebit ? ebit / revenue : netMargin || null;
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
      notes: ["美股行情取自 CNBC 公開報價（不經 Yahoo 代理）。"],
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
