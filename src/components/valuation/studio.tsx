import { useEffect, useRef, type ReactNode } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MethodNote, NumberField, Stat } from "@/components/valuation/field";
import { HistoryButton, HistoryStrip } from "@/components/valuation/history-pad";
import { ZoneBar, ZoneBoard } from "@/components/valuation/zone-bar";
import { fetchQuoteData } from "@/lib/valuation/fetch-quote";
import { GUIDE } from "@/lib/valuation/guide";
import { REGIME_META, ROE_PRICE_SHARE } from "@/lib/valuation/engine";
import { useValuation } from "@/lib/valuation/store";
import { type HistoryRow } from "@/lib/valuation/history";
import { fmtMoney, fmtMult, fmtPct, fmtPctAbs, fmtPrice } from "@/lib/utils";
import type { Assumptions } from "@/lib/valuation/types";

const TABS = [
  { id: "overview", label: "匯總" },
  { id: "zones", label: "魚帶" },
  { id: "news", label: "新聞風險" },
  { id: "assumptions", label: "假設" },
  { id: "quality", label: "品質" },
  { id: "dcf", label: "DCF" },
  { id: "ddm", label: "股利折現" },
  { id: "rim", label: "剩餘收益" },
  { id: "relative", label: "相對估值" },
  { id: "option", label: "選擇權" },
  { id: "sensitivity", label: "敏感度" },
  { id: "guide", label: "計算方法" },
];

function queryTicker() {
  if (typeof window === "undefined") return "";
  return (new URLSearchParams(window.location.search).get("q") ?? "").trim();
}

function rememberTicker(ticker: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const t = ticker.trim().toUpperCase();
  if (t) url.searchParams.set("q", t);
  else url.searchParams.delete("q");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function Studio() {
  const {
    tickerInput,
    setTickerInput,
    loading,
    progress,
    error,
    fundamentals: f,
    assumptions: a,
    result: r,
    sensitivity,
    tab,
    setTab,
    applyQuote,
    patchAssumptions,
    setLoading,
    setProgress,
    setError,
    startRun,
  } = useValuation();
  const runId = useRef(0);

  useEffect(() => {
    const s = useValuation.getState();
    if (s.loading) {
      s.setLoading(false);
      s.setProgress(null);
    }
    const q = queryTicker();
    if (q) {
      setTickerInput(q);
      void run(q);
    }
    // 只在第一次打開時讀網址代號，之後由計算結果改寫。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(ticker?: string) {
    const q = (ticker ?? tickerInput).trim();
    if (!q) {
      setError("請輸入股票代號");
      return;
    }
    const id = ++runId.current;
    const started = Date.now();
    startRun(q);
    const timers = [
      window.setTimeout(() => {
        if (runId.current === id) setProgress("正在向證交所／公開行情站抓最新財報…");
      }, 400),
      window.setTimeout(() => {
        if (runId.current === id) setProgress("來源較慢，還在等公開行情…");
      }, 4000),
      window.setTimeout(() => {
        if (runId.current === id) {
          runId.current += 1;
          setError("來源沒有在時限內回應，請再試一次");
          setLoading(false);
          setProgress(null);
        }
      }, 10000),
    ];
    try {
      const data = await Promise.race([
        fetchQuoteData(q),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("計算逾時，請再試一次")), 9000);
        }),
      ]);
      if (runId.current !== id) return;
      applyQuote(data);
      rememberTicker(q);
    } catch (err) {
      if (runId.current !== id) return;
      const msg = friendlyError(err, q);
      if (msg.startsWith("找不到股票")) {
        useValuation.getState().reset();
      }
      setError(msg);
    } finally {
      timers.forEach((t) => window.clearTimeout(t));
      if (runId.current === id) {
        const remain = 300 - (Date.now() - started);
        if (remain > 0) await new Promise((r) => window.setTimeout(r, remain));
        setLoading(false);
        setProgress(null);
      }
    }
  }

  function cancelRun() {
    runId.current += 1;
    setLoading(false);
    setProgress(null);
    setError("已取消");
  }

  function restoreRow(row: HistoryRow) {
    void run(row.ticker);
  }

  return (
    <div className="min-h-dvh overflow-x-hidden bg-bg text-fg">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium tracking-[0.18em] text-muted">
                INTRINSIC STUDIO
              </p>
              <h1 className="mt-1 font-display text-4xl tracking-tight text-fg sm:text-5xl">
                衡價
              </h1>
              <p className="mt-2 max-w-xl text-sm text-muted">
                輸入代號，查詢公司財報與產業新聞。不是投資建議。
              </p>
            </div>
            <HistoryButton onRerun={(t) => void run(t)} onRestore={restoreRow} />
          </div>
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              const typed = String(new FormData(e.currentTarget).get("ticker") ?? "");
              void run(typed || tickerInput);
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <Input
                name="ticker"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                placeholder="AAPL、SATL、2330.TW"
                className="pl-10 uppercase"
                autoCapitalize="characters"
                autoComplete="off"
                enterKeyHint="search"
                aria-label="股票代號"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="lg"
                className="flex-1 sm:min-w-36"
                aria-busy={loading}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    計算中
                  </span>
                ) : (
                  "開始計算"
                )}
              </Button>
              {loading ? (
                <Button type="button" size="lg" variant="quiet" onClick={cancelRun}>
                  取消
                </Button>
              ) : null}
            </div>
          </form>
          <HistoryStrip current={tickerInput} onRestore={restoreRow} />
          {loading ? (
            <div
              role="status"
              aria-live="polite"
              className="sticky top-2 z-50 flex items-start gap-3 rounded-xl border-2 border-accent bg-surface px-4 py-4 shadow-lg"
            >
              <Loader2 className="mt-0.5 size-6 shrink-0 animate-spin text-accent" />
              <div>
                <p className="text-base font-medium text-fg">
                  正在計算 {tickerInput.toUpperCase() || "…"}，請稍候
                </p>
                <p className="mt-1 text-sm text-muted">
                  {progress ?? "正在向證交所／公開行情站抓最新財報…"}。超過 10 秒會自動停，可按取消。
                </p>
              </div>
            </div>
          ) : null}
          {error ? (
            <p className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-down">
              {error}
            </p>
          ) : null}
        </div>
      </header>

      {loading ? (
        <LoadingState ticker={tickerInput} progress={progress} />
      ) : !f || !a || !r ? (
        <EmptyState />
      ) : (
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <Hero f={f} a={a} r={r} />
          <nav className="-mx-4 mt-8 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`h-10 shrink-0 rounded-full px-4 text-sm ${
                  tab === t.id
                    ? "bg-accent text-accent-fg"
                    : "text-muted hover:bg-raised hover:text-fg"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <section className="mt-6">
            {tab === "overview" && <Overview />}
            {tab === "zones" && <ZonePanel />}
            {tab === "news" && <NewsPanel />}
            {tab === "assumptions" && (
              <AssumptionsPanel a={a} onChange={patchAssumptions} />
            )}
            {tab === "quality" && <QualityPanel />}
            {tab === "dcf" && <DcfPanel />}
            {tab === "ddm" && <DdmPanel />}
            {tab === "rim" && <RimPanel />}
            {tab === "relative" && <RelativePanel />}
            {tab === "option" && <OptionPanel />}
            {tab === "sensitivity" && <SensitivityPanel cells={sensitivity} />}
            {tab === "guide" && <GuidePanel />}
          </section>
        </main>
      )}
      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted sm:px-6 lg:px-8">
          <p>僅供研究與教學，不是投資建議。</p>
        </div>
      </footer>
    </div>
  );
}

