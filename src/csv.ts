import type { LedgerState, PaymentKind, Transaction } from "./types";
import { accountChildren, canAffectAccountBalance, transactionAmountInBase, withBookedMoney } from "./transactionAccounting.js";

const headers = ["日期", "类型", "项目", "原币金额", "原币", "兑本币汇率", "本币", "折算本币", "分类", "账户", "付款类型", "信用工具", "状态", "备注"];

const quote = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function exportTransactionsCsv(transactions: Transaction[], ledger: LedgerState) {
  const rows = transactions.map((item) => { const bookedBaseCurrency = item.bookedBaseCurrency ?? ledger.baseCurrency; const amountInBase = transactionAmountInBase(item, ledger.rates, bookedBaseCurrency); const account = ledger.accounts.find((candidate) => candidate.id === item.accountId); const parent = ledger.accounts.find((candidate) => candidate.id === account?.parentAccountId); return [
    item.date,
    item.type === "income" ? "收入" : "支出",
    item.item,
    item.amount,
    item.currency,
    item.amount > 0 ? Number((amountInBase / item.amount).toFixed(8)) : "",
    bookedBaseCurrency,
    amountInBase,
    item.category,
    account ? (parent ? `${parent.name} / ${account.name}` : account.name) : item.accountId,
    item.paymentKind === "credit" ? "信用付款" : item.paymentKind === "installment" ? "分期付款" : "普通付款",
    ledger.creditTools.find((tool) => tool.id === item.creditToolId)?.name ?? "",
    item.status === "scheduled" ? "待入账" : "已入账",
    item.note ?? "",
  ]; });
  return `\uFEFF${[headers, ...rows].map((row) => row.map(quote).join(",")).join("\r\n")}`;
}

type CsvField = "date" | "type" | "item" | "amount" | "expenseAmount" | "incomeAmount" | "currency" | "exchangeRate" | "baseCurrency" | "amountInBase" | "category" | "account" | "paymentKind" | "creditTool" | "status" | "note";

export interface CsvImportReviewCandidate {
  id: string;
  rowNumber: number;
  kind: "possible-duplicate" | "incomplete";
  reasons: string[];
  transaction: Transaction;
  existing?: Pick<Transaction, "id" | "date" | "item" | "amount" | "currency" | "accountId" | "category">;
}

export interface CsvImportResult {
  transactions: Transaction[];
  review: CsvImportReviewCandidate[];
  duplicates: number;
  skipped: number;
  totalRows: number;
  ignoredColumns: string[];
}

const headerAliases: Record<CsvField, string[]> = {
  date: ["日期", "交易日期", "记账日期", "发生日期", "时间", "交易时间", "date", "datetime", "transactiondate", "time"],
  type: ["类型", "交易类型", "收支", "收支类型", "方向", "type", "direction", "incomeexpense"],
  item: ["项目", "名称", "项目名称", "摘要", "交易摘要", "商品", "商品名称", "商户", "商户名称", "对方", "对方名称", "说明", "item", "name", "description", "merchant", "payee"],
  amount: ["原币金额", "金额", "交易金额", "发生金额", "amount", "value", "price"],
  expenseAmount: ["支出", "支出金额", "付款金额", "借方金额", "debit", "expense", "outflow"],
  incomeAmount: ["收入", "收入金额", "收款金额", "贷方金额", "credit", "income", "inflow"],
  currency: ["原币", "币种", "货币", "交易币种", "currency", "currencycode"],
  exchangeRate: ["兑本币汇率", "记账汇率", "汇率", "exchangeratetobase", "exchangeratetocny", "exchangerate", "rate"],
  baseCurrency: ["本币", "本位币", "结算币种", "basecurrency", "settlementcurrency"],
  amountInBase: ["折算本币", "折算人民币", "本币金额", "结算金额", "amountinbase", "amountcny", "baseamount"],
  category: ["分类", "类别", "交易分类", "category"],
  account: ["账户", "支付方式", "支付账户", "付款账户", "收款账户", "账号", "银行卡", "account", "accountid", "paymentaccount"],
  paymentKind: ["付款类型", "支付类型", "支付类别", "paymentkind", "paymenttype"],
  creditTool: ["信用工具", "信用账户", "credittool", "creditaccount"],
  status: ["状态", "入账状态", "status"],
  note: ["备注", "附言", "备注信息", "memo", "note", "remark", "comments"],
};

