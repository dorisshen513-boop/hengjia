import type { NewsBrief } from "./news";
import type { Assumptions, Fundamentals } from "./types";

export type QuoteSnapshot = {
  fundamentals: Fundamentals;
  assumptions: Assumptions;
  baseAssumptions: Assumptions;
  bearAssumptions: Assumptions;
  news: NewsBrief;
};

export type HistoryRow = {
  id: string;
  at: string;
  ticker: string;
  name: string;
  currency: string;
  price: number;
  blended: number | null;
  dcf: number | null;
  relative: number | null;
  upside: number | null;
  qualityQ: number;
  qualityLabel: string;
  regime: string;
  snapshot: QuoteSnapshot | null;
};

const KEY = "hengjia-history";
const MAX = 24;

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): HistoryRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(rows: HistoryRow[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX)));
  } catch {
    try {
      const slim = rows.slice(0, MAX).map((row) => ({
        ...row,
        snapshot: row.snapshot
          ? {
              ...row.snapshot,
              news: {
                ...row.snapshot.news,
                items: row.snapshot.news.items.slice(0, 8),
              },
            }
          : null,
      }));
      window.localStorage.setItem(KEY, JSON.stringify(slim));
    } catch {
      /* quota */
    }
  }
  listeners.forEach((fn) => fn());
}

export function listHistory(): HistoryRow[] {
  return read();
}

export function pushHistory(
  row: Omit<HistoryRow, "id" | "at"> & { snapshot?: QuoteSnapshot | null },
): HistoryRow {
  const entry: HistoryRow = {
    ...row,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ticker: row.ticker.trim().toUpperCase(),
    snapshot: row.snapshot ?? null,
  };
  const rest = read().filter((x) => x.ticker !== entry.ticker);
  write([entry, ...rest].slice(0, MAX));
  return entry;
}

export function touchHistory(ticker: string) {
  const key = ticker.trim().toUpperCase();
  const rows = read();
  const hit = rows.find((x) => x.ticker === key);
  if (!hit) return;
  write([hit, ...rows.filter((x) => x.ticker !== key)]);
}

export function removeHistory(id: string) {
  write(read().filter((row) => row.id !== id));
}

export function clearHistory() {
  write([]);
}

export function subscribeHistory(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
