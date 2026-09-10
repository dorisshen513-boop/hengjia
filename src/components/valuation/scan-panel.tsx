import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  auditAllTwse,
  auditAllUs,
  runRandomScan,
  type AuditBucket,
  type AuditReport,
  type ScanRow,
} from "@/lib/valuation/scan";
import { fmtPct, fmtPrice } from "@/lib/utils";

const AUDIT_KEY = "hengjia-twse-audit";

function loadCachedAudit(): AuditReport | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUDIT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuditReport;
  } catch {
    return null;
  }
}

function saveCachedAudit(report: AuditReport) {
  try {
    window.localStorage.setItem(AUDIT_KEY, JSON.stringify(report));
  } catch {
    /* quota */
  }
}

export function ScanPanel({ onOpen }: { onOpen: (ticker: string) => void }) {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [running, setRunning] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<"all" | "TW" | "US">("all");

  const [auditTw, setAuditTw] = useState<AuditReport | null>(null);
  const [auditUs, setAuditUs] = useState<AuditReport | null>(null);
  const [auditMarket, setAuditMarket] = useState<"TW" | "US">("US");
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditLabel, setAuditLabel] = useState<string | null>(null);
  const [auditFilter, setAuditFilter] = useState<"issues" | AuditBucket | "loss">("issues");
  const audit = auditMarket === "TW" ? auditTw : auditUs;

  async function run() {
    if (running) return;
    setRunning(true);
    setError(null);
    setLabel("準備抽樣…");
    try {
      const result = await runRandomScan((p) => {
        setLabel(p.label);
        setRows(p.rows);
      });
      setRows(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "抽樣失敗");
    } finally {
      setRunning(false);
    }
  }

  async function loadSnapshot(market: "TW" | "US"): Promise<AuditReport | null> {
    if (market === "TW") {
      const cached = loadCachedAudit();
      if (cached?.rows?.length) return cached;
    }
    const file = market === "TW" ? "twse-audit.json" : "us-audit.json";
    const res = await fetch(`${import.meta.env.BASE_URL}${file}`);
    if (!res.ok) return null;
    return (await res.json()) as AuditReport;
  }

  async function runAudit(fresh: boolean, market: "TW" | "US" = auditMarket) {
    if (auditBusy) return;
    setAuditBusy(true);
    if (fresh) setAuditMarket(market);
    setAuditLabel(fresh ? `正在重掃全部${market === "TW" ? "台股" : "美股"}…` : "讀取掃描紀錄…");
    try {
      if (!fresh) {
        const report = await loadSnapshot(market);
        if (report) {
          if (market === "TW") {
            setAuditTw(report);
            saveCachedAudit(report);
          } else setAuditUs(report);
          setAuditLabel(`${market === "TW" ? "台股" : "美股"}紀錄 ${report.asOf} · ${report.total} 檔`);
          return;
        }
      }
      const report =
        market === "TW"
          ? await auditAllTwse((done, total) => setAuditLabel(`台股 ${done}／${total}`))
          : await auditAllUs((done, total, label) => setAuditLabel(label));
      if (market === "TW") {
        setAuditTw(report);
        saveCachedAudit(report);
      } else setAuditUs(report);
      setAuditLabel(`完成 ${report.asOf} · ${report.total} 檔`);
    } catch (err) {
      setAuditLabel(err instanceof Error ? err.message : "掃描失敗");
    } finally {
      setAuditBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      await runAudit(false, "US");
      void runAudit(false, "TW");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = rows.filter((r) => market === "all" || r.market === market);
  const ok = shown.filter((r) => r.ok);
  const twN = rows.filter((r) => r.market === "TW" && r.ok).length;
  const usN = rows.filter((r) => r.market === "US" && r.ok).length;

  const issueRows = useMemo(() => {
    if (!audit) return [];
    if (auditFilter === "issues") {
      return audit.rows.filter((r) => r.bucket !== "ok");
    }
    if (auditFilter === "loss") {
      return audit.rows.filter((r) => r.reason.includes("虧損"));
    }
    return audit.rows.filter((r) => r.bucket === auditFilter);
  }, [audit, auditFilter]);
  const shownIssues = issueRows.slice(0, 400);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl">全市場紀錄</h2>
            <p className="mt-1 text-sm text-muted">
              台股走證交所；美股走 Nasdaq 全部上市名單再配 Yahoo 倍數。分開記無資料、算不出、錯誤。
            </p>
          </div>
          <Button type="button" variant="ghost" onClick={() => void runAudit(true, auditMarket)} disabled={auditBusy}>
            {auditBusy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                掃描中
              </span>
            ) : (
              "重新掃描全部"
            )}
          </Button>
        </div>
        {auditLabel ? <p className="mt-3 text-sm text-muted">{auditLabel}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {(
            [
              ["US", `美股${auditUs ? ` ${auditUs.total}` : ""}`],
              ["TW", `台股${auditTw ? ` ${auditTw.total}` : ""}`],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              onClick={() => setAuditMarket(id)}
              className={`h-9 rounded-full px-3 ${
                auditMarket === id ? "bg-accent text-accent-fg" : "border border-line text-muted"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
        {audit ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["全部", audit.total],
                ["算得出", audit.ok],
                ["無資料", audit.noData],
                ["算不出", audit.noValue],
                ["錯誤", audit.errors],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg border border-line bg-raised px-3 py-2">
                  <p className="text-[11px] text-muted">{k}</p>
                  <p className="font-mono text-lg tabular-nums">{v}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {(
                [
                  ["issues", "問題與虧損股"],
                  ["no_data", `無資料 ${audit.noData}`],
                  ["no_value", `算不出 ${audit.noValue}`],
                  ["error", `錯誤 ${audit.errors}`],
                  ["loss", "虧損改用淨值比"],
                  ["ok", "全部算得出"],
                ] as const
              ).map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAuditFilter(id)}
                  className={`h-9 rounded-full px-3 ${
                    auditFilter === id ? "bg-accent text-accent-fg" : "border border-line text-muted"
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>
            <div className="mt-3 max-h-80 overflow-auto">
              {issueRows.length === 0 ? (
                <p className="text-sm text-muted">這一欄是空的，沒有需要記的錯誤。</p>
              ) : (
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="pb-2 font-medium">代號</th>
                      <th className="pb-2 font-medium">分類</th>
                      <th className="pb-2 font-medium">市價</th>
                      <th className="pb-2 font-medium">合理價</th>
                      <th className="pb-2 font-medium">原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownIssues.map((row) => (
                      <tr key={row.ticker} className="border-t border-line">
                        <td className="py-2">
                          <button type="button" className="text-left" onClick={() => onOpen(row.ticker)}>
                            <span className="font-mono">{row.ticker.replace(".TW", "")}</span>
                            <span className="ml-2 text-xs text-muted">{row.name}</span>
                          </button>
                        </td>
                        <td className="py-2 text-xs">
                          {row.bucket === "ok"
                            ? "已算出"
                            : row.bucket === "no_data"
                              ? "無資料"
                              : row.bucket === "no_value"
                                ? "算不出"
                                : "錯誤"}
                        </td>
                        <td className="py-2 font-mono tabular-nums">{row.price ? fmtPrice(row.price) : "—"}</td>
                        <td className="py-2 font-mono tabular-nums">
                          {row.blended != null ? fmtPrice(row.blended) : "—"}
                        </td>
                        <td className="py-2 text-xs text-muted">
                          {row.reason}
                          {row.error ? `｜${row.error}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p className="mt-3 text-xs text-muted">
              {issueRows.length > 400 ? `表上只列前 400 檔，這一欄共 ${issueRows.length} 檔。` : null}
              美股清單來自 Nasdaq 全部上市股票；無報價多半是特別股代號。虧損股若有淨值比仍會算出。
            </p>
          </>
        ) : null}
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl">隨機抽樣</h2>
            <p className="mt-1 text-sm text-muted">
              台股 50 檔走證交所；美股 50 檔走 Yahoo。只算輕量模型，點列可開完整計算。
            </p>
          </div>
          <Button type="button" onClick={() => void run()} disabled={running}>
            {running ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                抽樣中
              </span>
            ) : rows.length ? (
              "再抽一次"
            ) : (
              "抽台股 50 + 美股 50"
            )}
          </Button>
        </div>
        {label ? <p className="mt-3 text-sm text-muted">{label}</p> : null}
        {error ? <p className="mt-2 text-sm text-down">{error}</p> : null}
        {rows.length ? (
          <>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {(
                [
                  ["all", `全部 ${ok.length}`],
                  ["TW", `台股 ${twN}`],
                  ["US", `美股 ${usN}`],
                ] as const
              ).map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMarket(id)}
                  className={`h-9 rounded-full px-3 ${
                    market === id ? "bg-accent text-accent-fg" : "border border-line text-muted"
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="pb-2 font-medium">市場</th>
                    <th className="pb-2 font-medium">代號</th>
                    <th className="pb-2 font-medium">市價</th>
                    <th className="pb-2 font-medium">合理價</th>
                    <th className="pb-2 font-medium">魚帶</th>
                    <th className="pb-2 font-medium">安全邊際</th>
                    <th className="pb-2 font-medium">品質</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={`${row.market}-${row.ticker}`} className="border-t border-line">
                      <td className="py-2 text-xs text-muted">{row.market === "TW" ? "台" : "美"}</td>
                      <td className="py-2">
                        <button type="button" className="text-left" onClick={() => onOpen(row.ticker)}>
                          <span className="font-mono">{row.ticker.replace(".TW", "")}</span>
                          <span className="ml-2 text-xs text-muted">{row.name}</span>
                        </button>
                      </td>
                      <td className="py-2 font-mono tabular-nums">{row.ok ? fmtPrice(row.price) : "—"}</td>
                      <td className="py-2 font-mono tabular-nums">
                        {row.blended != null ? fmtPrice(row.blended) : "—"}
                      </td>
                      <td className="py-2 text-xs">{row.zoneLabel}</td>
                      <td
                        className={`py-2 font-mono tabular-nums ${
                          row.upside == null ? "text-muted" : row.upside >= 0 ? "text-up" : "text-down"
                        }`}
                      >
                        {row.upside != null ? fmtPct(row.upside) : "—"}
                      </td>
                      <td className="py-2 text-xs text-muted">
                        {row.ok ? `${row.qualityQ} · ${row.qualityLabel}` : row.error}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
