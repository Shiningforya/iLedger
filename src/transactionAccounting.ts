import type { Account, Asset, ExchangeRate, LedgerState, Repayment, Subscription, Transaction } from "./types";

const roundMoney = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));

export function rateToCnyFor(currency: string, rates: ExchangeRate[]) {
  if (currency === "CNY") return 1;
  const rate = rates.find((item) => item.code === currency)?.rateToCny;
  return rate && rate > 0 ? rate : 1;
}

export function rateToBaseFor(currency: string, baseCurrency: string, rates: ExchangeRate[]) {
  return rateToCnyFor(currency, rates) / rateToCnyFor(baseCurrency, rates);
}

export function convertBaseAmount(value: number, fromCurrency: string, toCurrency: string, rates: ExchangeRate[]) {
  return roundMoney(value * rateToBaseFor(fromCurrency, toCurrency, rates));
}

export function transactionAmountCny(transaction: Pick<Transaction, "amount" | "currency" | "amountCny" | "exchangeRateToCny">, rates: ExchangeRate[]) {
  if (Number.isFinite(transaction.amountCny)) return roundMoney(Number(transaction.amountCny));
  const rate = transaction.exchangeRateToCny && transaction.exchangeRateToCny > 0
    ? transaction.exchangeRateToCny
    : rateToCnyFor(transaction.currency, rates);
  return roundMoney(transaction.amount * rate);
}

export function transactionAmountInBase(
  transaction: Pick<Transaction, "amount" | "currency" | "amountCny" | "exchangeRateToCny" | "bookedBaseCurrency" | "amountInBase">,
  rates: ExchangeRate[],
  baseCurrency: string,
) {
  if (transaction.bookedBaseCurrency === baseCurrency && Number.isFinite(transaction.amountInBase)) return roundMoney(Number(transaction.amountInBase));
  return roundMoney(transactionAmountCny(transaction, rates) / rateToCnyFor(baseCurrency, rates));
}

export function frozenAmountInBase(
  amount: number,
  bookedBaseCurrency: string | undefined,
  amountCny: number | undefined,
  rates: ExchangeRate[],
  baseCurrency: string,
) {
  if (bookedBaseCurrency === baseCurrency) return roundMoney(amount);
  if (Number.isFinite(amountCny)) return roundMoney(Number(amountCny) / rateToCnyFor(baseCurrency, rates));
  return roundMoney(amount * rateToBaseFor(bookedBaseCurrency ?? baseCurrency, baseCurrency, rates));
}

export function repaymentAmountInBase(repayment: Repayment, rates: ExchangeRate[], baseCurrency: string) {
  return frozenAmountInBase(repayment.amount, repayment.bookedBaseCurrency, repayment.amountCny, rates, baseCurrency);
}

export function subscriptionAmountInBase(subscription: Subscription, rates: ExchangeRate[], baseCurrency: string) {
  return frozenAmountInBase(subscription.amount, subscription.bookedBaseCurrency, subscription.amountCny, rates, baseCurrency);
}

export function assetPriceInBase(asset: Asset, rates: ExchangeRate[], baseCurrency: string) {
  return frozenAmountInBase(asset.price, asset.bookedBaseCurrency, asset.priceCny, rates, baseCurrency);
}

export function withBookedMoney<T extends Pick<Transaction, "amount" | "currency">>(
  transaction: T,
  rates: ExchangeRate[],
  exchangeRateToBase?: number,
  amountInBase?: number,
  baseCurrency = "CNY",
) {
  const rate = transaction.currency === baseCurrency
    ? 1
    : exchangeRateToBase && exchangeRateToBase > 0
      ? exchangeRateToBase
      : amountInBase && transaction.amount > 0
        ? amountInBase / transaction.amount
        : rateToBaseFor(transaction.currency, baseCurrency, rates);
  const converted = transaction.currency === baseCurrency
    ? transaction.amount
    : Number.isFinite(amountInBase)
      ? Number(amountInBase)
      : transaction.amount * rate;
  const baseRateToCny = rateToCnyFor(baseCurrency, rates);
  return {
    ...transaction,
    bookedBaseCurrency: baseCurrency,
    exchangeRateToBase: rate,
    amountInBase: roundMoney(converted),
    exchangeRateToCny: rate * baseRateToCny,
    amountCny: roundMoney(converted * baseRateToCny),
  };
}

export function canAffectAccountBalance(transaction: Pick<Transaction, "status" | "paymentKind">) {
  return transaction.status !== "scheduled" && transaction.paymentKind === "normal";
}

function signedBalanceAmount(transaction: Transaction, rates: ExchangeRate[], accountCurrency: string) {
  if (!transaction.balanceApplied) return 0;
  const amount = transaction.currency === accountCurrency
    ? transaction.amount
    : transactionAmountInBase(transaction, rates, accountCurrency);
  return transaction.type === "income" ? amount : -amount;
}

