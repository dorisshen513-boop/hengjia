import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtMoney(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  return `${sign}${abs.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

export function fmtPrice(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return "—";
  const v = n * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

export function fmtPctAbs(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtMult(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return "n.m.";
  if (n <= 0) return "n.m.";
  return `${n.toFixed(1)}x`;
}
