import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowDown, ArrowUp, CalendarBlank, CheckSquare, CreditCard, Funnel, MagnifyingGlass,
  HandCoins, PencilSimple, Receipt, Repeat, Square, SquaresFour, Trash, Warning, X,
} from "@phosphor-icons/react";
import type { Asset, LedgerState, Loan, Subscription, Transaction } from "../types";
import { managedCategoryName, removeManagedRecordAndClearLink, saveAssetAndSyncTransaction, saveSubscriptionAndSyncTransaction } from "../ledgerRelations";
import { assetPriceInBase, canAffectAccountBalance, repaymentAmountInBase, spendableAccounts, subscriptionAmountInBase, transactionAmountInBase, updateAccountsForTransactionChange, withBookedMoney } from "../transactionAccounting";
import { Pagination, usePagedItems } from "./Pagination";
import { useScrollHeightReserve } from "./useScrollHeightReserve";

const money = (value: number, currency: string) => new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(value);
const moneyFor = (value: number, currency: string) => {
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  }
};
type Tab = "all" | "expense" | "income" | "credit" | "loan" | "subscription" | "asset";
type DeleteRequest = { ids: string[]; label: string; single?: boolean };
type ManagedEditorState = { kind: "loan"; value: Loan } | { kind: "subscription"; value: Subscription } | { kind: "asset"; value: Asset };
type ManagedDelete = { kind: ManagedEditorState["kind"]; id: string; name: string };
const databaseTabs: Array<{ key: Tab; label: string }> = [
  { key: "all", label: "全部流水" }, { key: "expense", label: "支出" }, { key: "income", label: "收入" },
  { key: "credit", label: "信用账单" }, { key: "loan", label: "借款管理" }, { key: "subscription", label: "订阅" }, { key: "asset", label: "资产折旧" },
];

interface Props {
  ledger: LedgerState;
  setLedger: React.Dispatch<React.SetStateAction<LedgerState>>;
  onEdit: (transaction: Transaction) => void;
  onRepayLoan: (loan: Loan) => void;
  onDelete: (ids: string[]) => void;
}

