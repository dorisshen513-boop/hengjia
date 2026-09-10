export type TerminalMethod = "perpetuity" | "exit";

export type Fundamentals = {
  ticker: string;
  name: string;
  currency: string;
  exchange: string;
  sector: string;
  industry: string;
  price: number;
  sharesOut: number;
  marketCap: number;
  beta: number;
  revenue: number;
  ebit: number;
  ebitda: number;
  netIncome: number;
  bookEquity: number;
  dps: number;
  eps: number;
  fcf: number;
  totalCash: number;
  totalDebt: number;
  netDebt: number;
  nonCoreAssets: number;
  minorityInterest: number;
  revenueGrowth: number | null;
  operatingMargin: number | null;
  dividendYield: number | null;
  trailingPE: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  evToEbitda: number | null;
  source: string;
  asOf: string;
  notes: string[];
};

export type CompanyRegime =
  | "optionality"
  | "preProfit"
  | "lowMargin"
  | "growthProfit"
  | "dividend"
  | "compounder";

export type Assumptions = {
  nYears: number;
  g1: number;
  g2: number;
  gDiv1: number;
  gDiv2: number;
  ebitStart: number;
  ebitTarget: number;
  tax: number;
  daSales: number;
  capexSales: number;
  nwcSales: number;
  payoutHigh: number;
  payoutStable: number;
  terminalMethod: TerminalMethod;
  exitEbitdaMultiple: number;
  rf: number;
  beta: number;
  erp: number;
  specificRisk: number;
  preTaxKd: number;
  we: number;
  wd: number;
  weightGordon: number;
  weightTwoStage: number;
  weightDcf: number;
  weightRelative: number;
  ddmYieldFloor: number;
  ddmYieldFull: number;
  regime: CompanyRegime;
  peBase: number;
  peLow: number;
  peHigh: number;
  pbBase: number;
  pbLow: number;
  pbHigh: number;
  psBase: number;
  psLow: number;
  psHigh: number;
  evEbitdaBase: number;
  evEbitdaLow: number;
  evEbitdaHigh: number;
  pegBase: number;
  fadeGrowth: boolean;
};

export type YearRow = {
  year: number;
  growth: number;
  revenue: number;
  ebitMargin: number;
  ebit: number;
  nopat: number;
  da: number;
  ebitda: number;
  capex: number;
  dnwc: number;
  fcff: number;
  df: number;
  pv: number;
  dividend: number;
  pvDiv: number;
};

export type ValuationResult = {
  ke: number;
  wacc: number;
  gordon: number | null;
  gordonImpliedG: number | null;
  twoStage: number | null;
  twoStageDivPv: number;
  twoStageTvPv: number;
  dcf: number | null;
  dcfEv: number;
  dcfEquity: number;
  dcfExplicitPv: number;
  dcfTvPv: number;
  dcfTvShare: number | null;
  relativeBase: number | null;
  relativeLow: number | null;
  relativeHigh: number | null;
  impliedPe: number | null;
  impliedPb: number | null;
  impliedPs: number | null;
  impliedEvEbitda: number | null;
  blended: number | null;
  upside: number | null;
  status: string;
  years: YearRow[];
  warnings: string[];
  ddmApplicable: boolean;
  dcfFragile: boolean;
  impliedG1: number | null;
  impliedG1Capped: boolean;
  option: OptionCard;
  quality: QualityReport;
  zones: ZoneCard | null;
  revCases: RevenueCase[];
  models: ModelLine[];
};

export type RevenueCase = {
  g: number;
  label: string;
  dcf: number | null;
  rev3: number | null;
};

export type ZoneId = "tail" | "lower" | "body" | "upper" | "head";

export type PriceZone = {
  id: ZoneId;
  name: string;
  action: string;
  hint: string;
  low: number;
  high: number;
};

export type ZoneCard = {
  mid: number;
  current: ZoneId | "below" | "above";
  currentLabel: string;
  currentHint: string;
  zones: PriceZone[];
};

export type ModelLine = {
  id: "gordon" | "twoStage" | "dcf" | "relative";
  label: string;
  price: number | null;
  weight: number;
  used: boolean;
  formula: string;
  calc: string;
};

export type QualityLabel =
  | "survival"
  | "shell"
  | "early"
  | "investable"
  | "quality"
  | "optionality"
  | "thematic";

export type QualityLine = {
  id: string;
  name: string;
  points: number;
  max: number;
  rule: string;
  why: string;
};

export type SurvivalGate = {
  id: string;
  name: string;
  triggered: boolean;
  rule: string;
  value: string;
};

export type QualityReport = {
  q: number;
  label: QualityLabel;
  labelText: string;
  meaning: string;
  allowed: {
    blend: boolean;
    optionExpected: boolean;
    bullDcf: boolean;
    note: string;
  };
  runwayYears: number | null;
  revUsd: number;
  lines: QualityLine[];
  traps: QualityLine[];
  gates: SurvivalGate[];
  bands: { min: number; max: number; name: string; meaning: string }[];
};

export type OptionKind = "optionality" | "junk" | "normal" | "early";

export type OptionFlag = {
  label: string;
  points: number;
  note: string;
};

export type OptionCard = {
  kind: OptionKind;
  score: number;
  flags: OptionFlag[];
  pFail: number;
  pBase: number;
  pBull: number;
  vFail: number | null;
  vBase: number | null;
  vBull: number | null;
  expected: number | null;
  impliedPBull: number | null;
  impliedCapped: boolean;
  verdict: string;
};

export type SensitivityCell = {
  wacc: number;
  g2: number;
  price: number | null;
};