export function updateAccountsForTransactionChange(
  accounts: Account[],
  rates: ExchangeRate[],
  previous?: Transaction,
  next?: Transaction,
  baseCurrency = "CNY",
) {
  const deltas = new Map<string, number>();
  const accountCurrency = (accountId: string) => accounts.find((account) => account.id === accountId)?.currency ?? baseCurrency;
  if (previous) deltas.set(previous.accountId, (deltas.get(previous.accountId) ?? 0) - signedBalanceAmount(previous, rates, accountCurrency(previous.accountId)));
  if (next) deltas.set(next.accountId, (deltas.get(next.accountId) ?? 0) + signedBalanceAmount(next, rates, accountCurrency(next.accountId)));
  if (![...deltas.values()].some(Boolean)) return accounts;
  return accounts.map((account) => deltas.has(account.id)
    ? { ...account, balance: roundMoney(account.balance + (deltas.get(account.id) ?? 0)) }
    : account);
}

export function applyNewTransactionsToAccounts(accounts: Account[], rates: ExchangeRate[], transactions: Transaction[], baseCurrency = "CNY") {
  return transactions.reduce((current, transaction) => updateAccountsForTransactionChange(current, rates, undefined, transaction, baseCurrency), accounts);
}

export function removeTransactionsAndRevertBalances(state: LedgerState, ids: Set<string>): LedgerState {
  const accounts = state.transactions
    .filter((transaction) => ids.has(transaction.id))
    .reduce((current, transaction) => updateAccountsForTransactionChange(current, state.rates, transaction, undefined, state.baseCurrency), state.accounts);
  return { ...state, accounts, transactions: state.transactions.filter((transaction) => !ids.has(transaction.id)) };
}

function isCreditAccount(state: LedgerState, accountId: string) {
  return state.creditTools.some((tool) => tool.accountId === accountId);
}

export function nonCreditChildren(state: LedgerState, parentId: string) {
  return state.accounts.filter((account) => account.parentAccountId === parentId && !isCreditAccount(state, account.id));
}

export function accountChildren(state: LedgerState, parentId: string) {
  return state.accounts.filter((account) => account.parentAccountId === parentId);
}

export function spendableAccounts(state: LedgerState) {
  return state.accounts.filter((account) => Boolean(account.parentAccountId));
}

export function spendableAccountsForCurrency(state: LedgerState, currency: string) {
  return spendableAccounts(state).filter((account) => (account.currency ?? state.baseCurrency) === currency);
}

export function hasSpendableAccountForCurrency(state: LedgerState, currency: string) {
  return spendableAccountsForCurrency(state, currency).length > 0;
}

export function accountBalanceInBase(state: Pick<LedgerState, "rates" | "baseCurrency">, account: Account) {
  return convertBaseAmount(account.balance, account.currency ?? state.baseCurrency, state.baseCurrency, state.rates);
}

export function accountDisplayBalance(state: LedgerState, account: Account) {
  const children = nonCreditChildren(state, account.id);
  if (children.length) return roundMoney(children.reduce((sum, child) => sum + accountBalanceInBase(state, child), 0));
  if (accountChildren(state, account.id).length) return 0;
  return accountBalanceInBase(state, account);
}

export function currencyIsReferenced(state: LedgerState, code: string) {
  return state.accounts.some((item) => item.currency === code)
    || state.transactions.some((item) => item.currency === code || item.bookedBaseCurrency === code)
    || state.repayments.some((item) => item.bookedBaseCurrency === code)
    || state.subscriptions.some((item) => item.bookedBaseCurrency === code)
    || state.assets.some((item) => item.bookedBaseCurrency === code)
    || (state.loans ?? []).some((item) => item.currency === code);
}

export function totalAssetBalance(state: LedgerState) {
  return roundMoney(state.accounts.reduce((sum, account) => {
    if (account.parentAccountId) return sum + accountBalanceInBase(state, account);
    return accountChildren(state, account.id).length ? sum : sum + accountBalanceInBase(state, account);
  }, 0));
}

function mostFrequentCurrency(currencies: Array<string | undefined>) {
  const counts = new Map<string, number>();
  currencies.filter(Boolean).forEach((currency) => counts.set(currency!, (counts.get(currency!) ?? 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

/**
 * Freezes currencies for legacy child accounts that predate per-account currency storage.
 * Existing explicit account currencies always win; historical booking data is only used
 * to repair missing metadata, so changing the current base currency cannot rewrite an account.
 */
export function stabilizeAccountCurrencies(
  state: Pick<LedgerState, "accounts" | "transactions" | "repayments" | "subscriptions" | "baseCurrency">,
) {
  const evidenceByAccount = new Map<string, Array<string | undefined>>();
  const addEvidence = (accountId: string, currency?: string) => {
    if (!currency) return;
    evidenceByAccount.set(accountId, [...(evidenceByAccount.get(accountId) ?? []), currency]);
  };
  state.transactions.forEach((item) => addEvidence(item.accountId, item.bookedBaseCurrency));
  state.repayments.forEach((item) => addEvidence(item.accountId, item.bookedBaseCurrency));
  state.subscriptions.forEach((item) => addEvidence(item.accountId, item.bookedBaseCurrency));
  const historicalDefault = mostFrequentCurrency([
    ...state.transactions.map((item) => item.bookedBaseCurrency),
    ...state.repayments.map((item) => item.bookedBaseCurrency),
    ...state.subscriptions.map((item) => item.bookedBaseCurrency),
  ]) ?? "CNY";

  return state.accounts.map((account) => {
    if (!account.parentAccountId) return account.currency === undefined ? account : { ...account, currency: undefined };
    if (account.currency) return account;
    return { ...account, currency: mostFrequentCurrency(evidenceByAccount.get(account.id) ?? []) ?? historicalDefault };
  });
}
