import type { LedgerState, Transaction } from "./types";
import { subscriptionAmountInBase, transactionAmountInBase } from "./transactionAccounting.js";

export type ChartType = "donut" | "pie" | "bar" | "line" | "table" | "board" | "number";
export type RangeKey = "today" | "week" | "month" | "year" | "fixed" | "relative";
export type RelativeUnit = "day" | "week" | "month" | "year";
export type GroupKey = "time" | "category";
export type FilterKey = "all" | "category" | "account" | "amount";
export type AggregateMetricKey = "totalIncome" | "totalExpense" | "net" | "averageIncome" | "averageExpense" | "averageNet" | "expenseCount" | "incomeCount";
export type DetailMetricKey = "incomeDetail" | "expenseDetail" | "top10Expense" | "top10Income" | "subscriptionDetail" | "creditDetail";
export type MetricKey = AggregateMetricKey | DetailMetricKey;

export interface CustomTile {
  id: string;
  title: string;
  chartType: ChartType;
  range: RangeKey;
  metric: MetricKey;
  groupBy?: GroupKey;
  filterBy: FilterKey;
  filterCategory?: string;
  filterAccountId?: string;
  minAmount?: number;
  maxAmount?: number;
  startDate?: string;
  endDate?: string;
  relativeValue: number;
  relativeUnit: RelativeUnit;
}

export const CUSTOM_TILES_STORAGE_KEY = "iledger-custom-tiles";

export function remapTileCategoryReferences(tiles: CustomTile[], previousName: string, nextName: string): CustomTile[] {
  return tiles.map((tile) => tile.filterCategory === previousName ? { ...tile, filterCategory: nextName } : tile);
}

export function remapTileAccountReferences(tiles: CustomTile[], previousId: string, nextId?: string): CustomTile[] {
  return tiles.map((tile) => tile.filterAccountId === previousId
    ? { ...tile, filterBy: nextId ? tile.filterBy : "all", filterAccountId: nextId }
    : tile);
}

export interface AnalyticsPoint {
  name: string;
  amount: number;
  colorIndex: number;
}

export interface AnalyticsDetail {
  id: string;
  name: string;
  meta: string;
  amount: number;
}

export interface AnalyticsModel {
  value: number;
  data: AnalyticsPoint[];
  details: AnalyticsDetail[];
  relatedCount: number;
  countMetric: boolean;
}

export const rangeLabels: Record<RangeKey, string> = {
  today: "今天",
  week: "本周",
  month: "本月",
  year: "今年",
  fixed: "指定日期",
  relative: "相对今天",
};

export const relativeUnitLabels: Record<RelativeUnit, string> = { day: "天", week: "周", month: "月", year: "年" };
export const chartTypeLabels: Record<ChartType, string> = { donut: "环形图", pie: "饼状图", bar: "柱状图", line: "折线图", table: "表格", board: "看板", number: "数字汇总" };
export const groupLabels: Record<GroupKey, string> = { time: "按时间", category: "按类别" };
export const filterLabels: Record<FilterKey, string> = { all: "全部数据", category: "按分类", account: "按账户", amount: "按金额" };
export const metricLabels: Record<MetricKey, string> = {
  totalIncome: "总收入",
  totalExpense: "总支出",
  net: "总收支差",
  averageIncome: "平均收入",
  averageExpense: "平均支出",
  averageNet: "平均收支差",
  expenseCount: "支出数量",
  incomeCount: "收入数量",
  incomeDetail: "收入明细",
  expenseDetail: "支出明细",
  top10Expense: "十笔最大支出",
  top10Income: "十笔最大收入",
  subscriptionDetail: "订阅明细",
  creditDetail: "信用消费明细",
};

export const aggregateMetrics: AggregateMetricKey[] = ["totalIncome", "totalExpense", "net", "averageIncome", "averageExpense", "averageNet", "expenseCount", "incomeCount"];
export const tableDetailMetrics: DetailMetricKey[] = ["incomeDetail", "expenseDetail", "subscriptionDetail", "creditDetail"];
export const boardMetrics: DetailMetricKey[] = ["incomeDetail", "expenseDetail", "top10Expense", "top10Income", "subscriptionDetail", "creditDetail"];
export const chartMetricKeys: Record<ChartType, MetricKey[]> = {
  donut: aggregateMetrics,
  pie: aggregateMetrics,
  bar: aggregateMetrics,
  line: aggregateMetrics,
  table: [...aggregateMetrics, ...tableDetailMetrics],
  board: boardMetrics,
  number: aggregateMetrics,
};

