import { useValuation } from "@/lib/valuation/store";
import { fmtPrice } from "@/lib/utils";

const ZONE_TONE: Record<string, { bar: string; ink: string }> = {
  head: { bar: "bg-zone-head text-fg", ink: "text-fg" },
  lower: { bar: "bg-zone-lower text-fg", ink: "text-fg" },
  body: { bar: "bg-zone-body text-accent-fg", ink: "text-accent-fg" },
  upper: { bar: "bg-zone-upper text-fg", ink: "text-fg" },
  tail: { bar: "bg-zone-tail text-fg", ink: "text-fg" },
};

function pinLeft(p: number, min: number, span: number) {
  return `${((p - min) / span) * 100}%`;
}

export function ZoneBar({ compact = false }: { compact?: boolean }) {
  const { fundamentals: f, result: r } = useValuation();
  const z = r?.zones;
  if (!f || !r || !z) return null;
  const min = Math.min(z.zones[0].low, f.price, z.mid);
  const max = Math.max(z.zones[4].high, f.price, z.mid);
  const span = max - min || 1;
  const priceLeft = pinLeft(f.price, min, span);
  const midLeft = pinLeft(z.mid, min, span);
  const pricePct = ((f.price - min) / span) * 100;
  const midPct = ((z.mid - min) / span) * 100;
  const overlap = Math.abs(pricePct - midPct) < 14;
  return (
    <div>
      <div className={`relative ${compact ? "h-11" : "h-14"}`}>
        <div className="flex h-full overflow-hidden rounded-full border border-line">
          {min < z.zones[0].low ? (
            <div
              className="h-full bg-raised"
              style={{ width: `${((z.zones[0].low - min) / span) * 100}%` }}
            />
          ) : null}
          {z.zones.map((band) => {
            const w = ((band.high - band.low) / span) * 100;
            const on = z.current === band.id;
            const tone = ZONE_TONE[band.id] ?? ZONE_TONE.body;
            return (
              <div
                key={band.id}
                className={`relative flex h-full min-w-0 flex-col items-center justify-center px-1 ${tone.bar} ${
                  on ? "ring-2 ring-inset ring-fg" : ""
                }`}
                style={{ width: `${Math.max(w, 8)}%` }}
                title={`${band.name} ${fmtPrice(band.low)}–${fmtPrice(band.high)} · ${band.action}`}
              >
                <span className={`truncate text-[11px] font-medium leading-none ${tone.ink}`}>
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
          {max > z.zones[4].high ? (
            <div
              className="h-full bg-raised"
              style={{ width: `${((max - z.zones[4].high) / span) * 100}%` }}
            />
          ) : null}
        </div>
        <span
          className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-fg"
          style={{ left: priceLeft }}
        />
        <span
          className="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-accent-fg/70"
          style={{ left: midLeft }}
        />
      </div>
      <div className="relative mt-2 h-8">
        <span
          className="absolute -translate-x-1/2 rounded-full bg-fg px-2 py-0.5 font-mono text-[10px] text-bg"
          style={{ left: priceLeft, top: overlap && pricePct >= midPct ? 14 : 0 }}
        >
          市價 {fmtPrice(f.price)}
        </span>
        <span
          className="absolute -translate-x-1/2 rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[10px] text-muted"
          style={{ left: midLeft, top: overlap && pricePct < midPct ? 14 : 0 }}
        >
          合理核 {fmtPrice(z.mid)}
        </span>
      </div>
      {compact ? (
        <p className="mt-1 text-xs text-muted">
          現價在{z.currentLabel} · {z.currentHint}
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-5 gap-1">
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
