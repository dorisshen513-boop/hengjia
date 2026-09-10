import type { Assumptions } from "./types";

export type NewsScope = "company" | "parent" | "industry";

export type NewsItem = {
  title: string;
  source: string;
  url: string;
  published: string;
  scope: NewsScope;
  sentiment: "pos" | "neg" | "neu";
  tags: string[];
};

export type AssumptionShift = {
  field: string;
  label: string;
  from: string;
  to: string;
  reason: string;
};

export type RiskFlag = {
  code: string;
  label: string;
  severity: "medium" | "high" | "severe";
  evidence: string;
};

export type NewsBrief = {
  parentName: string;
  items: NewsItem[];
  riskScore: number;
  level: "低" | "中" | "偏高" | "嚴重";
  bias: "正面" | "中性" | "負面" | "嚴重負面";
  flags: RiskFlag[];
  shifts: AssumptionShift[];
  controls: string[];
  summary: string;
  aiNote: string | null;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const NEG: Array<{ re: RegExp; w: number; tag: string; flag?: RiskFlag["code"] }> = [
  { re: /bankrupt|insolv|going concern|default|違約|破產|重整|下市|delist/i, w: 28, tag: "存續", flag: "going-concern" },
  { re: /fraud|restatement|sec charg|indict|調查|詐欺|掏空|作假|虛報/i, w: 26, tag: "誠信", flag: "integrity" },
  { re: /dilut|offering|secondary|atm offering|warrant|增資|私募|可轉債|現金增資/i, w: 16, tag: "稀釋", flag: "dilution" },
  { re: /downgrade|cut guidance|misses|missed|profit warning|下修|不及預期|調降評等/i, w: 14, tag: "展望", flag: "guidance" },
  { re: /layoff|job cut|restructuring|裁員|減薪/i, w: 10, tag: "營運", flag: "ops" },
  { re: /lawsuit|litigation|probe|fine|penalty|訴訟|罰款|遭罰/i, w: 12, tag: "法律", flag: "legal" },
  { re: /hack|cyber|breach|資安|外洩/i, w: 11, tag: "資安", flag: "cyber" },
  { re: /tariff|sanction|export ban|關稅|制裁|禁令/i, w: 10, tag: "政策", flag: "policy" },
  { re: /ceo resign|steps down|突然請辭|閃辭/i, w: 9, tag: "治理", flag: "governance" },
  { re: /liquidity|cash burn|going concern|資金鏈|周轉/i, w: 15, tag: "流動性", flag: "liquidity" },
];

const POS: Array<{ re: RegExp; w: number; tag: string }> = [
  { re: /beat|raises guidance|upgrade|record (?:revenue|profit)|超預期|調升|創高|大單/i, w: 10, tag: "超預期" },
  { re: /contract win|award|partnership|order|得標|簽約|長約/i, w: 8, tag: "訂單" },
  { re: /buyback|dividend hike|庫藏股|提高股利/i, w: 7, tag: "資本回饋" },
];

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function classify(title: string): { sentiment: NewsItem["sentiment"]; tags: string[]; score: number; flags: string[] } {
  let score = 0;
  const tags: string[] = [];
  const flags: string[] = [];
  for (const n of NEG) {
    if (n.re.test(title)) {
      score += n.w;
      tags.push(n.tag);
      if (n.flag) flags.push(n.flag);
    }
  }
  for (const p of POS) {
    if (p.re.test(title)) {
      score -= p.w;
      tags.push(p.tag);
    }
  }
  const sentiment = score >= 8 ? "neg" : score <= -6 ? "pos" : "neu";
  return { sentiment, tags: Array.from(new Set(tags)), score, flags };
}

async function fetchText(url: string, timeout = 9000): Promise<string> {
  const res = await fetch(url, {
    credentials: "omit",
    cache: "no-store",
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/json, text/xml, */*" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

function parseRss(xml: string, scope: NewsScope, limit: number): NewsItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const out: NewsItem[] = [];
  for (const block of blocks) {
    const title = decode((block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/ - [^-]+$/, ""));
    const link = decode(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "");
    const pub = decode(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "");
    const src =
      decode(block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] ?? "") ||
      "Google News";
    if (!title) continue;
    const c = classify(title);
    out.push({
      title,
      source: src,
      url: link.startsWith("http") ? link : "",
      published: pub ? new Date(pub).toISOString().slice(0, 10) : "",
      scope,
      sentiment: c.sentiment,
      tags: c.tags,
    });
    if (out.length >= limit) break;
  }
  return out;
}

type YahooNews = {
  title?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: number;
};

async function yahooNews(query: string, scope: NewsScope, limit: number): Promise<NewsItem[]> {
  try {
    const data = JSON.parse(
      await fetchText(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=${limit}&quotesCount=0`,
      ),
    ) as { news?: YahooNews[] };
    return (data.news ?? []).slice(0, limit).map((n) => {
      const title = n.title ?? "";
      const c = classify(title);
      return {
        title,
        source: n.publisher ?? "Yahoo",
        url: n.link ?? "",
        published: n.providerPublishTime
          ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10)
          : "",
        scope,
        sentiment: c.sentiment,
        tags: c.tags,
      };
    });
  } catch {
    return [];
  }
}

async function googleNews(query: string, scope: NewsScope, limit: number, tw: boolean): Promise<NewsItem[]> {
  if (typeof window !== "undefined") return [];
  const loc = tw
    ? "hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
    : "hl=en-US&gl=US&ceid=US:en";
  try {
    const xml = await fetchText(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${loc}`,
      3500,
    );
    return parseRss(xml, scope, limit);
  } catch {
    return [];
  }
}

function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

const FLAG_LABEL: Record<string, { label: string; severity: RiskFlag["severity"] }> = {
  "going-concern": { label: "存續／違約風險", severity: "severe" },
  integrity: { label: "誠信或重編風險", severity: "severe" },
  dilution: { label: "股權稀釋", severity: "high" },
  guidance: { label: "展望下修", severity: "high" },
  liquidity: { label: "流動性壓力", severity: "high" },
  legal: { label: "訴訟或監管", severity: "medium" },
  cyber: { label: "資安事件", severity: "medium" },
  policy: { label: "政策／貿易衝擊", severity: "medium" },
  ops: { label: "營運重整", severity: "medium" },
  governance: { label: "治理異動", severity: "medium" },
};

export function applyNewsToAssumptions(
  base: Assumptions,
  items: NewsItem[],
  opts?: { parentName?: string; aiNote?: string | null },
): { assumptions: Assumptions; bear: Assumptions; brief: NewsBrief } {
  const weight: Record<NewsScope, number> = { company: 1, parent: 0.55, industry: 0.32 };
  let raw = 0;
  let wsum = 0;
  const flagHits = new Map<string, string>();
  for (const it of items) {
    const c = classify(it.title);
    const w = weight[it.scope];
    raw += c.score * w;
    wsum += w;
    for (const f of c.flags) {
      if (!flagHits.has(f)) flagHits.set(f, it.title);
    }
  }
  const avg = wsum ? raw / Math.max(4, wsum) : 0;
  const riskScore = Math.max(0, Math.min(100, Math.round(36 + avg * 1.8)));
  const level: NewsBrief["level"] =
    riskScore >= 78 ? "嚴重" : riskScore >= 58 ? "偏高" : riskScore >= 42 ? "中" : "低";
  const bias: NewsBrief["bias"] =
    riskScore >= 78 ? "嚴重負面" : riskScore >= 55 ? "負面" : riskScore <= 28 ? "正面" : "中性";

  const flags: RiskFlag[] = [...flagHits.entries()].map(([code, evidence]) => ({
    code,
    label: FLAG_LABEL[code]?.label ?? code,
    severity: FLAG_LABEL[code]?.severity ?? "medium",
    evidence,
  }));

  const down = Math.max(0, (riskScore - 40) / 60);
  const up = Math.max(0, (32 - riskScore) / 32);

  const next: Assumptions = { ...base };
  const shifts: AssumptionShift[] = [];

  const push = (field: keyof Assumptions, label: string, to: number, reason: string, pct = true) => {
    const from = base[field] as number;
    if (Math.abs(from - to) < 1e-6) return;
    (next[field] as number) = to;
    shifts.push({
      field,
      label,
      from: pct ? fmtPct(from) : from.toFixed(1),
      to: pct ? fmtPct(to) : to.toFixed(1),
      reason,
    });
  };

  if (down > 0) {
    push("g1", "近期末成長 g1", Math.max(0.01, base.g1 * (1 - 0.38 * down)), "負面新聞下修營收路徑");
    push(
      "ebitTarget",
      "目標 EBIT 率",
      Math.max(base.ebitStart, base.ebitTarget - 0.04 * down),
      "利潤復原較慢",
    );
    push("specificRisk", "特定風險加碼", Math.min(0.09, base.specificRisk + 0.045 * down), "事件風險未反映在 β");
    push(
      "exitEbitdaMultiple",
      "離場 EV/EBITDA",
      Math.max(4, base.exitEbitdaMultiple * (1 - 0.22 * down)),
      "買家願付倍數下降",
      false,
    );
    push("psBase", "基準 P/S", Math.max(0.4, base.psBase * (1 - 0.18 * down)), "同業情緒轉弱", false);
    if (down > 0.45) {
      push("weightDcf", "DCF 權重", Math.max(0.15, base.weightDcf * 0.75), "現金流路徑更不穩", true);
      push(
        "weightRelative",
        "相對估值權重",
        Math.min(0.8, base.weightRelative + 0.1),
        "改以市場倍數當錨",
        true,
      );
    }
  } else if (up > 0.25) {
    push("g1", "近期末成長 g1", Math.min(0.5, base.g1 * (1 + 0.12 * up)), "正面新聞小幅上修，避免一次加太多");
    push(
      "ebitTarget",
      "目標 EBIT 率",
      Math.min(0.4, base.ebitTarget + 0.015 * up),
      "執行力／訂單改善",
    );
  }

  const bear: Assumptions = { ...next };
  bear.g1 = Math.max(0.005, next.g1 * 0.72);
  bear.ebitTarget = Math.max(next.ebitStart - 0.02, next.ebitTarget - 0.03);
  bear.specificRisk = Math.min(0.1, next.specificRisk + 0.02);
  bear.exitEbitdaMultiple = Math.max(4, next.exitEbitdaMultiple * 0.85);
  bear.psBase = Math.max(0.3, next.psBase * 0.85);

  const controls: string[] = [];
  if (level === "低") {
    controls.push("維持原部位計畫即可，仍以財報驅動假設為主。");
    controls.push("產業新聞若與公司訂單無關，不要改 g1。");
  } else {
    controls.push("新聞只改驅動因子（成長、利潤、折現、倍數），不另設「新聞權重 20%」。");
  }
  if (level === "中" || level === "偏高" || level === "嚴重") {
    controls.push("新資金分批進場；加碼前等待下一份季報或法說驗證。");
    controls.push("把上修後的 Ke／WACC 當成最低要求報酬，報酬覆蓋不了就不要加碼。");
  }
  if (flags.some((f) => f.code === "dilution")) {
    controls.push("假設流通股還會增加。合理價應再除以更大股數，或把目前每股再打七至八折交叉檢查。");
  }
  if (flags.some((f) => f.code === "liquidity" || f.code === "going-concern")) {
    controls.push("先算現金跑道（現金／季燒錢），跑道短於四季視為生存問題，不是估值問題。");
    controls.push("部位上限改為「可承受歸零」的金額，停止用融資或選擇權放大。");
  }
  if (flags.some((f) => f.code === "integrity" || f.code === "legal")) {
    controls.push("在官方澄清或監管文件前，不要用樂觀終端倍數。");
  }
  if (level === "偏高") {
    controls.push("建議將計畫部位縮至原先的四至六成，並以新聞調整後的合理價當上限，而不是市價反彈。");
  }
  if (level === "嚴重") {
    controls.push("暫停加碼。已有部位改為風險預算管理：能接受全損才留，否則減至象徵部位。");
    controls.push("優先看現金、債務到期與會計意見，而不是成長故事。");
  }

  const nNeg = items.filter((i) => i.sentiment === "neg").length;
  const nPos = items.filter((i) => i.sentiment === "pos").length;
  const summary =
    items.length === 0
      ? "未能抓到足夠新聞，估值維持財報假設，未做事件調整。"
      : `共 ${items.length} 則（公司／母公司／產業）。負面 ${nNeg}、正面 ${nPos}。風險分數 ${riskScore}（${level}）。` +
        (shifts.length
          ? `已改 ${shifts.length} 項驅動假設，加權合理價會隨之下修或上修。`
          : "頭條偏中性，未改驅動假設。");

  return {
    assumptions: next,
    bear,
    brief: {
      parentName: opts?.parentName ?? "",
      items,
      riskScore,
      level,
      bias,
      flags,
      shifts,
      controls,
      summary,
      aiNote: opts?.aiNote ?? null,
    },
  };
}

async function optionalAiNote(headlines: string[]): Promise<string | null> {
  if (typeof window !== "undefined") return null;
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey || headlines.length === 0) return null;
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              "用繁體中文、最多四句。根據標題判斷對估值的影響（成長、利潤、稀釋、流動性）。不要給買賣指令。若看不出母公司就不要編造。",
          },
          {
            role: "user",
            content: headlines.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join("\n"),
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export async function gatherNews(input: {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
}): Promise<{ items: NewsItem[]; parentName: string; aiNote: string | null }> {
  const tw = /\.TW$|\.TWO$/i.test(input.ticker);
  const name = input.name || input.ticker;
  const industry = input.industry || input.sector || "stocks";
  const parentQ = tw
    ? `${name} 母公司 OR 控股`
    : `"${name}" (parent company OR controlling shareholder)`;
  const industryQ = tw
    ? `${input.industry || input.sector} 產業 前景`
    : `${industry} industry outlook stocks`;

  const [coY, coG, parG, indG] = await Promise.all([
    typeof window === "undefined" ? yahooNews(input.ticker, "company", 8) : Promise.resolve([] as NewsItem[]),
    googleNews(`${name} ${input.ticker}`, "company", 6, tw),
    googleNews(parentQ, "parent", 5, tw),
    googleNews(industryQ, "industry", 6, tw),
  ]);

  const items = dedupe([...coY, ...coG, ...parG, ...indG]).slice(0, 22);
  const parentName =
    parG.find((x) => /母公司|parent|holding|控股/i.test(x.title))?.title.match(
      /([\u4e00-\u9fa5A-Za-z0-9&.\- ]{2,40})/,
    )?.[1] ?? "";
  const aiNote = await optionalAiNote(items.map((i) => `[${i.scope}] ${i.title}`));
  return { items, parentName, aiNote };
}