export const chartGroupKeys: Record<ChartType, GroupKey[]> = {
  donut: ["time", "category"],
  pie: ["time", "category"],
  bar: ["time", "category"],
  line: ["time", "category"],
  table: ["time", "category"],
  board: [],
  number: [],
};

const countMetrics = new Set<MetricKey>(["expenseCount", "incomeCount"]);
const detailMetrics = new Set<MetricKey>([...tableDetailMetrics, "top10Expense", "top10Income"]);
const chartTypes = new Set<ChartType>(["donut", "pie", "bar", "line", "table", "board", "number"]);
const rangeKeys = new Set<RangeKey>(["today", "week", "month", "year", "fixed", "relative"]);
const filterKeys = new Set<FilterKey>(["all", "category", "account", "amount"]);
const relativeUnits = new Set<RelativeUnit>(["day", "week", "month", "year"]);

export function isCountMetric(metric: MetricKey) {
  return countMetrics.has(metric);
}

export function isDetailMetric(metric: MetricKey) {
  return detailMetrics.has(metric);
}

export function piePlotValue(value: number) {
  return Math.max(0, value);
}

export function analyticsBoardColumns(width: number) {
  if (width <= 0) return 2;
  return Math.max(1, Math.floor(width / 210));
}

export function analyticsDisplayCapacity(chartType: ChartType, width: number, height: number) {
  if (chartType === "number") return 1;
  if (width <= 0 || height <= 0) return 3;
  if (chartType === "board") {
    const rows = Math.max(1, Math.floor(height / 58));
    return Math.max(1, analyticsBoardColumns(width) * rows);
  }
  if (chartType === "table") return Math.max(2, Math.floor((height - 26) / 31));
  if (chartType === "pie" || chartType === "donut") return Math.max(3, Math.floor(width / 82));
  return Math.max(3, Math.floor(width / 72));
}

export function calendarMonthWindow(capacity: number, now = new Date()) {
  const count = Math.min(12, Math.max(1, Math.floor(capacity)));
  if (count === 12) return Array.from({ length: 12 }, (_, index) => index + 1);
  const currentMonth = now.getMonth() + 1;
  const endMonth = Math.min(12, Math.max(currentMonth, count));
  const startMonth = endMonth - count + 1;
  return Array.from({ length: count }, (_, index) => startMonth + index);
}

export function timeRangeTitle(config: Pick<CustomTile, "range" | "relativeValue" | "relativeUnit" | "startDate" | "endDate">) {
  if (config.range === "relative") return `最近${Math.max(1, config.relativeValue)}${relativeUnitLabels[config.relativeUnit]}`;
  if (config.range === "fixed") return config.startDate && config.endDate ? `${config.startDate}至${config.endDate}` : rangeLabels.fixed;
  return rangeLabels[config.range];
}

export function defaultTileTitle(config: Pick<CustomTile, "range" | "relativeValue" | "relativeUnit" | "startDate" | "endDate" | "metric" | "chartType">) {
  return `${timeRangeTitle(config)}的${metricLabels[config.metric]}的${chartTypeLabels[config.chartType]}`;
}

export function createDefaultTile(id: string): CustomTile {
  const tile: CustomTile = {
    id,
    title: "",
    chartType: "bar",
    range: "month",
    metric: "totalExpense",
    groupBy: "time",
    filterBy: "all",
    relativeValue: 30,
    relativeUnit: "day",
  };
  return { ...tile, title: defaultTileTitle(tile) };
}

