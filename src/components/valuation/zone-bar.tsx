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
  return Math.min(96, Math.max(4, raw));
}

function hangX(pct: number) {
  if (pct < 18) return "0%";
  if (pct > 82) return "-100%";
  return "-50%";
}

export function ZoneBar({ compact = false }: { compact?: boolean }) {
  const { fundamentals: f, result: r } = useValuation();
  const z = r?.zones;
  if (!f || !r || !z) return null;
  const min = Math.min(z.zones[0].low, f.price, z.mid);
  const max = Math.max(z.zones[4].high, f.price, z.mid);
  const span = max - min || 1;
  const pricePct = pinPct(f.price, min, span);
  const midPct = pinPct(z.mid, min, span);
  const midLabel = r.thinBooks ? "營收地板" : "合理核";
  return (
    <div className="min-w-0">
      <div className="relative pt-10">
        <div
          className="pointer-events-none absolute top-0 z-20"
          style={{ left: `${pricePct}%`, transform: `translateX(${hangX(pricePct)})` }}
        >
          <div className="flex flex-col items-center">
            <span className="whitespace-nowrap rounded-md bg-accent-fg px-2.5 py-1 font-mono text-xs font-medium text-accent">
              市價 {fmtPrice(f.price)}
            </span>
            <span className="-mt-1 size-2 rotate-45 bg-accent-fg" />
          </div>
        </div>

        <div className={`relative overflow-hidden rounded-full border border-line ${compact ? "h-12" : "h-14"}`}>
          <div className="flex h-full min-w-0">
            {z.zones.map((band) => {
              const w = Math.max(((band.high - band.low) / span) * 100, 1);
              const on = z.current === band.id;
              const tone = ZONE_TONE[band.id] ?? ZONE_TONE.body;
              return (
                <div
                  key={band.id}
                  className={`relative flex min-w-0 flex-col items-center justify-center px-0.5 ${tone.bar}`}
                  style={{ flex: `${w} 1 0` }}
                  title={`${band.name} ${fmtPrice(band.low)}–${fmtPrice(band.high)} · ${band.action}`}
                >
                  <span className={`truncate text-xs font-medium leading-none ${tone.ink}`}>
                    {band.name}
                  </span>
                  {!compact ? (
                    <span className={`mt-1 hidden truncate font-mono text-xs leading-none opacity-80 sm:block ${tone.ink}`}>
                      {fmtPrice(band.low)}
                    </span>
                  ) : null}
                  {on ? (
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-accent-fg" />
                  ) : null}
                </div>
              );
            })}
          </div>
          <span
            className="pointer-events-none absolute top-0 z-10 h-full w-1 -translate-x-1/2 bg-accent-fg shadow-[0_0_0_1px_var(--color-bg)]"
            style={{ left: `${pricePct}%` }}
            aria-hidden
          />
          <span
            className="pointer-events-none absolute top-1/2 z-20 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent-fg bg-bg"
            style={{ left: `${midPct}%` }}
            aria-hidden
          />
        </div>
      </div>

      <div className="relative mt-2 h-8">
        <div
          className="absolute z-10"
          style={{ left: `${midPct}%`, transform: `translateX(${hangX(midPct)})` }}
        >
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border-2 border-accent-fg bg-bg px-2.5 py-1 font-mono text-xs font-medium text-fg">
            <span className="size-2.5 shrink-0 rounded-full border-2 border-accent-fg bg-bg" />
            {midLabel} {fmtPrice(z.mid)}
          </span>
        </div>
      </div>

      <p className="mt-1 text-xs text-muted">
        深針＝現價所在　空心圓＝{midLabel}
        {compact ? ` · 現價在${z.currentLabel}` : ""}
      </p>
      {compact ? (
        <p className="mt-1 text-xs text-muted">{z.currentHint}</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-5">
          {z.zones.map((band) => {
            const on = z.current === band.id;
            return (
              <div
                key={band.id}
                className={`rounded-md px-2 py-2 ${on ? "bg-raised" : ""}`}
              >
                <p className="text-xs font-medium">{band.name}</p>
                <p className="font-mono text-xs tabular-nums text-muted">
                  {fmtPrice(band.low)}–{fmtPrice(band.high)}
                </p>
                <p className="mt-1 text-xs text-subtle">{band.action}</p>
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
