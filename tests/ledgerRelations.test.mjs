import assert from "node:assert/strict";
import { initialLedger } from "../.test-build/demoData.js";
import {
  reconcileTransactionCompanions,
  isBorrowingCategory,
  managedCategoryName,
  removeManagedRecordAndClearLink,
  renameCategoryReferences,
  saveAssetAndSyncTransaction,
  saveSubscriptionAndSyncTransaction,
  transferAndRemoveChildAccount,
} from "../.test-build/ledgerRelations.js";
import { withBookedMoney } from "../.test-build/transactionAccounting.js";
import { buildAnalyticsModel, createDefaultTile } from "../.test-build/tileAnalytics.js";

const source = initialLedger.transactions.find((item) => item.item === "Nintendo eShop");
const companions = reconcileTransactionCompanions(initialLedger, source.id, {
  item: source.item,
  amount: source.amount,
  amountInBase: source.amount,
  bookedBaseCurrency: "CNY",
  category: source.category,
  accountId: source.accountId,
  date: source.date,
  isSubscription: true,
  subscriptionCycle: "monthly",
  subscriptionMode: "fixed",
  subscriptionEndsAt: "2026-11-01",
  subscriptionReminderDays: 5,
  trackDepreciation: true,
  assetLifeDays: 730,
});
assert.equal(companions.subscriptionId, `${source.id}-subscription`);
assert.equal(companions.assetId, `${source.id}-asset`);
assert.equal(companions.subscriptions.find((item) => item.id === companions.subscriptionId).name, "Nintendo eShop");
assert.equal(companions.assets.find((item) => item.id === companions.assetId).lifeDays, 730);
assert.equal(companions.subscriptions.find((item) => item.id === companions.subscriptionId).bookedBaseCurrency, "CNY");
assert.equal(companions.subscriptions.find((item) => item.id === companions.subscriptionId).amountCny, source.amount);
assert.equal(companions.assets.find((item) => item.id === companions.assetId).priceCny, source.amount);

const linkedState = {
  ...initialLedger,
  subscriptions: companions.subscriptions,
  assets: companions.assets,
  transactions: initialLedger.transactions.map((item) => item.id === source.id ? { ...item, subscriptionId: companions.subscriptionId, assetId: companions.assetId } : item),
};
const changedSubscription = saveSubscriptionAndSyncTransaction(linkedState, { ...companions.subscriptions.find((item) => item.id === companions.subscriptionId), name: "Nintendo Online", amount: 300 });
assert.equal(changedSubscription.transactions.find((item) => item.id === source.id).item, "Nintendo Online");
assert.equal(changedSubscription.transactions.find((item) => item.id === source.id).amount, 300);
assert.equal(changedSubscription.assets.find((item) => item.id === companions.assetId).name, "Nintendo Online");

const changedAsset = saveAssetAndSyncTransaction(changedSubscription, { ...companions.assets.find((item) => item.id === companions.assetId), name: "Nintendo 主机", price: 2399 });
assert.equal(changedAsset.transactions.find((item) => item.id === source.id).item, "Nintendo 主机");
assert.equal(changedAsset.transactions.find((item) => item.id === source.id).amount, 2399);
assert.equal(changedAsset.subscriptions.find((item) => item.id === companions.subscriptionId).name, "Nintendo 主机");

const removed = removeManagedRecordAndClearLink(changedAsset, "subscription", companions.subscriptionId);
assert.equal(removed.transactions.find((item) => item.id === source.id).subscriptionId, undefined);
assert.equal(removed.subscriptions.some((item) => item.id === companions.subscriptionId), false);

const renamed = renameCategoryReferences(linkedState, "娱乐", "影音娱乐");
assert.equal(renamed.transactions.find((item) => item.id === source.id).category, "影音娱乐");
assert.equal(renamed.subscriptions.find((item) => item.id === companions.subscriptionId).category, "影音娱乐");
assert.equal(renamed.assets.find((item) => item.id === companions.assetId).category, "影音娱乐");
const renamedLoanCategory = { ...initialLedger, categories: initialLedger.categories.map((item) => item.id === "borrowing" ? { ...item, name: "私人借入" } : item) };
assert.equal(managedCategoryName(renamedLoanCategory, "borrowing"), "私人借入");
assert.equal(isBorrowingCategory(renamedLoanCategory, "私人借入"), true);
assert.equal(isBorrowingCategory(renamedLoanCategory, "借款"), false);

