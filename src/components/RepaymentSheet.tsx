import { useMemo, useState } from "react";
import { CreditCard, X } from "@phosphor-icons/react";
import { motion } from "motion/react";
import type { LedgerState } from "../types";
import { repaymentAmountInBase, transactionAmountInBase } from "../transactionAccounting";

const money = (value: number, currency: string) => new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(value);

export default function RepaymentSheet({ ledger, initialToolId, onClose, onConfirm }: { ledger: LedgerState; initialToolId?: string; onClose: () => void; onConfirm: (toolId: string, amount: number, accountId: string) => void }) {
  const [toolId, setToolId] = useState(initialToolId ?? ledger.creditTools[0]?.id ?? "");
  const tool = ledger.creditTools.find((item) => item.id === toolId);
  const settlementCurrency = ledger.accounts.find((account) => account.id === tool?.accountId)?.currency ?? ledger.baseCurrency;
  const dueFor = (targetToolId: string, currency: string) => {
    const charges = ledger.transactions.filter((item) => item.status !== "scheduled" && item.creditToolId === targetToolId).reduce((sum, item) => sum + transactionAmountInBase(item, ledger.rates, currency), 0);
    const paid = ledger.repayments.filter((item) => item.creditToolId === targetToolId).reduce((sum, item) => sum + repaymentAmountInBase(item, ledger.rates, currency), 0);
    return Math.max(0, charges - paid);
  };
  const due = useMemo(() => {
    return dueFor(toolId, settlementCurrency);
  }, [ledger, toolId, settlementCurrency]);
  const orderedAccounts = tool?.repaymentAccountIds?.length ? tool.repaymentAccountIds : tool ? [tool.repaymentAccountId] : [];
  const repaymentAccounts = ledger.accounts.filter((account) => Boolean(account.parentAccountId) && account.id !== tool?.accountId && (account.currency ?? ledger.baseCurrency) === settlementCurrency);
  const [amount, setAmount] = useState(due);
  const [accountId, setAccountId] = useState(repaymentAccounts.some((account) => account.id === orderedAccounts[0]) ? orderedAccounts[0] : repaymentAccounts[0]?.id ?? "");

  const changeTool = (nextId: string) => {
    const nextTool = ledger.creditTools.find((item) => item.id === nextId);
    const nextCurrency = ledger.accounts.find((account) => account.id === nextTool?.accountId)?.currency ?? ledger.baseCurrency;
    const nextAccounts = ledger.accounts.filter((account) => Boolean(account.parentAccountId) && account.id !== nextTool?.accountId && (account.currency ?? ledger.baseCurrency) === nextCurrency);
    setToolId(nextId);
    setAmount(dueFor(nextId, nextCurrency));
    const preferred = nextTool?.repaymentAccountIds?.[0] ?? nextTool?.repaymentAccountId;
    setAccountId(nextAccounts.some((account) => account.id === preferred) ? preferred! : nextAccounts[0]?.id ?? "");
  };

  return <motion.div className="modal-backdrop clean" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.form className="settings-modal repayment-sheet liquid-modal glass-panel" initial={{ y: 24, opacity: 0, scale: .97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 16, opacity: 0, scale: .98 }} onSubmit={(event) => { event.preventDefault(); if (amount > 0 && amount <= due && accountId) onConfirm(toolId, amount, accountId); }}><div className="modal-header"><div><span className="modal-kicker"><CreditCard size={15} />内部转账</span><h2>信用还款</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭信用还款"><X size={18} /></button></div><div className="repayment-hero"><small>当前账户应还 · {settlementCurrency}</small><strong>{money(due, settlementCurrency)}</strong><span>{tool?.statementDay} 日出账 · {tool?.repaymentDay} 日还款</span></div><div className="editor-grid"><label className="field"><span>信用账户</span><select value={toolId} onChange={(event) => changeTool(event.target.value)}>{ledger.creditTools.map((item) => <option key={item.id} value={item.id}>{ledger.accounts.find((account) => account.id === item.parentAccountId)?.name} · {item.name}</option>)}</select></label><label className="field"><span>还款账户 · {settlementCurrency}</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{repaymentAccounts.map((account) => <option key={account.id} value={account.id}>{ledger.accounts.find((parent) => parent.id === account.parentAccountId)?.name} / {account.name} · {money(account.balance, settlementCurrency)}</option>)}</select></label><label className="field wide"><span>还款金额</span><input type="number" min="0.01" max={due} step="0.01" value={amount || ""} onChange={(event) => setAmount(Number(event.target.value))} /></label></div>{repaymentAccounts.length === 0 && <p className="recognition-note">请先创建一个 {settlementCurrency} 子账户用于还款。</p>}<div className="repayment-presets"><button type="button" onClick={() => setAmount(Number((due / 2).toFixed(2)))}>还一半</button><button type="button" onClick={() => setAmount(due)}>全部还清</button></div><button className="save-button modal-primary" type="submit" disabled={due <= 0 || amount <= 0 || amount > due || !accountId}>确认还款</button></motion.form></motion.div>;
}
