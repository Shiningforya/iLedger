import type { Asset, LedgerState, Subscription, Transaction } from "./types";
import { canAffectAccountBalance, updateAccountsForTransactionChange, withBookedMoney } from "./transactionAccounting.js";

export interface TransactionCompanionDraft {
  item: string;
  amount: number;
  amountInBase: number;
  bookedBaseCurrency: string;
  category: string;
  accountId: string;
  date: string;
  isSubscription: boolean;
  subscriptionCycle: Subscription["cycle"];
  subscriptionMode: Subscription["renewalMode"];
  subscriptionEndsAt: string;
  subscriptionReminderDays: number;
  trackDepreciation: boolean;
  assetLifeDays?: number;
}

const upsert = <T extends { id: string }>(items: T[], value: T) => [value, ...items.filter((item) => item.id !== value.id)];

export function reconcileTransactionCompanions(state: LedgerState, transactionId: string, draft: TransactionCompanionDraft) {
  const transaction = state.transactions.find((item) => item.id === transactionId);
  const existingSubscriptionId = transaction?.subscriptionId;
  const existingAssetId = transaction?.assetId;
  const subscriptionId = draft.isSubscription ? (existingSubscriptionId ?? `${transactionId}-subscription`) : undefined;
  const assetId = draft.trackDepreciation ? (existingAssetId ?? `${transactionId}-asset`) : undefined;

  const subscriptions = draft.isSubscription
    ? upsert(state.subscriptions, {
        id: subscriptionId!,
        name: draft.item,
        amount: draft.amountInBase,
        bookedBaseCurrency: draft.bookedBaseCurrency,
        amountCny: Number((draft.amountInBase * (state.rates.find((rate) => rate.code === draft.bookedBaseCurrency)?.rateToCny || 1)).toFixed(2)),
        cycle: draft.subscriptionCycle,
        startedAt: draft.date,
        endsAt: draft.subscriptionEndsAt,
        accountId: draft.accountId,
        category: draft.category,
        renewalMode: draft.subscriptionMode,
        reminderDays: draft.subscriptionReminderDays,
      })
    : existingSubscriptionId
      ? state.subscriptions.filter((item) => item.id !== existingSubscriptionId)
      : state.subscriptions;

  const assets = draft.trackDepreciation
    ? upsert(state.assets, {
        id: assetId!,
        name: draft.item,
        price: draft.amountInBase,
        bookedBaseCurrency: draft.bookedBaseCurrency,
        priceCny: Number((draft.amountInBase * (state.rates.find((rate) => rate.code === draft.bookedBaseCurrency)?.rateToCny || 1)).toFixed(2)),
        purchasedAt: draft.date,
        lifeDays: draft.assetLifeDays || undefined,
        category: draft.category,
      })
    : existingAssetId
      ? state.assets.filter((item) => item.id !== existingAssetId)
      : state.assets;

  return { subscriptionId, assetId, subscriptions, assets };
}

export function saveSubscriptionAndSyncTransaction(state: LedgerState, subscription: Subscription): LedgerState {
  const linkedAssetIds = new Set(state.transactions.filter((item) => item.subscriptionId === subscription.id).map((item) => item.assetId).filter((id): id is string => Boolean(id)));
  let accounts = state.accounts;
  const transactions = state.transactions.map((item) => {
    if (item.subscriptionId !== subscription.id) return item;
    const bookingCurrency = item.bookedBaseCurrency ?? subscription.bookedBaseCurrency ?? state.baseCurrency;
    const next = withBookedMoney({
      ...item,
      item: subscription.name,
      amount: item.currency === bookingCurrency ? subscription.amount : item.amount,
      category: subscription.category,
      accountId: subscription.accountId,
      date: subscription.startedAt,
      balanceApplied: canAffectAccountBalance(item),
    }, state.rates, item.amount > 0 ? subscription.amount / item.amount : undefined, subscription.amount, bookingCurrency) as Transaction;
    accounts = updateAccountsForTransactionChange(accounts, state.rates, item, next, bookingCurrency);
    return next;
  });
  return {
    ...state,
    accounts,
    subscriptions: upsert(state.subscriptions, { ...subscription, bookedBaseCurrency: subscription.bookedBaseCurrency ?? state.baseCurrency, amountCny: Number((subscription.amount * (state.rates.find((rate) => rate.code === (subscription.bookedBaseCurrency ?? state.baseCurrency))?.rateToCny || 1)).toFixed(2)) }),
    assets: state.assets.map((item) => linkedAssetIds.has(item.id) ? {
      ...item,
      name: subscription.name,
      price: subscription.amount,
      bookedBaseCurrency: subscription.bookedBaseCurrency ?? state.baseCurrency,
      priceCny: Number((subscription.amount * (state.rates.find((rate) => rate.code === (subscription.bookedBaseCurrency ?? state.baseCurrency))?.rateToCny || 1)).toFixed(2)),
      category: subscription.category,
      purchasedAt: subscription.startedAt,
    } : item),
    transactions,
  };
}

