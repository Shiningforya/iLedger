import assert from "node:assert/strict";
import {
  accountDisplayBalance,
  assetPriceInBase,
  applyNewTransactionsToAccounts,
  currencyIsReferenced,
  hasSpendableAccountForCurrency,
  repaymentAmountInBase,
  removeTransactionsAndRevertBalances,
  stabilizeAccountCurrencies,
  subscriptionAmountInBase,
  totalAssetBalance,
  transactionAmountInBase,
  transactionAmountCny,
  updateAccountsForTransactionChange,
  withBookedMoney,
} from "../.test-build/transactionAccounting.js";

const rates = [{ code: "CNY", rateToCny: 1 }, { code: "USD", rateToCny: 7.08 }, { code: "SGD", rateToCny: 5.52 }];
const accounts = [
  { id: "platform", name: "平台", institution: "平台", kind: "wallet", balance: 999, color: "#fff" },
  { id: "balance", name: "余额", institution: "平台", kind: "wallet", balance: 500, color: "#fff", parentAccountId: "platform" },
  { id: "card", name: "银行卡", institution: "银行", kind: "bank", balance: 1000, color: "#fff" },
];
const creditTools = [];
const expense = withBookedMoney({ id: "usd", type: "expense", item: "GPT", category: "AI", accountId: "card", amount: 20, date: "2026-10-02", currency: "USD", paymentKind: "normal", status: "posted", balanceApplied: true }, rates, 7.08);

assert.equal(transactionAmountCny(expense, rates), 141.6);
const afterExpense = applyNewTransactionsToAccounts(accounts, rates, [expense]);
assert.equal(afterExpense.find((item) => item.id === "card").balance, 858.4);

const income = withBookedMoney({ ...expense, type: "income", accountId: "balance", amount: 30 }, rates, 7.08);
const afterEdit = updateAccountsForTransactionChange(afterExpense, rates, expense, income);
assert.equal(afterEdit.find((item) => item.id === "card").balance, 1000, "editing must first undo the old account impact");
assert.equal(afterEdit.find((item) => item.id === "balance").balance, 712.4, "editing must apply the new converted amount");

const state = { accounts: afterExpense, transactions: [expense], rates, creditTools };
const removed = removeTransactionsAndRevertBalances(state, new Set(["usd"]));
assert.equal(removed.accounts.find((item) => item.id === "card").balance, 1000);

const legacy = { ...expense, id: "legacy", balanceApplied: undefined };
const legacyRemoved = removeTransactionsAndRevertBalances({ ...state, transactions: [legacy] }, new Set(["legacy"]));
assert.equal(legacyRemoved.accounts.find((item) => item.id === "card").balance, 858.4, "legacy records must not reverse a balance they never changed");

const hierarchyState = { accounts, creditTools, rates };
assert.equal(accountDisplayBalance(hierarchyState, accounts[0]), 500, "parent display balance comes from non-credit children");
assert.equal(totalAssetBalance(hierarchyState), 1500, "asset total counts leaf balances once");

const sgdExpense = withBookedMoney({ ...expense, id: "sgd-base", amount: 20 }, rates, 7.08 / 5.52, undefined, "SGD");
assert.equal(transactionAmountInBase(sgdExpense, rates, "SGD"), 25.65, "foreign transactions convert into the selected base currency");
const afterSgdExpense = applyNewTransactionsToAccounts(accounts, rates, [sgdExpense], "SGD");
assert.equal(afterSgdExpense.find((item) => item.id === "card").balance, 974.35, "account balances are measured in the selected base currency");

const currencyAccounts = [
  { id: "parent", name: "多币种银行", institution: "银行", kind: "bank", balance: 0, color: "#fff" },
  { id: "cny-child", name: "人民币账户", institution: "银行", kind: "bank", balance: 100, currency: "CNY", color: "#fff", parentAccountId: "parent" },
  { id: "usd-child", name: "美元账户", institution: "银行", kind: "bank", balance: 20, currency: "USD", color: "#fff", parentAccountId: "parent" },
];
const switchedView = { accounts: currencyAccounts, creditTools: [], rates, baseCurrency: "SGD" };
assert.equal(accountDisplayBalance(switchedView, currencyAccounts[0]), 43.77, "switching base currency converts only the displayed parent total");
assert.equal(totalAssetBalance(switchedView), 43.77, "mixed-currency assets are aggregated only for display");
assert.equal(hasSpendableAccountForCurrency(switchedView, "USD"), true, "a base switch is allowed only when a matching child account exists");
assert.equal(hasSpendableAccountForCurrency(switchedView, "SGD"), false, "a missing settlement account blocks the base switch");
assert.equal(currencyAccounts[1].balance, 100, "switching the view must not mutate the historical child balance");
const cnyAccountAfterUsdExpense = applyNewTransactionsToAccounts(currencyAccounts, rates, [expense], "SGD");
assert.equal(cnyAccountAfterUsdExpense.find((item) => item.id === "cny-child").balance, 100, "an unrelated account remains untouched");
const expenseOnCny = { ...expense, accountId: "cny-child" };
const bookedAgainstAccountCurrency = applyNewTransactionsToAccounts(currencyAccounts, rates, [expenseOnCny], "SGD");
assert.equal(bookedAgainstAccountCurrency.find((item) => item.id === "cny-child").balance, -41.6, "balance updates use the child account currency instead of the newly selected base");
assert.equal(repaymentAmountInBase({ amount: 100, bookedBaseCurrency: "CNY", amountCny: 100 }, rates, "SGD"), 18.12);
assert.equal(subscriptionAmountInBase({ amount: 20, bookedBaseCurrency: "USD", amountCny: 141.6 }, rates, "SGD"), 25.65);
assert.equal(assetPriceInBase({ price: 20, bookedBaseCurrency: "USD", priceCny: 141.6 }, rates, "CNY"), 141.6);

