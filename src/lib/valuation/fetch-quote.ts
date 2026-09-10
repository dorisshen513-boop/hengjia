import { createServerFn } from "@tanstack/react-start";
import { suggestAssumptions } from "./engine";
import {
  blankFundamentals,
  fetchGrokFundamentals,
  fetchNasdaq,
  mergeFundamentals,
} from "./fetch-alt";
import { netFetch } from "./http";
import { applyNewsToAssumptions, gatherNews, type NewsBrief, type NewsItem } from "./news";
import type { Assumptions, Fundamentals } from "./types";

type QuotePayload = {
  fundamentals: Fundamentals;
  assumptions: Assumptions;
  baseAssumptions: Assumptions;
  bearAssumptions: Assumptions;
  news: NewsBrief;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type YahooAuth = { cookie: string; crumb: string; at: number };
let yahooSession: YahooAuth | null = null;

function pickCookies(res: Response): string {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof anyHeaders.getSetCookie === "function" ? anyHeaders.getSetCookie() : [];
  if (list.length) return list.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  const raw = res.headers.get("set-cookie");
  if (!raw) return "";
  return raw
    .split(/,(?=\s*[A-Za-z0-9_]+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mergeCookie(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const map = new Map<string, string>();
  for (const part of `${a}; ${b}`.split(";")) {
    const kv = part.trim();
    const i = kv.indexOf("=");
    if (i <= 0) continue;
    map.set(kv.slice(0, i), kv);
  }
  return [...map.values()].join("; ");
}

async function getYahooAuth(): Promise<YahooAuth> {
  if (yahooSession && Date.now() - yahooSession.at < 20 * 60_000) return yahooSession;
  const boot = await netFetch("https://fc.yahoo.com/", {
    headers: { "User-Agent": UA, Accept: "*/*" },
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  let cookie = pickCookies(boot);
  const crumbRes = await netFetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": UA,
      Accept: "text/plain,*/*",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  cookie = mergeCookie(cookie, pickCookies(crumbRes));
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 80 || crumb.startsWith("{") || crumb.startsWith("<")) {
    throw new Error("無法取得 Yahoo 授權");
  }
  yahooSession = { cookie, crumb, at: Date.now() };
  return yahooSession;
}

async function yahooGet(url: string, authed = true): Promise<unknown> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
  let target = url;
  if (authed) {
    try {
      const auth = await getYahooAuth();
      headers.Cookie = auth.cookie;
      const u = new URL(url);
      u.searchParams.set("crumb", auth.crumb);
      target = u.toString();
    } catch {
      /* chart often still works without crumb */
    }
  }
  const res = await netFetch(target, { headers, signal: AbortSignal.timeout(12000) });
  if ((res.status === 401 || res.status === 403) && authed) {
    yahooSession = null;
    const retryAuth = await getYahooAuth();
    headers.Cookie = retryAuth.cookie;
    const u = new URL(url);
    u.searchParams.set("crumb", retryAuth.crumb);
    const retry = await netFetch(u.toString(), { headers, signal: AbortSignal.timeout(12000) });
    if (!retry.ok) throw new Error(`quote ${retry.status}`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`quote ${res.status}`);
  return res.json();
}

function normalizeTicker(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (/^\d{4}$/.test(t)) return `${t}.TW`;
  return t;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && v && "raw" in v) {
    const raw = (v as { raw?: unknown }).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v ? v : fallback;
}

type ChartResult = {
  currency?: string;
  exchangeName?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  symbol?: string;
};

async function fetchChart(ticker: string): Promise<ChartResult | null> {
  try {
    const data = (await yahooGet(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
      false,
    )) as {
      chart?: {
        result?: Array<{ meta?: ChartResult }>;
        error?: { description?: string };
      };
    };
    if (data.chart?.error) return null;
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    return meta;
  } catch {
    return null;
  }
}

async function fetchQuoteSummary(ticker: string): Promise<Record<string, unknown>> {
  const modules = [
    "price",
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "summaryProfile",
  ].join(",");
  const hosts = [
    "https://query1.finance.yahoo.com/v10/finance/quoteSummary/",
    "https://query2.finance.yahoo.com/v10/finance/quoteSummary/",
  ];
  let last = "no summary";
  for (const host of hosts) {
    try {
      const data = (await yahooGet(
        `${host}${encodeURIComponent(ticker)}?modules=${modules}`,
      )) as {
        quoteSummary?: { result?: Array<Record<string, unknown>>; error?: unknown };
      };
      const row = data.quoteSummary?.result?.[0];
      if (row) return row;
      last = "empty summary";
    } catch (err) {
      last = err instanceof Error ? err.message : "summary fail";
    }
  }
  throw new Error(last);
}

async function fetchTreasuryRf(): Promise<number> {
  try {
    const meta = await fetchChart("^TNX");
    const y = meta?.regularMarketPrice;
    if (y && y > 0.5 && y < 20) return y / 100;
  } catch {
    /* ignore */
  }
  return 0.043;
}

function buildFundamentals(
  ticker: string,
  chart: ChartResult,
  summary: Record<string, unknown> | null,
): Fundamentals {
  const priceMod = (summary?.price ?? {}) as Record<string, unknown>;
  const fd = (summary?.financialData ?? {}) as Record<string, unknown>;
  const ks = (summary?.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const sd = (summary?.summaryDetail ?? {}) as Record<string, unknown>;
  const sp = (summary?.summaryProfile ?? {}) as Record<string, unknown>;

  const price =
    num(priceMod.regularMarketPrice) ??
    chart.regularMarketPrice ??
    0;
  const shares =
    num(ks.sharesOutstanding) ??
    num(fd.sharesOutstanding) ??
    0;
  const marketCap =
    num(priceMod.marketCap) ??
    num(sd.marketCap) ??
    (shares > 0 ? price * shares : 0);
  const sharesOut =
    shares > 0
      ? shares
      : marketCap > 0 && price > 0
        ? marketCap / price
        : 0;

  const totalCash = num(fd.totalCash) ?? 0;
  const totalDebt = num(fd.totalDebt) ?? 0;
  const revenue = num(fd.totalRevenue) ?? 0;
  const ebitda = num(fd.ebitda) ?? 0;
  const fcf = num(fd.freeCashflow) ?? 0;
  const opMargin = num(fd.operatingMargins);
  const ebit =
    num(fd.ebit) ??
    (opMargin != null && revenue ? opMargin * revenue : ebitda * 0.7);
  const eps =
    num(ks.trailingEps) ??
    num(sd.trailingEps) ??
    (sharesOut > 0 ? (num(fd.profitMargins) ?? 0) * revenue / sharesOut : 0);
  const book =
    num(ks.bookValue) != null && sharesOut
      ? num(ks.bookValue)! * sharesOut
      : 0;
  const dps = num(sd.dividendRate) ?? 0;
  const beta = num(ks.beta) ?? 1;
  const notes: string[] = [];
  if (!summary) notes.push("僅取得行情，財務欄位請自行核對或改輸入。");
  if (sharesOut <= 0) notes.push("沒有流通股數，DCF 與相對估值無法換成每股。");
  if (revenue <= 0) notes.push("沒有營收，DCF 路徑與 P/S 無法建立。");

  const name =
    str(priceMod.longName) ||
    str(priceMod.shortName) ||
    str(chart.longName) ||
    str(chart.shortName) ||
    ticker;

  const ps = revenue > 0 && marketCap > 0 ? marketCap / revenue : null;
  const pb = book > 0 && marketCap > 0 ? marketCap / book : num(ks.priceToBook);
  const pe = eps > 0 ? price / eps : num(sd.trailingPE);
  const netDebt = totalDebt - totalCash;
  const ev = marketCap + netDebt;
  const eve = ebitda > 0 ? ev / ebitda : null;

  return {
    ticker,
    name,
    currency: str(priceMod.currency) || str(chart.currency) || "USD",
    exchange: str(priceMod.exchangeName) || str(chart.exchangeName) || "",
    sector: str(sp.sector),
    industry: str(sp.industry),
    price,
    sharesOut,
    marketCap,
    beta,
    revenue,
    ebit,
    ebitda,
    netIncome: sharesOut * eps,
    bookEquity: book,
    dps,
    eps,
    fcf,
    totalCash,
    totalDebt,
    netDebt,
    nonCoreAssets: 0,
    minorityInterest: 0,
    revenueGrowth: num(fd.revenueGrowth),
    operatingMargin: opMargin,
    dividendYield: num(sd.dividendYield),
    trailingPE: pe,
    priceToBook: pb,
    priceToSales: ps,
    evToEbitda: eve,
    source: "Yahoo Finance 公開行情／摘要",
    asOf: new Date().toISOString().slice(0, 10),
    notes,
  };
}

function isComplete(f: Fundamentals | null): boolean {
  return !!f && f.price > 0 && f.sharesOut > 0 && f.revenue > 0;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

export async function loadQuotePayload(rawTicker: string): Promise<QuotePayload> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker || ticker.length > 16) {
    throw new Error(`找不到股票：${rawTicker.trim() || "?"}`);
  }

  let fundamentals: Fundamentals | null = null;
  const chart = await fetchChart(ticker);
  if (chart) {
    let summary: Record<string, unknown> | null = null;
    try {
      summary = await fetchQuoteSummary(ticker);
    } catch {
      /* try other sources */
    }
    fundamentals = buildFundamentals(ticker, chart, summary);
  }

  if (!isComplete(fundamentals)) {
    const nasdaq = await fetchNasdaq(ticker);
    if (nasdaq?.price) {
      fundamentals = mergeFundamentals(fundamentals ?? blankFundamentals(ticker), nasdaq);
    }
  }

  if (fundamentals?.price && !isComplete(fundamentals)) {
    const grok = await fetchGrokFundamentals(ticker);
    if (grok && grok !== "notfound" && grok.price) {
      fundamentals = mergeFundamentals(fundamentals, grok);
    }
  }

  if (!fundamentals?.price) {
    throw new Error(`找不到股票：${ticker}`);
  }

  const rf = await fetchTreasuryRf();
  const baseAssumptions = suggestAssumptions(fundamentals, rf);
  const newsPack = await withTimeout(
    gatherNews({
      ticker,
      name: fundamentals.name,
      sector: fundamentals.sector,
      industry: fundamentals.industry,
    }),
    8000,
    { items: [] as NewsItem[], parentName: "", aiNote: null as string | null },
  );
  const applied = applyNewsToAssumptions(baseAssumptions, newsPack.items, {
    parentName: newsPack.parentName,
    aiNote: newsPack.aiNote,
  });
  return {
    fundamentals,
    assumptions: applied.assumptions,
    baseAssumptions,
    bearAssumptions: applied.bear,
    news: applied.brief,
  };
}

export const loadQuote = createServerFn({ method: "POST" })
  .validator((d: { ticker: string }) => ({
    ticker: normalizeTicker(String(d?.ticker ?? "")),
  }))
  .handler(async ({ data }): Promise<QuotePayload> => loadQuotePayload(data.ticker));

export async function fetchQuoteData(ticker: string): Promise<QuotePayload> {
  if (import.meta.env.VITE_STATIC === "1") {
    return loadQuotePayload(ticker);
  }
  return loadQuote({ data: { ticker } });
}

