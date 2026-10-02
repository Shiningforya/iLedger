import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Info, Sparkle, X } from "@phosphor-icons/react";
import type { Account, Category, CreditTool, CurrencyCode, EntryType, LedgerState, ParsedEntry, PaymentKind, Transaction } from "../types";
import { isBorrowingCategory } from "../ledgerRelations";
import { AccountEditor, CategoryModal } from "./ProfilePage";
import { accountChildren, rateToBaseFor, transactionAmountInBase } from "../transactionAccounting";

export interface EntryDraft {
  type: EntryType;
  item: string;
  amount: number;
  exchangeRateToBase: number;
  amountInBase: number;
  bookedBaseCurrency: CurrencyCode;
  category: string;
  accountId: string;
  date: string;
  currency: CurrencyCode;
  paymentKind: PaymentKind;
  creditToolId?: string;
  installmentCount: number;
  interestMode: "monthly" | "total";
  interest: number;
  note: string;
  rememberProject: boolean;
  isSubscription: boolean;
  subscriptionCycle: "monthly" | "yearly";
  subscriptionMode: "auto" | "fixed";
  subscriptionEndsAt: string;
  subscriptionReminderDays: number;
  trackDepreciation: boolean;
  assetLifeDays?: number;
  loanDueDate?: string;
}

interface Props {
  mode: "expense" | "income" | "parsed" | "edit";
  parsed: ParsedEntry | null;
  initialTransaction?: Transaction | null;
  ledger: LedgerState;
  onClose: () => void;
  onSave: (draft: EntryDraft) => void;
  onAddCategory: (category: Category) => void;
  onAddAccount: (account: Account, initialChild?: Account) => void;
  onAddCredit: (tool: CreditTool) => void;
}

const today = () => new Date().toISOString().slice(0, 10);