const repairedAccounts = stabilizeAccountCurrencies({
  accounts: [
    { id: "legacy-parent", name: "旧银行", currency: "USD", balance: 0 },
    { id: "legacy-cny", name: "原人民币账户", parentAccountId: "legacy-parent", balance: 100 },
    { id: "legacy-empty", name: "无流水账户", parentAccountId: "legacy-parent", balance: 20 },
    { id: "explicit-usd", name: "美元账户", parentAccountId: "legacy-parent", currency: "USD", balance: 30 },
  ],
  transactions: [{ ...expense, accountId: "legacy-cny" }],
  repayments: [],
  subscriptions: [],
  baseCurrency: "USD",
});
assert.equal(repairedAccounts.find((item) => item.id === "legacy-cny").currency, "CNY", "legacy accounts recover their historical settlement currency after a base switch");
assert.equal(repairedAccounts.find((item) => item.id === "legacy-empty").currency, "CNY", "accounts without direct history use the dominant historical base instead of the new base");
assert.equal(repairedAccounts.find((item) => item.id === "explicit-usd").currency, "USD", "an explicit child currency is never rewritten");
assert.equal(repairedAccounts.find((item) => item.id === "legacy-parent").currency, undefined, "primary containers never carry a spendable currency");
assert.equal(repairedAccounts.find((item) => item.id === "legacy-cny").balance, 100, "currency repair never converts or changes balances");
const noHistoryRepair = stabilizeAccountCurrencies({
  accounts: [{ id: "parent", balance: 0 }, { id: "child", parentAccountId: "parent", balance: 88 }],
  transactions: [],
  repayments: [],
  subscriptions: [],
  baseCurrency: "USD",
});
assert.equal(noHistoryRepair.find((item) => item.id === "child").currency, "CNY", "a transaction-free legacy account still keeps the old implicit CNY currency");

const usdAccounts = [
  { id: "usd-parent", name: "Dollar bank", balance: 0 },
  { id: "usd-child", name: "USD checking", parentAccountId: "usd-parent", balance: 100, currency: "USD" },
];
const usdBookedExpense = { ...expense, accountId: "usd-child" };
const changedRates = rates.map((rate) => rate.code === "USD" ? { ...rate, rateToCny: 7.5 } : rate);
const postedAfterRateChange = applyNewTransactionsToAccounts(usdAccounts, changedRates, [usdBookedExpense], "SGD");
assert.equal(postedAfterRateChange[1].balance, 80, "a USD account is debited by the original USD amount even after rates change");
assert.equal(removeTransactionsAndRevertBalances({ accounts: postedAfterRateChange, transactions: [usdBookedExpense], rates: changedRates, baseCurrency: "SGD" }, new Set([usdBookedExpense.id])).accounts[1].balance, 100, "deleting historical spending restores the exact original account amount");

const creditHierarchy = {
  accounts: [...currencyAccounts, { id: "credit-child", name: "USD credit", parentAccountId: "parent", balance: 50, currency: "USD" }],
  creditTools: [{ id: "credit", accountId: "credit-child" }],
  rates,
  baseCurrency: "CNY",
};
assert.equal(accountDisplayBalance(creditHierarchy, creditHierarchy.accounts[0]), 241.6, "the parent total excludes credit subaccounts");

const referenceBase = { accounts: [], transactions: [], repayments: [], subscriptions: [], assets: [], loans: [] };
for (const field of ["accounts", "transactions", "repayments", "subscriptions", "assets", "loans"]) {
  const entry = field === "accounts" || field === "loans" ? { currency: "USD" } : { bookedBaseCurrency: "USD" };
  assert.equal(currencyIsReferenced({ ...referenceBase, [field]: [entry] }, "USD"), true, `${field} protects its currency from deletion`);
}
assert.equal(currencyIsReferenced(referenceBase, "USD"), false);

console.log("transaction accounting regression tests: 36 assertions passed");
