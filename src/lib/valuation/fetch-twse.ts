import type { Fundamentals } from "./types";

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
  const m = ticker.trim().toUpperCase().match(/^(\d{4})\.(TW|TWO)$/);
  return m ? m[1] : null;
}

function nameFromTitle(title: string, code: string): string {
  const a = title.match(new RegExp(`${code}\\s+([^\\s]+)`));
  if (a?.[1] && !/各日|個股|成交/.test(a[1])) return a[1];
  const b = title.match(/月\s+([^\s]+)\s+個股/);
  if (b?.[1]) return b[1];
  return "";
}

async function twseJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function stockDay(code: string): Promise<{ price: number; name: string } | null> {
  for (const offset of [0, 1, 2, 3, 4]) {
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
  for (const offset of [0, 1, 2, 3, 4]) {
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

/** Direct TWSE JSON (CORS *). Works on GitHub Pages without a proxy. */
export async function fetchTwse(ticker: string): Promise<Partial<Fundamentals> | null> {
  const code = codeOf(ticker);
  if (!code) return null;
  try {
    const [day, ratios] = await Promise.all([stockDay(code), bwibbu(code)]);
    if (!day?.price) return null;
    const pe = ratios.pe;
    const pb = ratios.pb;
    const yieldPct = ratios.yieldPct;
    const eps = pe && pe > 0 ? day.price / pe : 0;
    const dps = yieldPct && yieldPct > 0 ? (day.price * yieldPct) / 100 : 0;
    return {
      ticker,
      name: day.name || ticker,
      currency: "TWD",
      exchange: "TWSE",
      price: day.price,
      eps,
      dps,
      bookEquity: 0,
      dividendYield: yieldPct != null ? yieldPct / 100 : null,
      trailingPE: pe,
      priceToBook: pb,
      source: "臺灣證交所公開資訊",
      notes: ["台股行情取自證交所（不經 Yahoo 代理）。"],
    };
  } catch {
    return null;
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