function friendlyError(err: unknown, ticker: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const lower = msg.toLowerCase();
  if (/找不到股票/.test(msg)) {
    const hit = msg.match(/找不到股票：[A-Z0-9.]+/i);
    return hit?.[0] ?? `找不到股票：${ticker.toUpperCase()}`;
  }
  if (
    /not found|no data found|delist|symbol not exist|quote 404|找不到此代號/.test(
      lower,
    )
  ) {
    return `找不到股票：${ticker.toUpperCase()}`;
  }
  if (/暫時連不到|抓不到財報|timeout|timed out|abort|逾時|failed to fetch|networkerror|網路請求/.test(lower)) {
    return msg.includes("暫時連不到") ? msg : "抓不到財報（網路或來源被擋），請再試一次";
  }
  return msg.replace(/^.*?Error:\s*/i, "") || "計算失敗，請再試一次";
}

function LoadingState({
  ticker,
  progress,
}: {
  ticker: string;
  progress: string | null;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-line bg-surface p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="size-6 animate-spin text-accent" />
          <h2 className="font-display text-2xl">正在計算 {ticker.toUpperCase()}</h2>
        </div>
        <p className="mt-3 text-sm text-muted">{progress ?? "正在抓行情與財報…"}</p>
        <ol className="mt-5 space-y-2 text-sm text-muted">
          <li>1. 台股：證交所　美股：CNBC 公開報價</li>
          <li>2. 公司／母公司／產業新聞</li>
          <li>3. 套用假設並算出合理價</li>
        </ol>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-display text-xl">輸入代號</h2>
        <p className="mt-2 text-sm text-muted">
          美股直接填 AAPL；台股四碼會自動加上 .TW。會上網抓公司財報與產業新聞。
        </p>
      </div>
    </section>
  );
}

