import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";

export function NumberField({
  label,
  value,
  onChange,
  step = 0.01,
  suffix,
  pct = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  suffix?: string;
  pct?: boolean;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="relative">
        <Input
          type="number"
          step={step}
          value={pct ? Number((value * 100).toFixed(3)) : value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(pct ? n / 100 : n);
          }}
          className="pr-10 font-mono tabular-nums"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-subtle">
          {suffix ?? (pct ? "%" : "")}
        </span>
      </div>
    </label>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "up" | "down";
}) {
  const color =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-fg";
  return (
    <div className="rounded-lg bg-raised p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl tabular-nums tracking-tight ${color}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

export function MethodNote({
  title,
  formula,
  children,
}: {
  title: string;
  formula: string;
  children: ReactNode;
}) {
  return (
    <aside className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">
        怎麼算
      </p>
      <h3 className="mt-1 font-display text-lg text-fg">{title}</h3>
      <p className="mt-2 font-mono text-xs leading-relaxed text-accent">{formula}</p>
      <div className="mt-3 space-y-2 text-sm text-muted">{children}</div>
    </aside>
  );
}
