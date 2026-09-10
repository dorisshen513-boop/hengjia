import { createServerFn } from "@tanstack/react-start";
import { suggestAssumptions } from "./engine";
import {
  blankFundamentals,
  fetchGrokFundamentals,
  fetchNasdaq,
  mergeFundamentals,
} from "./fetch-alt";
import { fetchCnbc, fetchCnbcRf } from "./fetch-cnbc";
import { fetchTwse } from "./fetch-twse";
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
  if (typeof window !== "undefined") {
    throw new Error("browser-skip-auth");
  }
  if (yahooSession && Date.now() - yahooSession.at < 20 * 60_000) return yahooSession;
  const boot = await fetch("https://fc.yahoo.com/", {
    headers: { "User-Agent": UA, Accept: "*/*" },
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  let cookie = pickCookies(boot);
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
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
  const useAuth = authed && typeof window === "undefined";
  if (useAuth) {
    try {
      const auth = await getYahooAuth();
      headers.Cookie = auth.cookie;
      const u = new URL(url);
      u.searchParams.set("crumb", auth.crumb);
      target = u.toString();
    } catch {
      /* chart / timeseries often still work without crumb */
    }
  }
  const res = await netFetch(target, { headers, signal: AbortSignal.timeout(12000) });
  if ((res.status === 401 || res.status === 403) && useAuth) {
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

type SeriesFund = {
  revenue: number;
  ebit: number;
  ebitda: number;
  netIncome: number;
  fcf: number;
  marketCap: number;
  shares: number;
  cash: number;
  debt: number;
  netDebt: number;
  equity: number;
  eps: number;
  dps: number;
  pe: number | null;
  ps: number | null;
  pb: number | null;
  evebitda: number | null;
  revenueGrowth: number | null;
  yield: number | null;
};

type SearchMeta = {
  name: string;
  exchange: string;
  sector: string;
  industry: string;
};

const TS_TYPES = [
  "trailingTotalRevenue",
  "trailingOperatingIncome",
  "trailingEBITDA",
  "trailingEBIT",
  "trailingNetIncome",
  "trailingFreeCashFlow",
  "trailingMarketCap",
  "trailingPeRatio",
  "trailingPsRatio",
  "trailingPbRatio",
  "trailingEnterprisesValueEBITDARatio",
  "trailingDividendRate",
  "trailingDividendYield",
  "trailingEps",
  "annualTotalRevenue",
  "annualOperatingIncome",
  "annualEBITDA",
  "annualEBIT",
  "annualNetIncome",
  "annualFreeCashFlow",
  "annualTotalDebt",
  "annualCashAndCashEquivalents",
  "annualStockholdersEquity",
  "annualOrdinarySharesNumber",
  "annualDilutedAverageShares",
  "annualBasicAverageShares",
  "annualNetDebt",
  "annualDilutedEPS",
].join(",");

function tsLatest(block: Record<string, unknown>, type: string): number | null {
  const arr = block[type];
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const item = arr[i] as { reportedValue?: { raw?: unknown } } | null;
    const v = item?.reportedValue?.raw;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function tsGrowth(block: Record<string, unknown>, type: string): number | null {
  const arr = block[type];
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const vals: number[] = [];
  for (const item of arr as Array<{ reportedValue?: { raw?: unknown } }>) {
    const v = item?.reportedValue?.raw;
    if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length < 2) return null;
  const prev = vals[vals.length - 2];
  const last = vals[vals.length - 1];
  if (!prev) return null;
  const g = last / prev - 1;
  return Number.isFinite(g) ? g : null;
}

async function fetchTimeseries(ticker: string): Promise<SeriesFund | null> {
  const period1 = 1577836800;
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const hosts = [
    "https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/",
    "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/",
  ];
  for (const host of hosts) {
    try {
      const data = (await yahooGet(
        `${host}${encodeURIComponent(ticker)}?symbol=${encodeURIComponent(ticker)}&period1=${period1}&period2=${period2}&type=${TS_TYPES}`,
        false,
      )) as { timeseries?: { result?: Array<Record<string, unknown>> } };
      const blocks = data.timeseries?.result ?? [];
      if (!blocks.length) continue;
      const bag: Record<string, Record<string, unknown>> = {};
      for (const block of blocks) {
        const type = (block.meta as { type?: string[] } | undefined)?.type?.[0];
        if (type) bag[type] = block;
      }
      const pick = (...keys: string[]) => {
        for (const k of keys) {
          const v = bag[k] ? tsLatest(bag[k], k) : null;
          if (v != null) return v;
        }
        return 0;
      };
      const pickNull = (...keys: string[]) => {
        for (const k of keys) {
          const v = bag[k] ? tsLatest(bag[k], k) : null;
          if (v != null) return v;
        }
        return null;
      };
      const revenue = pick("trailingTotalRevenue", "annualTotalRevenue");
      const shares = pick(
        "annualDilutedAverageShares",
        "annualOrdinarySharesNumber",
        "annualBasicAverageShares",
      );
      if (!revenue && !shares && !pick("trailingMarketCap")) continue;
      return {
        revenue,
        ebit: pick("trailingEBIT", "trailingOperatingIncome", "annualEBIT", "annualOperatingIncome"),
        ebitda: pick("trailingEBITDA", "annualEBITDA"),
        netIncome: pick("trailingNetIncome", "annualNetIncome"),
        fcf: pick("trailingFreeCashFlow", "annualFreeCashFlow"),
        marketCap: pick("trailingMarketCap"),
        shares,
        cash: pick("annualCashAndCashEquivalents"),
        debt: pick("annualTotalDebt"),
        netDebt: pick("annualNetDebt"),
        equity: pick("annualStockholdersEquity"),
        eps: pick("trailingEps", "annualDilutedEPS"),
        dps: pick("trailingDividendRate"),
        pe: pickNull("trailingPeRatio"),
        ps: pickNull("trailingPsRatio"),
        pb: pickNull("trailingPbRatio"),
        evebitda: pickNull("trailingEnterprisesValueEBITDARatio"),
        revenueGrowth: bag.annualTotalRevenue ? tsGrowth(bag.annualTotalRevenue, "annualTotalRevenue") : null,
        yield: pickNull("trailingDividendYield"),
      };
    } catch {
      /* next host */
    }
  }
  return null;
}

async function fetchSearchMeta(ticker: string): Promise<SearchMeta | null> {
  try {
    const data = (await yahooGet(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&quotesCount=5&newsCount=0`,
      false,
    )) as {
      quotes?: Array<{
        symbol?: string;
        shortname?: string;
        longname?: string;
        exchDisp?: string;
        sector?: string;
        industry?: string;
      }>;
    };
    const hit =
      data.quotes?.find((q) => (q.symbol ?? "").toUpperCase() === ticker.toUpperCase()) ??
      data.quotes?.[0];
    if (!hit) return null;
    return {
      name: hit.longname || hit.shortname || "",
      exchange: hit.exchDisp || "",
      sector: hit.sector || "",
      industry: hit.industry || "",
    };
  } catch {
    return null;
  }
}

function buildFundamentals(
  ticker: string,
  chart: ChartResult,
  summary: Record<string, unknown> | null,
  series: SeriesFund | null,
  search: SearchMeta | null,
): Fundamentals {
  const priceMod = (summary?.price ?? {}) as Record<string, unknown>;
  const fd = (summary?.financialData ?? {}) as Record<string, unknown>;
  const ks = (summary?.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const sd = (summary?.summaryDetail ?? {}) as Record<string, unknown>;
  const sp = (summary?.summaryProfile ?? {}) as Record<string, unknown>;

  const inferredPrice =
    series && series.marketCap > 0 && series.shares > 0 ? series.marketCap / series.shares : 0;
  const price =
    num(priceMod.regularMarketPrice) ??
    chart.regularMarketPrice ??
    inferredPrice ??
    0;
  const shares =
    num(ks.sharesOutstanding) ??
    num(fd.sharesOutstanding) ??
    (series?.shares || 0);
  const marketCap =
    num(priceMod.marketCap) ??
    num(sd.marketCap) ??
    (series?.marketCap || 0) ??
    (shares > 0 ? price * shares : 0);
  const sharesOut =
    shares > 0
      ? shares
      : marketCap > 0 && price > 0
        ? marketCap / price
        : 0;

  const totalCash = num(fd.totalCash) ?? series?.cash ?? 0;
  const totalDebt = num(fd.totalDebt) ?? series?.debt ?? 0;
  const revenue = num(fd.totalRevenue) ?? series?.revenue ?? 0;
  const ebitda = num(fd.ebitda) ?? series?.ebitda ?? 0;
  const fcf = num(fd.freeCashflow) ?? series?.fcf ?? 0;
  const opMargin = num(fd.operatingMargins);
  const ebit =
    num(fd.ebit) ??
    series?.ebit ??
    (opMargin != null && revenue ? opMargin * revenue : ebitda * 0.7);
  const eps =
    num(ks.trailingEps) ??
    num(sd.trailingEps) ??
    series?.eps ??
    (sharesOut > 0 ? (num(fd.profitMargins) ?? 0) * revenue / sharesOut : 0);
  const book =
    num(ks.bookValue) != null && sharesOut
      ? num(ks.bookValue)! * sharesOut
      : series?.equity ?? 0;
  const dps = num(sd.dividendRate) ?? series?.dps ?? 0;
  const beta = num(ks.beta) ?? 1;
  const notes: string[] = [];
  if (!summary && series) notes.push("財報取自 Yahoo 公開時間序列（TTM／年報）。");
  if (!summary && !series) notes.push("僅取得行情，財務欄位請自行核對或改輸入。");
  if (sharesOut <= 0) notes.push("沒有流通股數，DCF 與相對估值無法換成每股。");
  if (revenue <= 0) notes.push("沒有營收，DCF 路徑與 P/S 無法建立。");

  const name =
    str(priceMod.longName) ||
    str(priceMod.shortName) ||
    str(chart.longName) ||
    str(chart.shortName) ||
    search?.name ||
    ticker;

  const ps = revenue > 0 && marketCap > 0 ? marketCap / revenue : series?.ps ?? null;
  const pb = book > 0 && marketCap > 0 ? marketCap / book : series?.pb ?? num(ks.priceToBook);
  const pe = eps > 0 ? price / eps : series?.pe ?? num(sd.trailingPE);
  const netDebt = totalDebt - totalCash || series?.netDebt || 0;
  const ev = marketCap + netDebt;
  const eve = ebitda > 0 ? ev / ebitda : series?.evebitda ?? null;
  const source = series
    ? "Yahoo Finance 公開行情／財報時間序列"
    : "Yahoo Finance 公開行情／摘要";

  return {
    ticker,
    name,
    currency: str(priceMod.currency) || str(chart.currency) || "USD",
    exchange: str(priceMod.exchangeName) || str(chart.exchangeName) || search?.exchange || "",
    sector: str(sp.sector) || search?.sector || "",
    industry: str(sp.industry) || search?.industry || "",
    price,
    sharesOut,
    marketCap,
    beta,
    revenue,
    ebit,
    ebitda,
    netIncome: series?.netIncome || sharesOut * eps,
    bookEquity: book,
    dps,
    eps,
    fcf,
    totalCash,
    totalDebt,
    netDebt,
    nonCoreAssets: 0,
    minorityInterest: 0,
    revenueGrowth: num(fd.revenueGrowth) ?? series?.revenueGrowth ?? null,
    operatingMargin: opMargin ?? (revenue ? ebit / revenue : null),
    dividendYield: num(sd.dividendYield) ?? series?.yield ?? (dps && price ? dps / price : null),
    trailingPE: pe,
    priceToBook: pb,
    priceToSales: ps,
    evToEbitda: eve,
    source,
    asOf: new Date().toISOString().slice(0, 10),
    notes,
  };
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

async function fetchYahooBundle(ticker: string): Promise<Fundamentals | null> {
  const [chart, series, search] = await Promise.all([
    withTimeout(fetchChart(ticker), 8000, null),
    withTimeout(fetchTimeseries(ticker), 8000, null),
    withTimeout(fetchSearchMeta(ticker), 5000, null),
  ]);
  const inferredPrice =
    series && series.marketCap > 0 && series.shares > 0 ? series.marketCap / series.shares : 0;
  const chartOrPrice: ChartResult | null =
    chart ??
    (inferredPrice
      ? {
          regularMarketPrice: inferredPrice,
          shortName: search?.name,
          longName: search?.name,
          exchangeName: search?.exchange,
          symbol: ticker,
        }
      : null);
  if (!chartOrPrice) return null;
  return buildFundamentals(ticker, chartOrPrice, null, series, search);
}

function isTw(ticker: string): boolean {
  return /\.(TW|TWO)$/i.test(ticker);
}

export async function loadQuotePayload(rawTicker: string): Promise<QuotePayload> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker || ticker.length > 16) {
    throw new Error(`找不到股票：${rawTicker.trim() || "?"}`);
  }

  const tw = isTw(ticker);
  const onServer = typeof window === "undefined";
  let fundamentals: Fundamentals | null = null;
  let rf = tw ? 0.016 : 0.043;

  if (tw) {
    const twse = await withTimeout(fetchTwse(ticker), 7000, null);
    if (twse?.price) {
      fundamentals = mergeFundamentals(blankFundamentals(ticker), twse);
    }
  } else {
    const [cnbc, rfLive] = await Promise.all([
      withTimeout(fetchCnbc(ticker), 7000, null),
      withTimeout(fetchCnbcRf(), 2500, null),
    ]);
    if (rfLive) rf = rfLive;
    if (cnbc?.price) {
      fundamentals = mergeFundamentals(blankFundamentals(ticker), cnbc);
    }
  }

  if (onServer) {
    const extra: Array<Promise<Partial<Fundamentals> | null>> = [
      withTimeout(fetchYahooBundle(ticker), 10000, null),
    ];
    if (!tw && !fundamentals?.price) {
      extra.push(withTimeout(fetchNasdaq(ticker), 8000, null));
    }
    const parts = await Promise.all(extra);
    for (const p of parts) {
      if (p?.price) {
        fundamentals = mergeFundamentals(fundamentals ?? blankFundamentals(ticker), p);
      }
    }
  }

  if (!fundamentals?.price && onServer) {
    const grok = await fetchGrokFundamentals(ticker);
    if (grok && grok !== "notfound" && grok.price) {
      fundamentals = mergeFundamentals(fundamentals ?? blankFundamentals(ticker), grok);
    }
  }

  if (!fundamentals?.price) {
    throw new Error(`暫時連不到 ${ticker} 的行情，請再試一次`);
  }

  const baseAssumptions = suggestAssumptions(fundamentals, rf);
  const newsPack = onServer
    ? await withTimeout(
        gatherNews({
          ticker,
          name: fundamentals.name,
          sector: fundamentals.sector,
          industry: fundamentals.industry,
        }),
        4000,
        { items: [] as NewsItem[], parentName: "", aiNote: null as string | null },
      )
    : { items: [] as NewsItem[], parentName: "", aiNote: null as string | null };
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
  // Always run in the browser with CORS-open sources (TWSE / CNBC).
  // GitHub Pages has no server; the live preview must not freeze on a hung RPC.
  return loadQuotePayload(ticker);
}
