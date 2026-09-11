import type { Fundamentals } from "./types";
import { abortAfter, netFetch } from "./http";
import { twseIndustry } from "./twse-industry";
import { twShares } from "./tw-shares";

function twNum(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const t = raw.replace(/,/g, "").replace(/%/g, "").trim();
  if (!t || t === "-" || t === "n/a") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function ymd(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function codeOf(ticker: string): string | null {
  const m = ticker.trim().toUpperCase().match(/^(\d{4})(?:\.(TW|TWO))?$/);
  return m ? m[1] : null;
}

function nameFromTitle(title: string, code: string): string {
  const a = title.match(new RegExp(`${code}\\s+([^\\s]+)`));
  if (a?.[1] && !/各日|個股|成交/.test(a[1])) return a[1];
  const b = title.match(/月\s+([^\s]+)\s+個股/);
  if (b?.[1]) return b[1];
  return "";
}

async function twseJson(url: string, ms = 5000): Promise<Record<string, unknown> | null> {
  try {
    const res =
      typeof window === "undefined"
        ? await fetch(url, {
            credentials: "omit",
            cache: "no-store",
            signal: abortAfter(ms),
          })
        : await netFetch(url);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function stockDay(code: string): Promise<{ price: number; name: string } | null> {
  for (const offset of [0, 1, 2]) {
    const data = await twseJson(
      `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ymd(offset)}&stockNo=${code}&response=json`,
    );
    if (!data || data.stat !== "OK") continue;
    const rows = (data.data as unknown[][]) ?? [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const close = twNum(rows[i]?.[6]);
      if (close && close > 0) {
        return { price: close, name: nameFromTitle(String(data.title ?? ""), code) };
      }
    }
  }
  return null;
}

async function bwibbu(code: string): Promise<{ pe: number | null; pb: number | null; yieldPct: number | null }> {
  const empty = { pe: null, pb: null, yieldPct: null };
  for (const offset of [0, 1, 2]) {
    const data = await twseJson(
      `https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU?date=${ymd(offset)}&stockNo=${code}&response=json`,
    );
    if (!data || data.stat !== "OK") continue;
    const rows = (data.data as unknown[][]) ?? [];
    const last = rows[rows.length - 1];
    if (!last) continue;
    return {
      yieldPct: twNum(last[1]),
      pe: twNum(last[3]),
      pb: twNum(last[4]),
    };
  }
  return empty;
}

function snapToPartial(ticker: string, snap: TwseSnap): Partial<Fundamentals> {
  const pe = snap.pe;
  const pb = snap.pb;
  const yieldPct = snap.yieldPct;
  const eps = pe && pe > 0 ? snap.price / pe : 0;
  const dps = yieldPct && yieldPct > 0 ? (snap.price * yieldPct) / 100 : 0;
  const industry = twseIndustry(codeOf(ticker) ?? ticker.replace(/\.(TW|TWO)$/i, ""));
  const code = codeOf(ticker) ?? ticker.replace(/\.(TW|TWO)$/i, "");
  const shares = twShares(code);
  const book = shares > 0 && pb && pb > 0 ? (snap.price / pb) * shares : 0;
  return {
    ticker,
    name: snap.name || ticker,
    currency: "TWD",
    exchange: "TWSE",
    sector: industry,
    industry,
    price: snap.price,
    sharesOut: shares,
    marketCap: shares > 0 ? shares * snap.price : 0,
    eps,
    dps,
    bookEquity: book,
    netIncome: shares > 0 && eps ? eps * shares : 0,
    dividendYield: yieldPct != null ? yieldPct / 100 : null,
    trailingPE: pe,
    priceToBook: pb,
    source: "臺灣證交所公開資訊",
    notes: [
      "台股行情取自證交所（不經 Yahoo 代理）。",
      shares
        ? "股數與淨值由證交所公開資料與淨值比推算；營收若有補上才跑 DCF。"
        : "證交所快照沒有營收與股數，DCF 可能空白；相對估值用本益比／淨值比。",
    ],
  };
}

async function fetchMis(code: string): Promise<Partial<Fundamentals> | null> {
  const exCh = `tse_${code}.tw|otc_${code}.tw|esb_${code}.tw`;
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;
  const data = await twseJson(url, 6000);
  const rows = (data?.msgArray as Array<Record<string, string>> | undefined) ?? [];
  const row = rows.find((r) => r.c === code && ((twNum(r.z) ?? 0) > 0 || (twNum(r.y) ?? 0) > 0));
  if (!row) return null;
  const price = twNum(row.z) || twNum(row.y) || 0;
  if (price <= 0) return null;
  const board = (row.ex || "").toLowerCase();
  const otc = board === "otc" || board === "esb";
  const emerging = board === "esb";
  const ticker = `${code}.${otc ? "TWO" : "TW"}`;
  const industry = otc ? "" : twseIndustry(code);
  const shares = twShares(code);
  return {
    ticker,
    name: (row.n || row.nf || code).trim(),
    currency: "TWD",
    exchange: emerging ? "興櫃" : otc ? "TPEx" : "TWSE",
    sector: industry,
    industry,
    price,
    sharesOut: shares,
    marketCap: shares > 0 ? shares * price : 0,
    source: emerging ? "興櫃即時行情" : otc ? "櫃買中心即時行情" : "證交所即時行情",
    notes: [
      otc
        ? "此檔是上櫃或興櫃，不是上市。已改查櫃買／興櫃行情。"
        : "台股行情取自證交所即時揭示。",
    ],
  };
}

/** Direct TWSE JSON (CORS *). Works on GitHub Pages without a proxy. */
export async function fetchTwse(ticker: string): Promise<Partial<Fundamentals> | null> {
  const code = codeOf(ticker);
  if (!code) return null;
  const forceOtc = /\.TWO$/i.test(ticker);
  try {
    if (!forceOtc) {
      const [day, ratios] = await Promise.all([stockDay(code), bwibbu(code)]);
      if (day?.price) {
        return snapToPartial(`${code}.TW`, {
          ticker: `${code}.TW`,
          name: day.name || ticker,
          price: day.price,
          pe: ratios.pe,
          pb: ratios.pb,
          yieldPct: ratios.yieldPct,
        });
      }
    }
    return await fetchMis(code);
  } catch {
    try {
      return await fetchMis(code);
    } catch {
      return null;
    }
  }
}

export type TwseSnap = {
  ticker: string;
  name: string;
  price: number;
  pe: number | null;
  pb: number | null;
  yieldPct: number | null;
};

/** One CORS call: all listed names with price / PE / PB / yield. */
export async function fetchTwseAll(): Promise<TwseSnap[]> {
  const data = await twseJson(
    "https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d?response=json&selectType=ALL",
    8000,
  );
  if (!data || data.stat !== "OK") return [];
  const rows = (data.data as unknown[][]) ?? [];
  const out: TwseSnap[] = [];
  for (const row of rows) {
    const code = String(row[0] ?? "").trim();
    if (!/^\d{4}$/.test(code) || code.startsWith("00")) continue;
    const price = twNum(row[2]);
    if (!price || price <= 0) continue;
    out.push({
      ticker: `${code}.TW`,
      name: String(row[1] ?? code).trim(),
      price,
      yieldPct: twNum(row[3]),
      pe: twNum(row[5]),
      pb: twNum(row[6]),
    });
  }
  return out;
}
