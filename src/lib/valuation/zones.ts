import type { Fundamentals, PriceZone, ValuationResult, ZoneCard, ZoneId } from "./types";

function pos(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n > 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const META: Record<ZoneId, { name: string; action: string; hint: string }> = {
  head: {
    name: "魚頭",
    action: "深折價",
    hint: "壓力價或清算附近。品質過關才分批，不是因為便宜就買。",
  },
  lower: {
    name: "入肚",
    action: "偏保守",
    hint: "低於合理核、仍在模型下沿。偏便宜的合理帶，可理解為分批區。",
  },
  body: {
    name: "魚肚",
    action: "合理核",
    hint: "以財報加權為中軸的大概合理區間，不是精確到分。",
  },
  upper: {
    name: "近尾",
    action: "偏貴",
    hint: "高於合理核、還沒出樂觀上沿。不宜追價，已持有可收緊。",
  },
  tail: {
    name: "魚尾",
    action: "溢價",
    hint: "相對樂觀或選擇權上沿。現價在這裡是在付期待。",
  },
};

export function buildZones(
  f: Fundamentals,
  r: ValuationResult,
  bearBlended: number | null,
): ZoneCard | null {
  const mid = r.blended;
  if (!pos(mid)) return null;

  const fail = r.option.vFail;
  const candidatesLow = [
    bearBlended,
    pos(fail) ? fail * 1.1 : null,
    r.relativeLow,
    pos(r.dcf) && r.dcf < mid ? r.dcf : null,
    mid * 0.78,
  ].filter(pos);
  const rawLow = Math.min(...candidatesLow);
  const low = clamp(rawLow, mid * 0.55, mid * 0.9);

  const bull =
    r.quality.allowed.optionExpected && pos(r.option.vBull) ? r.option.vBull : null;
  const candidatesHigh = [
    r.relativeHigh,
    bull,
    pos(r.dcf) && r.dcf > mid ? r.dcf : null,
    mid * 1.22,
  ].filter(pos);
  const rawHigh = Math.max(...candidatesHigh);
  const high = clamp(rawHigh, mid * 1.1, mid * 2.2);

  let bodyLo = mid * 0.93;
  let bodyHi = mid * 1.07;
  if (bodyLo <= low) bodyLo = low + (mid - low) * 0.45;
  if (bodyHi >= high) bodyHi = mid + (high - mid) * 0.4;
  if (bodyLo >= bodyHi) {
    bodyLo = mid * 0.96;
    bodyHi = mid * 1.04;
  }

  const midLower = (low + bodyLo) / 2;
  const midUpper = (bodyHi + high) / 2;

  const edges = [low, midLower, bodyLo, bodyHi, midUpper, high];
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] <= edges[i - 1]) edges[i] = edges[i - 1] * 1.015;
  }

  const ids: ZoneId[] = ["head", "lower", "body", "upper", "tail"];
  const zones: PriceZone[] = ids.map((id, i) => ({
    id,
    name: META[id].name,
    action: META[id].action,
    hint: META[id].hint,
    low: edges[i],
    high: edges[i + 1],
  }));

  const px = f.price;
  let current: ZoneCard["current"] = "body";
  if (!pos(px)) {
    current = "body";
  } else if (px < zones[0].low) {
    current = "below";
  } else if (px >= zones[4].high) {
    current = "above";
  } else {
    const hit = zones.find((z) => px >= z.low && px < z.high) ?? zones[4];
    current = hit.id;
  }

  const currentLabel =
    current === "below" ? "魚頭之下" : current === "above" ? "魚尾之上" : META[current].name;
  const currentHint =
    current === "below"
      ? "比魚頭還低，先核對品質與是否接近清算。"
      : current === "above"
        ? "比魚尾上沿還高，溢價超出模型樂觀端。"
        : META[current].hint;

  return { mid, current, currentLabel, currentHint, zones };
}
