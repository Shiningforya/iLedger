import assert from "node:assert/strict";
import { initialLedger } from "../.test-build/data.js";

for (const key of ["accounts", "creditTools", "transactions", "subscriptions", "assets", "repayments", "loans", "projectRules"]) {
  assert.deepEqual(initialLedger[key], [], `${key} must be empty on first launch`);
}
assert.ok(initialLedger.categories.some((category) => category.id === "borrowing"));
assert.ok(initialLedger.rates.some((rate) => rate.code === "CNY"));
assert.ok(initialLedger.rates.some((rate) => rate.code === "USD"));

console.log("fresh ledger regression tests: 11 passed");