export function normalizeCustomTile(input: unknown): CustomTile {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const chartType = chartTypes.has(raw.chartType as ChartType) ? raw.chartType as ChartType : "bar";
  const legacyMetric = typeof raw.metric === "string" ? raw.metric : "totalExpense";
  const legacyMetricMap: Record<string, MetricKey> = {
    totalExpense: "totalExpense", totalIncome: "totalIncome", net: "net", expenseCount: "expenseCount", incomeCount: "incomeCount",
    averageExpense: "averageExpense", transactionCount: "expenseCount", largestExpense: chartType === "board" ? "top10Expense" : "totalExpense",
    categoryExpense: "totalExpense", categoryIncome: "totalIncome", accountExpense: "totalExpense", accountIncome: "totalIncome",
    accountBalance: "totalExpense", subscriptionCost: chartType === "table" || chartType === "board" ? "subscriptionDetail" : "totalExpense",
    creditSpend: chartType === "table" || chartType === "board" ? "creditDetail" : "totalExpense",
    creditDue: chartType === "table" || chartType === "board" ? "creditDetail" : "totalExpense", assetValue: "totalExpense",
  };
  let metric = (Object.prototype.hasOwnProperty.call(metricLabels, legacyMetric) ? legacyMetric : legacyMetricMap[legacyMetric]) as MetricKey | undefined;
  if (!metric || !chartMetricKeys[chartType].includes(metric)) metric = chartType === "board" ? "expenseDetail" : "totalExpense";
  let filterBy = filterKeys.has(raw.filterBy as FilterKey) ? raw.filterBy as FilterKey : "all";
  if (legacyMetric === "categoryExpense" || legacyMetric === "categoryIncome") filterBy = "category";
  if (["accountExpense", "accountIncome", "accountBalance"].includes(legacyMetric)) filterBy = "account";
  const range = rangeKeys.has(raw.range as RangeKey) ? raw.range as RangeKey : "month";
  const relativeUnit = relativeUnits.has(raw.relativeUnit as RelativeUnit) ? raw.relativeUnit as RelativeUnit : "day";
  const relativeValue = Math.max(1, Number(raw.relativeValue ?? raw.relativeDays ?? 30) || 30);
  const groupBy = chartGroupKeys[chartType].length
    ? raw.groupBy === "category" ? "category" : "time"
    : undefined;
  const rawMin = typeof raw.minAmount === "number" ? raw.minAmount : undefined;
  const rawMax = typeof raw.maxAmount === "number" ? raw.maxAmount : undefined;
  const tile: CustomTile = {
    id: typeof raw.id === "string" ? raw.id : `custom-${crypto.randomUUID()}`,
    title: typeof raw.title === "string" ? raw.title : "",
    chartType,
    range,
    metric,
    groupBy,
    filterBy,
    filterCategory: typeof raw.filterCategory === "string" ? raw.filterCategory : typeof raw.category === "string" ? raw.category : undefined,
    filterAccountId: typeof raw.filterAccountId === "string" ? raw.filterAccountId : typeof raw.accountId === "string" ? raw.accountId : undefined,
    minAmount: rawMin !== undefined && rawMax !== undefined ? Math.min(rawMin, rawMax) : rawMin,
    maxAmount: rawMin !== undefined && rawMax !== undefined ? Math.max(rawMin, rawMax) : rawMax,
    startDate: typeof raw.startDate === "string" ? raw.startDate : undefined,
    endDate: typeof raw.endDate === "string" ? raw.endDate : undefined,
    relativeValue,
    relativeUnit,
  };
  return { ...tile, title: tile.title.trim() || defaultTileTitle(tile) };
}

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function shiftCalendar(date: Date, amount: number, unit: "month" | "year") {
  const day = date.getDate();
  date.setDate(1);
  if (unit === "month") date.setMonth(date.getMonth() - amount);
  else date.setFullYear(date.getFullYear() - amount);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  date.setDate(date.getDate() + 1);
}

export function dateRange(config: CustomTile, now = new Date()): [string, string] {
  const end = new Date(now); const start = new Date(now);
  if (config.range === "today") return [iso(end), iso(end)];
  if (config.range === "week") { const weekday = (start.getDay() + 6) % 7; start.setDate(start.getDate() - weekday); }
  if (config.range === "month") start.setDate(1);
  if (config.range === "year") start.setMonth(0, 1);
  if (config.range === "relative") {
    const amount = Math.max(1, config.relativeValue);
    if (config.relativeUnit === "day") start.setDate(start.getDate() - amount + 1);
    if (config.relativeUnit === "week") start.setDate(start.getDate() - amount * 7 + 1);
    if (config.relativeUnit === "month") shiftCalendar(start, amount, "month");
    if (config.relativeUnit === "year") shiftCalendar(start, amount, "year");
  }
  if (config.range === "fixed") return [config.startDate || "0000-01-01", config.endDate || "9999-12-31"];
  return [iso(start), iso(end)];
}

