import { blankFundamentals } from "./fetch-alt";
import { fetchTwseAll, type TwseSnap } from "./fetch-twse";
import { netFetch } from "./http";
import { suggestAssumptions, valueStock } from "./engine";
import { buildZones } from "./zones";
import { shufflePick, US_UNIVERSE } from "./universe";
import type { Fundamentals } from "./types";
import type { AuditReport, AuditRow } from "./fetch-us";

export type { AuditBucket, AuditReport, AuditRow } from "./fetch-us";
export { auditAllUs } from "./fetch-us";

export type ScanRow = {
  market: "TW" | "US";
  ticker: string;
  name: string;
  price: number;
  currency: string;
  blended: number | null;
  upside: number | null;
  zoneLabel: string;
  qualityQ: number;
  qualityLabel: string;
  pe: number | null;
  pb: number | null;
  status: string;
  ok: boolean;
  error: string | null;
};

export type ScanProgress = {
  label: string;
  done: number;
  total: number;
  rows: ScanRow[];
};

function twNum(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  return null;
}

function fromSnap(snap: {
  ticker: string;
  name: string;
  price: number;
  pe: number | null;
  pb: number | null;
  yieldPct: number | null;
  currency: string;
  exchange: string;
  shares?: number;
  marketCap?: number;
  source: string;
  notes: string[];
}): Fundamentals {
  const f = blankFundamentals(snap.ticker);
  const pe = snap.pe;
  const pb = snap.pb;
  const yieldPct = snap.yieldPct;
  f.name = snap.name || snap.ticker;
  f.currency = snap.currency;
  f.exchange = snap.exchange;
  f.price = snap.price;
  f.trailingPE = pe;
  f.priceToBook = pb;
  f.dividendYield = yieldPct != null ? yieldPct / 100 : null;
  f.eps = pe && pe > 0 ? snap.price / pe : 0;
  f.dps = yieldPct && yieldPct > 0 ? (snap.price * yieldPct) / 100 : 0;
  f.sharesOut = snap.shares && snap.shares > 0 ? snap.shares : 0;
  f.marketCap = snap.marketCap && snap.marketCap > 0 ? snap.marketCap : f.sharesOut * snap.price;
  f.source = snap.source;
  f.notes = snap.notes;
  return f;
}

function valueRow(market: "TW" | "US", f: Fundamentals): ScanRow {
  const a = suggestAssumptions(f, 0.043);
  const bear = { ...a, g1: a.g1 * 0.45, specificRisk: a.specificRisk + 0.02, ebitTarget: a.ebitTarget * 0.85 };
  const result = valueStock(f, a, { lite: true });
  const bearResult = valueStock(f, bear, { lite: true });
  const zones = buildZones(f, result, bearResult.blended);
  return {
    market,
    ticker: f.ticker,
    name: f.name,
    price: f.price,
    currency: f.currency,
    blended: result.blended,
    upside: result.upside,
    zoneLabel: zones?.currentLabel ?? "—",
    qualityQ: result.quality.q,
    qualityLabel: result.quality.labelText,
    pe: f.trailingPE,
    pb: f.priceToBook,
    status: result.status,
    ok: true,
    error: null,
  };
}

function failRow(market: "TW" | "US", ticker: string, error: string): ScanRow {
  return {
    market,
    ticker,
    name: ticker,
    price: 0,
    currency: market === "TW" ? "TWD" : "USD",
    blended: null,
    upside: null,
    zoneLabel: "—",
    qualityQ: 0,
    qualityLabel: "—",
    pe: null,
    pb: null,
    status: "抓不到",
    ok: false,
    error,
  };
}

async function scanTw(): Promise<ScanRow[]> {
  const all = await fetchTwseAll();
  const pool = all.filter((s: TwseSnap) => s.price > 5);
  const pick = shufflePick(pool, 50);
  return pick.map((s) =>
    valueRow(
      "TW",
      fromSnap({
        ...s,
        currency: "TWD",
        exchange: "TWSE",
        source: "臺灣證交所公開資訊",
        notes: ["抽樣：證交所日統計（本益比／淨值比／殖利率）。"],
      }),
    ),
  );
}

type SparkMeta = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  currency?: string;
  exchangeName?: string;
  fullExchangeName?: string;
};