export default function DatabasePage({ ledger, setLedger, onEdit, onRepayLoan, onDelete }: Props) {
  const reduceMotion = useReducedMotion();
  const panelReserve = useScrollHeightReserve<HTMLDivElement>();
  const [tab, setTab] = useState<Tab>("all");
  const [tabDirection, setTabDirection] = useState(1);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部分类");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [managedEditor, setManagedEditor] = useState<ManagedEditorState | null>(null);
  const [managedDelete, setManagedDelete] = useState<ManagedDelete | null>(null);

  const creditRows = useMemo(() => ledger.creditTools.map((tool) => {
    const items = ledger.transactions.filter((item) => item.status !== "scheduled" && item.creditToolId === tool.id);
    const charges = items.reduce((sum, item) => sum + transactionAmountInBase(item, ledger.rates, ledger.baseCurrency), 0);
    const paid = ledger.repayments.filter((item) => item.creditToolId === tool.id).reduce((sum, item) => sum + repaymentAmountInBase(item, ledger.rates, ledger.baseCurrency), 0);
    return { tool, charges, paid, due: Math.max(0, charges - paid) };
  }), [ledger]);

  const rows = useMemo(() => ledger.transactions
    .filter((item) => tab === "all" || tab === "credit" || item.type === tab)
    .filter((item) => tab !== "credit" || item.paymentKind !== "normal")
    .filter((item) => category === "全部分类" || item.category === category)
    .filter((item) => `${item.item}${item.category}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date)), [ledger.transactions, tab, category, query]);
  const transactionPages = usePagedItems(rows);
  const creditPages = usePagedItems(creditRows);
  const loanPages = usePagedItems(ledger.loans ?? []);
  const subscriptionPages = usePagedItems(ledger.subscriptions);
  const assetPages = usePagedItems(ledger.assets);
  const activePages = tab === "loan" ? loanPages : tab === "subscription" ? subscriptionPages : tab === "asset" ? assetPages : transactionPages;
  const changePage = (next: number) => { panelReserve.preserveHeight(); activePages.setPage(next); };

  const transactionTab = tab !== "subscription" && tab !== "asset" && tab !== "loan";
  const askDelete = (ids: string[], label: string, single = false) => ids.length && setDeleteRequest({ ids, label, single });
  const exitSelecting = () => { setSelecting(false); setSelected([]); setRangeOpen(false); };
  const selectTab = (next: Tab) => {
    if (next === tab) return;
    panelReserve.preserveHeight();
    setTabDirection(Math.sign(databaseTabs.findIndex((item) => item.key === next) - databaseTabs.findIndex((item) => item.key === tab)) || 1);
    setTab(next);
    transactionPages.setPage(1);
    exitSelecting();
  };
  const saveManaged = (editor: ManagedEditorState) => {
    setLedger((current) => {
      if (editor.kind === "loan") {
        const loan = editor.value.status === "outstanding" ? { ...editor.value, repaidAt: undefined, repaymentAccountId: undefined } : editor.value;
        let accounts = current.accounts;
        const transactions = current.transactions.map((item) => {
          if (item.id !== loan.transactionId) return item;
          const bookingCurrency = item.bookedBaseCurrency ?? current.baseCurrency;
          const next = withBookedMoney({
            ...item,
            type: "income" as const,
            item: loan.name,
            amount: loan.principal,
            currency: loan.currency,
            accountId: loan.accountId,
            date: loan.borrowedAt,
            category: managedCategoryName(current, "borrowing"),
            loanId: loan.id,
            balanceApplied: canAffectAccountBalance(item),
          }, current.rates, item.currency === loan.currency ? item.exchangeRateToBase : undefined, undefined, bookingCurrency) as Transaction;
          accounts = updateAccountsForTransactionChange(accounts, current.rates, item, next, bookingCurrency);
          return next;
        });
        return {
          ...current,
          accounts,
          loans: (current.loans ?? []).map((item) => item.id === loan.id ? loan : item),
          transactions,
        };
      }
      if (editor.kind === "subscription") return saveSubscriptionAndSyncTransaction(current, editor.value);
      return saveAssetAndSyncTransaction(current, editor.value);
    });
    setManagedEditor(null);
  };
  const deleteManaged = (request: ManagedDelete) => {
    setLedger((current) => request.kind === "loan"
      ? { ...current, loans: (current.loans ?? []).filter((item) => item.id !== request.id) }
      : removeManagedRecordAndClearLink(current, request.kind, request.id));
    setManagedDelete(null);
  };

  return <section className="database-page">
    <div className="page-heading"><div><p className="eyebrow">本地数据库</p><h1>{ledger.slogans.database.title}</h1><p>{ledger.slogans.database.subtitle}</p></div><div className="database-summary"><span><Receipt size={18} />{ledger.transactions.length} 条流水</span><span><HandCoins size={18} />{(ledger.loans ?? []).filter((loan) => loan.status === "outstanding").length} 笔待还</span><span><SquaresFour size={18} />{ledger.assets.length} 项资产</span><span><CalendarBlank size={18} />{ledger.transactions.filter((item) => item.status === "scheduled").length} 条待入账</span></div></div>

    <div className="database-panel surface-panel" ref={panelReserve.ref} style={panelReserve.minimumHeight ? { minHeight: panelReserve.minimumHeight } : undefined}>
      <div className="database-tabs"><div>{databaseTabs.map((item) => <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => selectTab(item.key)}><span>{item.label}</span>{tab === item.key && <motion.i className="database-tab-indicator" layoutId="database-tab-indicator" transition={{ type: "spring", stiffness: 430, damping: 36 }} />}</button>)}</div>{transactionTab && <button className={selecting ? "database-select active" : "database-select"} onClick={() => selecting ? exitSelecting() : setSelecting(true)}>{selecting ? <X size={15} /> : <CheckSquare size={15} />}{selecting ? "完成" : "选择"}</button>}</div>
      <div className="database-tab-viewport"><AnimatePresence initial={false} custom={tabDirection}>
        <motion.div
          key={tab}
          className="database-tab-stage"
          initial={reduceMotion ? false : { opacity: 0, x: tabDirection * 22 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, x: tabDirection * -14 }}
          transition={{ duration: .24, ease: [0.16, 1, 0.3, 1] }}
        >
          {transactionTab && <div className="database-tools"><label className="search-box"><MagnifyingGlass size={17} /><input value={query} onChange={(event) => { panelReserve.preserveHeight(); setQuery(event.target.value); transactionPages.setPage(1); }} placeholder="搜索项目或分类" /></label><label className="filter-select"><Funnel size={16} /><select value={category} onChange={(event) => { panelReserve.preserveHeight(); setCategory(event.target.value); transactionPages.setPage(1); }}><option>全部分类</option>{ledger.categories.map((item) => <option key={item.id}>{item.name}</option>)}</select></label></div>}
          {selecting && transactionTab && <div className="batch-toolbar"><button onClick={() => setSelected(selected.length === rows.length ? [] : rows.map((item) => item.id))}>{selected.length === rows.length && rows.length ? <CheckSquare size={16} weight="fill" /> : <Square size={16} />}全选当前结果</button><span>已选 {selected.length} 条</span><button onClick={() => setRangeOpen((value) => !value)}><CalendarBlank size={16} />按日期</button><button className="danger" disabled={!selected.length} onClick={() => askDelete(selected, `${selected.length}条`)}><Trash size={16} />删除所选</button><button className="danger ghost" onClick={() => askDelete(ledger.transactions.map((item) => item.id), "全部")}><Trash size={16} />全部删除</button></div>}
          {rangeOpen && <div className="range-delete"><label>开始日期<input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></label><label>结束日期<input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /></label><button className="danger" disabled={!rangeStart || !rangeEnd || rangeStart > rangeEnd} onClick={() => { const ids = ledger.transactions.filter((item) => item.date >= rangeStart && item.date <= rangeEnd).map((item) => item.id); askDelete(ids, `${rangeStart} 至 ${rangeEnd}`); }}>删除该时段</button></div>}
          {tab === "credit" && <><CreditSummary rows={creditPages.items} currency={ledger.baseCurrency} /><Pagination page={creditPages.page} pageCount={creditPages.pageCount} total={creditRows.length} onPageChange={(next) => { panelReserve.preserveHeight(); creditPages.setPage(next); }} /></>}
          {tab === "loan" ? <LoanTable ledger={ledger} loans={loanPages.items} onEdit={(value) => setManagedEditor({ kind: "loan", value })} onDelete={(value) => setManagedDelete({ kind: "loan", id: value.id, name: value.name })} onRepay={onRepayLoan} /> : tab === "subscription" ? <SubscriptionTable ledger={ledger} subscriptions={subscriptionPages.items} onEdit={(value) => setManagedEditor({ kind: "subscription", value })} onDelete={(value) => setManagedDelete({ kind: "subscription", id: value.id, name: value.name })} /> : tab === "asset" ? <AssetTable ledger={ledger} assets={assetPages.items} onEdit={(value) => setManagedEditor({ kind: "asset", value })} onDelete={(value) => setManagedDelete({ kind: "asset", id: value.id, name: value.name })} /> : <TransactionTable rows={transactionPages.items} ledger={ledger} onEdit={onEdit} selecting={selecting} selected={selected} onToggle={(id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onDelete={(item) => askDelete([item.id], item.item, true)} />}
          <Pagination page={activePages.page} pageCount={activePages.pageCount} total={tab === "loan" ? (ledger.loans ?? []).length : tab === "subscription" ? ledger.subscriptions.length : tab === "asset" ? ledger.assets.length : rows.length} onPageChange={changePage} />
        </motion.div>
      </AnimatePresence></div>
    </div>
    <AnimatePresence>{deleteRequest && <DeleteConfirm request={deleteRequest} onClose={() => setDeleteRequest(null)} onConfirm={() => { onDelete(deleteRequest.ids); setDeleteRequest(null); exitSelecting(); }} />}</AnimatePresence>
    <AnimatePresence>{managedEditor && <ManagedEditor key={`${managedEditor.kind}-${managedEditor.value.id}`} editor={managedEditor} ledger={ledger} onClose={() => setManagedEditor(null)} onSave={saveManaged} />}</AnimatePresence>
    <AnimatePresence>{managedDelete && <ManagedDeleteConfirm request={managedDelete} onClose={() => setManagedDelete(null)} onConfirm={() => deleteManaged(managedDelete)} />}</AnimatePresence>
  </section>;
}

function LoanTable({ ledger, loans, onEdit, onDelete, onRepay }: { ledger: LedgerState; loans: Loan[]; onEdit: (loan: Loan) => void; onDelete: (loan: Loan) => void; onRepay: (loan: Loan) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  return <div className="table-scroll"><table className="ledger-table managed-table"><thead><tr><th>借款</th><th>借入日期</th><th>收款账户</th><th>约定还款日</th><th>状态</th><th className="numeric">金额</th><th aria-label="操作" /></tr></thead><tbody>{loans.map((loan) => {
    const overdue = loan.status === "outstanding" && Boolean(loan.dueDate && loan.dueDate < today);
    return <tr key={loan.id} className={overdue ? "managed-overdue" : ""}>
      <td className="item-cell" data-label="借款"><b>{loan.name}</b><small>{loan.status === "repaid" ? `${loan.repaidAt ?? "已登记"} · ${ledger.accounts.find((account) => account.id === loan.repaymentAccountId)?.name ?? "已归还"}` : "来自收入分类“借款”"}</small></td>
      <td data-label="借入日期"><span className="date-cell">{loan.borrowedAt}</span></td>
      <td data-label="收款账户">{ledger.accounts.find((account) => account.id === loan.accountId)?.name ?? "未知账户"}</td>
      <td data-label="约定还款日"><span className="date-cell">{loan.dueDate || "未设置"}</span></td>
      <td data-label="状态"><span className={`status ${loan.status === "repaid" ? "posted" : overdue ? "overdue" : "scheduled"}`}>{loan.status === "repaid" ? "已归还" : overdue ? "已逾期" : "待归还"}</span></td>
      <td className="numeric" data-label="金额">{moneyFor(loan.principal, loan.currency)}</td>
      <td className="actions-cell" data-label="操作"><div className="row-actions">{loan.status === "outstanding" && <button className="row-repay" onClick={() => onRepay(loan)} aria-label={`归还${loan.name}`} title="去还款"><HandCoins size={15} /></button>}<button className="row-edit" onClick={() => onEdit(loan)} aria-label={`编辑${loan.name}`} title="编辑借款"><PencilSimple size={15} /></button><button className="row-delete" onClick={() => onDelete(loan)} aria-label={`删除${loan.name}`} title="删除借款管理记录"><Trash size={15} /></button></div></td>
    </tr>;
  })}</tbody></table>{loans.length === 0 && <div className="empty-state"><HandCoins size={28} /><b>还没有借款记录</b><span>新增收入并选择“借款”分类后，会在这里建立还款计划。</span></div>}</div>;
}

function TransactionTable({ rows, ledger, onEdit, selecting, selected, onToggle, onDelete }: { rows: Transaction[]; ledger: LedgerState; onEdit: (transaction: Transaction) => void; selecting: boolean; selected: string[]; onToggle: (id: string) => void; onDelete: (transaction: Transaction) => void }) {
  return <div className="table-scroll">
    <table className="ledger-table">
      <thead><tr>{selecting && <th className="select-column" aria-label="选择" />}<th>日期</th><th>项目</th><th>分类</th><th>账户</th><th>付款类型</th><th>状态</th><th className="numeric">金额</th><th aria-label="操作" /></tr></thead>
      <tbody>{rows.map((item) => <tr key={item.id} className={selected.includes(item.id) ? "selected-row" : ""}>
        {selecting && <td className="select-column" data-label="选择"><button onClick={() => onToggle(item.id)} aria-label={`选择${item.item}`}>{selected.includes(item.id) ? <CheckSquare size={18} weight="fill" /> : <Square size={18} />}</button></td>}
        <td data-label="日期"><span className="date-cell">{item.date}</span></td>
        <td className="item-cell" data-label="项目"><b>{item.item}</b>{item.installment && <small>计划 {item.installment.planId.slice(0, 5)}，第 {item.installment.index}/{item.installment.count} 期</small>}</td>
        <td data-label="分类"><span className="category-chip">{item.category}</span></td>
        <td data-label="账户">{ledger.accounts.find((account) => account.id === item.accountId)?.name || item.accountId}</td>
        <td data-label="付款类型">{item.paymentKind === "credit" ? "信用付款" : item.paymentKind === "installment" ? "分期付款" : "普通付款"}</td>
        <td data-label="状态"><span className={item.status === "scheduled" ? "status scheduled" : "status posted"}>{item.status === "scheduled" ? "待入账" : "已入账"}</span></td>
        <td data-label="金额" className={item.type === "income" ? "numeric income" : "numeric"}><span className="flow-icon">{item.type === "income" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</span>{item.type === "income" ? "+" : "-"}{moneyFor(item.amount, item.currency)}{item.currency !== ledger.baseCurrency && <small className="base-money">约 {money(transactionAmountInBase(item, ledger.rates, ledger.baseCurrency), ledger.baseCurrency)}</small>}</td>
        <td className="actions-cell" data-label="操作"><div className="row-actions"><button className="row-edit" onClick={() => onEdit(item)} aria-label={`编辑${item.item}`} title="编辑流水"><PencilSimple size={15} /></button><button className="row-delete" onClick={() => onDelete(item)} aria-label={`删除${item.item}`} title="删除流水"><Trash size={15} /></button></div></td>
      </tr>)}</tbody>
    </table>
    {rows.length === 0 && <div className="empty-state"><MagnifyingGlass size={28} /><b>没有匹配的记录</b><span>换一个关键词或分类试试</span></div>}
  </div>;
}

function DeleteConfirm({ request, onClose, onConfirm }: { request: DeleteRequest; onClose: () => void; onConfirm: () => void }) {
  const [text, setText] = useState("");
  const phrase = `我确认批量删除${request.label.replace(/\s+/g, "")}相关记录`;
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.div className="delete-confirm liquid-modal glass-panel" initial={{ y: 20, opacity: 0, scale: .97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 12, opacity: 0 }}><div className="delete-warning"><span><Warning size={23} weight="fill" /></span><div><h2>{request.single ? `删除“${request.label}”？` : `确认删除 ${request.ids.length} 条流水`}</h2><p>删除后无法恢复，请审慎删除。默认只删除流水，不会连带删除订阅、资产或分期项目。</p></div></div>{!request.single && <label className="field"><span>请输入以下文字完成确认</span><code>{phrase}</code><input value={text} onChange={(event) => setText(event.target.value)} autoFocus /></label>}<div className="delete-actions"><button onClick={onClose}>取消</button><button className="confirm-danger" disabled={!request.single && text !== phrase} onClick={onConfirm}><Trash size={16} />确认删除</button></div></motion.div></motion.div>;
}

function ManagedEditor({ editor, ledger, onClose, onSave }: { editor: ManagedEditorState; ledger: LedgerState; onClose: () => void; onSave: (editor: ManagedEditorState) => void }) {
  if (editor.kind === "loan") return <LoanEditor value={editor.value} ledger={ledger} onClose={onClose} onSave={(value) => onSave({ kind: "loan", value })} />;
  if (editor.kind === "subscription") return <SubscriptionEditor value={editor.value} ledger={ledger} onClose={onClose} onSave={(value) => onSave({ kind: "subscription", value })} />;
  return <AssetEditor value={editor.value} ledger={ledger} onClose={onClose} onSave={(value) => onSave({ kind: "asset", value })} />;
}

function LoanEditor({ value, ledger, onClose, onSave }: { value: Loan; ledger: LedgerState; onClose: () => void; onSave: (value: Loan) => void }) {
  const bookingCurrency = ledger.transactions.find((item) => item.id === value.transactionId)?.bookedBaseCurrency ?? ledger.baseCurrency;
  const accounts = spendableAccounts(ledger).filter((account) => (account.currency ?? ledger.baseCurrency) === bookingCurrency);
  const [draft, setDraft] = useState(() => ({ ...value, accountId: accounts.some((account) => account.id === value.accountId) ? value.accountId : accounts.find((account) => account.parentAccountId === value.accountId)?.id ?? accounts[0]?.id ?? value.accountId }));
  return <motion.div className="modal-backdrop clean" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.form className="settings-modal managed-editor liquid-modal glass-panel" initial={{ y: 18, opacity: 0, scale: .98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 12, opacity: 0 }} onSubmit={(event) => { event.preventDefault(); if (draft.name.trim() && draft.principal > 0) onSave(draft.status === "outstanding" ? { ...draft, name: draft.name.trim(), repaidAt: undefined, repaymentAccountId: undefined } : { ...draft, name: draft.name.trim() }); }}><div className="modal-header"><div><span className="modal-kicker">借款资料</span><h2>编辑借款</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button></div><div className="editor-grid managed-editor-grid"><label className="field"><span>借款名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="field"><span>金额</span><input type="number" min="0.01" step="0.01" value={draft.principal} onChange={(event) => setDraft({ ...draft, principal: Number(event.target.value) })} /></label><label className="field"><span>币种</span><select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value })}>{ledger.rates.map((rate) => <option key={rate.code} value={rate.code}>{rate.name} {rate.code}</option>)}</select></label><label className="field"><span>借入账户</span><select value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label className="field"><span>借入日期</span><input type="date" value={draft.borrowedAt} onChange={(event) => setDraft({ ...draft, borrowedAt: event.target.value })} /></label><label className="field"><span>约定还款日</span><input type="date" min={draft.borrowedAt} value={draft.dueDate ?? ""} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value || undefined })} /></label><label className="field wide"><span>归还状态</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Loan["status"], repaidAt: event.target.value === "outstanding" ? undefined : draft.repaidAt ?? new Date().toISOString().slice(0, 10), repaymentAccountId: event.target.value === "outstanding" ? undefined : draft.repaymentAccountId ?? accounts[0]?.id })}><option value="outstanding">待归还</option><option value="repaid">已归还</option></select><small className="field-help">误操作还款时选择“待归还”，借款会重新进入待还列表；流水记录不会被自动删除。</small></label>{draft.status === "repaid" && <><label className="field"><span>实际归还日期</span><input type="date" value={draft.repaidAt ?? ""} onChange={(event) => setDraft({ ...draft, repaidAt: event.target.value })} /></label><label className="field"><span>实际还款账户</span><select value={draft.repaymentAccountId ?? accounts[0]?.id} onChange={(event) => setDraft({ ...draft, repaymentAccountId: event.target.value })}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></>}</div><button className="save-button modal-primary" type="submit">保存借款</button></motion.form></motion.div>;
}

function SubscriptionEditor({ value, ledger, onClose, onSave }: { value: Subscription; ledger: LedgerState; onClose: () => void; onSave: (value: Subscription) => void }) {
  const bookingCurrency = value.bookedBaseCurrency ?? ledger.baseCurrency;
  const accounts = spendableAccounts(ledger).filter((account) => (account.currency ?? ledger.baseCurrency) === bookingCurrency);
  const [draft, setDraft] = useState(() => ({ ...value, accountId: accounts.some((account) => account.id === value.accountId) ? value.accountId : accounts.find((account) => account.parentAccountId === value.accountId)?.id ?? accounts[0]?.id ?? value.accountId }));
  return <motion.div className="modal-backdrop clean" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.form className="settings-modal managed-editor liquid-modal glass-panel" initial={{ y: 18, opacity: 0, scale: .98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 12, opacity: 0 }} onSubmit={(event) => { event.preventDefault(); if (draft.name.trim() && draft.amount > 0) onSave({ ...draft, name: draft.name.trim() }); }}><div className="modal-header"><div><span className="modal-kicker">订阅资料</span><h2>编辑订阅</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button></div><div className="editor-grid managed-editor-grid"><label className="field"><span>订阅名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="field"><span>金额 · {bookingCurrency}</span><input type="number" min="0.01" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: Number(event.target.value) })} /></label><label className="field"><span>分类</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{ledger.categories.filter((category) => category.type === "expense").map((category) => <option key={category.id}>{category.name}</option>)}</select></label><label className="field"><span>付款子账户</span><select value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label className="field"><span>开通日期</span><input type="date" value={draft.startedAt} onChange={(event) => setDraft({ ...draft, startedAt: event.target.value })} /></label><label className="field"><span>续订或到期日期</span><input type="date" min={draft.startedAt} value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /></label><label className="field"><span>扣款周期</span><select value={draft.cycle} onChange={(event) => setDraft({ ...draft, cycle: event.target.value as Subscription["cycle"] })}><option value="monthly">每月</option><option value="yearly">每年</option></select></label><label className="field"><span>续订方式</span><select value={draft.renewalMode} onChange={(event) => setDraft({ ...draft, renewalMode: event.target.value as Subscription["renewalMode"] })}><option value="auto">自动续订</option><option value="fixed">固定期限</option></select></label><label className="field wide"><span>提前提醒天数</span><input type="number" min="0" max="365" value={draft.reminderDays} onChange={(event) => setDraft({ ...draft, reminderDays: Number(event.target.value) })} /></label></div><button className="save-button modal-primary" type="submit">保存订阅</button></motion.form></motion.div>;
}

function AssetEditor({ value, ledger, onClose, onSave }: { value: Asset; ledger: LedgerState; onClose: () => void; onSave: (value: Asset) => void }) {
  const bookingCurrency = value.bookedBaseCurrency ?? ledger.baseCurrency;
  const [draft, setDraft] = useState(value);
  return <motion.div className="modal-backdrop clean" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.form className="settings-modal managed-editor liquid-modal glass-panel" initial={{ y: 18, opacity: 0, scale: .98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 12, opacity: 0 }} onSubmit={(event) => { event.preventDefault(); if (draft.name.trim() && draft.price > 0) onSave({ ...draft, name: draft.name.trim() }); }}><div className="modal-header"><div><span className="modal-kicker">折旧资料</span><h2>编辑资产</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button></div><div className="editor-grid managed-editor-grid"><label className="field"><span>资产名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="field"><span>原价 · {bookingCurrency}</span><input type="number" min="0.01" step="0.01" value={draft.price} onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) })} /></label><label className="field"><span>分类</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{ledger.categories.filter((category) => category.type === "expense").map((category) => <option key={category.id}>{category.name}</option>)}</select></label><label className="field"><span>购入日期</span><input type="date" value={draft.purchasedAt} onChange={(event) => setDraft({ ...draft, purchasedAt: event.target.value })} /></label><label className="field wide"><span>预计使用天数（可选）</span><input type="number" min="1" placeholder="留空则按实际使用天数计算" value={draft.lifeDays ?? ""} onChange={(event) => setDraft({ ...draft, lifeDays: event.target.value ? Number(event.target.value) : undefined })} /></label></div><button className="save-button modal-primary" type="submit">保存资产</button></motion.form></motion.div>;
}

function ManagedDeleteConfirm({ request, onClose, onConfirm }: { request: ManagedDelete; onClose: () => void; onConfirm: () => void }) {
  const labels = { loan: "借款管理记录", subscription: "订阅记录", asset: "折旧资产" };
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.div className="delete-confirm liquid-modal glass-panel" initial={{ y: 20, opacity: 0, scale: .97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 12, opacity: 0 }}><div className="delete-warning"><span><Warning size={23} weight="fill" /></span><div><h2>删除“{request.name}”？</h2><p>只删除该{labels[request.kind]}，不会删除对应的原始收支流水。</p></div></div><div className="delete-actions"><button onClick={onClose}>取消</button><button className="confirm-danger" onClick={onConfirm}><Trash size={16} />确认删除</button></div></motion.div></motion.div>;
}

function CreditSummary({ rows, currency }: { rows: Array<{ tool: LedgerState["creditTools"][number]; charges: number; paid: number; due: number }>; currency: string }) {
  return <div className="credit-summary-row">{rows.map(({ tool, charges, paid, due }) => <div key={tool.id}><span><CreditCard size={19} weight="duotone" /></span><p><b>{tool.name}</b><small>{tool.statementDay} 日出账，{tool.repaymentDay} 日还款</small></p><dl><div><dt>累计消费</dt><dd>{money(charges, currency)}</dd></div><div><dt>已还</dt><dd>{money(paid, currency)}</dd></div><div><dt>当前待还</dt><dd>{money(due, currency)}</dd></div></dl></div>)}</div>;
}

function SubscriptionTable({ ledger, subscriptions, onEdit, onDelete }: { ledger: LedgerState; subscriptions: Subscription[]; onEdit: (subscription: Subscription) => void; onDelete: (subscription: Subscription) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const labels = { auto: "自动续订", fixed: "固定期限" };
  return <div className="table-scroll"><table className="ledger-table managed-table"><thead><tr><th>订阅</th><th>模式</th><th>开通日期</th><th>续订 / 到期</th><th>付款账户</th><th className="numeric">金额</th><th aria-label="操作" /></tr></thead><tbody>{subscriptions.map((item) => { const days = Math.ceil((new Date(`${item.endsAt}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000); const urgent = days <= item.reminderDays; const linked = ledger.transactions.find((transaction) => transaction.subscriptionId === item.id); const amount = linked ? transactionAmountInBase(linked, ledger.rates, ledger.baseCurrency) : subscriptionAmountInBase(item, ledger.rates, ledger.baseCurrency); return <tr key={item.id} className={urgent ? "managed-urgent" : ""}><td className="item-cell" data-label="订阅"><b>{item.name}</b><small>{item.category} · {item.cycle === "monthly" ? "月付" : "年付"}</small></td><td data-label="模式">{labels[item.renewalMode]}</td><td data-label="开通日期"><span className="date-cell">{item.startedAt}</span></td><td data-label="续订 / 到期"><span className={urgent ? "status overdue" : "date-cell"}>{item.endsAt}{urgent ? ` · ${days < 0 ? "已到期" : `${days}天后`}` : ""}</span></td><td data-label="付款账户">{ledger.accounts.find((account) => account.id === item.accountId)?.name ?? "未知账户"}</td><td className="numeric" data-label="金额">{money(amount, ledger.baseCurrency)}</td><td className="actions-cell" data-label="操作"><div className="row-actions"><button className="row-edit" onClick={() => onEdit(item)} aria-label={`编辑${item.name}`} title="编辑订阅"><PencilSimple size={15} /></button><button className="row-delete" onClick={() => onDelete(item)} aria-label={`删除${item.name}`} title="删除订阅"><Trash size={15} /></button></div></td></tr>; })}</tbody></table>{ledger.subscriptions.length === 0 && <div className="empty-state"><Repeat size={28} /><b>还没有订阅记录</b><span>新增支出时开启订阅选项即可建立记录</span></div>}</div>;
}

