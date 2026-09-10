import { useValuation } from "@/lib/valuation/store";
import { fmtPrice } from "@/lib/utils";

const ZONE_TONE: Record<string, { bar: string; ink: string }> = {
  head: { bar: "bg-zone-head text-fg", ink: "text-fg" },
  lower: { bar: "bg-zone-lower text-fg", ink: "text-fg" },
  body: { bar: "bg-zone-body text-accent-fg", ink: "text-accent-fg" },
  upper: { bar: "bg-zone-upper text-fg", ink: "text-fg" },
  tail: { bar: "bg-zone-tail text-fg", ink: "text-fg" },
};

function pinPct(p: number, min: number, span: number) {
  const raw = ((p - min) / span) * 100;
  return Math.min(92, Math.max(8, raw));
}

export function ZoneBar({ compact = false }: { compact?: boolean }) {
  const { fundamentals: f, result: r } = useValuation();
  const z = r?.zones;
  if (!f || !r || !z) return null;
  const min = Math.min(z.zones[0].low, f.price, z.mid);
  const max = Math.max(z.zones[4].high, f.price, z.mid);
  const span = max - min || 1;
  return (
    <div className="min-w-0">
      <div className={`relative ${compact ? "h-11" : "h-14"}`}>
        <div className="flex h-full min-w-0 overflow-hidden rounded-full border border-line">
          {z.zones.map((band) => {
            const w = Math.max(((band.high - band.low) / span) * 100, 1);
            const on = z.current === band.id;
            const tone = ZONE_TONE[band.id] ?? ZONE_TONE.body;
            return (
              <div
                key={band.id}
                className={`relative flex min-w-0 flex-col items-center justify-center px-0.5 ${tone.bar} ${
                  on ? "ring-2 ring-inset ring-fg" : ""
                }`}
                style={{ flex: `${w} 1 0` }}
                title={`${band.name} ${fmtPrice(band.low)}–${fmtPrice(band.high)} · ${band.action}`}
              >
                <span className={`truncate text-[10px] font-medium leading-none sm:text-[11px] ${tone.ink}`}>
                  {band.name}
                </span>
                {!compact ? (
                  <span className={`mt-1 hidden truncate font-mono text-[10px] leading-none opacity-80 sm:block ${tone.ink}`}>
                    {fmtPrice(band.low)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <span
          className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-fg"
          style={{ left: `${pinPct(f.price, min, span)}%` }}
        />
        <span
          className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-accent-fg/70"
          style={{ left: `${pinPct(z.mid, min, span)}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="rounded-full bg-fg px-2 py-0.5 font-mono text-[10px] text-bg">
          市價 {fmtPrice(f.price)}
        </span>
        <span className="rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[10px] text-muted">
          {r.thinBooks ? "營收地板" : "合理核"} {fmtPrice(z.mid)}
        </span>
      </div>
      {compact ? (
        <p className="mt-1 text-xs text-muted">
          現價在{z.currentLabel} · {z.currentHint}
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-5">
          {z.zones.map((band) => {
            const on = z.current === band.id;
            return (
              <div
                key={band.id}
                className={`rounded-md px-2 py-2 ${on ? "bg-raised" : ""}`}
              >
                <p className="text-[11px] font-medium">{band.name}</p>
                <p className="font-mono text-[10px] tabular-nums text-muted">
                  {fmtPrice(band.low)}–{fmtPrice(band.high)}
                </p>
                <p className="mt-1 text-[10px] text-subtle">{band.action}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ZoneBoard() {
  const { fundamentals: f, result: r } = useValuation();
  const z = r?.zones;
  if (!f || !r || !z) return null;
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-xl">魚帶 · {z.currentLabel}</h3>
          <p className="mt-1 text-sm text-muted">{z.currentHint}</p>
        </div>
        <p className="font-mono text-sm tabular-nums text-muted">
          {f.currency} · 市價 {fmtPrice(f.price)}
        </p>
      </div>
      <div className="mt-5">
        <ZoneBar />
      </div>
    </div>
  );
}
