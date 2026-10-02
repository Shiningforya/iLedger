import assert from "node:assert/strict";
import { exportTransactionsCsv, importTransactionsCsv } from "../.test-build/csv.js";
import { initialLedger } from "../.test-build/demoData.js";

const source = [{ ...initialLedger.transactions[0], item: "咖啡,面包", note: "包含\"引号\"" }];
const csv = exportTransactionsCsv(source, initialLedger);
const result = importTransactionsCsv(csv, initialLedger);

assert.equal(result.skipped, 0);
assert.equal(result.transactions.length, 1);
assert.equal(result.transactions[0].item, "咖啡,面包");
assert.equal(result.transactions[0].note, "包含\"引号\"");
assert.equal(result.transactions[0].amountCny, source[0].amount);
assert.equal(result.transactions[0].balanceApplied, true);

const sgdLedger = { ...initialLedger, baseCurrency: "SGD" };
const foreignCsv = exportTransactionsCsv([{ ...source[0], amount: 20, currency: "USD", amountCny: 141.6, exchangeRateToCny: 7.08 }], sgdLedger);
assert.match(foreignCsv, /原币金额,原币,兑本币汇率,本币,折算本币/);
assert.match(foreignCsv, /USD,[^,]+,SGD,/);
const foreignResult = importTransactionsCsv(foreignCsv, sgdLedger);
assert.equal(foreignResult.transactions[0].bookedBaseCurrency, "SGD");
assert.equal(foreignResult.transactions[0].amountInBase, 25.65);

const historicalCsv = exportTransactionsCsv([{ ...source[0], amount: 20, currency: "USD", bookedBaseCurrency: "CNY", amountInBase: 141.6, amountCny: 141.6, exchangeRateToBase: 7.08, exchangeRateToCny: 7.08 }], sgdLedger);
assert.match(historicalCsv, /USD,7\.08,CNY,141\.6/, "export must preserve the base currency frozen on the historical transaction");
const historicalResult = importTransactionsCsv(historicalCsv, sgdLedger);
assert.equal(historicalResult.transactions[0].bookedBaseCurrency, "CNY");
assert.equal(historicalResult.transactions[0].amountInBase, 141.6);

const hierarchicalLedger = {
  ...initialLedger,
  accounts: [
    { id: "wallet", name: "钱包", institution: "钱包", kind: "wallet", balance: 0, color: "#000" },
    { id: "wallet-cny", name: "钱包", institution: "钱包", kind: "wallet", balance: 0, currency: "CNY", color: "#000", parentAccountId: "wallet" },
    { id: "wallet-usd", name: "钱包", institution: "钱包", kind: "wallet", balance: 0, currency: "USD", color: "#000", parentAccountId: "wallet" },
  ],
};
const hierarchicalCsv = "日期,类型,项目,原币金额,原币,兑本币汇率,本币,折算本币,分类,账户,付款类型\n2026-10-02,支出,测试,20,USD,1,USD,20,日用,钱包,普通付款";
const hierarchicalResult = importTransactionsCsv(hierarchicalCsv, hierarchicalLedger);
assert.equal(hierarchicalResult.transactions[0].accountId, "wallet-usd", "CSV import should resolve duplicate names to the child matching the booked base currency");
assert.equal(hierarchicalResult.transactions[0].bookedBaseCurrency, "USD");

const duplicateCsv = exportTransactionsCsv(result.transactions, { ...initialLedger, transactions: result.transactions });
const duplicateResult = importTransactionsCsv(duplicateCsv, { ...initialLedger, transactions: result.transactions });
assert.equal(duplicateResult.transactions.length, 0, "an exported transaction already in the database must not be imported again");
assert.equal(duplicateResult.review.length, 0);
assert.equal(duplicateResult.duplicates, 1);

const flexibleCsv = "交易日期\t收支\t商户名称\t交易金额\t货币\t汇率\t本位币\t类别\t支付方式\t银行流水号\n2026/10/02\t支出\t外部账单\t1,234.56\tCNY\t1\tCNY\t日用\t支付宝\tEXTRA-1";
const flexibleResult = importTransactionsCsv(flexibleCsv, initialLedger);
assert.equal(flexibleResult.transactions.length, 1, "tab-separated third-party CSV files should be accepted");
assert.equal(flexibleResult.transactions[0].date, "2026-10-02");
assert.equal(flexibleResult.transactions[0].amount, 1234.56);
assert.equal(flexibleResult.review.length, 0);
assert.deepEqual(flexibleResult.ignoredColumns, ["银行流水号"], "unrelated columns should be ignored without invalidating the row");