function Hero({
  f,
  a,
  r,
}: {
  f: NonNullable<ReturnType<typeof useValuation.getState>["fundamentals"]>;
  a: NonNullable<ReturnType<typeof useValuation.getState>["assumptions"]>;
  r: NonNullable<ReturnType<typeof useValuation.getState>["result"]>;
}) {
  const { news, newsOn, toggleNews, bearResult } = useValuation();
  const tone = (r.upside ?? 0) >= 0 ? "up" : "down";
  return (
    <div className="rounded-xl border border-line bg-surface p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-muted">
            {f.ticker} · {f.exchange || f.currency} · {f.asOf}
          </p>
          <h2 className="mt-1 font-display text-3xl tracking-tight">{f.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {[f.sector, f.industry].filter(Boolean).join(" / ") || "產業未提供"}
            {" · "}
            {f.source}
          </p>
          <p className="mt-2 text-sm text-fg">
            判定：{REGIME_META[a.regime]?.label ?? "未分類"}
            <span className="text-muted"> · {REGIME_META[a.regime]?.why}</span>
            {r.rimDistorted ? (
              <span className="text-muted"> 此檔 ROE 被淨值／庫藏股扭曲，RIM 這次沒投票。</span>
            ) : null}
          </p>
          {r.impliedG1 != null ? (
            <p className="mt-2 text-sm text-muted">
              市價隱含近期末成長 {fmtPctAbs(r.impliedG1)}
              {r.impliedG1Capped ? "（已達模型上界，差額是選擇權溢價）" : ""}
              ；模型 g1 {fmtPctAbs(a.g1)}
              {a.fadeGrowth ? `，${a.nYears} 年內遞減至 ${fmtPctAbs(a.g2)}` : ""}。
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">市價</p>
          <p className="font-display text-3xl tabular-nums">
            {fmtPrice(f.price)}
            <span className="ml-1 text-sm text-muted">{f.currency}</span>
          </p>
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label={
            r.thinBooks
              ? "現有營收地板"
              : newsOn
                ? "新聞調整後合理價"
                : "財報合理價"
          }
          value={r.blended != null ? `${fmtPrice(r.blended)} ${f.currency}` : "無法加權"}
          hint={
            r.thinBooks && r.blended != null
              ? "帳上生意只撐到這裡。市價其餘是選擇權，不是算錯，DCF 不投票。"
              : r.blended != null
                ? `${r.status} · 由納入的模型加權`
                : r.blendSkip || "沒有模型能投票時才會空白"
          }
          tone={tone}
        />
        <Stat
          label="情境期望"
          value={
            r.quality.allowed.optionExpected && r.option.expected != null
              ? `${fmtPrice(r.option.expected)} ${f.currency}`
              : "不適用"
          }
          hint={
            r.quality.allowed.optionExpected
              ? r.option.impliedPBull != null
                ? `市場隱含樂觀機率 ${r.option.impliedCapped ? ">95%" : fmtPctAbs(Math.max(0, r.option.impliedPBull))}（不併入加權）`
                : r.quality.allowed.note
              : r.quality.allowed.note
          }
        />
        <Stat
          label="事業品質"
          value={`${r.quality.q} · ${r.quality.labelText}`}
          hint={r.quality.meaning}
        />
        <Stat
          label="魚帶"
          value={r.zones?.currentLabel ?? "—"}
          hint={
            r.zones
              ? `${r.zones.currentHint}`
              : "需先有加權合理價"
          }
        />
        <Stat
          label="安全邊際"
          value={r.upside != null ? fmtPct(r.upside) : "—"}
          hint={
            r.blended != null
              ? `財報價 ${fmtPrice(r.blended)} ÷ 市價 ${fmtPrice(f.price)} − 1`
              : "需先有合理價"
          }
          tone={tone}
        />
      </div>
      {r.zones ? <div className="mt-5"><ZoneBar compact /></div> : null}
      <p className="mt-3 font-mono text-xs text-muted">
        Ke {fmtPctAbs(r.ke)} · ROE {fmtPctAbs(r.roe)}
        {r.rimSpread != null ? ` · ROE−Ke ${fmtPct(r.rimSpread)}` : ""}
        {" "}· WACC {fmtPctAbs(r.wacc)} · 市值 {fmtMoney(f.marketCap, 2)} · 股數{" "}
        {fmtMoney(f.sharesOut, 0)}
      </p>
      {r.option.kind !== "normal" ? (
        <div className="mt-4 rounded-lg border border-line bg-raised px-4 py-3">
          <p className="text-xs text-muted">
            {r.quality.labelText} · Q {r.quality.q}/100
            {news ? ` · 新聞風險 ${news.riskScore}（${news.level}）` : ""}
            {bearResult?.blended != null ? ` · 壓力價 ${fmtPrice(bearResult.blended)}` : ""}
          </p>
          <p className="mt-1 text-sm text-muted">{r.option.verdict}</p>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">
          新聞風險 {news ? `${news.riskScore} · ${news.level}` : "未抓到"}
          {bearResult?.blended != null ? ` · 壓力價 ${fmtPrice(bearResult.blended)} ${f.currency}` : ""}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm">
          <input
            type="checkbox"
            checked={newsOn}
            onChange={(e) => toggleNews(e.target.checked)}
          />
          套用新聞調整
        </label>
        {news?.summary ? <p className="text-xs text-muted">{news.summary}</p> : null}
      </div>
      {r.warnings.length ? (
        <ul className="mt-5 space-y-1 text-xs text-warn">
          {r.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ZonePanel() {
  const { result: r } = useValuation();
  if (!r) return null;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
      {r.zones ? <ZoneBoard /> : <p className="text-sm text-muted">沒有加權合理價時無法切魚帶。</p>}
      <MethodNote
        title="五帶怎麼切"
        formula="魚頭 ← 入肚 ← 魚肚（合理核）→ 近尾 → 魚尾"
      >
        <p>中軸是財報加權價。不是過冷／過熱指標，是模型價的五個大概位置。</p>
        <p>魚頭下沿取壓力價、相對低估值、偏低 DCF 的較低者。魚尾上沿取相對樂觀或選擇權樂觀情境。</p>
        <p>魚肚約為加權價 ±7%。入肚、近尾是合理核到兩端的過渡，所以也算偏合理，不是極端。</p>
      </MethodNote>
    </div>
  );
}

function RevenueCaseBoard() {
  const { fundamentals: f, result: r } = useValuation();
  if (!f || !r?.revCases?.length) return null;
  const prices = r.revCases.map((c) => c.dcf).filter((n): n is number => n != null && Number.isFinite(n));
  const lo = prices.length ? Math.min(...prices) : null;
  const hi = prices.length ? Math.max(...prices) : null;
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h3 className="font-display text-xl">三年營收情境</h3>
      <p className="mt-2 text-sm text-muted">
        不採用今年成長率。未來三年營收分別按 +10%、+5%、持平、−5%、−10%，其餘假設不變，各算一次 DCF。
      </p>
      <table className="mt-4 w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="pb-2 font-medium">情境</th>
            <th className="pb-2 font-medium">第 3 年營收</th>
            <th className="pb-2 font-medium">DCF</th>
            <th className="pb-2 font-medium">vs 市價</th>
          </tr>
        </thead>
        <tbody>
          {r.revCases.map((c) => {
            const gap = c.dcf != null && f.price > 0 ? c.dcf / f.price - 1 : null;
            const mid = c.g === 0;
            return (
              <tr key={c.label} className="border-t border-line">
                <td className="py-2">
                  {c.label}
                  {mid ? <span className="ml-2 text-xs text-muted">基準</span> : null}
                </td>
                <td className="py-2 font-mono tabular-nums">{fmtMoney(c.rev3)}</td>
                <td className="py-2 font-mono tabular-nums">{fmtPrice(c.dcf)}</td>
                <td className="py-2 font-mono tabular-nums">{fmtPct(gap)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {lo != null && hi != null ? (
        <p className="mt-3 text-sm text-muted">
          三年情境帶 {fmtPrice(lo)} – {fmtPrice(hi)} {f.currency}（−10% 到 +10%）。主模型 DCF 仍用假設裡的 g1。
        </p>
      ) : null}
    </div>
  );
}

function Overview() {
  const { fundamentals: f, result: r, assumptions: a } = useValuation();
  if (!f || !r || !a) return null;
  const rows = [
    ...r.models.map((m) => ({
      name:
        m.id === "gordon"
          ? "Gordon"
          : m.id === "twoStage"
            ? "兩階段"
            : m.id === "dcf"
              ? "DCF"
              : m.id === "rim"
                ? "RIM"
                : "相對",
      v: m.price,
      market: false,
    })),
    { name: "加權", v: r.blended, market: false },
    { name: "選擇權", v: r.option.expected, market: false },
    { name: "市價", v: f.price, market: true },
  ];
  const max = Math.max(
    ...rows.map((d) => (d.v != null && Number.isFinite(d.v) ? Math.abs(d.v) : 0)),
    1,
  );
  return (
    <div className="grid gap-5">
      {r.zones ? <ZoneBoard /> : null}
      <RevenueCaseBoard />
      <div className="rounded-xl border border-line bg-surface p-5">
        <h3 className="font-display text-xl">各模型 vs 市價</h3>
        <div className="mt-4 space-y-3">
          {rows.map((row) => {
            const num = row.v != null && Number.isFinite(row.v);
            const pct = num ? Math.max(3, Math.min(100, (Math.abs(row.v!) / max) * 100)) : 0;
            return (
              <div
                key={row.name}
                className="grid grid-cols-[5.25rem_minmax(0,1fr)_5.5rem] items-center gap-2"
              >
                <span className="text-xs text-muted">{row.name}</span>
                <div className="h-7 overflow-hidden rounded-sm bg-raised">
                  <div
                    className={`h-7 rounded-sm ${row.market ? "bg-accent" : "bg-muted"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-right font-mono text-xs tabular-nums text-fg">
                  {num ? fmtPrice(row.v) : "不適用"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <GapNote />
      <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <h3 className="font-display text-xl">各模型怎麼算、怎麼加權</h3>
        <p className="mt-2 text-sm text-muted">
          加權合理價 = Σ（有效權重 × 每股價值）。不適用的模型權重歸零後重分。ROE 透過 RIM 與合理 P/B 進股價，不是另開第六票。
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="pb-2 pr-3 text-left font-medium">模型</th>
                <th className="pb-2 px-3 text-right font-medium">每股</th>
                <th className="w-20 pb-2 pl-3 text-right font-medium">權重</th>
              </tr>
            </thead>
            <tbody>
              {r.models.map((m) => (
                <tr key={m.id} className="border-b border-line">
                  <td className="py-3 pr-3 align-middle">
                    <p className="leading-snug">{m.label}</p>
                    <p className="text-xs text-subtle">{m.used ? "納入加權" : "未納入"}</p>
                  </td>
                  <td className="whitespace-nowrap py-3 px-3 text-right font-mono tabular-nums">
                    {m.price != null && Number.isFinite(m.price) ? fmtPrice(m.price) : "不適用"}
                  </td>
                  <td className="whitespace-nowrap py-3 pl-3 text-right font-mono tabular-nums">
                    {fmtPctAbs(m.weight)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-3 pr-3 align-middle font-medium">加權合理價</td>
                <td className="whitespace-nowrap py-3 px-3 text-right font-mono tabular-nums">
                  {fmtPrice(r.blended)}
                </td>
                <td className="whitespace-nowrap py-3 pl-3 text-right font-mono tabular-nums">
                  100%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {[
            ...r.models.map((m) => ({
              id: m.id,
              title: m.label,
              formula: m.formula,
              calc: m.calc,
            })),
            {
              id: "blend",
              title: "加權合理價",
              formula: "Σ wᵢPᵢ",
              calc: `安全邊際 ${fmtPct(r.upside)}（vs 市價 ${fmtPrice(f.price)} ${f.currency}）`,
            },
          ].map((row) => (
            <li key={row.id} className="py-3">
              <p className="text-sm text-fg">{row.title}</p>
              <p className="mt-1 break-words font-mono text-xs leading-relaxed text-accent">
                {row.formula}
              </p>
              <p className="mt-1 break-words text-xs leading-relaxed text-muted">{row.calc}</p>
            </li>
          ))}
        </ul>
      </div>
      <MethodNote title="匯總怎麼來" formula="加權價 = Σ wᵢ Pᵢ　新聞只改假設，不另設權重">
        <p>
          不刪模型，依公司類型調比重。判定為「{REGIME_META[a.regime]?.label}」：
          {REGIME_META[a.regime]?.why}
          殖利率低於 1% 時股利模型仍會歸零。高選擇權／尚未獲利的 RIM 權重為 0。單一模型高於中位數 2.5 倍會再降權。
          此檔 ROE 約佔合理價 {ROE_PRICE_SHARE[a.regime]?.total}（RIM {ROE_PRICE_SHARE[a.regime]?.rim} + 相對裡的合理 P/B {ROE_PRICE_SHARE[a.regime]?.viaPb}）。
        </p>
        <p>
          相對區間 {fmtPrice(r.relativeLow)} – {fmtPrice(r.relativeHigh)}。
          ROE {fmtPctAbs(r.roe)}
          {r.justifiedPb != null ? ` · 合理 P/B ${r.justifiedPb.toFixed(1)}×` : ""}
          。Ke = Rf + β×ERP + 特定風險 ={" "}
          {fmtPctAbs(a.rf)} + {a.beta.toFixed(2)}×{fmtPctAbs(a.erp)} + {fmtPctAbs(a.specificRisk)} ={" "}
          {fmtPctAbs(r.ke)}。
        </p>
      </MethodNote>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="font-mono tabular-nums text-fg">{value}</p>
    </div>
  );
}

const SCOPE_LABEL: Record<string, string> = {
  company: "公司",
  parent: "母公司／控股",
  industry: "產業",
};

function NewsPanel() {
  const { news, bearResult, result: r, fundamentals: f } = useValuation();
  if (!news || !f) return null;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.25fr_0.85fr]">
      <div className="space-y-5">
        <div className="rounded-xl border border-line bg-surface p-5">
          <h3 className="font-display text-xl">風險與假設變動</h3>
          <p className="mt-2 text-sm text-muted">{news.summary}</p>
          {news.parentName ? (
            <p className="mt-2 text-xs text-muted">母公司線索：{news.parentName}</p>
          ) : (
            <p className="mt-2 text-xs text-subtle">
              未解析到明確母公司時，母公司欄抓「控股／parent」相關報導。
            </p>
          )}
          {news.aiNote ? (
            <p className="mt-3 rounded-md bg-raised p-3 text-sm text-muted">{news.aiNote}</p>
          ) : null}
          {news.flags.length ? (
            <ul className="mt-4 space-y-2">
              {news.flags.map((flag) => (
                <li key={flag.code} className="rounded-md border border-line p-3">
                  <p className="text-sm font-medium text-down">
                    {flag.label}
                    <span className="ml-2 text-xs text-subtle">{flag.severity}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted">{flag.evidence}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">未掃到高嚴重度事件關鍵字。</p>
          )}
          {news.shifts.length ? (
            <table className="mt-4 w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="pb-2 font-medium">假設</th>
                  <th className="pb-2 font-medium">調整前</th>
                  <th className="pb-2 font-medium">調整後</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {news.shifts.map((s) => (
                  <tr key={s.field} className="border-t border-line">
                    <td className="py-2">{s.label}</td>
                    <td>{s.from}</td>
                    <td>{s.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Mini label="新聞調整後" value={fmtPrice(r?.blended)} />
            <Mini label="壓力情境" value={fmtPrice(bearResult?.blended)} />
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5">
          <h3 className="font-display text-xl">風險管控</h3>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
            {news.controls.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </div>
      </div>
      <div className="rounded-xl border border-line bg-surface p-5">
        <h3 className="font-display text-xl">即時新聞</h3>
        <div className="mt-4 space-y-3">
          {news.items.length === 0 ? (
            <p className="text-sm text-muted">這次沒抓到公開頭條，估值未做事件調整。</p>
          ) : (
            news.items.map((it) => (
              <article key={`${it.scope}-${it.title}`} className="border-t border-line pt-3 first:border-0 first:pt-0">
                <p className="text-[11px] tracking-wide text-subtle">
                  {SCOPE_LABEL[it.scope]} · {it.source}
                  {it.published ? ` · ${it.published}` : ""}
                  {it.sentiment === "neg"
                    ? " · 負面"
                    : it.sentiment === "pos"
                      ? " · 正面"
                      : ""}
                </p>
                {it.url ? (
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block text-sm leading-snug text-fg hover:text-accent"
                  >
                    {it.title}
                  </a>
                ) : (
                  <p className="mt-1 text-sm leading-snug">{it.title}</p>
                )}
                {it.tags.length ? (
                  <p className="mt-1 text-xs text-muted">{it.tags.join(" · ")}</p>
                ) : null}
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function AssumptionsPanel({
  a,
  onChange,
}: {
  a: Assumptions;
  onChange: (p: Partial<Assumptions>) => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.7fr]">
      <div className="space-y-6 rounded-xl border border-line bg-surface p-5">
        <Group title="折現率">
          <NumberField label="無風險利率 Rf" pct value={a.rf} onChange={(v) => onChange({ rf: v })} />
          <NumberField label="Beta" value={a.beta} step={0.01} onChange={(v) => onChange({ beta: v })} />
          <NumberField label="股權風險溢酬 ERP" pct value={a.erp} onChange={(v) => onChange({ erp: v })} />
          <NumberField
            label="特定風險加碼"
            pct
            value={a.specificRisk}
            onChange={(v) => onChange({ specificRisk: v })}
          />
        </Group>
        <Group title="成長與利潤">
          <NumberField
            label="高成長年數"
            value={a.nYears}
            step={1}
            onChange={(v) => onChange({ nYears: v })}
          />
          <NumberField label="近期末成長 g1" pct value={a.g1} onChange={(v) => onChange({ g1: v })} />
          <NumberField label="終端成長 g2" pct value={a.g2} onChange={(v) => onChange({ g2: v })} />
          <label className="col-span-full flex h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={a.fadeGrowth}
              onChange={(e) => onChange({ fadeGrowth: e.target.checked })}
            />
            成長遞減（第 1 年 g1，第 {a.nYears} 年收到 g2）
          </label>
          <p className="col-span-full text-xs text-muted">
            {a.fadeGrowth
              ? `不遞減時，${fmtPctAbs(a.g1)} 連複利 ${a.nYears} 年會把終端基期撐很大，DCF 容易飆高。`
              : "每年都用 g1，直到終端突然改 g2。終端價值容易被高基期放大。"}
          </p>
          <NumberField
            label="起始 EBIT 率"
            pct
            value={a.ebitStart}
            onChange={(v) => onChange({ ebitStart: v })}
          />
          <NumberField
            label="目標 EBIT 率"
            pct
            value={a.ebitTarget}
            onChange={(v) => onChange({ ebitTarget: v })}
          />
          <NumberField label="稅率" pct value={a.tax} onChange={(v) => onChange({ tax: v })} />
        </Group>
        <Group title="再投資">
          <NumberField
            label="D&A / 營收"
            pct
            value={a.daSales}
            onChange={(v) => onChange({ daSales: v })}
          />
          <NumberField
            label="Capex / 營收"
            pct
            value={a.capexSales}
            onChange={(v) => onChange({ capexSales: v })}
          />
          <NumberField
            label="ΔNWC / Δ營收"
            pct
            value={a.nwcSales}
            onChange={(v) => onChange({ nwcSales: v })}
          />
          <NumberField
            label="離場 EV/EBITDA"
            value={a.exitEbitdaMultiple}
            step={0.5}
            suffix="x"
            onChange={(v) => onChange({ exitEbitdaMultiple: v })}
          />
        </Group>
        <Group title="模型權重">
          <p className="text-xs text-muted">
            預設依「{REGIME_META[a.regime]?.label}」帶入，可手動改。
          </p>
          <NumberField
            label="Gordon"
            pct
            value={a.weightGordon}
            onChange={(v) => onChange({ weightGordon: v })}
          />
          <NumberField
            label="兩階段 DDM"
            pct
            value={a.weightTwoStage}
            onChange={(v) => onChange({ weightTwoStage: v })}
          />
          <NumberField
            label="FCFF DCF"
            pct
            value={a.weightDcf}
            onChange={(v) => onChange({ weightDcf: v })}
          />
          <NumberField
            label="相對估值"
            pct
            value={a.weightRelative}
            onChange={(v) => onChange({ weightRelative: v })}
          />
          <NumberField
            label="剩餘收益 RIM"
            pct
            value={a.weightRim}
            onChange={(v) => onChange({ weightRim: v })}
          />
          <NumberField
            label="股利權重下限（低於此為 0）"
            pct
            value={a.ddmYieldFloor}
            onChange={(v) => onChange({ ddmYieldFloor: v })}
          />
          <NumberField
            label="股利權重滿載殖利率"
            pct
            value={a.ddmYieldFull}
            onChange={(v) => onChange({ ddmYieldFull: v })}
          />
        </Group>
        <label className="flex items-center gap-3 text-sm">
          <span className="text-muted">終端方法</span>
          <select
            className="h-11 rounded-[10px] border border-line bg-raised px-3 text-sm"
            value={a.terminalMethod}
            onChange={(e) =>
              onChange({ terminalMethod: e.target.value as Assumptions["terminalMethod"] })
            }
          >
            <option value="perpetuity">永續成長</option>
            <option value="exit">離場倍數</option>
          </select>
        </label>
      </div>
      <MethodNote title="假設為什麼存在" formula="黃格是看法，不是財報事實">
        <p>抓到的營收、股價、β 是公開資料；成長率、目標利潤、ERP 仍是你的判斷。</p>
        <p>虧損成長股與高選擇權：稅率 0、DDM 與 RIM 權重 0、終端用離場倍數、相對估值權重較高。</p>
        <p>低股利且 ROE 高過 Ke：RIM 與 DCF 並重。成熟配息股打開股利折現，RIM 仍吃淨值溢價。</p>
      </MethodNote>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 font-display text-lg">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function DcfPanel() {
  const { result: r, fundamentals: f, assumptions: a } = useValuation();
  if (!r || !f || !a) return null;
  const last = r.years[r.years.length - 1];
  const dcfLine = r.models.find((m) => m.id === "dcf");
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
      <div className="overflow-x-auto rounded-xl border border-line bg-surface p-5">
        {!dcfLine?.used ? (
          <p className="mb-4 rounded-md bg-raised px-3 py-2 text-sm text-muted">
            {dcfLine?.calc || "DCF 未納入加權。"} 下面仍顯示計算過程，
            <span className="text-fg">不當目標價</span>。
          </p>
        ) : r.dcfFragile ? (
          <p className="mb-4 rounded-md bg-raised px-3 py-2 text-sm text-muted">
            終端價值超過企業價值 70%，權重已減半。對折現率與離場倍數很敏感。
          </p>
        ) : null}
        <h3 className="font-display text-xl">計算過程</h3>
        {last && f.revenue > 0 ? (
          <p className="mt-2 text-sm text-muted">
            第 {a.nYears} 年營收 {fmtMoney(last.revenue)}，約為現在的{" "}
            {(last.revenue / f.revenue).toFixed(1)} 倍；終端佔 EV {fmtPctAbs(r.dcfTvShare ?? 0)}。
            {a.fadeGrowth ? "成長已遞減。" : "成長未遞減，終端基期容易偏大。"}
          </p>
        ) : null}
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>
            Ke = {fmtPctAbs(a.rf)} + {a.beta.toFixed(2)} × {fmtPctAbs(a.erp)} +{" "}
            {fmtPctAbs(a.specificRisk)} = <span className="text-fg">{fmtPctAbs(r.ke)}</span>
          </li>
          <li>
            WACC = 權益 {fmtPctAbs(a.we)} × {fmtPctAbs(r.ke)} + 負債 {fmtPctAbs(a.wd)} ×{" "}
            {fmtPctAbs(a.preTaxKd)} × (1 − {fmtPctAbs(a.tax)}) ={" "}
            <span className="text-fg">{fmtPctAbs(r.wacc)}</span>
          </li>
          <li>
            各年 FCFF = NOPAT + D&A − Capex − ΔNWC，用 WACC 折現。明確期現值{" "}
            <span className="text-fg">{fmtMoney(r.dcfExplicitPv)}</span>
          </li>
          <li>
            {a.terminalMethod === "exit"
              ? `終端 = 第 ${a.nYears} 年 EBITDA ${last ? fmtMoney(last.ebitda) : "—"} × 離場 ${a.exitEbitdaMultiple.toFixed(1)}x`
              : `終端 = FCFF_n × (1+g2) / (WACC − g2)`}
            ，折現後 <span className="text-fg">{fmtMoney(r.dcfTvPv)}</span>
          </li>
          <li>
            EV {fmtMoney(r.dcfEv)} − 淨債務 {fmtMoney(f.netDebt)} = 股權{" "}
            {fmtMoney(r.dcfEquity)}
          </li>
          <li>
            每股 DCF = {fmtMoney(r.dcfEquity)} ÷ {fmtMoney(f.sharesOut, 0)} 股 ={" "}
            <span className="text-fg">{fmtPrice(r.dcf)} {f.currency}</span>
          </li>
        </ol>
        <h3 className="mt-6 font-display text-xl">明確預測期</h3>
        <table className="mt-3 w-full min-w-[640px] text-left text-xs">
          <thead className="text-muted">
            <tr>
              {["年", "成長", "營收", "EBIT率", "FCFF", "折現因子", "現值"].map((h) => (
                <th key={h} className="pb-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums font-mono">
            {r.years.map((y) => (
              <tr key={y.year} className="border-t border-line">
                <td className="py-2">Y{y.year}</td>
                <td>{fmtPctAbs(y.growth)}</td>
                <td>{fmtMoney(y.revenue)}</td>
                <td>{fmtPctAbs(y.ebitMargin)}</td>
                <td>{fmtMoney(y.fcff)}</td>
                <td>{y.df.toFixed(3)}</td>
                <td>{fmtMoney(y.pv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Mini label="明確期 PV" value={fmtMoney(r.dcfExplicitPv)} />
          <Mini label="終端 PV" value={fmtMoney(r.dcfTvPv)} />
          <Mini label="終端佔 EV" value={fmtPctAbs(r.dcfTvShare ?? 0)} />
          <Mini label="企業價值 EV" value={fmtMoney(r.dcfEv)} />
          <Mini label="股權價值" value={fmtMoney(r.dcfEquity)} />
          <Mini label="每股 DCF" value={fmtPrice(r.dcf)} />
        </div>
        <RevenueCaseBoard />
      </div>
      <MethodNote
        title="FCFF 折現"
        formula="FCFF = NOPAT + D&A − Capex − ΔNWC"
      >
        <p>這是給全體資金提供者的現金，所以用 WACC 折現，不是 Ke。</p>
        <p>
          企業價值扣淨債務 {fmtMoney(f.netDebt)} 後得到股權，再除以{" "}
          {fmtMoney(f.sharesOut, 0)} 股。
        </p>
        <p>EBIT 率在預測期內由起始值線性收到目標值。選擇權型股票的營收成長會由 g1 遞減至 g2，避免把一年高成長當成永續。</p>
        <p>
          DCF 只在現有現金流能解釋至少兩成市價、且不是從大幅虧損「長出」獲利時才投票。否則權重併入相對估值，差額看選擇權分頁。
        </p>
      </MethodNote>
    </div>
  );
}

function DdmPanel() {
  const { result: r, assumptions: a, fundamentals: f } = useValuation();
  if (!r || !a || !f) return null;
  const dy = f.price > 0 ? f.dps / f.price : 0;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-line bg-surface p-5">
        {!r.ddmApplicable ? (
          <p className="mb-4 rounded-md bg-raised px-3 py-2 text-sm text-muted">
            殖利率 {fmtPctAbs(dy)}，低於 {fmtPctAbs(a.ddmYieldFloor)} 下限，
            <span className="text-fg">未納入加權</span>
            。下面是只折現現金股利的參考價，不含庫藏股與留存盈餘，所以會遠低於市價。這不是當目標價。
          </p>
        ) : null}
        <h3 className="font-display text-xl">Gordon</h3>
        <p className="mt-2 font-mono text-3xl tabular-nums">
          {r.gordon != null ? `${fmtPrice(r.gordon)} ${f.currency}` : "不適用"}
        </p>
        <p className="mt-2 font-mono text-xs text-accent">P = D1 / (Ke − g)</p>
        <p className="mt-2 text-sm text-muted">
          D0 = {fmtPrice(f.dps)} {f.currency}，D1 = {fmtPrice(f.dps * (1 + a.gDiv2))}，Ke ={" "}
          {fmtPctAbs(r.ke)}，g = {fmtPctAbs(a.gDiv2)}
          {f.dps <= 0 ? "。沒有股利就不能用此式。" : `。隱含永續成長 ${fmtPctAbs(r.gordonImpliedG)}。`}
        </p>
        <h3 className="mt-6 font-display text-xl">兩階段</h3>
        <p className="mt-2 font-mono text-3xl tabular-nums">
          {r.twoStage != null ? `${fmtPrice(r.twoStage)} ${f.currency}` : "不適用"}
        </p>
        <p className="mt-2 font-mono text-xs text-accent">
          P = Σ Dt/(1+Ke)^t + [D_n(1+g2)/(Ke−g2)]/(1+Ke)^n
        </p>
        <p className="mt-2 text-sm text-muted">
          明確期股利現值 {fmtPrice(r.twoStageDivPv)} · 終端現值 {fmtPrice(r.twoStageTvPv)} · 高成長{" "}
          {a.nYears} 年、g1 {fmtPctAbs(a.gDiv1)}
        </p>
      </div>
      <MethodNote title="股利折現" formula="P0 = D1 / (Ke − g)">
        <p>股東長期持有真正拿到的是股利（或等價的自由現金流給股東）。</p>
        <p>
          目前 Ke = {fmtPctAbs(r.ke)}。低殖利率或無配息時權重為 0，改看 DCF、RIM 或相對估值。
        </p>
        <p>適用：穩定配息、成長接近經濟成長的成熟公司。蘋果、台積電這種低股利複利股不該用 Gordon 當目標價。</p>
      </MethodNote>
    </div>
  );
}

function RimPanel() {
  const { result: r, fundamentals: f, assumptions: a } = useValuation();
  if (!r || !f || !a) return null;
  const last = r.rimYears[r.rimYears.length - 1];
  const share = ROE_PRICE_SHARE[a.regime];
  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
      <div className="overflow-x-auto rounded-xl border border-line bg-surface p-5">
        <h3 className="font-display text-xl">剩餘收益</h3>
        <p className="mt-2 font-mono text-3xl tabular-nums">
          {r.rim != null ? `${fmtPrice(r.rim)} ${f.currency}` : "不適用"}
        </p>
        <p className="mt-2 font-mono text-xs text-accent">
          P = 每股淨值 + Σ (ROE_t − Ke) × 淨值_{"{t−1}"} / (1+Ke)^t
        </p>
        <p className="mt-3 text-sm text-muted">{r.rimReason || "沒有足夠淨值或 ROE。"}</p>
        {r.rim == null ? (
          <p className="mt-3 rounded-md bg-raised p-3 text-sm text-muted">
            這次沒有投票權。高選擇權、尚未獲利、或庫藏股扭曲的 ROE，都不該用帳面去追市價。
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Mini label="ROE" value={fmtPctAbs(r.roe)} />
          <Mini label="Ke" value={fmtPctAbs(r.ke)} />
          <Mini label="ROE − Ke" value={fmtPct(r.rimSpread)} />
          <Mini label="每股淨值" value={fmtPrice(r.rimBook)} />
          <Mini label="剩餘收益現值" value={fmtPrice(r.rimExplicitPv)} />
          <Mini
            label="合理 P/B"
            value={r.justifiedPb != null ? `${r.justifiedPb.toFixed(1)}x` : "n.m."}
          />
        </div>
        {r.rimYears.length ? (
          <table className="mt-5 w-full min-w-[28rem] text-left text-xs">
            <thead className="text-muted">
              <tr>
                {["年", "期初淨值", "ROE", "剩餘收益", "現值"].map((h) => (
                  <th key={h} className="pb-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums font-mono">
              {r.rimYears.map((y) => (
                <tr key={y.year} className="border-t border-line">
                  <td className="py-2">Y{y.year}</td>
                  <td>{fmtPrice(y.book)}</td>
                  <td>{fmtPctAbs(y.roe)}</td>
                  <td>{fmtPrice(y.ri)}</td>
                  <td>{fmtPrice(y.pv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {last ? (
          <p className="mt-3 text-xs text-muted">
            第 {a.nYears} 年 ROE 收到 {fmtPctAbs(last.roe)}（目標 Ke）。終端剩餘收益趨近 0，避免永遠維持超額 ROE。
          </p>
        ) : null}
        <h3 className="mt-8 font-display text-xl">ROE 怎麼進股價</h3>
        <p className="mt-2 text-sm text-muted">
          ROE 不是第六票。它透過 RIM 投票，以及相對估值裡的合理 P/B。品質分數看 ROE−Ke，那是好不好，不是價格。
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="pb-2 font-medium">類型</th>
              <th className="pb-2 font-medium">RIM</th>
              <th className="pb-2 font-medium">經 P/B</th>
              <th className="pb-2 font-medium">合計</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(ROE_PRICE_SHARE) as Array<keyof typeof ROE_PRICE_SHARE>).map((key) => {
              const row = ROE_PRICE_SHARE[key];
              const on = key === a.regime;
              return (
                <tr key={key} className="border-t border-line">
                  <td className={`py-2 ${on ? "font-medium text-fg" : "text-muted"}`}>
                    {REGIME_META[key].label}
                    {on ? "（此檔）" : ""}
                  </td>
                  <td className="py-2 font-mono tabular-nums">{row.rim}</td>
                  <td className="py-2 font-mono tabular-nums">{row.viaPb}</td>
                  <td className="py-2 font-mono tabular-nums">{row.total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">{share?.note}</p>
      </div>
      <MethodNote title="為什麼看 ROE" formula="超額報酬 = ROE − Ke">
        <p>股東把錢留在公司，要求至少賺到 Ke。ROE 高過 Ke，帳面每一塊都在幫股東賺錢，合理價可以高於淨值。</p>
        <p>RIM 把這段差折現。高選擇權、尚未獲利、或庫藏股把淨值削到 ROE 爆炸時，權重自動為 0。</p>
        <p>低股利複利股權重最高（約 36%），因為錢留在公司，該問的就是 ROE 能不能蓋過 Ke。</p>
        <p>庫藏股造成的超高 ROE（超過 80%）不當成超額，否則蘋果這類會被淨值削薄騙到。</p>
      </MethodNote>
    </div>
  );
}

function RelativePanel() {
  const { result: r, fundamentals: f, assumptions: a, patchAssumptions } =
    useValuation();
  if (!r || !f || !a) return null;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-xl border border-line bg-surface p-5">
        <h3 className="font-display text-xl">隱含股價</h3>
        <p className="mt-2 text-sm text-muted">
          每股營收 {fmtPrice(f.sharesOut ? f.revenue / f.sharesOut : null)} · 每股帳面{" "}
          {fmtPrice(f.sharesOut ? f.bookEquity / f.sharesOut : null)} · EPS {fmtPrice(f.eps)}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Mini label="目前 P/E" value={fmtMult(f.trailingPE)} />
          <Mini label="目前 P/S" value={fmtMult(f.priceToSales)} />
          <Mini label="目前 P/B" value={fmtMult(f.priceToBook)} />
          <Mini
            label="合理 P/B（ROE、Ke、g2）"
            value={r.justifiedPb != null ? `${r.justifiedPb.toFixed(1)}x` : "n.m."}
          />
          <Mini label="目前 EV/EBITDA" value={fmtMult(f.evToEbitda)} />
          <Mini
            label={`P/E 隱含 = ${a.peBase.toFixed(1)} × EPS`}
            value={fmtPrice(r.impliedPe)}
          />
          <Mini
            label={`P/S 隱含 = ${a.psBase.toFixed(1)} × 每股營收`}
            value={fmtPrice(r.impliedPs)}
          />
          <Mini
            label={`P/B 隱含 = ${a.pbBase.toFixed(1)} × 每股權益`}
            value={fmtPrice(r.impliedPb)}
          />
          <Mini
            label={`EV/EBITDA 隱含 − 每股淨債`}
            value={fmtPrice(r.impliedEvEbitda)}
          />
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <NumberField
            label="基準 P/S"
            value={a.psBase}
            step={0.1}
            suffix="x"
            onChange={(v) => patchAssumptions({ psBase: v })}
          />
          <NumberField
            label="基準 P/B"
            value={a.pbBase}
            step={0.1}
            suffix="x"
            onChange={(v) => patchAssumptions({ pbBase: v })}
          />
          <NumberField
            label="基準 P/E"
            value={a.peBase}
            step={0.1}
            suffix="x"
            onChange={(v) => patchAssumptions({ peBase: v })}
          />
        </div>
        <p className="mt-4 text-sm text-muted">
          基準平均 {fmtPrice(r.relativeBase)} · 保守 {fmtPrice(r.relativeLow)} · 樂觀{" "}
          {fmtPrice(r.relativeHigh)}
        </p>
      </div>
      <MethodNote title="倍數交叉檢查" formula="目標價 = 可比倍數 × 每股基本面">
        <p>負 EPS 時 P/E 自動排除。EV 倍數會扣每股淨債務。</p>
        <p>
          已獲利公司的基準 P/B 有一半來自合理倍數 (ROE−g)/(Ke−g)，不是只跟熱市自己的 P/B。高選擇權股仍用市場倍數。
        </p>
      </MethodNote>
    </div>
  );
}

function GapNote() {
  const { fundamentals: f, result: r, assumptions: a } = useValuation();
  if (!f || !r || !a || !f.price) return null;
  const peOwn = f.trailingPE;
  const peCapped = peOwn != null && peOwn > a.peBase + 0.05;
  const dcfGap = r.dcf != null ? r.dcf / f.price - 1 : null;
  const relGap = r.relativeBase != null ? r.relativeBase / f.price - 1 : null;
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h3 className="font-display text-xl">為何常低於市價</h3>
      <p className="mt-2 text-sm text-muted">
        合理價系統性偏低，多半是假設，不是模型獨立偵測到泡沫。熱市裡教科書折現本來就會低於成交價。
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        <li>
          權益成本 Ke {fmtPctAbs(r.ke)}（Rf {fmtPctAbs(a.rf)} + β {a.beta.toFixed(2)} × ERP{" "}
          {fmtPctAbs(a.erp)} + 特定風險 {fmtPctAbs(a.specificRisk)}）。市場若用 3–4% ERP，DCF 會比較接近市價。
        </li>
        <li>
          終端成長 g2 {fmtPctAbs(a.g2)}。長期名目 GDP 常被寫成 3.5–4%；我們用 3% 仍偏保守。
        </li>
        <li>
          相對估值用 TTM 與倍數上限：P/E 基準 {a.peBase.toFixed(1)}×
          {peCapped && peOwn ? `（市價 TTM P/E ${peOwn.toFixed(1)}× 被上限截過）` : ""}
          ，EV/EBITDA 基準 {a.evEbitdaBase.toFixed(1)}×。用自己的未截斷倍數去乘 TTM，相對價會接近市價，那是恆等式，證明不了貴或便宜。
        </li>
        <li>
          此檔：DCF {dcfGap != null ? fmtPct(dcfGap) : "—"}、RIM{" "}
          {r.rim != null ? fmtPct(r.rim / f.price - 1) : "—"}、相對{" "}
          {relGap != null ? fmtPct(relGap) : "—"}、加權 {r.upside != null ? fmtPct(r.upside) : "—"} vs 市價。
        </li>
        <li>
          Gordon／兩階段在低殖利率時會算出很小的數字，因為只折現現金股利、不含買回。殖利率低於{" "}
          {fmtPctAbs(a.ddmYieldFloor)} 時權重為 0，不會拉低加權價。
        </li>
        <li>
          虧損硬收到成熟利潤、或 DCF／RIM 低於市價 80% 以上時，那一票會關掉。那是「現有帳解釋不了市價」，不是證明便宜。
        </li>
      </ul>
      <p className="mt-3 text-xs text-muted">
        要讓合理價貼近市價，應改 ERP／g2／倍數上限，而不是把單一成長率拉爆。假設分頁可改。
      </p>
    </div>
  );
}

function QualityPanel() {
  const { result: r, fundamentals: f } = useValuation();
  if (!r || !f) return null;
  const q = r.quality;
  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
      <div className="rounded-xl border border-line bg-surface p-5">
        <h3 className="font-display text-xl">事業品質 Q</h3>
        <p className="mt-2 text-sm text-muted">
          {q.labelText} · {q.q}/100。分數看生意好不好，不是股價便不便宜。新聞不是必要條件。
        </p>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-raised">
          <div className="h-3 rounded-full bg-accent" style={{ width: `${Math.max(4, q.q)}%` }} />
        </div>
        <p className="mt-3 text-sm text-fg">{q.meaning}</p>
        <p className="mt-1 text-xs text-muted">{q.allowed.note}</p>

        <h3 className="mt-8 font-display text-xl">存活門檻</h3>
        <p className="mt-1 text-xs text-muted">任一條觸發即為存活風險，後面的 Q 只當參考。</p>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="pb-2 font-medium">檢查</th>
              <th className="pb-2 font-medium">結果</th>
              <th className="pb-2 font-medium">規則</th>
              <th className="pb-2 font-medium">代入</th>
            </tr>
          </thead>
          <tbody>
            {q.gates.map((g) => (
              <tr key={g.id} className="border-t border-line align-top">
                <td className="py-2">{g.name}</td>
                <td className="py-2 font-medium">{g.triggered ? "觸發" : "通過"}</td>
                <td className="py-2 text-xs text-muted">{g.rule}</td>
                <td className="py-2 text-xs text-muted">{g.value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mt-8 font-display text-xl">六塊打分（各 0–20）</h3>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="pb-2 font-medium">項目</th>
              <th className="pb-2 font-medium">分數</th>
              <th className="pb-2 font-medium">怎麼判</th>
              <th className="pb-2 font-medium">這家為什麼</th>
            </tr>
          </thead>
          <tbody>
            {q.lines.map((line) => (
              <tr key={line.id} className="border-t border-line align-top">
                <td className="py-2">{line.name}</td>
                <td className="py-2 font-mono tabular-nums">
                  {line.points}/{line.max}
                </td>
                <td className="py-2 text-xs text-muted">{line.rule}</td>
                <td className="py-2 text-xs text-muted">{line.why}</td>
              </tr>
            ))}
            {q.traps.map((line) => (
              <tr key={line.id} className="border-t border-line align-top">
                <td className="py-2">{line.name}</td>
                <td className="py-2 font-mono tabular-nums">{line.points}</td>
                <td className="py-2 text-xs text-muted">{line.rule}</td>
                <td className="py-2 text-xs text-muted">{line.why}</td>
              </tr>
            ))}
            <tr className="border-t border-line">
              <td className="py-2 font-medium">合計 Q</td>
              <td className="py-2 font-mono tabular-nums">{q.q}/100</td>
              <td className="py-2 text-xs text-muted">clamp(六塊 + 陷阱, 0, 100)</td>
              <td className="py-2 text-xs text-muted">標籤：{q.labelText}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <MethodNote title="分數怎麼判斷" formula="Q = A規模 + B引擎 + C單位經濟 + D成長品質 + E資產負債 + F超額ROE − 陷阱">
        <ul className="list-disc space-y-2 pl-4">
          {q.bands.map((b) => (
            <li key={b.name}>
              <span className="text-fg">
                {b.min}–{b.max} {b.name}
              </span>
              ：{b.meaning}
            </li>
          ))}
        </ul>
        <p className="mt-3">
          真選擇權另需：Q≥55、營收≥10 億美元、高倍數、EBITDA 已轉正或接近。題材溢價：很貴但 Q 低於 40 或營收低於 1 億美元。
        </p>
        <p>
          小公司沒新聞時不補分。成長看絕對年增額；跑道用現金 ÷ 年燒錢。ARBE 這類會被存活／研發殼擋住，不會拿到 SPCX 的情境期望。
        </p>
      </MethodNote>
    </div>
  );
}

function OptionPanel() {
  const { result: r, fundamentals: f } = useValuation();
  if (!r || !f) return null;
  const o = r.option;
  const q = r.quality;
  const kindLabel = q.labelText;
  const rows = [
    { name: "失敗", p: o.pFail, v: o.vFail, hint: "淨現金或 25% 帳面" },
    { name: "基本（營運 DCF）", p: o.pBase, v: o.vBase, hint: "現有假設下的現金流" },
    { name: "樂觀（爆發）", p: o.pBull, v: o.vBull, hint: "10 年、更高利潤與離場倍數" },
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
      <div className="rounded-xl border border-line bg-surface p-5">
        <h3 className="font-display text-xl">情境期望</h3>
        <p className="mt-2 text-sm text-muted">
          {kindLabel} · 品質 Q {q.q}/100。{q.allowed.note}
        </p>
        {!q.allowed.optionExpected ? (
          <p className="mt-6 text-sm text-fg">
            這家不准開爆發帳。請看「品質」分頁的打分。失敗底{" "}
            {fmtPrice(o.vFail)} {f.currency}。
          </p>
        ) : null}
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-raised">
          <div
            className="h-3 rounded-full bg-accent"
            style={{ width: `${Math.max(4, o.score)}%` }}
          />
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {o.flags.map((flag) => (
            <li key={flag.label} className="flex justify-between gap-3 border-t border-line pt-2">
              <span>
                {flag.label}
                <span className="mt-0.5 block text-xs text-muted">{flag.note}</span>
              </span>
              <span className="font-mono tabular-nums text-muted">
                {flag.points > 0 ? "+" : ""}
                {flag.points}
              </span>
            </li>
          ))}
        </ul>
        <h3 className="mt-8 font-display text-xl">三情境（不併入財報加權）</h3>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="pb-2 font-medium">情境</th>
              <th className="pb-2 font-medium">機率</th>
              <th className="pb-2 font-medium">每股</th>
              <th className="pb-2 font-medium">依據</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-t border-line">
                <td className="py-2">{row.name}</td>
                <td className="py-2 font-mono tabular-nums">{fmtPctAbs(row.p)}</td>
                <td className="py-2 font-mono tabular-nums">{fmtPrice(row.v)}</td>
                <td className="py-2 text-xs text-muted">{row.hint}</td>
              </tr>
            ))}
            <tr className="border-t border-line">
              <td className="py-2 font-medium">機率加權</td>
              <td className="py-2 font-mono">100%</td>
              <td className="py-2 font-mono tabular-nums">{fmtPrice(o.expected)}</td>
              <td className="py-2 text-xs text-muted">Σ pᵢVᵢ</td>
            </tr>
            <tr className="border-t border-line">
              <td className="py-2">市價</td>
              <td className="py-2 text-muted">—</td>
              <td className="py-2 font-mono tabular-nums">{fmtPrice(f.price)}</td>
              <td className="py-2 text-xs text-muted">
                隱含樂觀機率{" "}
                {o.impliedPBull == null
                  ? "—"
                  : o.impliedCapped
                    ? ">95%"
                    : fmtPctAbs(Math.max(0, o.impliedPBull))}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mt-4 text-sm text-fg">{o.verdict}</p>
      </div>
      <MethodNote
        title="選擇權帳怎麼分真假"
        formula="E[V] = p失敗V失敗 + p基本V基本 + p樂觀V樂觀"
      >
        <p>
          價差大有兩種：市場在買尚未入帳的選擇權（SPCX），或公司只是貴／爛。評分先看規模、成長、EBITDA 是否轉正、現金能不能燒到大成。
        </p>
        <p>
          真選擇權才開這本帳，且不併入上面的財報合理價。你要做的是比較「市價隱含成功機率」和你自己願意給的機率。
        </p>
        <p>
          題材溢價型維持失敗權重 50%、樂觀 5%，避免把 SATL 這種小公司高倍數用星艦那套往上修。
        </p>
      </MethodNote>
    </div>
  );
}

function SensitivityPanel({
  cells,
}: {
  cells: ReturnType<typeof useValuation.getState>["sensitivity"];
}) {
  const waccs = Array.from(new Set(cells.map((c) => c.wacc))).sort((a, b) => a - b);
  const g2s = Array.from(new Set(cells.map((c) => c.g2))).sort((a, b) => a - b);
  const { result: r } = useValuation();
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
      <div className="overflow-x-auto rounded-xl border border-line bg-surface p-5">
        <h3 className="font-display text-xl">DCF：WACC × 終端成長</h3>
        <table className="mt-4 w-full min-w-[520px] text-center text-xs">
          <thead>
            <tr>
              <th className="pb-2 text-left text-muted">WACC \\ g2</th>
              {g2s.map((g) => (
                <th key={g} className="pb-2 font-mono text-muted">
                  {fmtPctAbs(g)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {waccs.map((w) => (
              <tr key={w} className="border-t border-line">
                <td className="py-2 text-left text-muted">{fmtPctAbs(w)}</td>
                {g2s.map((g) => {
                  const cell = cells.find((c) => c.wacc === w && c.g2 === g);
                  return (
                    <td key={g} className="py-2">
                      {fmtPrice(cell?.price ?? null)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          基準 DCF {fmtPrice(r?.dcf ?? null)}。往右下（成長高、折現低）價值上升。
        </p>
      </div>
      <MethodNote title="為什麼要做敏感度" formula="價值對 Ke、g2 的偏導數很大">
        <p>終端價值權重高時，差 1 個百分點的折現率就能讓合理價差一倍。</p>
        <p>若只有中心格子合理、四周極端，就不要只報一個目標價。</p>
      </MethodNote>
    </div>
  );
}

function GuidePanel() {
  const [open, setOpen] = useState<string>("hub");
  return (
    <div className="space-y-3">
      {GUIDE.map((g) => {
        const on = open === g.id;
        return (
          <article key={g.id} className="rounded-xl border border-line bg-surface p-5">
            <button
              type="button"
              className="flex w-full items-start justify-between gap-4 text-left"
              onClick={() => setOpen(on ? "" : g.id)}
            >
              <div>
                <h3 className="font-display text-xl">{g.title}</h3>
                <p className="mt-1 text-sm text-muted">{g.purpose}</p>
              </div>
              <span className="text-muted">{on ? "−" : "+"}</span>
            </button>
            {on ? (
              <div className="mt-4 border-t border-line pt-4">
                <p className="font-mono text-xs text-accent">{g.formula}</p>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
                  {g.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