export function saveAssetAndSyncTransaction(state: LedgerState, asset: Asset): LedgerState {
  const linkedSubscriptionIds = new Set(state.transactions.filter((item) => item.assetId === asset.id).map((item) => item.subscriptionId).filter((id): id is string => Boolean(id)));
  let accounts = state.accounts;
  const transactions = state.transactions.map((item) => {
    if (item.assetId !== asset.id) return item;
    const bookingCurrency = item.bookedBaseCurrency ?? asset.bookedBaseCurrency ?? state.baseCurrency;
    const next = withBookedMoney({
      ...item,
      item: asset.name,
      amount: item.currency === bookingCurrency ? asset.price : item.amount,
      category: asset.category,
      date: asset.purchasedAt,
      balanceApplied: canAffectAccountBalance(item),
    }, state.rates, item.amount > 0 ? asset.price / item.amount : undefined, asset.price, bookingCurrency) as Transaction;
    accounts = updateAccountsForTransactionChange(accounts, state.rates, item, next, bookingCurrency);
    return next;
  });
  return {
    ...state,
    accounts,
    assets: upsert(state.assets, { ...asset, bookedBaseCurrency: asset.bookedBaseCurrency ?? state.baseCurrency, priceCny: Number((asset.price * (state.rates.find((rate) => rate.code === (asset.bookedBaseCurrency ?? state.baseCurrency))?.rateToCny || 1)).toFixed(2)) }),
    subscriptions: state.subscriptions.map((item) => linkedSubscriptionIds.has(item.id) ? {
      ...item,
      name: asset.name,
      amount: asset.price,
      bookedBaseCurrency: asset.bookedBaseCurrency ?? state.baseCurrency,
      amountCny: Number((asset.price * (state.rates.find((rate) => rate.code === (asset.bookedBaseCurrency ?? state.baseCurrency))?.rateToCny || 1)).toFixed(2)),
      category: asset.category,
      startedAt: asset.purchasedAt,
    } : item),
    transactions,
  };
}

export function removeManagedRecordAndClearLink(state: LedgerState, kind: "subscription" | "asset", id: string): LedgerState {
  if (kind === "subscription") return {
    ...state,
    subscriptions: state.subscriptions.filter((item) => item.id !== id),
    transactions: state.transactions.map((item) => item.subscriptionId === id ? { ...item, subscriptionId: undefined } : item),
  };
  return {
    ...state,
    assets: state.assets.filter((item) => item.id !== id),
    transactions: state.transactions.map((item) => item.assetId === id ? { ...item, assetId: undefined } : item),
  };
}

export function renameCategoryReferences(state: LedgerState, previousName: string, nextName: string): LedgerState {
  if (previousName === nextName) return state;
  return {
    ...state,
    transactions: state.transactions.map((item) => item.category === previousName ? { ...item, category: nextName } : item),
    subscriptions: state.subscriptions.map((item) => item.category === previousName ? { ...item, category: nextName } : item),
    assets: state.assets.map((item) => item.category === previousName ? { ...item, category: nextName } : item),
    projectRules: state.projectRules.map((item) => item.category === previousName ? { ...item, category: nextName } : item),
  };
}

export function managedCategoryName(state: LedgerState, id: "borrowing" | "loan-repayment") {
  return state.categories.find((category) => category.id === id)?.name ?? (id === "borrowing" ? "借款" : "归还借款");
}

export function isBorrowingCategory(state: LedgerState, name: string) {
  return state.categories.some((category) => category.id === "borrowing" && category.type === "income" && category.name === name);
}

export function transferAndRemoveChildAccount(state: LedgerState, sourceId: string, replacementId: string): LedgerState {
  const source = state.accounts.find((item) => item.id === sourceId);
  const replacement = state.accounts.find((item) => item.id === replacementId);
  if (!source?.parentAccountId || !replacement?.parentAccountId || sourceId === replacementId) throw new Error("请选择另一个子账户承接流水");
  if (source.currency !== replacement.currency) throw new Error("只能转入相同币种的子账户");
  if (state.creditTools.some((tool) => tool.accountId === replacementId)) throw new Error("不能转入已有信用能力的子账户");
  const destinationParentId = replacement.parentAccountId;
  const route = (id: string) => id === sourceId ? replacementId : id;
  return {
    ...state,
    accounts: state.accounts.filter((item) => item.id !== sourceId).map((item) => item.id === replacementId ? { ...item, balance: Number((item.balance + source.balance).toFixed(2)) } : item),
    transactions: state.transactions.map((item) => item.accountId === sourceId ? { ...item, accountId: replacementId } : item),
    subscriptions: state.subscriptions.map((item) => item.accountId === sourceId ? { ...item, accountId: replacementId } : item),
    repayments: state.repayments.map((item) => item.accountId === sourceId ? { ...item, accountId: replacementId } : item),
    loans: (state.loans ?? []).map((item) => ({ ...item, accountId: route(item.accountId), repaymentAccountId: item.repaymentAccountId ? route(item.repaymentAccountId) : undefined })),
    projectRules: state.projectRules.map((item) => item.accountId === sourceId ? { ...item, accountId: replacementId } : item),
    creditTools: state.creditTools.map((tool) => ({
      ...tool,
      accountId: tool.accountId ? route(tool.accountId) : undefined,
      parentAccountId: tool.accountId === sourceId ? destinationParentId : tool.parentAccountId,
      repaymentAccountId: route(tool.repaymentAccountId),
      repaymentAccountIds: [...new Set(tool.repaymentAccountIds.map(route))],
    })),
  };
}