function filterTransactions(entries: Transaction[], config: CustomTile, ledger: LedgerState) {
  const accountScope = config.filterAccountId
    ? new Set([config.filterAccountId, ...ledger.accounts.filter((account) => account.parentAccountId === config.filterAccountId).map((account) => account.id)])
    : null;
  return entries.filter((item) => {
    const amount = transactionAmountInBase(item, ledger.rates, ledger.baseCurrency);
    if (config.filterBy === "category" && config.filterCategory && item.category !== config.filterCategory) return false;
    if (config.filterBy === "account" && accountScope && !accountScope.has(item.accountId)) return false;
    if (config.filterBy === "amount" && config.minAmount !== undefined && amount < config.minAmount) return false;
    if (config.filterBy === "amount" && config.maxAmount !== undefined && amount > config.maxAmount) return false;
    return true;
  });
}

function transactionsForMetric(entries: Transaction[], metric: MetricKey) {
  if (["totalIncome", "averageIncome", "incomeCount", "incomeDetail", "top10Income"].includes(metric)) return entries.filter((item) => item.type === "income");
  if (["totalExpense", "averageExpense", "expenseCount", "expenseDetail", "top10Expense"].includes(metric)) return entries.filter((item) => item.type === "expense");
  if (metric === "creditDetail") return entries.filter((item) => item.type === "expense" && (item.creditToolId || item.paymentKind !== "normal"));
  return entries;
}

function metricValue(entries: Transaction[], metric: MetricKey, ledger: LedgerState) {
  const income = entries.filter((item) => item.type === "income");
  const expense = entries.filter((item) => item.type === "expense");
  const incomeTotal = income.reduce((sum, item) => sum + transactionAmountInBase(item, ledger.rates, ledger.baseCurrency), 0);
  const expenseTotal = expense.reduce((sum, item) => sum + transactionAmountInBase(item, ledger.rates, ledger.baseCurrency), 0);
  if (metric === "totalIncome") return incomeTotal;
  if (metric === "totalExpense") return expenseTotal;
  if (metric === "net") return incomeTotal - expenseTotal;
  if (metric === "averageIncome") return income.length ? incomeTotal / income.length : 0;
  if (metric === "averageExpense") return expense.length ? expenseTotal / expense.length : 0;
  if (metric === "averageNet") return (income.length ? incomeTotal / income.length : 0) - (expense.length ? expenseTotal / expense.length : 0);
  if (metric === "incomeCount") return income.length;
  if (metric === "expenseCount") return expense.length;
  return entries.reduce((sum, item) => sum + transactionAmountInBase(item, ledger.rates, ledger.baseCurrency), 0);
}

function daysBetween(start: string, end: string) {
  const startTime = new Date(`${start}T12:00:00`).getTime();
  const endTime = new Date(`${end}T12:00:00`).getTime();
  return Number.isFinite(startTime) && Number.isFinite(endTime) ? Math.floor((endTime - startTime) / 86400000) : 0;
}

function usesMonthlyTimeGroups(config: CustomTile, start: string, end: string) {
  return config.range === "year"
    || daysBetween(start, end) > 93
    || (config.range === "relative" && (config.relativeUnit === "year" || (config.relativeUnit === "month" && config.relativeValue > 3)));
}

function groupKey(item: Transaction, config: CustomTile, monthly: boolean) {
  if (config.groupBy === "category") return { key: item.category, label: item.category };
  if (monthly) return { key: item.date.slice(0, 7), label: `${Number(item.date.slice(5, 7))}月` };
  return { key: item.date, label: `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}` };
}

function timeGroups(start: string, end: string, monthly: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start.startsWith("0000") || end.startsWith("9999")) return [];
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(last.getTime()) || cursor > last) return [];
  if (monthly) cursor.setDate(1);
  const groups: Array<{ key: string; label: string; entries: Transaction[] }> = [];
  while (cursor <= last && groups.length < 120) {
    const key = monthly ? `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}` : iso(cursor);
    groups.push({ key, label: monthly ? `${cursor.getMonth() + 1}月` : `${cursor.getMonth() + 1}/${cursor.getDate()}`, entries: [] });
    if (monthly) cursor.setMonth(cursor.getMonth() + 1, 1);
    else cursor.setDate(cursor.getDate() + 1);
  }
  return groups;
}

