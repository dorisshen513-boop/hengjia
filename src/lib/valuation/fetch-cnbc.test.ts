import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconcileRevenue, reconcileShares, scaleCnbcMoney } from "./fetch-cnbc.ts";

describe("CNBC unit scale", () => {
  it("does not multiply Tesla shares twice when raw is already 3.95B and view is 3949.55M", () => {
    const shares = scaleCnbcMoney("3949547000", "3949.55M");
    assert.equal(shares, 3949547000);
  });

  it("does not multiply NuScale-scale revenue twice when raw is 10.69M dollars", () => {
    assert.equal(scaleCnbcMoney("10690000", "10.69M"), 10690000);
    assert.equal(scaleCnbcMoney("36535000", "36.535M"), 36535000);
  });

  it("scales compact millions when raw equals the view number", () => {
    assert.equal(scaleCnbcMoney("15", "15.0M"), 15e6);
    assert.equal(scaleCnbcMoney("3.22", "3.22B"), 3.22e9);
  });

  it("leaves already-full market cap alone", () => {
    assert.equal(scaleCnbcMoney("1452682882070", "1452682.8821M"), 1452682882070);
  });

  it("rebuilds shares from market cap when the share count is absurd", () => {
    const price = 367.81;
    const mcap = 1.45268288207e12;
    const bad = 3949547000 * 1e6;
    const shares = reconcileShares(bad, price, mcap);
    assert.ok(shares > 3e9 && shares < 5e9, `got ${shares}`);
  });

  it("rebuilds revenue from P/S when the dollar unit is 1000x too big", () => {
    const mcap = 4.645e9;
    const ps = 434.5471;
    const exploded = 10.69e12;
    const rev = reconcileRevenue(exploded, mcap, ps);
    assert.ok(rev > 1e7 && rev < 2e7, `got ${rev}`);
  });

  it("treats 10.69 vs 10.69M as millions and 10,690,000 vs 10.69M as already full", () => {
    assert.equal(scaleCnbcMoney("10.69", "10.69M"), 10.69e6);
    assert.equal(scaleCnbcMoney("-731.66", "-731.66M"), -731.66e6);
  });
});