const addMonths = (dateString: string, months: number) => {
  const date = new Date(`${dateString}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
};

export default function EntryModal({ mode, parsed, initialTransaction, ledger, onClose, onSave, onAddCategory, onAddAccount, onAddCredit }: Props) {
  const initialType: EntryType = initialTransaction?.type ?? parsed?.type ?? (mode === "income" ? "income" : "expense");
  const initialBookedBaseCurrency = initialTransaction?.bookedBaseCurrency ?? ledger.baseCurrency;
  const rawAccountId = initialTransaction?.accountId ?? parsed?.accountId ?? ledger.accounts.find((account) => Boolean(account.parentAccountId))?.id ?? "";
  const rawAccount = ledger.accounts.find((account) => account.id === rawAccountId);
  const requestedCreditToolId = initialTransaction?.creditToolId ?? parsed?.creditToolId;
  const requestedCreditTool = ledger.creditTools.find((tool) => tool.id === requestedCreditToolId);
  const requestedCreditAccount = ledger.accounts.find((account) => account.id === requestedCreditTool?.accountId);
  const initialCreditTool = initialTransaction || (requestedCreditAccount?.currency ?? ledger.baseCurrency) === initialBookedBaseCurrency ? requestedCreditTool : undefined;
  const initialCreditToolId = initialCreditTool?.id;
  const initialLoan = (ledger.loans ?? []).find((loan) => loan.transactionId === initialTransaction?.id || loan.id === initialTransaction?.loanId);
  const initialSubscription = ledger.subscriptions.find((item) => item.id === initialTransaction?.subscriptionId || item.id === `${initialTransaction?.id}-subscription`);
  const initialAsset = ledger.assets.find((item) => item.id === initialTransaction?.assetId || item.id === `${initialTransaction?.id}-asset`);
  const initialPrimaryAccountId = initialCreditTool?.parentAccountId ?? rawAccount?.parentAccountId ?? rawAccountId;
  const initialChildren = accountChildren(ledger, initialPrimaryAccountId);
  const initialEligibleChildren = initialChildren.filter((account) => (account.currency ?? initialBookedBaseCurrency) === initialBookedBaseCurrency);
  const rawAccountMatchesBooking = rawAccount?.parentAccountId && (rawAccount.currency ?? initialBookedBaseCurrency) === initialBookedBaseCurrency;
  const initialDirectAccountId = rawAccountMatchesBooking
    ? rawAccount.id
    : initialEligibleChildren[0]?.id ?? rawAccountId;
  const initialFundingSelection = initialCreditToolId
    ? `credit:${initialCreditToolId}`
    : rawAccountMatchesBooking
      ? `account:${rawAccount.id}`
      : initialEligibleChildren.length
        ? `account:${initialEligibleChildren[0].id}`
        : "";
  const initialCurrency = initialTransaction?.currency ?? parsed?.currency ?? ledger.baseCurrency;
  const initialAmount = initialTransaction?.amount ?? parsed?.amount ?? 0;
  const initialRate = initialTransaction?.bookedBaseCurrency === initialBookedBaseCurrency && initialTransaction.exchangeRateToBase
    ? initialTransaction.exchangeRateToBase
    : rateToBaseFor(initialCurrency, initialBookedBaseCurrency, ledger.rates);
  const initialAmountInBase = initialTransaction
    ? transactionAmountInBase(initialTransaction, ledger.rates, initialBookedBaseCurrency)
    : Number((initialAmount * initialRate).toFixed(2));
  const [draft, setDraft] = useState<EntryDraft>({
    type: initialType,
    item: initialTransaction?.item ?? parsed?.item ?? "",
    amount: initialAmount,
    exchangeRateToBase: initialRate,
    amountInBase: initialAmountInBase,
    bookedBaseCurrency: initialBookedBaseCurrency,
    category: initialTransaction?.category ?? parsed?.category ?? (initialType === "income" ? "工资" : "日用"),
    accountId: initialCreditTool?.accountId ?? initialDirectAccountId,
    date: initialTransaction?.date ?? parsed?.date ?? today(),
    currency: initialCurrency,
    paymentKind: initialTransaction?.paymentKind ?? parsed?.paymentKind ?? "normal",
    creditToolId: initialCreditToolId,
    installmentCount: initialTransaction?.installment?.count ?? 3,
    interestMode: initialTransaction?.installment?.interestMode ?? "total",
    interest: initialTransaction?.installment?.interest ?? 0,
    note: initialTransaction?.note ?? "",
    rememberProject: mode !== "edit" && !(initialTransaction?.loanId && initialType === "expense"),
    isSubscription: Boolean(initialSubscription),
    subscriptionCycle: initialSubscription?.cycle ?? "monthly",
    subscriptionMode: initialSubscription?.renewalMode ?? "auto",
    subscriptionEndsAt: initialSubscription?.endsAt ?? addMonths(initialTransaction?.date ?? parsed?.date ?? today(), 1),
    subscriptionReminderDays: initialSubscription?.reminderDays ?? 7,
    trackDepreciation: Boolean(initialAsset),
    assetLifeDays: initialAsset?.lifeDays,
    loanDueDate: initialLoan?.dueDate,
  });
  const [primaryAccountId, setPrimaryAccountId] = useState(initialPrimaryAccountId);
  const [fundingSelection, setFundingSelection] = useState(initialFundingSelection);
  const [showAdvanced, setShowAdvanced] = useState(parsed?.paymentKind === "installment" || Boolean(initialTransaction?.note || initialSubscription || initialAsset));
  const [quickAdd, setQuickAdd] = useState<"category" | "account" | "child" | null>(null);

  const categories = useMemo(() => ledger.categories.filter((category) => category.type === draft.type), [ledger.categories, draft.type]);
  const primaryAccounts = useMemo(() => ledger.accounts.filter((account) => !account.parentAccountId), [ledger.accounts]);
  const childAccounts = useMemo(
    () =>
      ledger.accounts.filter((account) => account.parentAccountId === primaryAccountId && (account.currency ?? draft.bookedBaseCurrency) === draft.bookedBaseCurrency),
    [ledger.accounts, primaryAccountId, draft.bookedBaseCurrency],
  );
  const confidence = parsed?.confidence;
  const uncertain = (key: keyof NonNullable<typeof confidence>) => Boolean(confidence && confidence[key] < 0.7);
  const update = <K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const selectCurrency = (currency: CurrencyCode) => {
    const exchangeRateToBase = rateToBaseFor(currency, draft.bookedBaseCurrency, ledger.rates);
    setDraft((current) => ({
      ...current,
      currency,
      exchangeRateToBase,
      amountInBase: Number((current.amount * exchangeRateToBase).toFixed(2)),
    }));
  };

  const updateAmount = (amount: number) => setDraft((current) => ({
    ...current,
    amount,
    amountInBase: Number((amount * current.exchangeRateToBase).toFixed(2)),
  }));

  const updateExchangeRate = (exchangeRateToBase: number) => setDraft((current) => ({
    ...current,
    exchangeRateToBase,
    amountInBase: Number((current.amount * exchangeRateToBase).toFixed(2)),
  }));

  const updateAmountInBase = (amountInBase: number) => setDraft((current) => ({
    ...current,
    amountInBase,
    exchangeRateToBase: current.amount > 0 ? Number((amountInBase / current.amount).toFixed(6)) : current.exchangeRateToBase,
  }));

  const selectPrimaryAccount = (accountId: string) => {
    setPrimaryAccountId(accountId);
    const firstChild = accountChildren(ledger, accountId).find((account) => (account.currency ?? draft.bookedBaseCurrency) === draft.bookedBaseCurrency);
    const credit = firstChild && draft.type === "expense" ? ledger.creditTools.find((tool) => tool.accountId === firstChild.id) : undefined;
    if (firstChild && credit) {
      setFundingSelection(`credit:${credit.id}`);
      setDraft((current) => ({ ...current, accountId: firstChild.id, paymentKind: "credit", creditToolId: credit.id }));
    } else if (firstChild) {
      setFundingSelection(`account:${firstChild.id}`);
      setDraft((current) => ({ ...current, accountId: firstChild.id, paymentKind: "normal", creditToolId: undefined }));
    } else {
      setFundingSelection("");
      setDraft((current) => ({ ...current, accountId: "", paymentKind: "normal", creditToolId: undefined }));
    }
  };

  const selectFundingSource = (selection: string) => {
    setFundingSelection(selection);
    if (selection.startsWith("credit:")) {
      const creditToolId = selection.slice("credit:".length);
      const accountId = ledger.creditTools.find((tool) => tool.id === creditToolId)?.accountId ?? primaryAccountId;
      setDraft((current) => ({ ...current, accountId, paymentKind: "credit", creditToolId }));
      return;
    }
    if (selection.startsWith("account:")) {
      setDraft((current) => ({ ...current, accountId: selection.slice("account:".length), paymentKind: "normal", creditToolId: undefined }));
      return;
    }
    setDraft((current) => ({ ...current, accountId: "", paymentKind: "normal", creditToolId: undefined }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.item.trim() || draft.amount <= 0 || !draft.accountId) return;
    onSave(draft);
  };

  const selectNewAccountConfiguration = (account: Account, tool?: CreditTool, initialChild?: Account) => {
    onAddAccount(account, initialChild);
    if (tool) {
      onAddCredit(tool);
      setPrimaryAccountId(tool.parentAccountId);
      setFundingSelection(`credit:${tool.id}`);
      setDraft((current) => ({ ...current, accountId: tool.accountId ?? "", paymentKind: "credit", creditToolId: tool.id }));
    } else if (account.parentAccountId) {
      setPrimaryAccountId(account.parentAccountId);
      setFundingSelection(`account:${account.id}`);
      setDraft((current) => ({ ...current, accountId: account.id, paymentKind: "normal", creditToolId: undefined }));
    } else {
      setPrimaryAccountId(account.id);
      const child = initialChild ?? account;
      setFundingSelection(`account:${child.id}`);
      setDraft((current) => ({ ...current, accountId: child.id, paymentKind: "normal", creditToolId: undefined }));
    }
    setQuickAdd(null);
  };

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.div
        className={`entry-modal liquid-modal glass-panel${quickAdd ? " nested-modal-open" : ""}`}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="modal-liquid-content">
        <div className="modal-header">
          <div>
            <span className="modal-kicker">{mode === "parsed" ? <><Sparkle size={15} weight="fill" /> 本地规则已解析</> : mode === "edit" ? "编辑流水" : "新记录"}</span>
            <h2>{mode === "parsed" ? "确认识别结果" : mode === "edit" ? "修改这条记录" : draft.type === "expense" ? "新增支出" : "新增收入"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="关闭"><X size={19} /></button>
        </div>

        {mode === "parsed" && (
          <div className="recognition-note">
            <Info size={17} />系统不会直接入账。黄色字段置信度较低，请确认后再保存。
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="type-segment" role="group" aria-label="记录类型">
            <button type="button" className={draft.type === "expense" ? "selected" : ""} onClick={() => { update("type", "expense"); update("category", ledger.categories.find((item) => item.type === "expense")?.name ?? "日用"); }}>支出</button>
            <button type="button" className={draft.type === "income" ? "selected" : ""} onClick={() => { update("type", "income"); update("category", ledger.categories.find((item) => item.type === "income")?.name ?? "工资"); if (fundingSelection.startsWith("credit:")) { setFundingSelection(`account:${draft.accountId}`); setDraft((current) => ({ ...current, paymentKind: "normal", creditToolId: undefined })); } }}>收入</button>
          </div>

          <div className="form-grid">
            <label className={uncertain("item") ? "field uncertain" : "field"}>
              <span>项目名称 {uncertain("item") && <em>请确认</em>}</span>
              <input value={draft.item} onChange={(event) => update("item", event.target.value)} placeholder="例如：酷态科 10 号充电器" autoFocus />
            </label>
            <label className={uncertain("amount") || uncertain("currency") ? "field uncertain" : "field"}>
              <span>金额与币种 {(uncertain("amount") || uncertain("currency")) && <em>请确认</em>}</span>
              <div className="amount-field">
                <select value={draft.currency} onChange={(event) => selectCurrency(event.target.value as CurrencyCode)}>
                  {ledger.rates.map((rate) => <option key={rate.code} value={rate.code}>{rate.code}</option>)}
                </select>
                <input type="number" min="0" step="0.01" value={draft.amount || ""} onChange={(event) => updateAmount(Number(event.target.value))} placeholder="0.00" />
              </div>
            </label>
            {draft.currency !== ledger.baseCurrency && <motion.div className="exchange-panel field wide" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
              <div><span>本次记账汇率</span><small>默认来自汇率库，保存后不随未来汇率变化</small></div>
              <label><span>1 {draft.currency} =</span><input type="number" min="0.000001" step="any" value={draft.exchangeRateToBase || ""} onChange={(event) => updateExchangeRate(Number(event.target.value))} /><span>{draft.bookedBaseCurrency}</span></label>
              <label><span>折算本币</span><input type="number" min="0" step="0.01" value={draft.amountInBase || ""} onChange={(event) => updateAmountInBase(Number(event.target.value))} /><span>{draft.bookedBaseCurrency}</span></label>
            </motion.div>}
            <div className={uncertain("category") ? "field uncertain" : "field"}>
              <span>分类 {uncertain("category") && <em>请确认</em>}</span>
              <select value={draft.category} onChange={(event) => { if (event.target.value === "__add_category__") setQuickAdd("category"); else update("category", event.target.value); }}>
                {categories.map((category) => <option key={category.id}>{category.name}</option>)}
                <option value="__add_category__">＋ 添加分类…</option>
              </select>
            </div>
            <div className={uncertain("accountId") ? "field uncertain" : "field"}>
              <span>主账户 {uncertain("accountId") && <em>请确认</em>}</span>
              <select value={primaryAccountId} onChange={(event) => { if (event.target.value === "__add_account__") setQuickAdd("account"); else selectPrimaryAccount(event.target.value); }}>
                {primaryAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                <option value="__add_account__">＋ 添加主账户…</option>
              </select>
            </div>
            <label className={uncertain("date") ? "field uncertain" : "field"}>
              <span>日期 {uncertain("date") && <em>请确认</em>}</span>
              <input type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} />
            </label>
            {draft.type === "income" && isBorrowingCategory(ledger, draft.category) && <label className="field"><span>约定还款日（可选）</span><input type="date" min={draft.date} value={draft.loanDueDate ?? ""} onChange={(event) => update("loanDueDate", event.target.value || undefined)} /><small>暂不确定时可留空，之后在借款管理中补充。</small></label>}
            <label className="field">
              <span>子账户 · {draft.bookedBaseCurrency}</span>
              <select value={fundingSelection} onChange={(event) => { if (event.target.value === "__add_child__") setQuickAdd("child"); else selectFundingSource(event.target.value); }}>
                {!fundingSelection && <option value="">请选择子账户</option>}
                {childAccounts.map((account) => { const tool = draft.type === "expense" ? ledger.creditTools.find((item) => item.accountId === account.id) : undefined; return <option key={account.id} value={tool ? `credit:${tool.id}` : `account:${account.id}`}>{account.name}{tool ? " · 信用账户" : ""}</option>; })}
                <option value="__add_child__">＋ 新增 {draft.bookedBaseCurrency} 子账户…</option>
              </select>
            </label>
          </div>

          {draft.type === "expense" && draft.paymentKind !== "normal" && (
            <motion.div className="credit-fields" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
              <label className="field">
                <span>账单方式</span>
                <select value={draft.paymentKind} onChange={(event) => { const value = event.target.value as PaymentKind; update("paymentKind", value); setShowAdvanced(value === "installment"); }}>
                  <option value="credit">下期还款</option>
                  <option value="installment">分期付款</option>
                </select>
              </label>
              <p className="account-path-hint">{ledger.accounts.find((account) => account.id === primaryAccountId)?.name} / {ledger.creditTools.find((tool) => tool.id === draft.creditToolId)?.name}，每月 {ledger.creditTools.find((tool) => tool.id === draft.creditToolId)?.statementDay} 日出账</p>
              {draft.paymentKind === "installment" && (
                <>
                  <label className="field"><span>期数</span><input type="number" min="2" max="36" value={draft.installmentCount} onChange={(event) => update("installmentCount", Number(event.target.value))} /></label>
                  <label className="field"><span>利息方式</span><select value={draft.interestMode} onChange={(event) => update("interestMode", event.target.value as "monthly" | "total")}><option value="total">利息总额</option><option value="monthly">每月利息</option></select></label>
                  <label className="field"><span>{draft.interestMode === "total" ? "利息总额" : "每月利息"}</span><input type="number" min="0" step="0.01" value={draft.interest} onChange={(event) => update("interest", Number(event.target.value))} /></label>
                </>
              )}
            </motion.div>
          )}

          <button type="button" className="advanced-toggle" onClick={() => setShowAdvanced((value) => !value)}>{showAdvanced ? "收起扩展选项" : "订阅、折旧与备注"}</button>
          <AnimatePresence initial={false}>
            {showAdvanced && (
              <motion.div className="advanced-fields" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <label className="check-row"><input type="checkbox" checked={draft.isSubscription} onChange={(event) => update("isSubscription", event.target.checked)} /><span>这是订阅项目</span></label>
                {draft.isSubscription && <><label className="field compact"><span>订阅方式</span><select value={draft.subscriptionMode} onChange={(event) => update("subscriptionMode", event.target.value as EntryDraft["subscriptionMode"])}><option value="auto">自动续订</option><option value="fixed">固定期限</option></select></label><label className="field compact"><span>计费周期</span><select value={draft.subscriptionCycle} onChange={(event) => { const cycle = event.target.value as "monthly" | "yearly"; update("subscriptionCycle", cycle); update("subscriptionEndsAt", addMonths(draft.date, cycle === "monthly" ? 1 : 12)); }}><option value="monthly">每月</option><option value="yearly">每年</option></select></label><label className="field compact"><span>{draft.subscriptionMode === "auto" ? "下次续订日" : "到期日期"}</span><input type="date" min={draft.date} value={draft.subscriptionEndsAt} onChange={(event) => update("subscriptionEndsAt", event.target.value)} /></label><label className="field compact"><span>提前提醒天数</span><input type="number" min="0" max="90" value={draft.subscriptionReminderDays} onChange={(event) => update("subscriptionReminderDays", Number(event.target.value))} /></label></>}
                <label className="check-row"><input type="checkbox" checked={draft.trackDepreciation} onChange={(event) => update("trackDepreciation", event.target.checked)} /><span>加入资产折旧</span></label>
                {draft.trackDepreciation && <label className="field compact"><span>预计使用天数（可选）</span><input type="number" min="30" value={draft.assetLifeDays ?? ""} onChange={(event) => update("assetLifeDays", event.target.value ? Number(event.target.value) : undefined)} placeholder="留空则按实际使用天数计算" /></label>}
                <label className="field wide"><span>备注</span><input value={draft.note} onChange={(event) => update("note", event.target.value)} placeholder="可选" /></label>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="modal-footer">
            {mode !== "edit" ? <label className="remember-row"><input type="checkbox" checked={draft.rememberProject} onChange={(event) => update("rememberProject", event.target.checked)} /><span>记住该项目，提升下次识别准确度</span></label> : <span className="edit-preserve-note">同步更新关联的订阅、资产或借款资料</span>}
            <button className="save-button" type="submit" disabled={!draft.item.trim() || draft.amount <= 0 || !draft.accountId}>{mode === "edit" ? "保存修改" : "确认入账"}</button>
          </div>
        </form>
        </div>
      </motion.div>
      <AnimatePresence>
        {quickAdd === "category" && <CategoryModal defaultType={draft.type} notify={() => undefined} onClose={() => setQuickAdd(null)} onSave={(category) => { onAddCategory(category); update("category", category.name); setQuickAdd(null); }} />}
        {quickAdd === "account" && <AccountEditor ledger={ledger} initialCurrency={draft.bookedBaseCurrency} onClose={() => setQuickAdd(null)} onSave={selectNewAccountConfiguration} />}
        {quickAdd === "child" && <AccountEditor ledger={ledger} initialParentId={primaryAccountId} initialCurrency={draft.bookedBaseCurrency} onClose={() => setQuickAdd(null)} onSave={selectNewAccountConfiguration} />}
      </AnimatePresence>
    </motion.div>
  );
}
