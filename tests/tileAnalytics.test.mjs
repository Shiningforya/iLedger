import assert from "node:assert/strict";
import {
  aggregateMetrics,
  analyticsDisplayCapacity,
  boardMetrics,
  buildAnalyticsModel,
  calendarMonthWindow,
  chartGroupKeys,
  chartMetricKeys,
  createDefaultTile,
  dateRange,
  defaultTileTitle,
  normalizeCustomTile,
  piePlotValue,
  remapTileAccountReferences,
  remapTileCategoryReferences,
  tableDetailMetrics,
} from "../.test-build/tileAnalytics.js";

const ledger = {
  transactions: [
    { id: "e1", type: "expense", item: "午餐", category: "餐饮", accountId: "wallet", amount: 80, date: "2026-10-01", currency: "CNY", paymentKind: "normal", status: "posted" },
    { id: "e2", type: "expense", item: "耳机", category: "数码", accountId: "bank", amount: 600, date: "2026-09-26", currency: "CNY", paymentKind: "credit", creditToolId: "card", status: "posted" },
    { id: "i1", type: "income", item: "工资", category: "工资", accountId: "bank", amount: 3000, date: "2026-10-01", currency: "CNY", paymentKind: "normal", status: "posted" },
  ],
  accounts: [{ id: "wallet", name: "钱包" }, { id: "bank", name: "银行卡" }],
  rates: [{ code: "CNY", rateToCny: 1 }, { code: "USD", rateToCny: 7.08 }],
  subscriptions: [{ id: "s1", name: "音乐", amount: 18, startedAt: "2026-09-28", category: "娱乐", accountId: "wallet" }],
};

const chartTypes = ["donut", "pie", "bar", "line", "table", "board", "number"];
for (const chartType of chartTypes) {
  assert.ok(chartMetricKeys[chartType].length > 0, `${chartType} should expose at least one drawable metric`);
  if (chartType === "number" || chartType === "board") assert.deepEqual(chartGroupKeys[chartType], []);
  else assert.deepEqual(chartGroupKeys[chartType], ["time", "category"]);
}
assert.ok(tableDetailMetrics.every((metric) => chartMetricKeys.table.includes(metric)));
assert.deepEqual(chartMetricKeys.number, aggregateMetrics);
assert.deepEqual(chartMetricKeys.board, boardMetrics);

const base = createDefaultTile("custom-test");
assert.equal(base.title, "本月的总支出的柱状图");
assert.equal(defaultTileTitle({ ...base, range: "relative", relativeValue: 2, relativeUnit: "week" }), "最近2周的总支出的柱状图");
assert.deepEqual(dateRange({ ...base, range: "relative", relativeValue: 2, relativeUnit: "week" }, new Date("2026-10-01T12:00:00")), ["2026-09-18", "2026-10-01"]);

const numberTile = normalizeCustomTile({ ...base, chartType: "number", groupBy: "day", metric: "totalExpense" });
assert.equal(numberTile.groupBy, undefined, "number summaries must never carry a grouping dimension");
const numberModel = buildAnalyticsModel(numberTile, ledger, new Date("2026-10-01T12:00:00"));
assert.equal(numberModel.value, 80);

const barModel = buildAnalyticsModel({ ...base, range: "relative", relativeValue: 2, relativeUnit: "week", groupBy: "time" }, ledger, new Date("2026-10-01T12:00:00"));
assert.equal(barModel.data.length, 14, "two weeks should expose a complete daily timeline");
assert.equal(barModel.data.find((item) => item.name === "9/26")?.amount, 600);
assert.equal(barModel.data.at(-1)?.amount, 80);

const yearModel = buildAnalyticsModel({ ...base, range: "year", metric: "net", groupBy: "time" }, ledger, new Date("2026-10-01T12:00:00"));
assert.equal(yearModel.data.length, 12, "the current year should always expose a complete 12-month axis");
assert.deepEqual(yearModel.data.slice(-3).map((item) => item.name), ["10月", "11月", "12月"]);

assert.equal(analyticsDisplayCapacity("board", 420, 116), 4);
assert.equal(analyticsDisplayCapacity("board", 1050, 240), 20);
assert.equal(analyticsDisplayCapacity("bar", 300, 180), 4);
assert.equal(analyticsDisplayCapacity("bar", 1440, 180), 20);
assert.equal(analyticsDisplayCapacity("bar", 7200, 180), 100, "large charts must not have an arbitrary item cap");
assert.equal(analyticsDisplayCapacity("table", 800, 956), 30, "large tables must not have an arbitrary row cap");
assert.deepEqual(calendarMonthWindow(12, new Date("2026-10-02T12:00:00")), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "a wide annual trend must stay in natural calendar order");
assert.deepEqual(calendarMonthWindow(6, new Date("2026-10-02T12:00:00")), [5, 6, 7, 8, 9, 10], "a compact trend must not wrap into the previous year");

