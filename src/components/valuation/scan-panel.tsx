import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runRandomScan, type ScanRow } from "@/lib/valuation/scan";
import { fmtPct, fmtPrice } from "@/lib/utils";

export function ScanPanel({ onOpen }: { onOpen: (ticker: string) => void }) {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [running, setRunning] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<"all" | "TW" | "US">("all");

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

  useEffect(() => {
    void run();
    // first paint: auto-sample 50+50
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = rows.filter((r) => market === "all" || r.market === market);
  const ok = shown.filter((r) => r.ok);
  const twN = rows.filter((r) => r.market === "TW" && r.ok).length;
  const usN = rows.filter((r) => r.market === "US" && r.ok).length;

  return (
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
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => onOpen(row.ticker)}
                      >
                        <span className="font-mono">{row.ticker.replace(".TW", "")}</span>
                        <span className="ml-2 text-xs text-muted">{row.name}</span>
                      </button>
                    </td>
                    <td className="py-2 font-mono tabular-nums">
                      {row.ok ? fmtPrice(row.price) : "—"}
                    </td>
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
  );
}
