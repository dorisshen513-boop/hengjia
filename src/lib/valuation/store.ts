import { create } from "zustand";
import { valueStock, sensitivityMatrix } from "./engine";
import { pushHistory } from "./history";
import { buildZones } from "./zones";
import type { NewsBrief } from "./news";
import type { Assumptions, Fundamentals, SensitivityCell, ValuationResult } from "./types";

type AppState = {
  tickerInput: string;
  loading: boolean;
  progress: string | null;
  error: string | null;
  fundamentals: Fundamentals | null;
  assumptions: Assumptions | null;
  baseAssumptions: Assumptions | null;
  newsAssumptions: Assumptions | null;
  bearAssumptions: Assumptions | null;
  newsOn: boolean;
  news: NewsBrief | null;
  result: ValuationResult | null;
  bearResult: ValuationResult | null;
  sensitivity: SensitivityCell[];
  tab: string;
  setTickerInput: (v: string) => void;
  setTab: (v: string) => void;
  applyQuote: (p: {
    fundamentals: Fundamentals;
    assumptions: Assumptions;
    baseAssumptions: Assumptions;
    bearAssumptions: Assumptions;
    news: NewsBrief;
  }, opts?: { record?: boolean }) => void;
  patchAssumptions: (patch: Partial<Assumptions>) => void;
  patchFundamentals: (patch: Partial<Fundamentals>) => void;
  toggleNews: (on: boolean) => void;
  setLoading: (v: boolean) => void;
  setProgress: (v: string | null) => void;
  setError: (v: string | null) => void;
  startRun: (ticker: string) => void;
  reset: () => void;
};

function recompute(
  f: Fundamentals | null,
  a: Assumptions | null,
  bear: Assumptions | null,
): Pick<AppState, "result" | "sensitivity" | "bearResult"> {
  if (!f || !a) return { result: null, sensitivity: [], bearResult: null };
  const result = valueStock(f, a);
  const bearResult = bear ? valueStock(f, bear) : null;
  return {
    result: { ...result, zones: buildZones(f, result, bearResult?.blended ?? null) },
    sensitivity: sensitivityMatrix(f, a),
    bearResult,
  };
}

export const useValuation = create<AppState>((set, get) => ({
  tickerInput: "",
  loading: false,
  progress: null,
  error: null,
  fundamentals: null,
  assumptions: null,
  baseAssumptions: null,
  newsAssumptions: null,
  bearAssumptions: null,
  newsOn: true,
  news: null,
  result: null,
  bearResult: null,
  sensitivity: [],
  tab: "overview",
  setTickerInput: (v) => set({ tickerInput: v }),
  setTab: (v) => set({ tab: v }),
  applyQuote: (p, opts) => {
    const computed = recompute(p.fundamentals, p.assumptions, p.bearAssumptions);
    set({
      fundamentals: p.fundamentals,
      assumptions: p.assumptions,
      newsAssumptions: p.assumptions,
      baseAssumptions: p.baseAssumptions,
      bearAssumptions: p.bearAssumptions,
      news: p.news,
      newsOn: true,
      error: null,
      loading: false,
      progress: null,
      tab: "overview",
      ...computed,
    });
    const r = computed.result;
    if (r && opts?.record !== false) {
      pushHistory({
        ticker: p.fundamentals.ticker,
        name: p.fundamentals.name,
        currency: p.fundamentals.currency,
        price: p.fundamentals.price,
        blended: r.blended,
        dcf: r.dcf,
        relative: r.relativeBase,
        upside: r.upside,
        qualityQ: r.quality.q,
        qualityLabel: r.quality.labelText,
        regime: p.assumptions.regime,
        snapshot: null,
      });
    }
  },
  patchAssumptions: (patch) => {
    const { fundamentals, assumptions, bearAssumptions, newsOn } = get();
    if (!assumptions) return;
    const next = { ...assumptions, ...patch };
    set({
      assumptions: next,
      ...(newsOn ? { newsAssumptions: next } : { baseAssumptions: next }),
      ...recompute(fundamentals, next, bearAssumptions),
    });
  },
  patchFundamentals: (patch) => {
    const { fundamentals, assumptions, bearAssumptions } = get();
    if (!fundamentals) return;
    const next = { ...fundamentals, ...patch };
    set({ fundamentals: next, ...recompute(next, assumptions, bearAssumptions) });
  },
  toggleNews: (on) => {
    const { fundamentals, baseAssumptions, newsAssumptions, bearAssumptions } = get();
    const next = on ? newsAssumptions : baseAssumptions;
    if (!next) return;
    set({
      newsOn: on,
      assumptions: next,
      ...recompute(fundamentals, next, bearAssumptions),
    });
  },
  setLoading: (v) => set({ loading: v, ...(v ? {} : { progress: null }) }),
  setProgress: (v) => set({ progress: v }),
  setError: (v) =>
    set(v ? { error: v, loading: false, progress: null } : { error: null }),
  startRun: (ticker) =>
    set({
      tickerInput: ticker,
      loading: true,
      progress: "正在向證交所／公開行情站抓最新財報與新聞…",
      error: null,
      fundamentals: null,
      assumptions: null,
      baseAssumptions: null,
      newsAssumptions: null,
      bearAssumptions: null,
      news: null,
      result: null,
      bearResult: null,
      sensitivity: [],
      tab: "overview",
    }),
  reset: () =>
    set({
      fundamentals: null,
      assumptions: null,
      baseAssumptions: null,
      newsAssumptions: null,
      bearAssumptions: null,
      news: null,
      newsOn: true,
      result: null,
      bearResult: null,
      sensitivity: [],
      error: null,
      loading: false,
      progress: null,
      tab: "overview",
    }),
}));