const manyCategoryLedger = {
  ...ledger,
  transactions: Array.from({ length: 30 }, (_, index) => ({ ...ledger.transactions[0], id: `category-${index}`, category: `分类${index + 1}`, amount: index + 1 })),
};
const manyCategoryModel = buildAnalyticsModel({ ...base, groupBy: "category" }, manyCategoryLedger, new Date("2026-10-01T12:00:00"));
assert.equal(manyCategoryModel.data.length, 30, "category groups must remain complete when the tile has enough space");

const categoryModel = buildAnalyticsModel({ ...base, groupBy: "category", filterBy: "account", filterAccountId: "bank" }, ledger, new Date("2026-10-01T12:00:00"));
assert.equal(categoryModel.value, 0, "current-month account scope should exclude September entries");

const foreignLedger = {
  ...ledger,
  transactions: [{ ...ledger.transactions[0], id: "usd-expense", amount: 20, amountCny: 141.6, exchangeRateToCny: 7.08, currency: "USD" }],
};
const foreignModel = buildAnalyticsModel(base, foreignLedger, new Date("2026-10-01T12:00:00"));
assert.equal(foreignModel.value, 141.6, "analytics must use the frozen CNY booking amount");

const parentScopeLedger = {
  ...ledger,
  accounts: [{ id: "wallet", name: "钱包" }, { id: "wallet-child", name: "零钱", parentAccountId: "wallet" }],
  transactions: [{ ...ledger.transactions[0], accountId: "wallet-child" }],
};
const parentScope = buildAnalyticsModel({ ...base, filterBy: "account", filterAccountId: "wallet" }, parentScopeLedger, new Date("2026-10-01T12:00:00"));
assert.equal(parentScope.value, 80, "a parent account filter must include its balance subaccounts");

const categoryTile = { ...base, filterBy: "category", filterCategory: "餐饮" };
const [renamedTile] = remapTileCategoryReferences([categoryTile], "餐饮", "外食");
assert.equal(renamedTile.filterCategory, "外食", "renamed categories must update saved tile filters");
assert.equal(buildAnalyticsModel(renamedTile, { ...ledger, transactions: ledger.transactions.map((item) => item.category === "餐饮" ? { ...item, category: "外食" } : item) }, new Date("2026-10-01T12:00:00")).value, 80);
const accountTile = { ...base, filterBy: "account", filterAccountId: "wallet" };
const [transferredTile] = remapTileAccountReferences([accountTile], "wallet", "bank");
assert.equal(transferredTile.filterAccountId, "bank", "child-account deletion must retarget saved tile filters");
assert.equal(buildAnalyticsModel(transferredTile, { ...ledger, transactions: ledger.transactions.map((item) => item.accountId === "wallet" ? { ...item, accountId: "bank" } : item) }, new Date("2026-10-01T12:00:00")).value, 80);
const [unscopedTile] = remapTileAccountReferences([accountTile], "wallet");
assert.equal(unscopedTile.filterBy, "all", "removing an empty parent account must leave a usable tile");
assert.equal(unscopedTile.filterAccountId, undefined);

const negativeLedger = {
  ...ledger,
  transactions: [
    { ...ledger.transactions[0], id: "negative-expense", amount: 200 },
    { ...ledger.transactions[2], id: "negative-income", amount: 40 },
  ],
};
const negativeNet = buildAnalyticsModel({ ...base, metric: "net", groupBy: "time" }, negativeLedger, new Date("2026-10-01T12:00:00"));
assert.equal(negativeNet.value, -160, "net summaries must preserve a negative result");
assert.deepEqual(negativeNet.data.map((item) => item.amount), [-160], "bar and line chart data must remain below zero");
assert.equal(piePlotValue(-160), 0, "pie geometry cannot render a negative net value");
assert.equal(piePlotValue(160), 160, "pie geometry must preserve positive values");

const board = normalizeCustomTile({ ...base, chartType: "board", metric: "largestExpense" });
assert.equal(board.metric, "top10Expense");
assert.equal(board.groupBy, undefined);

console.log("tile analytics regression tests passed");