const normalizeToken = (value: string) => value.trim().toLocaleLowerCase().replace(/[\s_\-\/()（）【】\[\].·:：]/g, "");
const aliasToField = new Map(Object.entries(headerAliases).flatMap(([field, aliases]) => aliases.map((alias) => [normalizeToken(alias), field as CsvField])));

function detectDelimiter(text: string) {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/).find((line) => line.trim()) ?? "";
  const counts = new Map([[",", 0], ["\t", 0], [";", 0]]);
  let quoted = false;
  for (let index = 0; index < firstLine.length; index += 1) {
    const char = firstLine[index];
    if (char === '"') quoted = !quoted;
    else if (!quoted && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? ",";
}

function parseRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(input);
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell.trim()); cell = ""; }
    else if (char === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

function parseNumber(value: string) {
  const negative = /^\s*\(.*\)\s*$/.test(value) || /^\s*-/.test(value);
  let cleaned = value.replace(/[()\s\u00A0A-Za-z¥￥$€£₩₽₫₹]/g, "").replace(/[^\d.,+\-]/g, "");
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    cleaned = cleaned.replace(decimal === "," ? /\./g : /,/g, "").replace(decimal, ".");
  } else if (comma >= 0) {
    const decimals = cleaned.length - comma - 1;
    cleaned = decimals > 0 && decimals <= 2 ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  }
  const number = Number(cleaned.replace(/^\+/, ""));
  return Number.isFinite(number) ? (negative ? -Math.abs(number) : number) : NaN;
}

function normalizeDate(value: string) {
  const trimmed = value.trim();
  if (/^\d{5}(?:\.\d+)?$/.test(trimmed)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Number(trimmed) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const yearFirst = trimmed.match(/^(\d{4})[年\/.-](\d{1,2})[月\/.-](\d{1,2})/);
  const yearLast = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  const parts = yearFirst
    ? [Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3])]
    : yearLast
      ? [Number(yearLast[3]), Number(yearLast[1]), Number(yearLast[2])]
      : undefined;
  if (!parts) return "";
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function resolveCurrency(value: string, ledger: LedgerState) {
  if (!value.trim()) return ledger.baseCurrency;
  const token = normalizeToken(value);
  const symbolCodes: Record<string, string> = { "$": "USD", "¥": "CNY", "￥": "CNY", "€": "EUR", "£": "GBP", "₩": "KRW" };
  return symbolCodes[value.trim()] ?? ledger.rates.find((rate) => [rate.code, rate.name, rate.symbol, ...(rate.aliases ?? [])].some((candidate) => normalizeToken(candidate) === token))?.code ?? value.trim().toUpperCase();
}

function sameCore(left: Transaction, right: Transaction) {
  const leftItem = normalizeToken(left.item);
  const rightItem = normalizeToken(right.item);
  const similarItem = leftItem === rightItem || (Math.min(leftItem.length, rightItem.length) >= 4 && (leftItem.includes(rightItem) || rightItem.includes(leftItem)));
  return left.date === right.date && left.type === right.type && left.currency === right.currency && Math.abs(left.amount - right.amount) < 0.005 && similarItem;
}

function sameExact(left: Transaction, right: Transaction) {
  return sameCore(left, right)
    && normalizeToken(left.item) === normalizeToken(right.item)
    && left.accountId === right.accountId
    && left.category === right.category
    && left.paymentKind === right.paymentKind
    && (left.status ?? "posted") === (right.status ?? "posted")
    && (left.note ?? "").trim() === (right.note ?? "").trim();
}

