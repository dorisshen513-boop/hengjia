import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRegime,
  justifiedPb,
  rimDistorted,
  rimUsable,
  suggestAssumptions,
  trailingRoe,
  valueStock,
} from "./engine.ts";
import type { Fundamentals } from "./types.ts";

function base(over: Partial<Fundamentals>): Fundamentals {
  return {
    ticker: over.ticker ?? "TEST",
    name: over.ticker ?? "TEST",
    currency: "USD",
    exchange: "",
    sector: "",
    industry: "",
    price: 0,
    sharesOut: 0,
    marketCap: 0,
    beta: 1,
    revenue: 0,
    ebit: 0,
    ebitda: 0,
    netIncome: 0,
    bookEquity: 0,
    dps: 0,
    eps: 0,
    fcf: 0,
    totalCash: 0,
    totalDebt: 0,
    netDebt: 0,
    nonCoreAssets: 0,
    minorityInterest: 0,
    revenueGrowth: null,
    operatingMargin: null,
    dividendYield: null,
    trailingPE: null,
    priceToBook: null,
    priceToSales: null,
    evToEbitda: null,
    source: "",
    asOf: "2026-01-01",
    notes: [],
    ...over,
  };
}

describe("RIM / ROE", () => {
  it("TWSE-lite ROE comes from P/B ÷ P/E", () => {
    const f = base({
      price: 100,
      trailingPE: 20,
      priceToBook: 5,
      eps: 5,
    });
    assert.equal(trailingRoe(f)?.toFixed(2), "0.25");
  });

  it("high ROE + modest yield is compounder, not dividend", () => {
    const f = base({
      price: 100,
      sharesOut: 1e9,
      marketCap: 1e11,
      revenue: 2e10,
      ebit: 5e9,
      ebitda: 6e9,
      netIncome: 4e9,
      bookEquity: 2e10,
      eps: 4,
      dps: 3,
      operatingMargin: 0.25,
      revenueGrowth: 0.08,
      dividendYield: 0.03,
    });
    assert.equal(classifyRegime(f), "compounder");
  });

  it("high yield without high ROE stays dividend", () => {
    const f = base({
      price: 100,
      sharesOut: 1e9,
      marketCap: 1e11,
      revenue: 2e10,
      ebit: 2e9,
      ebitda: 3e9,
      netIncome: 1.2e9,
      bookEquity: 2e10,
      eps: 1.2,
      dps: 5,
      operatingMargin: 0.1,
      revenueGrowth: 0.02,
      dividendYield: 0.05,
    });
    assert.equal(classifyRegime(f), "dividend");
  });

  it("unprofitable high P/S scale is optionality; RIM does not vote", () => {
    const f = base({
      price: 50,
      sharesOut: 2e9,
      marketCap: 1e11,
      revenue: 6e9,
      ebit: -1e9,
      ebitda: -2e8,
      netIncome: -8e8,
      bookEquity: 4e9,
      eps: -0.4,
      dps: 0,
      operatingMargin: -0.16,
      revenueGrowth: 0.35,
      priceToSales: 16,
    });
    assert.equal(classifyRegime(f), "optionality");
    const a = suggestAssumptions(f, 0.043);
    assert.equal(a.weightRim, 0);
    const r = valueStock(f, a, { lite: true });
    assert.equal(r.rim, null);
    const rimLine = r.models.find((m) => m.id === "rim");
    assert.equal(rimLine?.used, false);
    assert.equal(rimLine?.weight, 0);
  });

  it("pre-profit keeps RIM at 0", () => {
    const f = base({
      price: 8,
      sharesOut: 1e8,
      marketCap: 8e8,
      revenue: 1.2e8,
      ebit: -4e7,
      ebitda: -3e7,
      netIncome: -5e7,
      bookEquity: 9e7,
      eps: -0.5,
      operatingMargin: -0.33,
      revenueGrowth: 0.1,
      totalCash: 6e7,
    });
    assert.equal(classifyRegime(f), "preProfit");
    const a = suggestAssumptions(f, 0.043);
    assert.equal(a.weightRim, 0);
    assert.equal(valueStock(f, a, { lite: true }).rim, null);
  });

  it("buyback-thin book marks ROE distorted and drops RIM", () => {
    const f = base({
      price: 200,
      sharesOut: 1e9,
      marketCap: 2e11,
      revenue: 4e10,
      ebit: 1.2e10,
      ebitda: 1.4e10,
      netIncome: 1e10,
      bookEquity: 4e9,
      eps: 10,
      dps: 1,
      operatingMargin: 0.3,
      revenueGrowth: 0.06,
    });
    const roe = trailingRoe(f);
    assert.ok(roe != null && roe > 0.8);
    assert.equal(rimDistorted(f, roe), true);
    assert.equal(rimUsable(f, "compounder", roe), false);
    const a = suggestAssumptions(f, 0.043);
    const r = valueStock(f, a, { lite: true });
    assert.equal(r.rim, null);
    assert.equal(r.rimDistorted, true);
  });

  it("healthy compounder: RIM votes and prices above book when ROE > Ke", () => {
    const f = base({
      price: 80,
      sharesOut: 1e9,
      marketCap: 8e10,
      revenue: 3e10,
      ebit: 6e9,
      ebitda: 8e9,
      netIncome: 5e9,
      bookEquity: 2.5e10,
      eps: 5,
      dps: 0.8,
      fcf: 4e9,
      operatingMargin: 0.2,
      revenueGrowth: 0.07,
      trailingPE: 16,
      priceToBook: 3.2,
      priceToSales: 2.7,
    });
    assert.equal(classifyRegime(f), "compounder");
    const a = suggestAssumptions(f, 0.043);
    assert.ok(a.weightRim >= 0.3);
    const r = valueStock(f, a, { lite: true });
    assert.ok(r.rim != null && r.rim > r.rimBook);
    const rimLine = r.models.find((m) => m.id === "rim");
    assert.equal(rimLine?.used, true);
    assert.ok((rimLine?.weight ?? 0) > 0.2);
    assert.ok(r.justifiedPb != null && r.justifiedPb > 1);
  });

  it("justified P/B is (ROE − g) / (Ke − g)", () => {
    const pb = justifiedPb(0.18, 0.1, 0.03);
    assert.ok(pb != null);
    assert.equal(pb.toFixed(2), ((0.18 - 0.03) / (0.1 - 0.03)).toFixed(2));
  });

  it("dividend names open DDM and still give RIM a vote", () => {
    const f = base({
      price: 40,
      sharesOut: 5e9,
      marketCap: 2e11,
      revenue: 3e10,
      ebit: 4e9,
      ebitda: 7e9,
      netIncome: 3e9,
      bookEquity: 4e10,
      eps: 0.6,
      dps: 2.2,
      fcf: 3.5e9,
      operatingMargin: 0.13,
      revenueGrowth: 0.02,
      dividendYield: 0.055,
      trailingPE: 14,
      priceToBook: 5,
    });
    assert.equal(classifyRegime(f), "dividend");
    const a = suggestAssumptions(f, 0.043);
    assert.ok(a.weightGordon > 0);
    assert.ok(a.weightRim >= 0.25);
    const r = valueStock(f, a, { lite: true });
    assert.ok(r.ddmApplicable);
    assert.ok(r.rim != null);
  });

  it("TWSE-lite compounder does not inherit startup assumptions; unused DDM is blank; DCF weight goes to relative", () => {
    const f = base({
      ticker: "2330.TW",
      price: 100,
      eps: 4,
      dps: 0.8,
      trailingPE: 25,
      priceToBook: 6,
      dividendYield: 0.008,
    });
    assert.equal(classifyRegime(f), "compounder");
    const a = suggestAssumptions(f, 0.016);
    assert.ok(a.g1 <= 0.08, `g1 ${a.g1}`);
    assert.ok(a.gDiv1 <= 0.06, `gDiv1 ${a.gDiv1}`);
    assert.ok(a.specificRisk < 0.02, `specific ${a.specificRisk}`);
    const r = valueStock(f, a, { lite: true });
    const gordon = r.models.find((m) => m.id === "gordon");
    const dcf = r.models.find((m) => m.id === "dcf");
    const rel = r.models.find((m) => m.id === "relative");
    const rim = r.models.find((m) => m.id === "rim");
    assert.equal(gordon?.used, false);
    assert.equal(gordon?.price, null);
    assert.equal(dcf?.used, false);
    assert.equal(rel?.used, true);
    assert.equal(rim?.used, true);
    assert.ok((rel?.weight ?? 0) > (rim?.weight ?? 0));
  });

  it("expensive low-ROE scale name is optionality; RIM does not vote", () => {
    const f = base({
      ticker: "TSLA",
      price: 370,
      sharesOut: 3.95e9,
      marketCap: 1.46e12,
      revenue: 1.04e11,
      ebit: 9e9,
      ebitda: 1.12e10,
      netIncome: 3.6e9,
      bookEquity: 8.4e10,
      eps: 1,
      fcf: 2e9,
      operatingMargin: 0.09,
      priceToSales: 14,
      trailingPE: 370,
      priceToBook: 17,
    });
    assert.equal(classifyRegime(f), "optionality");
    const a = suggestAssumptions(f, 0.043);
    assert.equal(a.weightRim, 0);
    const r = valueStock(f, a, { lite: true });
    const rim = r.models.find((m) => m.id === "rim");
    assert.equal(rim?.used, false);
    assert.ok(r.blended != null && r.blended > 20);
  });
});