function detailsFor(config: CustomTile, ledger: LedgerState, scoped: Transaction[], start: string, end: string): AnalyticsDetail[] {
  const accountName = (id: string) => ledger.accounts.find((account) => account.id === id)?.name ?? id;
  const accountScope = config.filterAccountId
    ? new Set([config.filterAccountId, ...ledger.accounts.filter((account) => account.parentAccountId === config.filterAccountId).map((account) => account.id)])
    : null;
  if (config.metric === "subscriptionDetail") return ledger.subscriptions
    .filter((item) => item.startedAt <= end && item.endsAt >= start)
    .filter((item) => config.filterBy !== "category" || !config.filterCategory || item.category === config.filterCategory)
    .filter((item) => { const linked = ledger.transactions.find((transaction) => transaction.subscriptionId === item.id); return config.filterBy !== "account" || !accountScope || accountScope.has(linked?.accountId ?? item.accountId); })
    .filter((item) => { const linked = ledger.transactions.find((transaction) => transaction.subscriptionId === item.id); const amount = linked ? transactionAmountInBase(linked, ledger.rates, ledger.baseCurrency) : subscriptionAmountInBase(item, ledger.rates, ledger.baseCurrency); return config.filterBy !== "amount" || ((config.minAmount === undefined || amount >= config.minAmount) && (config.maxAmount === undefined || amount <= config.maxAmount)); })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((item) => { const linked = ledger.transactions.find((transaction) => transaction.subscriptionId === item.id); return { id: item.id, name: item.name, meta: `${item.startedAt} · ${item.category} · ${accountName(item.accountId)}`, amount: linked ? transactionAmountInBase(linked, ledger.rates, ledger.baseCurrency) : subscriptionAmountInBase(item, ledger.rates, ledger.baseCurrency) }; });
  let entries = transactionsForMetric(scoped, config.metric);
  if (config.metric === "top10Expense" || config.metric === "top10Income") entries = [...entries].sort((a, b) => transactionAmountInBase(b, ledger.rates, ledger.baseCurrency) - transactionAmountInBase(a, ledger.rates, ledger.baseCurrency)).slice(0, 10);
  else entries = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  return entries.map((item) => ({ id: item.id, name: item.item, meta: `${item.date} · ${item.category} · ${accountName(item.accountId)}`, amount: transactionAmountInBase(item, ledger.rates, ledger.baseCurrency) }));
}

export function buildAnalyticsModel(config: CustomTile, ledger: LedgerState, now = new Date()): AnalyticsModel {
  const [start, end] = dateRange(config, now);
  const dated = ledger.transactions.filter((item) => item.status !== "scheduled" && item.date >= start && item.date <= end);
  const scoped = filterTransactions(dated, config, ledger);
  const relevant = transactionsForMetric(scoped, config.metric);
  const details = isDetailMetric(config.metric) ? detailsFor(config, ledger, scoped, start, end) : [];
  const value = isDetailMetric(config.metric) ? details.reduce((sum, item) => sum + item.amount, 0) : metricValue(relevant, config.metric, ledger);
  const groups = new Map<string, { label: string; entries: Transaction[] }>();
  const monthly = usesMonthlyTimeGroups(config, start, end);
  if (config.groupBy === "time" && !isDetailMetric(config.metric)) {
    const axisEnd = config.range === "year" ? `${now.getFullYear()}-12-31` : end;
    timeGroups(start, axisEnd, monthly).forEach((group) => groups.set(group.key, { label: group.label, entries: group.entries }));
  }
  if (config.groupBy && !isDetailMetric(config.metric)) relevant.forEach((item) => {
    const group = groupKey(item, config, monthly);
    const existing = groups.get(group.key);
    if (existing) existing.entries.push(item);
    else groups.set(group.key, { label: group.label, entries: [item] });
  });
  const data = Array.from(groups.entries()).map(([key, group], index) => ({ key, name: group.label, amount: metricValue(group.entries, config.metric, ledger), colorIndex: index }));
  data.sort((a, b) => config.groupBy === "time" ? a.key.localeCompare(b.key) : Math.abs(b.amount) - Math.abs(a.amount));
  return { value, data: data.map(({ name, amount, colorIndex }) => ({ name, amount, colorIndex })), details, relatedCount: isDetailMetric(config.metric) ? details.length : relevant.length, countMetric: isCountMetric(config.metric) };
}
