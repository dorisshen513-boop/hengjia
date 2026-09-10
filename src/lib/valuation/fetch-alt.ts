import type { Fundamentals } from "./types";
import { netFetch } from "./http";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function money(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t || /^(n\/a|na|--|none|null)$/i.test(t)) return null;
  const neg = t.includes("(") && t.includes(")");
  const n = Number(t.replace(/[$,()%\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

function rowMap(table: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const rows = (table as { rows?: Array<Record<string, string>> } | undefined)?.rows ?? [];
  for (const row of rows) {
    const k = (row.value1 ?? "").trim();
    const v = row.value2 ?? "";
    if (k) map.set(k.toLowerCase(), v);
  }
  return map;
}

function pick(map: Map<string, string>, names: string[]): number | null {
  for (const n of names) {
    const v = money(map.get(n.toLowerCase()));
    if (v != null) return v;
  }
  return null;
}

async function nasdaqGet(url: string): Promise<unknown> {
  const res = await netFetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,text/plain,*/*",
      Origin: "https://www.nasdaq.com",
      Referer: "https://www.nasdaq.com/",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`nasdaq ${res.status}`);
  return res.json();
}

export function blankFundamentals(ticker: string): Fundamentals {
  return {
    ticker,
    name: ticker,
    currency: "USD",
    exchange: "",
    sector: "",
    industry: "",
    price: 0,
    sharesOut: 0,
    marketCap: 0,
    beta: 1,
    revenue: 0,
    ebit: 0,
    ebitda: 0,
    netIncome: 0,
    bookEquity: 0,
    dps: 0,
    eps: 0,
    fcf: 0,
    totalCash: 0,
    totalDebt: 0,
    netDebt: 0,
    nonCoreAssets: 0,
    minorityInterest: 0,
    revenueGrowth: null,
    operatingMargin: null,
    dividendYield: null,
    trailingPE: null,
    priceToBook: null,
    priceToSales: null,
    evToEbitda: null,
    source: "",
    asOf: new Date().toISOString().slice(0, 10),
    notes: [],
  };
}

export async function fetchNasdaq(ticker: string): Promise<Partial<Fundamentals> | null> {
  const sym = ticker.replace(/\.(US|NASDAQ|NYSE)$/i, "");
  if (sym.includes(".")) return null;
  try {
    const [info, summary, financials] = await Promise.all([
      nasdaqGet(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/info?assetclass=stocks`),
      nasdaqGet(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/summary?assetclass=stocks`),
      nasdaqGet(`https://api.nasdaq.com/api/company/${encodeURIComponent(sym)}/financials?frequency=1`).catch(
        () => null,
      ),
    ]);
    const infoStatus = (info as { status?: { rCode?: number; bCodeMessage?: Array<{ errorMessage?: string }> } })
      .status;
    if (infoStatus?.rCode === 400 || /not exists|not found/i.test(JSON.stringify(infoStatus ?? ""))) {
      return null;
    }
    const idata = (info as { data?: Record<string, unknown> }).data;
    if (!idata) return null;
    const primary = (idata.primaryData ?? {}) as Record<string, unknown>;
    const sdata = ((summary as { data?: { summaryData?: Record<string, { value?: string }> } }).data
      ?.summaryData ?? {}) as Record<string, { value?: string }>;
    const price = money(primary.lastSalePrice) ?? money(sdata.PreviousClose?.value);
    if (!price) return null;
    const marketCap = money(sdata.MarketCap?.value) ?? 0;
    const dps = money(sdata.AnnualizedDividend?.value) ?? 0;
    const fdata = (financials as { data?: Record<string, unknown> } | null)?.data;
    const income = rowMap(fdata?.incomeStatementTable);
    const balance = rowMap(fdata?.balanceSheetTable);
    const cash = rowMap(fdata?.cashFlowTable);
    let revenue = pick(income, ["total revenue"]);
    let ebit = pick(income, ["operating income", "earnings before interest and tax"]);
    let da = pick(cash, ["depreciation"]);
    let fcfOp = pick(cash, ["net cash flow-operating"]);
    let capex = pick(cash, ["capital expenditures"]);
    let cashEq = pick(balance, ["cash and cash equivalents"]);
    let debt =
      (pick(balance, ["long-term debt"]) ?? 0) +
      (pick(balance, ["short-term debt / current portion of long-term debt"]) ?? 0);
    let equity = pick(balance, ["total equity", "total stockholders equity", "stock holders equity"]);
    const scale = revenue != null && Math.abs(revenue) < 5e5 ? 1000 : 1;
    if (scale !== 1) {
      revenue = revenue != null ? revenue * scale : null;
      ebit = ebit != null ? ebit * scale : null;
      da = da != null ? da * scale : null;
      fcfOp = fcfOp != null ? fcfOp * scale : null;
      capex = capex != null ? capex * scale : null;
      cashEq = cashEq != null ? cashEq * scale : null;
      debt *= scale;
      equity = equity != null ? equity * scale : null;
    }
    const ebitda = (ebit ?? 0) + (da ?? 0);
    const fcf = (fcfOp ?? 0) + (capex ?? 0);
    const sharesOut = marketCap > 0 && price > 0 ? marketCap / price : 0;
    const opMargin = revenue ? (ebit ?? 0) / revenue : null;
    const netIncome = pick(income, ["net income"]);
    return {
      ticker: ticker.toUpperCase(),
      name: str(idata.companyName) || ticker.toUpperCase(),
      currency: "USD",
      exchange: str(idata.exchange) || str(sdata.Exchange?.value),
      sector: str(sdata.Sector?.value),
      industry: str(sdata.Industry?.value),
      price,
      sharesOut,
      marketCap,
      revenue: revenue ?? 0,
      ebit: ebit ?? 0,
      ebitda,
      netIncome: (netIncome ?? 0) * (revenue != null && Math.abs(netIncome ?? 0) < 5e5 ? scale : 1),
      bookEquity: equity ?? 0,
      dps,
      eps: sharesOut > 0 && netIncome != null ? (netIncome * (Math.abs(netIncome) < 5e5 ? scale : 1)) / sharesOut : 0,
      fcf,
      totalCash: cashEq ?? 0,
      totalDebt: debt,
      netDebt: debt - (cashEq ?? 0),
      operatingMargin: opMargin,
      dividendYield: dps && price ? dps / price : null,
      priceToSales: revenue && marketCap ? marketCap / revenue : null,
      priceToBook: equity && marketCap ? marketCap / equity : null,
      evToEbitda: ebitda > 0 ? (marketCap + debt - (cashEq ?? 0)) / ebitda : null,
      source: "Nasdaq 公開報價／財報",
      notes: ["Yahoo 財報失敗，已改用 Nasdaq。"],
    };
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === "string" && v && v !== "null" ? v : "";
}

export async function fetchGrokFundamentals(
  ticker: string,
): Promise<Partial<Fundamentals> | "notfound" | null> {
  if (typeof window !== "undefined") return null;
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(9000),
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 500,
        search_parameters: { mode: "on", max_search_results: 6 },
        messages: [
          {
            role: "system",
            content:
              '只回 JSON，不要 markdown。找不到股票時 {"found":false}。找到則 {"found":true,"name":"","currency":"USD","exchange":"","sector":"","industry":"","price":0,"sharesOut":0,"marketCap":0,"beta":1,"revenue":0,"ebit":0,"ebitda":0,"netIncome":0,"bookEquity":0,"dps":0,"eps":0,"fcf":0,"totalCash":0,"totalDebt":0}。金額用原幣絕對數字，不要百萬簡寫。',
          },
          {
            role: "user",
            content: `查股票代號 ${ticker} 的最新市價與最近四季（TTM）財報。若代號不存在或已下市，found=false。`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (parsed.found === false) return "notfound";
    const n = (k: string) => {
      const v = Number(parsed[k]);
      return Number.isFinite(v) ? v : 0;
    };
    const price = n("price");
    if (price <= 0) return "notfound";
    return {
      ticker: ticker.toUpperCase(),
      name: str(parsed.name) || ticker.toUpperCase(),
      currency: str(parsed.currency) || "USD",
      exchange: str(parsed.exchange),
      sector: str(parsed.sector),
      industry: str(parsed.industry),
      price,
      sharesOut: n("sharesOut"),
      marketCap: n("marketCap") || n("sharesOut") * price,
      beta: n("beta") || 1,
      revenue: n("revenue"),
      ebit: n("ebit"),
      ebitda: n("ebitda"),
      netIncome: n("netIncome"),
      bookEquity: n("bookEquity"),
      dps: n("dps"),
      eps: n("eps"),
      fcf: n("fcf"),
      totalCash: n("totalCash"),
      totalDebt: n("totalDebt"),
      netDebt: n("totalDebt") - n("totalCash"),
      source: "Grok 即時搜尋",
      notes: ["Yahoo／Nasdaq 不足，已用 Grok 搜尋補財報，請核對假設。"],
    };
  } catch {
    return null;
  }
}

export function mergeFundamentals(base: Fundamentals, extra: Partial<Fundamentals>): Fundamentals {
  const next: Fundamentals = { ...base, notes: [...base.notes] };
  const keys = Object.keys(extra) as Array<keyof Fundamentals>;
  for (const k of keys) {
    const v = extra[k];
    if (v == null || v === "") continue;
    if (k === "notes" && Array.isArray(v)) {
      next.notes.push(...v);
      continue;
    }
    const cur = next[k];
    if (typeof cur === "number" && typeof v === "number") {
      if (cur === 0 && v !== 0) (next[k] as number) = v;
      continue;
    }
    if (typeof cur === "string" && typeof v === "string" && !cur) (next[k] as string) = v;
    if (cur == null && v != null) (next as Record<string, unknown>)[k] = v;
  }
  if (next.sharesOut <= 0 && next.marketCap > 0 && next.price > 0) {
    next.sharesOut = next.marketCap / next.price;
  }
  if (next.marketCap <= 0 && next.sharesOut > 0 && next.price > 0) {
    next.marketCap = next.sharesOut * next.price;
  }
  next.netDebt = next.totalDebt - next.totalCash;
  if (next.revenue > 0 && next.marketCap > 0) next.priceToSales = next.marketCap / next.revenue;
  if (next.bookEquity > 0 && next.marketCap > 0) next.priceToBook = next.marketCap / next.bookEquity;
  if (next.source && extra.source && next.source !== extra.source) {
    next.source = `${next.source} + ${extra.source}`;
  } else if (extra.source) {
    next.source = extra.source;
  }
  return next;
}
