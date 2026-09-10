/** Liquid-ish US names to sample from. Not a recommendation list. */
export const US_UNIVERSE: string[] = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "BRK-B", "JPM",
  "V", "MA", "UNH", "XOM", "JNJ", "WMT", "PG", "HD", "COST", "LLY",
  "ABBV", "PEP", "KO", "MRK", "ORCL", "BAC", "CSCO", "AMD", "ADBE", "NFLX",
  "CRM", "INTC", "QCOM", "TXN", "AMAT", "IBM", "GE", "CAT", "BA", "DIS",
  "NKE", "SBUX", "MCD", "T", "VZ", "PFE", "ABT", "TMO", "DHR", "CVX",
  "WFC", "GS", "MS", "BLK", "HON", "DE", "UPS", "LOW", "TGT", "AMGN",
  "GILD", "ISRG", "NOW", "PANW", "INTU", "UBER", "SHOP", "PLTR", "SNOW", "CRWD",
  "NET", "DDOG", "ARM", "SMCI", "COIN", "HOOD", "RIVN", "LCID", "RKLB", "IONQ",
  "SATL", "ARBE", "SOUN", "MSTR", "TMUS", "COP", "SLB", "F", "GM", "C",
];

export function shufflePick<T>(items: T[], n: number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, Math.min(n, copy.length));
}
