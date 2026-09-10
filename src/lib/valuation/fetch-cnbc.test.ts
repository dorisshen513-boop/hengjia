import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconcileShares, scaleCnbcMoney } from "./fetch-cnbc.ts";

describe("CNBC unit scale", () => {
  it("does not multiply Tesla shares twice when raw is already 3.95B and view is 3949.55M", () => {
    const shares = scaleCnbcMoney("3949547000", "3949.55M");
    assert.equal(shares, 3949547000);
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
});