const rates = [{ code: "CNY", rateToCny: 1 }, { code: "USD", rateToCny: 7 }];
const linkedForeign = withBookedMoney({ id: "foreign-tx", type: "expense", item: "Cloud", amount: 20, currency: "USD", accountId: "cny-child", category: "数码", date: "2026-10-02", paymentKind: "normal", status: "posted", balanceApplied: true, subscriptionId: "foreign-sub", assetId: "foreign-asset" }, rates, 7, 140, "CNY");
const foreignState = {
  ...initialLedger,
  rates,
  baseCurrency: "CNY",
  accounts: [{ id: "parent", balance: 0 }, { id: "cny-child", parentAccountId: "parent", balance: 860, currency: "CNY" }, { id: "replacement", parentAccountId: "parent", balance: 40, currency: "CNY" }],
  creditTools: [],
  transactions: [linkedForeign],
  subscriptions: [{ id: "foreign-sub", name: "Cloud", amount: 140, bookedBaseCurrency: "CNY", amountCny: 140, startedAt: "2026-10-02", endsAt: "2026-11-02", cycle: "monthly", renewalMode: "auto", reminderDays: 3, accountId: "cny-child", category: "数码" }],
  assets: [{ id: "foreign-asset", name: "Cloud", price: 140, bookedBaseCurrency: "CNY", priceCny: 140, purchasedAt: "2026-10-02", category: "数码" }],
  repayments: [], loans: [], projectRules: [],
};
const subEdited = saveSubscriptionAndSyncTransaction(foreignState, { ...foreignState.subscriptions[0], name: "Cloud Pro", amount: 175 });
assert.equal(subEdited.transactions[0].item, "Cloud Pro");
assert.equal(subEdited.transactions[0].amount, 20, "a base-currency price edit keeps the original USD transaction amount");
assert.equal(subEdited.transactions[0].amountInBase, 175);
assert.equal(subEdited.accounts[1].balance, 825, "subscription edits reconcile the linked account balance");
assert.equal(subEdited.assets[0].price, 175, "a linked asset receives the updated price");
const assetEdited = saveAssetAndSyncTransaction(subEdited, { ...subEdited.assets[0], price: 210 });
assert.equal(assetEdited.transactions[0].amountInBase, 210);
assert.equal(assetEdited.accounts[1].balance, 790);
assert.equal(assetEdited.subscriptions[0].amount, 210);
const totalExpenseTile = createDefaultTile("integration-expense");
assert.equal(buildAnalyticsModel(totalExpenseTile, assetEdited, new Date("2026-10-02T12:00:00")).value, 210, "editing linked assets updates dashboard totals through the transaction");
const switchedBase = { ...assetEdited, baseCurrency: "USD" };
assert.equal(buildAnalyticsModel(totalExpenseTile, switchedBase, new Date("2026-10-02T12:00:00")).value, 30, "a later base-currency switch converts the frozen historical value only for display");
assert.equal(switchedBase.transactions[0].currency, "USD", "the original transaction currency remains unchanged");
assert.equal(switchedBase.transactions[0].bookedBaseCurrency, "CNY", "the original booking currency remains unchanged");
assert.equal(switchedBase.accounts[1].currency, "CNY", "the historical account settlement currency remains unchanged");
assert.equal(switchedBase.accounts[1].balance, 790, "the historical account balance remains unchanged");

const transferable = {
  ...assetEdited,
  loans: [{ id: "loan", transactionId: "foreign-tx", accountId: "cny-child", repaymentAccountId: "cny-child", currency: "CNY" }],
  repayments: [{ id: "repayment", accountId: "cny-child", creditToolId: "other", amount: 5 }],
  projectRules: [{ id: "rule", accountId: "cny-child", keyword: "Cloud", item: "Cloud Pro", uses: 1 }],
  creditTools: [{ id: "source-credit", accountId: "cny-child", parentAccountId: "parent", repaymentAccountId: "cny-child", repaymentAccountIds: ["cny-child", "replacement"] }],
};
const transferred = transferAndRemoveChildAccount(transferable, "cny-child", "replacement");
assert.equal(transferred.accounts.find((item) => item.id === "cny-child"), undefined);
assert.equal(transferred.accounts.find((item) => item.id === "replacement").balance, 830);
assert.equal(transferred.transactions[0].accountId, "replacement");
assert.equal(transferred.subscriptions[0].accountId, "replacement");
assert.equal(transferred.loans[0].accountId, "replacement");
assert.equal(transferred.loans[0].repaymentAccountId, "replacement");
assert.equal(transferred.repayments[0].accountId, "replacement");
assert.equal(transferred.projectRules[0].accountId, "replacement");
assert.equal(transferred.creditTools[0].accountId, "replacement");
assert.deepEqual(transferred.creditTools[0].repaymentAccountIds, ["replacement"]);
assert.throws(() => transferAndRemoveChildAccount({ ...transferable, creditTools: [...transferable.creditTools, { id: "destination-credit", accountId: "replacement" }] }, "cny-child", "replacement"), /已有信用能力/);
assert.throws(() => transferAndRemoveChildAccount({ ...transferable, accounts: transferable.accounts.map((item) => item.id === "replacement" ? { ...item, currency: "USD" } : item) }, "cny-child", "replacement"), /相同币种/);

console.log("ledger relationship regression tests: 47 assertions passed");