const possibleExisting = { ...source[0], id: "existing-chatgpt", date: "2026-10-02", item: "ChatGPT Plus", amount: 20, currency: "USD" };
const sparseCsv = "交易日期;商户;支出金额;货币;无关列\n2026/10/02;ChatGPT;20;USD;保留但忽略";
const sparseResult = importTransactionsCsv(sparseCsv, { ...initialLedger, transactions: [possibleExisting] });
assert.equal(sparseResult.transactions.length, 0, "uncertain rows must not be imported automatically");
assert.equal(sparseResult.review.length, 1);
assert.equal(sparseResult.review[0].kind, "possible-duplicate");
assert.match(sparseResult.review[0].reasons.join("，"), /相同或相近/);
assert.match(sparseResult.review[0].reasons.join("，"), /缺少分类/);
assert.match(sparseResult.review[0].reasons.join("，"), /缺少账户/);

const incompleteResult = importTransactionsCsv("日期,金额,备注,额外字段\n2026年10月2日,88,临时记录,被忽略", initialLedger);
assert.equal(incompleteResult.review.length, 1, "rows with inferred fields should be sent to manual review");
assert.equal(incompleteResult.review[0].transaction.item, "临时记录");
assert.equal(incompleteResult.ignoredColumns[0], "额外字段");

const repeatedUncertain = importTransactionsCsv("日期,金额,备注\n2026-10-02,66,外部记录\n2026-10-02,66,外部记录", initialLedger);
assert.equal(repeatedUncertain.review.length, 2);
assert.equal(repeatedUncertain.review[0].kind, "incomplete");
assert.equal(repeatedUncertain.review[1].kind, "possible-duplicate", "duplicate candidates inside the same external file should also be identified");

const invalidResult = importTransactionsCsv("日期,项目,金额\n不是日期,测试,20", initialLedger);
assert.equal(invalidResult.skipped, 1, "rows without a valid date or amount remain invalid");

const unsupportedCurrency = importTransactionsCsv("日期,类型,项目,金额,币种,本币,分类,账户\n2026-10-02,支出,外部付款,18,XYZ,ZZZ,日用,支付宝", initialLedger);
assert.equal(unsupportedCurrency.transactions.length, 0, "an unknown currency must not enter the ledger unchecked");
assert.equal(unsupportedCurrency.review.length, 1);
assert.equal(unsupportedCurrency.review[0].transaction.currency, initialLedger.baseCurrency, "unknown currency falls back to an editable known option");
assert.match(unsupportedCurrency.review[0].reasons.join("，"), /未收录币种/);
assert.match(unsupportedCurrency.review[0].reasons.join("，"), /未收录本币/);

const ambiguousLedger = { ...hierarchicalLedger, accounts: [
  ...hierarchicalLedger.accounts,
  { id: "other-parent", name: "其他钱包", balance: 0 },
  { id: "other-wallet-cny", name: "钱包", parentAccountId: "other-parent", currency: "CNY", balance: 0 },
] };
const ambiguousImport = importTransactionsCsv("日期,类型,项目,金额,分类,账户\n2026-10-02,支出,重复名称账户,30,日用,钱包", ambiguousLedger);
assert.equal(ambiguousImport.review.length, 1);
assert.match(ambiguousImport.review[0].reasons.join("，"), /多个子账户/);

const qualifiedCsv = exportTransactionsCsv([{ ...source[0], accountId: "other-wallet-cny" }], ambiguousLedger);
assert.match(qualifiedCsv, /其他钱包 \/ 钱包/, "exports identify both the primary and child account");
const qualifiedImport = importTransactionsCsv(qualifiedCsv, ambiguousLedger);
assert.equal(qualifiedImport.transactions[0].accountId, "other-wallet-cny", "a CSV round trip preserves the correct child when names collide");

console.log("csv round-trip tests: 40 assertions passed");
