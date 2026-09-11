import { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clearHistory,
  listHistory,
  removeHistory,
  subscribeHistory,
  touchHistory,
  type HistoryRow,
} from "@/lib/valuation/history";
import { fmtPct, fmtPrice } from "@/lib/utils";

export function HistoryButton({
  onRerun,
  onRestore,
}: {
  onRerun: (ticker: string) => void;
  onRestore: (row: HistoryRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  useEffect(() => {
    setRows(listHistory());
    return subscribeHistory(() => setRows(listHistory()));
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm text-muted hover:bg-raised hover:text-fg"
      >
        <History className="size-4" />
        歷史
        {rows.length ? (
          <span className="rounded-full bg-raised px-2 py-0.5 text-xs text-fg">{rows.length}</span>
        ) : null}
      </button>
      {open ? (
        <HistoryPanel
          rows={rows}
          onClose={() => setOpen(false)}
          onRerun={(ticker) => {
            setOpen(false);
            onRerun(ticker);
          }}
          onRestore={(row) => {
            setOpen(false);
            onRestore(row);
          }}
        />
      ) : null}
    </>
  );
}

export function HistoryStrip({
  current,
  onRestore,
}: {
  current: string;
  onRestore: (row: HistoryRow) => void;
}) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  useEffect(() => {
    setRows(listHistory());
    return subscribeHistory(() => setRows(listHistory()));
  }, []);
  const shown = rows.slice(0, 12);
  if (!shown.length) {
    return (
      <p className="text-xs text-muted">
        還沒有紀錄。
      </p>
    );
  }
  const cur = current.trim().toUpperCase();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-subtle">紀錄</span>
      {shown.map((row) => {
        const on = row.ticker === cur;
        return (
          <button
            key={row.id}
            type="button"
            title={`${row.name} · ${row.at.replace("T", " ").slice(0, 16)}`}
            className={`h-9 rounded-full border px-3 text-xs ${
              on
                ? "border-accent bg-accent text-accent-fg"
                : "border-line text-muted hover:bg-raised hover:text-fg"
            }`}
            onClick={() => {
              touchHistory(row.ticker);
              onRestore(row);
            }}
          >
            {row.ticker}
            <span className={on ? "ml-1.5 opacity-80" : "ml-1.5 text-subtle"}>
              {fmtPrice(row.blended, 0)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HistoryPanel({
  rows,
  onClose,
  onRerun,
  onRestore,
}: {
  rows: HistoryRow[];
  onClose: () => void;
  onRerun: (ticker: string) => void;
  onRestore: (row: HistoryRow) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-bg/70">
      <button type="button" className="flex-1" aria-label="關閉歷史" onClick={onClose} />
      <aside className="flex h-full w-full max-w-md flex-col border-l border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <p className="text-xs tracking-wide text-muted">HISTORY</p>
            <h2 className="font-display text-xl">計算紀錄</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-10 items-center justify-center rounded-full hover:bg-raised"
            aria-label="關閉"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="px-4 pt-3 text-xs text-muted">
          同一檔只留最近一次。點開會重新上網抓最新財報與新聞，不會用上次測算結果。
        </p>
        <div className="flex justify-end px-4 py-2">
          <Button type="button" variant="quiet" size="md" onClick={clearHistory} disabled={!rows.length}>
            清空
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {rows.length === 0 ? (
            <p className="text-sm text-muted">還沒有紀錄。</p>
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => (
                <li key={row.id} className="rounded-lg border border-line bg-raised p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm text-fg">{row.ticker}</p>
                      <p className="text-xs text-muted">{row.name}</p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-fg"
                      onClick={() => removeHistory(row.id)}
                    >
                      刪
                    </button>
                  </div>
                  <p className="mt-2 font-mono text-xs tabular-nums text-muted">
                    市價 {fmtPrice(row.price)} · 財報價 {fmtPrice(row.blended)} {row.currency}
                    {row.upside != null ? ` · ${fmtPct(row.upside)}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Q {row.qualityQ} · {row.qualityLabel} · {row.at.replace("T", " ").slice(0, 16)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="h-9 rounded-full border border-line px-3 text-xs hover:bg-surface"
                      onClick={() => onRerun(row.ticker)}
                    >
                      重新計算
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