function AssetTable({ ledger, assets, onEdit, onDelete }: { ledger: LedgerState; assets: Asset[]; onEdit: (asset: Asset) => void; onDelete: (asset: Asset) => void }) {
  const today = new Date();
  return <div className="table-scroll"><table className="ledger-table asset-table managed-table"><thead><tr><th>资产</th><th>分类</th><th>购入日期</th><th>已使用</th><th>折旧方式</th><th className="numeric">原价</th><th className="numeric">当前日均成本</th><th aria-label="操作" /></tr></thead><tbody>{assets.map((asset) => { const usedDays = Math.max(1, Math.floor((today.getTime() - new Date(`${asset.purchasedAt}T12:00:00`).getTime()) / 86400000)); const linked = ledger.transactions.find((transaction) => transaction.assetId === asset.id); const price = linked ? transactionAmountInBase(linked, ledger.rates, ledger.baseCurrency) : assetPriceInBase(asset, ledger.rates, ledger.baseCurrency); return <tr key={asset.id}><td className="item-cell" data-label="资产"><b>{asset.name}</b><small>资产编号 {asset.id.slice(0, 8)}</small></td><td data-label="分类"><span className="category-chip">{asset.category}</span></td><td data-label="购入日期"><span className="date-cell">{asset.purchasedAt}</span></td><td data-label="已使用">{usedDays} 天</td><td data-label="折旧方式">{asset.lifeDays ? `预计 ${asset.lifeDays} 天` : "按实际使用天数"}</td><td className="numeric" data-label="原价">{money(price, ledger.baseCurrency)}</td><td className="numeric income" data-label="当前日均成本">{money(price / usedDays, ledger.baseCurrency)}</td><td className="actions-cell" data-label="操作"><div className="row-actions"><button className="row-edit" onClick={() => onEdit(asset)} aria-label={`编辑${asset.name}`} title="编辑资产"><PencilSimple size={15} /></button><button className="row-delete" onClick={() => onDelete(asset)} aria-label={`删除${asset.name}`} title="删除资产"><Trash size={15} /></button></div></td></tr>; })}</tbody></table>{ledger.assets.length === 0 && <div className="empty-state"><SquaresFour size={28} /><b>还没有折旧资产</b><span>新增支出时勾选“计入资产折旧”即可建立记录</span></div>}</div>;
}