async function fetchSparkChunk(symbols: string[]): Promise<Map<string, SparkMeta>> {
  const map = new Map<string, SparkMeta>();
  if (!symbols.length) return map;
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(","))}&range=1d&interval=1d`;
  const res = await netFetch(url);
  const json = (await res.json()) as {
    spark?: { result?: Array<{ symbol?: string; response?: Array<{ meta?: SparkMeta }> }> };
  };
  for (const item of json.spark?.result ?? []) {
    const meta = item.response?.[0]?.meta;
    const sym = (meta?.symbol ?? item.symbol ?? "").toUpperCase();
    if (sym && meta) map.set(sym, meta);
  }
  return map;
}

async function fetchTimeseriesLite(ticker: string): Promise<{
  pe: number | null;
  pb: number | null;
  yieldPct: number | null;
  shares: number;
  marketCap: number;
} | null> {
  const now = Math.floor(Date.now() / 1000);
  const start = now - 86400 * 400;
  const types = [
    "trailingPeRatio",
    "trailingPbRatio",
    "trailingDividendYield",
    "trailingMarketCap",
    "annualOrdinarySharesNumber",
    "annualDilutedAverageShares",
  ].join(",");
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}?symbol=${encodeURIComponent(ticker)}&period1=${start}&period2=${now}&type=${types}`;
  try {
    const res = await netFetch(url);
    const json = (await res.json()) as {
      timeseries?: { result?: Array<Record<string, unknown> & { meta?: { type?: string[] } }> };
    };
    const bag: Record<string, Record<string, unknown>> = {};
    for (const block of json.timeseries?.result ?? []) {
      const type = block.meta?.type?.[0];
      if (type) bag[type] = block;
    }
    const last = (key: string): number | null => {
      const arr = bag[key]?.[key];
      if (!Array.isArray(arr)) return null;
      for (let i = arr.length - 1; i >= 0; i--) {
        const n = (arr[i] as { reportedValue?: { raw?: number } })?.reportedValue?.raw;
        if (typeof n === "number" && Number.isFinite(n)) return n;
      }
      return null;
    };
    const pe = last("trailingPeRatio");
    const pb = last("trailingPbRatio");
    let yieldPct = last("trailingDividendYield");
    if (yieldPct != null && yieldPct > 0 && yieldPct < 1) yieldPct *= 100;
    const marketCap = last("trailingMarketCap") ?? 0;
    const shares = last("annualDilutedAverageShares") ?? last("annualOrdinarySharesNumber") ?? 0;
    return { pe, pb, yieldPct, shares, marketCap };
  } catch {
    return null;
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

async function scanUs(onTick: (rows: ScanRow[], label: string, done: number, total: number) => void): Promise<ScanRow[]> {
  const pick = shufflePick(US_UNIVERSE, 50);
  const spark = new Map<string, SparkMeta>();
  const chunks: string[][] = [];
  for (let i = 0; i < pick.length; i += 10) chunks.push(pick.slice(i, i + 10));
  let sparkDone = 0;
  for (const chunk of chunks) {
    try {
      const part = await fetchSparkChunk(chunk);
      part.forEach((v, k) => spark.set(k, v));
    } catch {
      /* try singles later */
    }
    sparkDone += chunk.length;
    onTick([], `美股行情 ${Math.min(sparkDone, pick.length)}/${pick.length}`, sparkDone, pick.length * 2);
  }

  let finished = 0;
  const acc: ScanRow[] = [];
  const rows = await poolMap(pick, 3, async (sym) => {
    const meta = spark.get(sym);
    const price = twNum(meta?.regularMarketPrice);
    let row: ScanRow;
    if (!price) {
      row = failRow("US", sym, "沒有市價");
    } else {
      const ts = await fetchTimeseriesLite(sym);
      const f = fromSnap({
        ticker: sym,
        name: meta?.shortName || meta?.longName || sym,
        price,
        pe: ts?.pe ?? null,
        pb: ts?.pb ?? null,
        yieldPct: ts?.yieldPct ?? null,
        currency: meta?.currency || "USD",
        exchange: meta?.fullExchangeName || meta?.exchangeName || "",
        shares: ts?.shares,
        marketCap: ts?.marketCap,
        source: "Yahoo Finance",
        notes: ["抽樣：Yahoo spark 行情 + 時間序列倍數。"],
      });
      row = valueRow("US", f);
    }
    finished += 1;
    acc.push(row);
    onTick(acc.slice(), `美股財報 ${finished}/${pick.length}`, pick.length + finished, pick.length * 2);
    return row;
  });
  return rows;
}

export async function runRandomScan(
  onProgress: (p: ScanProgress) => void,
): Promise<ScanRow[]> {
  onProgress({ label: "正在抽台股 50 檔…", done: 0, total: 100, rows: [] });
  let tw: ScanRow[] = [];
  try {
    tw = await scanTw();
  } catch (err) {
    tw = [failRow("TW", "TWSE", err instanceof Error ? err.message : "證交所抽樣失敗")];
  }
  onProgress({ label: `台股 ${tw.length} 檔完成，接著抽美股…`, done: tw.length, total: 100, rows: tw });
  const us = await scanUs((partial, label, done) => {
    onProgress({
      label,
      done: tw.length + Math.round((done / 100) * 50),
      total: 100,
      rows: [...tw, ...partial],
    });
  });
  const rows = [...tw, ...us];
  onProgress({ label: `完成 ${rows.filter((r) => r.ok).length}／${rows.length} 檔`, done: 100, total: 100, rows });
  return rows;
}

function classifyTwse(s: TwseSnap): AuditRow {
  const base = {
    ticker: s.ticker,
    name: s.name,
    price: s.price,
    pe: s.pe,
    pb: s.pb,
    yieldPct: s.yieldPct,
    blended: null as number | null,
    error: null as string | null,
  };
  if (!s.price || s.price <= 0) {
    return { ...base, bucket: "no_data", reason: "證交所沒有收盤價" };
  }
  const lacksPe = s.pe == null || s.pe <= 0;
  const lacksPb = s.pb == null || s.pb <= 0;
  const lacksY = s.yieldPct == null || s.yieldPct <= 0;
  try {
    const f = fromSnap({
      ...s,
      currency: "TWD",
      exchange: "TWSE",
      source: "臺灣證交所公開資訊",
      notes: ["全市場掃描"],
    });
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
      return { ...base, bucket: "no_value", reason: why };
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

export async function auditAllTwse(
  onProgress?: (done: number, total: number) => void,
): Promise<AuditReport> {
  const all = await fetchTwseAll();
  const rows: AuditRow[] = [];
  const total = all.length;
  for (let i = 0; i < all.length; i++) {
    rows.push(classifyTwse(all[i]));
    if (onProgress && (i % 50 === 0 || i === all.length - 1)) onProgress(i + 1, total);
  }
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
