import { blankFundamentals } from "./fetch-alt";
import { suggestAssumptions, valueStock } from "./engine";
import { netFetch } from "./http";
import type { Fundamentals } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type AuditBucket = "ok" | "no_data" | "no_value" | "error";

export type AuditRow = {
  ticker: string;
  name: string;
  price: number;
  pe: number | null;
  pb: number | null;
  yieldPct: number | null;
  blended: number | null;
  bucket: AuditBucket;
  reason: string;
  error: string | null;
};

export type AuditReport = {
  asOf: string;
  total: number;
  ok: number;
  noData: number;
  noValue: number;
  errors: number;
  rows: AuditRow[];
};

type UsListing = { ticker: string; name: string; price: number | null; marketCap: number | null };

type QuoteRow = {
  ticker: string;
  name: string;
  price: number;
  pe: number | null;
  pb: number | null;
  yieldPct: number | null;
  shares: number;
  marketCap: number;
  eps: number;
  bookValue: number;
  currency: string;
  exchange: string;
};

function money(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const n = Number(raw.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function yahooSym(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "").replace(/\//g, "-").replace(/\^/g, "-P");
}

type YahooAuth = { cookie: string; crumb: string };

export async function fetchUsListings(): Promise<UsListing[]> {
  const res = await netFetch("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25000", {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,text/plain,*/*",
    },
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) throw new Error(`美股清單 ${res.status}`);
  const json = (await res.json()) as {
    data?: { table?: { rows?: Array<Record<string, string>> }; totalrecords?: number };
  };
  const rows = json.data?.table?.rows ?? [];
  const out: UsListing[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const ticker = yahooSym(row.symbol ?? "");
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push({
      ticker,
      name: (row.name ?? ticker).trim(),
      price: money(row.lastsale),
      marketCap: money(row.marketCap),
    });
  }
  return out;
}

async function serverFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(20000) });
}

function pickCookies(res: Response): string {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof anyHeaders.getSetCookie === "function" ? anyHeaders.getSetCookie() : [];
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

async function getCrumb(): Promise<YahooAuth | null> {
  if (typeof window !== "undefined") return null;
  try {
    let cookie = "";
    try {
      const boot = await serverFetch("https://fc.yahoo.com/", {
        headers: { "User-Agent": UA, Accept: "*/*" },
        redirect: "manual",
      });
      cookie = mergeCookie(cookie, pickCookies(boot));
    } catch {
      /* 404 is fine if cookies arrived */
    }
    const crumbRes = await serverFetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: {
        "User-Agent": UA,
        Accept: "text/plain,*/*",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    cookie = mergeCookie(cookie, pickCookies(crumbRes));
    const crumb = (await crumbRes.text()).trim();
    if (!crumbRes.ok || !crumb || crumb.length > 80 || crumb.startsWith("{") || crumb.startsWith("<")) {
      return null;
    }
    return { cookie, crumb };
  } catch {
    return null;
  }
}

async function quoteBatch(symbols: string[], auth: YahooAuth | null): Promise<QuoteRow[]> {
  if (!symbols.length) return [];
  const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
  url.searchParams.set("symbols", symbols.join(","));
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json,text/plain,*/*",
  };
  if (auth) {
    headers.Cookie = auth.cookie;
    url.searchParams.set("crumb", auth.crumb);
  }
  const res =
    typeof window === "undefined"
      ? await serverFetch(url.toString(), { headers, signal: AbortSignal.timeout(20000) })
      : await netFetch(url.toString(), { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`yahoo quote ${res.status}`);
  const json = (await res.json()) as {
    quoteResponse?: {
      result?: Array<Record<string, unknown>>;
    };
  };
  const out: QuoteRow[] = [];
  for (const q of json.quoteResponse?.result ?? []) {
    const ticker = yahooSym(String(q.symbol ?? ""));
    const price = money(q.regularMarketPrice);
    if (!ticker || !price || price <= 0) continue;
    const pe = money(q.trailingPE);
    let pb = money(q.priceToBook);
    if (pb != null && (pb < 0.05 || pb > 80)) pb = null;
    const yieldPct = money(q.dividendYield); // Yahoo: 0.34 = 0.34%
    out.push({
      ticker,
      name: String(q.shortName || q.longName || ticker),
      price,
      pe: pe && pe > 0 ? pe : null,
      pb,
      yieldPct: yieldPct && yieldPct > 0 ? yieldPct : null,
      shares: money(q.sharesOutstanding) ?? 0,
      marketCap: money(q.marketCap) ?? 0,
      eps: money(q.epsTrailingTwelveMonths) ?? 0,
      bookValue: money(q.bookValue) ?? 0,
      currency: String(q.currency || "USD"),
      exchange: String(q.fullExchangeName || q.exchange || ""),
    });
  }
  return out;
}

function toFund(q: QuoteRow): Fundamentals {
  const f = blankFundamentals(q.ticker);
  f.name = q.name;
  f.currency = q.currency || "USD";
  f.exchange = q.exchange;
  f.price = q.price;
  f.trailingPE = q.pe;
  f.priceToBook = q.pb;
  f.dividendYield = q.yieldPct != null ? q.yieldPct / 100 : null;
  f.eps = q.eps > 0 ? q.eps : q.pe && q.pe > 0 ? q.price / q.pe : 0;
  f.dps = q.yieldPct && q.yieldPct > 0 ? (q.price * q.yieldPct) / 100 : 0;
  f.sharesOut = q.shares;
  f.marketCap = q.marketCap || (q.shares > 0 ? q.shares * q.price : 0);
  if (q.bookValue > 0 && q.shares > 0 && q.bookValue < q.price * 30) {
    f.bookEquity = q.bookValue * q.shares;
  }
  f.source = "Yahoo Finance / Nasdaq screener";
  f.notes = ["全市場掃描：美股上市股票。"];
  return f;
}

function classify(listing: UsListing, quote: QuoteRow | undefined): AuditRow {
  const base = {
    ticker: listing.ticker,
    name: listing.name,
    price: quote?.price ?? listing.price ?? 0,
    pe: quote?.pe ?? null,
    pb: quote?.pb ?? null,
    yieldPct: quote?.yieldPct ?? null,
    blended: null as number | null,
    error: null as string | null,
  };
  if (!quote) {
    return { ...base, bucket: "no_data", reason: "Yahoo 沒有報價" };
  }
  if (!quote.price || quote.price <= 0) {
    return { ...base, bucket: "no_data", reason: "沒有市價" };
  }
  const lacksPe = quote.pe == null;
  const lacksPb = quote.pb == null;
  const lacksY = quote.yieldPct == null;
  try {
    const f = toFund(quote);
    const a = suggestAssumptions(f, 0.043);
    const result = valueStock(f, a, { lite: true });
    if (result.blended == null || !Number.isFinite(result.blended)) {
      const why = [
        lacksPe ? "無本益比（虧損或未公布）" : null,
        lacksPb ? "無淨值比" : null,
        lacksY ? "無股息" : null,
        "模型加權為空",
      ]
        .filter(Boolean)
        .join("；");
      return { ...base, bucket: "no_value", reason: why || "模型加權為空" };
    }
    const note = lacksPe
      ? "虧損無本益比，改用淨值比"
      : lacksY
        ? "無股息，未用股利折現"
        : "本益比／淨值比／殖利率齊全";
    return { ...base, blended: result.blended, bucket: "ok", reason: note };
  } catch (err) {
    return {
      ...base,
      bucket: "error",
      reason: "計算過程丟出例外",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function poolMap<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
  return out;
}

export async function auditAllUs(
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<AuditReport> {
  onProgress?.(0, 1, "正在抓 Nasdaq 美股清單…");
  const listings = await fetchUsListings();
  const chunks: string[][] = [];
  for (let i = 0; i < listings.length; i += 80) {
    chunks.push(listings.slice(i, i + 80).map((x) => x.ticker));
  }
  const auth = await getCrumb();
  const quotes = new Map<string, QuoteRow>();
  let done = 0;
  await poolMap(chunks, 3, async (chunk) => {
    try {
      const rows = await quoteBatch(chunk, auth);
      for (const row of rows) quotes.set(row.ticker, row);
    } catch {
      for (const sub of [chunk.slice(0, 40), chunk.slice(40)]) {
        if (!sub.length) continue;
        try {
          const rows = await quoteBatch(sub, auth);
          for (const row of rows) quotes.set(row.ticker, row);
        } catch {
          /* leave as no_data */
        }
      }
    }
    done += chunk.length;
    onProgress?.(Math.min(done, listings.length), listings.length, `美股報價 ${Math.min(done, listings.length)}／${listings.length}`);
  });

  const rows: AuditRow[] = listings.map((listing) => classify(listing, quotes.get(listing.ticker)));
  return {
    asOf: new Date().toISOString().slice(0, 10),
    total: rows.length,
    ok: rows.filter((r) => r.bucket === "ok").length,
    noData: rows.filter((r) => r.bucket === "no_data").length,
    noValue: rows.filter((r) => r.bucket === "no_value").length,
    errors: rows.filter((r) => r.bucket === "error").length,
    rows,
  };
}