export function importTransactionsCsv(text: string, ledger: LedgerState): CsvImportResult {
  const rows = parseRows(text);
  const emptyResult = { transactions: [] as Transaction[], review: [] as CsvImportReviewCandidate[], duplicates: 0, skipped: 0, totalRows: 0, ignoredColumns: [] as string[] };
  if (rows.length < 2) return emptyResult;
  const columns = rows[0].map((column) => column.trim());
  const fields = columns.map((column) => aliasToField.get(normalizeToken(column)));
  const ignoredColumns = columns.filter((column, index) => column && !fields[index]);
  const dataRows = rows.slice(1).filter((values) => values.some((value) => value.trim()));
  const transactions: Transaction[] = [];
  const review: CsvImportReviewCandidate[] = [];
  let duplicates = 0;
  let skipped = 0;
  dataRows.forEach((values, dataIndex) => {
    const rowNumber = dataIndex + 2;
    const row: Partial<Record<CsvField, string>> = {};
    fields.forEach((field, index) => { if (field && values[index]?.trim() && !row[field]) row[field] = values[index].trim(); });
    const warnings: string[] = [];
    const date = normalizeDate(row.date ?? "");
    let rawAmount = parseNumber(row.amount ?? "");
    let type: Transaction["type"] | undefined;
    const expenseAmount = parseNumber(row.expenseAmount ?? "");
    const incomeAmount = parseNumber(row.incomeAmount ?? "");
    const rawType = normalizeToken(row.type ?? "");
    if (Number.isFinite(expenseAmount) && Math.abs(expenseAmount) > 0) { rawAmount = expenseAmount; type = "expense"; }
    else if (Number.isFinite(incomeAmount) && Math.abs(incomeAmount) > 0) { rawAmount = incomeAmount; type = "income"; }
    else if (/收入|收款|入账|income|inflow|credit/.test(rawType)) type = "income";
    else if (/支出|付款|消费|expense|outflow|debit/.test(rawType)) type = "expense";
    else if (rawAmount < 0) type = "expense";
    else { type = "expense"; warnings.push("缺少收支类型，暂按支出处理"); }
    const amount = Math.abs(rawAmount);
    if (!date || !Number.isFinite(amount) || amount <= 0) { skipped += 1; return; }
    let item = (row.item || row.note || "").trim();
    if (!item) { item = "CSV 导入记录"; warnings.push("缺少项目名称"); }
    const parsedCurrency = resolveCurrency(row.currency ?? "", ledger);
    const parsedBaseCurrency = resolveCurrency(row.baseCurrency ?? "", ledger);
    const currency = ledger.rates.some((rate) => rate.code === parsedCurrency) ? parsedCurrency : ledger.baseCurrency;
    const rowBaseCurrency = ledger.rates.some((rate) => rate.code === parsedBaseCurrency) ? parsedBaseCurrency : ledger.baseCurrency;
    if (currency !== parsedCurrency) warnings.push(`未收录币种“${row.currency}”，暂用“${currency}”`);
    if (rowBaseCurrency !== parsedBaseCurrency) warnings.push(`未收录本币“${row.baseCurrency}”，暂用“${rowBaseCurrency}”`);
    const categoryToken = normalizeToken(row.category ?? "");
    const category = ledger.categories.find((candidate) => candidate.type === type && [candidate.name, ...(candidate.aliases ?? [])].some((value) => normalizeToken(value) === categoryToken));
    const fallbackCategory = ledger.categories.find((candidate) => candidate.type === type && candidate.name === (type === "income" ? "生活费" : "日用")) ?? ledger.categories.find((candidate) => candidate.type === type);
    if (!row.category) warnings.push(`缺少分类，暂用“${fallbackCategory?.name ?? "未分类"}”`);
    else if (!category) warnings.push(`未找到分类“${row.category}”，暂用“${fallbackCategory?.name ?? "未分类"}”`);
    const accountToken = normalizeToken(row.account ?? "");
    const childAccounts = ledger.accounts.filter((candidate) => candidate.parentAccountId);
    const spendableAccounts = childAccounts.length ? childAccounts : ledger.accounts;
    const namedAccounts = spendableAccounts.filter((candidate) => {
      const parent = ledger.accounts.find((item) => item.id === candidate.parentAccountId);
      return [candidate.id, candidate.name, ...(candidate.aliases ?? []), ...(parent ? [`${parent.name} / ${candidate.name}`] : [])].some((value) => normalizeToken(value) === accountToken);
    });
    const matchingNamedAccounts = namedAccounts.filter((candidate) => (candidate.currency ?? ledger.baseCurrency) === rowBaseCurrency);
    const namedAccount = matchingNamedAccounts[0] ?? namedAccounts[0];
    if (matchingNamedAccounts.length > 1) warnings.push(`账户“${row.account}”对应多个子账户，请确认`);
    const matchingPrimary = ledger.accounts.find((candidate) => !candidate.parentAccountId && [candidate.id, candidate.name].some((value) => normalizeToken(value) === accountToken));
    const primaryChild = matchingPrimary && (accountChildren(ledger, matchingPrimary.id).find((candidate) => (candidate.currency ?? ledger.baseCurrency) === rowBaseCurrency) ?? accountChildren(ledger, matchingPrimary.id)[0]);
    const fallbackAccount = spendableAccounts.find((candidate) => (candidate.currency ?? ledger.baseCurrency) === rowBaseCurrency) ?? spendableAccounts[0];
    const account = namedAccount ?? primaryChild ?? fallbackAccount;
    if (!row.account) warnings.push(`缺少账户，暂用“${account?.name ?? "默认账户"}”`);
    else if (!namedAccount && !primaryChild) warnings.push(`未找到账户“${row.account}”，暂用“${account?.name ?? "默认账户"}”`);
    const rawPayment = normalizeToken(row.paymentKind ?? "");
    const paymentKind: PaymentKind = /分期|installment/.test(rawPayment) ? "installment" : /信用|credit/.test(rawPayment) ? "credit" : "normal";
    const creditToken = normalizeToken(row.creditTool ?? "");
    const creditToolId = ledger.creditTools.find((tool) => [tool.id, tool.name, ...(tool.aliases ?? [])].some((value) => normalizeToken(value) === creditToken))?.id;
    if (paymentKind !== "normal" && !creditToolId) warnings.push("信用付款信息不完整");
    const status = /待入账|scheduled|pending/.test(normalizeToken(row.status ?? "")) ? "scheduled" as const : "posted" as const;
    const exchangeRate = parseNumber(row.exchangeRate ?? "");
    const amountInBase = parseNumber(row.amountInBase ?? "");
    if (currency !== rowBaseCurrency && !(Number.isFinite(exchangeRate) && exchangeRate > 0) && !(Number.isFinite(amountInBase) && amountInBase > 0)) warnings.push("缺少原始汇率，将使用当前汇率");
    const transaction = withBookedMoney({
      id: crypto.randomUUID(),
      type,
      item,
      amount,
      date,
      currency,
      category: category?.name ?? fallbackCategory?.name ?? (type === "income" ? "生活费" : "日用"),
      accountId: account?.id ?? "cash",
      paymentKind,
      creditToolId: paymentKind === "normal" ? undefined : (creditToolId ?? ledger.creditTools[0]?.id),
      status,
      balanceApplied: canAffectAccountBalance({ status, paymentKind }),
      note: row.note || undefined,
    }, ledger.rates, Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : undefined, Number.isFinite(amountInBase) && amountInBase > 0 ? amountInBase : undefined, rowBaseCurrency) as Transaction;
    const acceptedPool = [...ledger.transactions, ...transactions];
    const exact = warnings.length === 0 ? acceptedPool.find((candidate) => sameExact(candidate, transaction)) : undefined;
    if (exact) { duplicates += 1; return; }
    const possibleDuplicate = [...acceptedPool, ...review.map((candidate) => candidate.transaction)].find((candidate) => sameCore(candidate, transaction));
    if (possibleDuplicate || warnings.length) {
      review.push({
        id: `csv-${rowNumber}-${transaction.id}`,
        rowNumber,
        kind: possibleDuplicate ? "possible-duplicate" : "incomplete",
        reasons: [...new Set([...(possibleDuplicate ? ["同日已有相同或相近的项目与金额"] : []), ...warnings])],
        transaction,
        existing: possibleDuplicate,
      });
      return;
    }
    transactions.push(transaction);
  });
  return { transactions, review, duplicates, skipped, totalRows: dataRows.length, ignoredColumns };
}
