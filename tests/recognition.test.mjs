import assert from "node:assert/strict";
import { initialLedger } from "../.test-build/demoData.js";
import { learnRecognitionCorrections, projectKeywordFromCorrection } from "../.test-build/recognition.js";
import { parseNaturalEntry } from "../.test-build/parser.js";

const ledger = {
  ...initialLedger,
  accounts: [...initialLedger.accounts, { ...initialLedger.accounts.find((account) => account.id === "wechat"), id: "wechat-balance", parentAccountId: "wechat", currency: "CNY" }],
  rates: [...initialLedger.rates, { code: "IDR", name: "印度尼西亚卢比", symbol: "Rp", rateToCny: 0.00046 }],
  creditTools: [...initialLedger.creditTools, { id: "hsbc-mastercard", name: "汇丰万事达", accountId: "wechat-balance", parentAccountId: "wechat", statementDay: 6, repaymentDay: 26, repaymentAccountId: "cmb", repaymentAccountIds: ["cmb"], priority: 9, autoRepay: false }],
};
const parsed = {
  type: "expense", item: "咖啡", amount: 50000, category: "日用", accountId: "alipay", currency: "CNY",
  date: "2026-10-01", paymentKind: "normal", source: "买咖啡，中银香港VISA花了50000印尼盾",
  confidence: { type: .9, item: .9, amount: .9, currency: .4, category: .4, accountId: .4, date: .7 },
};
const learned = learnRecognitionCorrections(ledger, parsed, { category: "餐饮", accountId: "wechat-balance", currency: "IDR" });
assert.deepEqual(learned.rates.find((rate) => rate.code === "IDR").aliases, ["印尼盾"]);
assert.ok(learned.categories.find((category) => category.name === "餐饮").aliases.includes("咖啡"));
assert.ok(learned.accounts.find((account) => account.id === "wechat-balance").aliases.includes("中银香港VISA"));
const reparsed = parseNaturalEntry("咖啡，中银香港VISA花了20印尼盾", { ...ledger, ...learned });
assert.equal(reparsed.category, "餐饮");
assert.equal(reparsed.accountId, "wechat-balance");
assert.equal(reparsed.currency, "IDR");
const creditCorrection = learnRecognitionCorrections(ledger, { ...parsed, item: "ChatGPT", source: "ChatGPT，汇丰万事达花了20美刀" }, { category: "日用", accountId: "wechat-balance", creditToolId: "hsbc-mastercard", currency: "USD" });
assert.ok(creditCorrection.creditTools.find((tool) => tool.id === "hsbc-mastercard").aliases.includes("汇丰万事达"));
assert.equal(parseNaturalEntry("ChatGPT，汇丰万事达花了20美刀", { ...ledger, ...creditCorrection }).creditToolId, "hsbc-mastercard");
assert.equal(projectKeywordFromCorrection("ChatGPT中银香港", "ChatGPT"), "ChatGPT");
assert.equal(projectKeywordFromCorrection("酷态科", "酷态科 10 号充电器"), "酷态科");

console.log("recognition learning tests: 10 passed");
