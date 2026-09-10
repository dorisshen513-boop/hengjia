import { useValuation } from "@/lib/valuation/store";
import { fmtPrice } from "@/lib/utils";

const ZONE_TONE: Record<string, { bar: string; ink: string }> = {
  head: { bar: "bg-zone-head", ink: "text-zone-ink-dark" },
  lower: { bar: "bg-zone-lower", ink: "text-zone-ink-dark" },
  body: { bar: "bg-zone-body", ink: "text-zone-ink-light" },
  upper: { bar: "bg-zone-upper", ink: "text-zone-ink-light" },
  tail: { bar: "bg-zone-tail", ink: "text-zone-ink-light" },
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

function fmtTick(n: number) {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 100) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function zoneGap(price: number, low: number, high: number) {
  if (price < low) return `差 ${fmtTick(low - price)} 才到`;
  if (price > high) return `已過 ${fmtTick(price - high)}`;
  return `區內 離下沿 ${fmtTick(price - low)} · 離上沿還有 ${fmtTick(high - price)}`;
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
      <div className="relative pt-9">
        <div
          className="pointer-events-none absolute top-0 z-20"
          style={{ left: `${pricePct}%`, transform: `translateX(${hangX(pricePct)})` }}
        >
          <span className="whitespace-nowrap rounded-md bg-zone-ink-dark px-2.5 py-1 font-mono text-xs font-medium text-zone-ink-light">
            市價 {fmtPrice(f.price)}
          </span>
        </div>

        <div className="p-1">
          <div className={`flex min-w-0 ${compact ? "h-14" : "h-16"}`}>
            {z.zones.map((band, i) => {
              const w = Math.max(((band.high - band.low) / span) * 100, 1);
              const on = z.current === band.id;
              const tone = ZONE_TONE[band.id] ?? ZONE_TONE.body;
              const first = i === 0;
              const last = i === z.zones.length - 1;
              const round = first && last
                ? "rounded-full"
                : first
                  ? "rounded-l-full"
                  : last
                    ? "rounded-r-full"
                    : "";
              return (
                <div
                  key={band.id}
                  className={`relative flex min-w-0 flex-col items-stretch justify-center gap-1 px-1.5 ${tone.bar} ${round} ${
                    on ? "z-10 ring-2 ring-fg ring-offset-2 ring-offset-bg" : ""
                  }`}
                  style={{ flex: `${w} 1 0` }}
                  title={`${band.name} ${fmtPrice(band.low)}–${fmtPrice(band.high)} · ${band.action}`}
                >
                  <span className={`truncate text-center text-xs font-medium leading-none ${tone.ink}`}>
                    {band.name}
                  </span>
                  <span className={`flex justify-between gap-0.5 font-mono text-xs tabular-nums leading-none ${tone.ink}`}>
                    <span className="min-w-0 truncate">{fmtTick(band.low)}</span>
                    <span className="min-w-0 truncate text-right">{fmtTick(band.high)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative mt-2 h-8">
        <div
          className="absolute z-10"
          style={{ left: `${midPct}%`, transform: `translateX(${hangX(midPct)})` }}
        >
          <span className="whitespace-nowrap rounded-md border border-fg bg-surface px-2.5 py-1 font-mono text-xs font-medium text-fg">
            {midLabel} {fmtPrice(z.mid)}
          </span>
        </div>
      </div>

      <p className="mt-1 text-xs text-muted">
        每區左右是上下沿。市價 {fmtPrice(f.price)}
        {compact ? ` · 現價在${z.currentLabel}` : ""}。
      </p>
      {compact ? <p className="mt-1 text-xs text-muted">{z.currentHint}</p> : null}

      <div className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-5">
        {z.zones.map((band) => {
          const on = z.current === band.id;
          const tone = ZONE_TONE[band.id] ?? ZONE_TONE.body;
          return (
            <div
              key={band.id}
              className={`rounded-md px-2 py-2 ${on ? "bg-raised" : ""}`}
            >
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <span className={`inline-block size-2.5 rounded-sm ${tone.bar}`} />
                {band.name}
              </p>
              <p className="font-mono text-xs tabular-nums text-muted">
                {fmtPrice(band.low)} – {fmtPrice(band.high)}
              </p>
              <p className="mt-1 text-xs text-subtle">{zoneGap(f.price, band.low, band.high)}</p>
            </div>
          );
        })}
      </div>
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
