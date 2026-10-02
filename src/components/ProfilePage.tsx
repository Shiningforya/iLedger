import { useState } from "react";
import {
  ArrowDown, ArrowUp, ArrowsClockwise, Bank, Basket, BookOpen, Briefcase, CaretRight, Check,
  CreditCard, CurrencyCircleDollar, Database, DeviceMobile, Eye, EyeSlash, ForkKnife,
  GameController, Gift, GraduationCap, HandCoins, Handshake, Heart, House, ImageSquare, MagnifyingGlass, Palette,
  PencilSimple, Plus, Repeat, ShieldCheck, ShoppingBag, Tag, Train, Trash, TrendUp, Wallet, X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Account, Category, CreditTool, EntryType, ExchangeRate, LedgerState, ProjectRule } from "../types";
import { fetchRatesToCny, lookupCurrency } from "../exchange";
import { compressCategoryIcon } from "../image";
import { renameCategoryReferences, transferAndRemoveChildAccount } from "../ledgerRelations";
import { CUSTOM_TILES_STORAGE_KEY, normalizeCustomTile, remapTileAccountReferences, remapTileCategoryReferences, type CustomTile } from "../tileAnalytics";
import { accountChildren, accountDisplayBalance, currencyIsReferenced, hasSpendableAccountForCurrency, repaymentAmountInBase, totalAssetBalance, transactionAmountInBase } from "../transactionAccounting";
import RepaymentSheet from "./RepaymentSheet";
import { Pagination, usePagedItems } from "./Pagination";
import { useScrollHeightReserve } from "./useScrollHeightReserve";

const money = (value: number, currency: string) => new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(value);
const iconMap = { tag: Tag, basket: Basket, fork: ForkKnife, train: Train, game: GameController, book: BookOpen, device: DeviceMobile, briefcase: Briefcase, wallet: Wallet, trend: TrendUp, house: House, heart: Heart, gift: Gift, study: GraduationCap, shopping: ShoppingBag, handshake: Handshake, repay: HandCoins };
const accountIconMap = { bank: Bank, wallet: Wallet, cash: CurrencyCircleDollar, mobile: DeviceMobile, trend: TrendUp, house: House, briefcase: Briefcase, card: CreditCard };
const colors = ["#88C8AE", "#F0A49B", "#85B7E6", "#C9A2D5", "#EFC574", "#7DC8C7", "#B7CF7B", "#D6B28B"];
const parseRecognitionTerms = (value: string) => [...new Set(value.split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean))];
const updateSavedTiles = (transform: (tiles: CustomTile[]) => CustomTile[]) => {
  try {
    const raw = localStorage.getItem(CUSTOM_TILES_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved)) localStorage.setItem(CUSTOM_TILES_STORAGE_KEY, JSON.stringify(transform(saved.map(normalizeCustomTile))));
  } catch { /* Keep existing tile data if local storage is unavailable or malformed. */ }
};
type Section = "accounts" | "categories" | "currency" | "projects";

export default function ProfilePage({ ledger, setLedger, notify }: { ledger: LedgerState; setLedger: React.Dispatch<React.SetStateAction<LedgerState>>; notify: (message: string) => void }) {
  const reduceMotion = useReducedMotion();
  const contentReserve = useScrollHeightReserve<HTMLDivElement>();
  const [balancesVisible, setBalancesVisible] = useState(true);
  const [section, setSection] = useState<Section>("accounts");
  const [sectionDirection, setSectionDirection] = useState(1);
  const totalAssets = totalAssetBalance(ledger);
  const creditDue = ledger.transactions.filter((item) => item.status !== "scheduled" && item.creditToolId).reduce((sum, item) => sum + transactionAmountInBase(item, ledger.rates, ledger.baseCurrency), 0) - ledger.repayments.reduce((sum, item) => sum + repaymentAmountInBase(item, ledger.rates, ledger.baseCurrency), 0);
  const menu = [
    { key: "accounts" as const, label: "账户与信用", icon: Wallet, count: `${ledger.accounts.length + ledger.creditTools.filter((tool) => !tool.accountId).length} 个` },
    { key: "categories" as const, label: "类别管理", icon: Tag, count: `${ledger.categories.length} 项` },
    { key: "currency" as const, label: "币种与汇率", icon: CurrencyCircleDollar, count: ledger.baseCurrency },
    { key: "projects" as const, label: "项目记忆库", icon: Database, count: `${ledger.projectRules.length} 条` },
  ];
  const selectSection = (next: Section) => {
    if (next === section) return;
    contentReserve.preserveHeight();
    setSectionDirection(Math.sign(menu.findIndex((item) => item.key === next) - menu.findIndex((item) => item.key === section)) || 1);
    setSection(next);
  };
  const repay = (toolId: string, amount: number, accountId: string) => {
    if (amount <= 0) return;
    const settlementCurrency = ledger.accounts.find((account) => account.id === accountId)?.currency ?? ledger.baseCurrency;
    setLedger((current) => ({
      ...current,
      repayments: [{ id: crypto.randomUUID(), creditToolId: toolId, accountId, amount, bookedBaseCurrency: settlementCurrency, amountCny: Number((amount * (current.rates.find((rate) => rate.code === settlementCurrency)?.rateToCny || 1)).toFixed(2)), date: new Date().toISOString().slice(0, 10), automatic: false }, ...current.repayments],
      accounts: current.accounts.map((account) => account.id === accountId ? { ...account, balance: account.balance - amount } : account),
    }));
    notify(`已记录还款 ${money(amount, settlementCurrency)}`);
  };
  return <section className="profile-page">
    <div className="page-heading"><div><p className="eyebrow">我的</p><h1>{ledger.slogans.profile.title}</h1><p>{ledger.slogans.profile.subtitle}</p></div><div className="privacy-badge"><ShieldCheck size={20} weight="fill" /><span><b>本地优先</b><small>WebDAV 可按需手动传输</small></span></div></div>
    <div className="profile-layout">
      <aside className="profile-aside surface-panel">
        <div className="profile-balance"><div><small>净资产 · {ledger.baseCurrency}</small><button onClick={() => setBalancesVisible((value) => !value)} aria-label="显示或隐藏余额">{balancesVisible ? <Eye size={17} /> : <EyeSlash size={17} />}</button></div><strong>{balancesVisible ? money(totalAssets - Math.max(0, creditDue), ledger.baseCurrency) : "••••••"}</strong><span>资产 {balancesVisible ? money(totalAssets, ledger.baseCurrency) : "••••"}，待还 {balancesVisible ? money(Math.max(0, creditDue), ledger.baseCurrency) : "••••"}</span></div>
        <nav>{menu.map((item, index) => { const Icon = item.icon; return <button key={item.key} style={{ "--menu-index": index } as React.CSSProperties} className={section === item.key ? "active" : ""} onClick={() => selectSection(item.key)}>{section === item.key && <motion.i className="profile-nav-indicator" layoutId="profile-nav-indicator" transition={{ type: "spring", stiffness: 410, damping: 35 }} />}<span><Icon size={19} weight={section === item.key ? "fill" : "regular"} />{item.label}</span><small>{item.count}</small><CaretRight size={14} /></button>; })}</nav>
      </aside>
      <div className="profile-content surface-panel" ref={contentReserve.ref} style={contentReserve.minimumHeight ? { minHeight: contentReserve.minimumHeight } : undefined}>
        <AnimatePresence initial={false} custom={sectionDirection}>
          <motion.div
            key={section}
            className="profile-section-stage"
            initial={reduceMotion ? false : { opacity: 0, y: sectionDirection * 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: sectionDirection * -14 }}
            transition={{ duration: .26, ease: [0.16, 1, 0.3, 1] }}
          >
            {section === "accounts" && <Accounts ledger={ledger} setLedger={setLedger} notify={notify} visible={balancesVisible} repay={repay} preserveHeight={contentReserve.preserveHeight} />}
            {section === "categories" && <Categories ledger={ledger} setLedger={setLedger} notify={notify} preserveHeight={contentReserve.preserveHeight} />}
            {section === "currency" && <CurrencySettings ledger={ledger} setLedger={setLedger} notify={notify} preserveHeight={contentReserve.preserveHeight} />}
            {section === "projects" && <ProjectMemory ledger={ledger} setLedger={setLedger} preserveHeight={contentReserve.preserveHeight} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  </section>;
}

function SectionHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="profile-section-header"><div><h2>{title}</h2><p>{description}</p></div>{action}</div>;
}

function Accounts({ ledger, setLedger, notify, visible, repay, preserveHeight }: { ledger: LedgerState; setLedger: React.Dispatch<React.SetStateAction<LedgerState>>; notify: (message: string) => void; visible: boolean; repay: (toolId: string, amount: number, accountId: string) => void; preserveHeight: () => void }) {
  const [editingAccount, setEditingAccount] = useState<Account | "new" | null>(null);
  const [newChildParentId, setNewChildParentId] = useState<string>();
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const [deletingPrimary, setDeletingPrimary] = useState<Account | null>(null);
  const [repayToolId, setRepayToolId] = useState<string | null>(null);
  const primaryAccounts = ledger.accounts.filter((account) => !account.parentAccountId);
  const primaryPages = usePagedItems(primaryAccounts, 2);
  const [childPages, setChildPages] = useState<Record<string, number>>({});
  const saveAccount = (account: Account, creditTool?: CreditTool, initialChild?: Account) => {
    setLedger((current) => ({
      ...current,
      accounts: [...current.accounts.filter((item) => item.id !== account.id && item.id !== initialChild?.id), account, ...(initialChild ? [initialChild] : [])],
      creditTools: creditTool
        ? [creditTool, ...current.creditTools.filter((item) => item.id !== creditTool.id && item.accountId !== account.id)]
        : current.creditTools.filter((item) => item.accountId !== account.id),
    }));
    setEditingAccount(null); setNewChildParentId(undefined); notify("账户资料已保存");
  };
  const transferAndDelete = (replacementId: string) => {
    if (!deletingAccount || !replacementId) return;
    setLedger((current) => transferAndRemoveChildAccount(current, deletingAccount.id, replacementId));
    updateSavedTiles((tiles) => remapTileAccountReferences(tiles, deletingAccount.id, replacementId));
    setDeletingAccount(null); notify(`“${deletingAccount.name}”的流水已转移并删除`);
  };
  const dueFor = (tool: CreditTool) => {
    const settlementCurrency = ledger.accounts.find((item) => item.id === tool.accountId)?.currency ?? ledger.baseCurrency;
    return Math.max(0,
      ledger.transactions.filter((item) => item.status !== "scheduled" && item.creditToolId === tool.id).reduce((sum, item) => sum + transactionAmountInBase(item, ledger.rates, settlementCurrency), 0)
      - ledger.repayments.filter((item) => item.creditToolId === tool.id).reduce((sum, item) => sum + repaymentAmountInBase(item, ledger.rates, settlementCurrency), 0));
  };
  const deletePrimary = () => {
    if (!deletingPrimary || accountChildren(ledger, deletingPrimary.id).length) return;
    const primaryId = deletingPrimary.id;
    setLedger((current) => ({
      ...current,
      accounts: current.accounts.filter((item) => item.id !== primaryId),
      projectRules: current.projectRules.map((rule) => rule.accountId === primaryId ? { ...rule, accountId: undefined } : rule),
      creditTools: current.creditTools.filter((tool) => tool.parentAccountId !== primaryId),
    }));
    updateSavedTiles((tiles) => remapTileAccountReferences(tiles, primaryId));
    setDeletingPrimary(null);
    notify(`主账户“${deletingPrimary.name}”已删除`);
  };
  return <><SectionHeader title="账户与信用" description="主账户用于汇总；余额、流水与信用能力都归属于子账户。" action={<button className="text-button" onClick={() => { setNewChildParentId(undefined); setEditingAccount("new"); }}><Plus size={16} />添加账户</button>} />
    <div className="account-tree">{primaryPages.items.map((account) => {
      const children = accountChildren(ledger, account.id);
      const childPageCount = Math.max(1, Math.ceil(children.length / 10));
      const childPage = Math.min(childPages[account.id] ?? 1, childPageCount);
      const visibleChildren = children.slice((childPage - 1) * 10, childPage * 10);
      return <article className="account-family" key={account.id} style={{ "--account-color": account.color } as React.CSSProperties}>
        <div className="account-main"><button className="account-main-hit" onClick={() => setEditingAccount(account)}><span className="account-icon"><AccountIcon account={account} size={23} /></span><span><small>{children.length} 个子账户</small><b>{account.name}</b></span><strong>{visible ? money(accountDisplayBalance(ledger, account), ledger.baseCurrency) : "••••••"}</strong><CaretRight size={16} /></button><div className="account-main-actions"><button className="account-add-child" type="button" onClick={() => { setNewChildParentId(account.id); setEditingAccount("new"); }} title={`在${account.name}下新增子账户`} aria-label={`在${account.name}下新增子账户`}><Plus size={17} /></button><button className="account-delete-primary" type="button" onClick={() => children.length ? notify("请先删除或转移该主账户下的全部子账户") : setDeletingPrimary(account)} title={children.length ? "需先清空子账户" : "删除主账户"} aria-label={`删除主账户${account.name}`}><Trash size={15} /></button></div></div>
        {children.length > 0 && <div className="account-children">
          {visibleChildren.map((child) => { const tool = ledger.creditTools.find((item) => item.accountId === child.id); const due = tool ? dueFor(tool) : 0; const childCurrency = child.currency ?? ledger.baseCurrency; const hasReplacement = ledger.accounts.some((item) => item.parentAccountId && item.id !== child.id && (item.currency ?? ledger.baseCurrency) === childCurrency && !ledger.creditTools.some((credit) => credit.accountId === item.id)); return <div className={tool ? "account-child-row credit-child" : "account-child-row"} key={child.id} style={{ "--child-color": child.color } as React.CSSProperties}><button className="account-child-edit" onClick={() => setEditingAccount(child)}><span><AccountIcon account={child} size={18} /></span><p><b>{child.name}</b><small>{tool ? `${tool.statementDay} 日出账 · ${tool.repaymentDay} 日还款 · ${childCurrency}` : `余额子账户 · ${childCurrency}`}</small></p><strong>{visible ? money(child.balance, childCurrency) : "••••"}</strong>{tool && <em>{visible ? `待还 ${money(due, childCurrency)}` : "待还 ••••"}</em>}<CaretRight size={14} /></button>{tool && <button className="child-repay" type="button" onClick={() => setRepayToolId(tool.id)}>还款</button>}<button className="child-delete" type="button" onClick={() => hasReplacement ? setDeletingAccount(child) : notify(`至少需要另一个 ${childCurrency} 非信用子账户承接流水`)} title={hasReplacement ? "删除子账户" : `没有可承接流水的 ${childCurrency} 非信用子账户`} aria-label={`删除${child.name}`}><Trash size={14} /></button></div>; })}
          <Pagination page={childPage} pageCount={childPageCount} total={children.length} onPageChange={(next) => { preserveHeight(); setChildPages((current) => ({ ...current, [account.id]: next })); }} />
        </div>}
      </article>;
    })}</div>
    <Pagination page={primaryPages.page} pageCount={primaryPages.pageCount} total={primaryAccounts.length} onPageChange={(next) => { preserveHeight(); primaryPages.setPage(next); }} />
    <AnimatePresence>{editingAccount && <AccountEditor ledger={ledger} account={editingAccount === "new" ? undefined : editingAccount} initialParentId={editingAccount === "new" ? newChildParentId : undefined} onClose={() => { setEditingAccount(null); setNewChildParentId(undefined); }} onSave={saveAccount} />}{deletingAccount && <DeleteAccountModal ledger={ledger} account={deletingAccount} onClose={() => setDeletingAccount(null)} onConfirm={transferAndDelete} />}{deletingPrimary && <DeletePrimaryModal account={deletingPrimary} onClose={() => setDeletingPrimary(null)} onConfirm={deletePrimary} />}{repayToolId && <RepaymentSheet ledger={ledger} initialToolId={repayToolId} onClose={() => setRepayToolId(null)} onConfirm={(toolId, amount, accountId) => { repay(toolId, amount, accountId); setRepayToolId(null); }} />}</AnimatePresence>
  </>;
}

export function AccountEditor({ ledger, account, initialParentId, initialCurrency, onClose, onSave }: { ledger: LedgerState; account?: Account; initialParentId?: string; initialCurrency?: string; onClose: () => void; onSave: (account: Account, creditTool?: CreditTool, initialChild?: Account) => void }) {
  const linkedCredit = account ? ledger.creditTools.find((tool) => tool.accountId === account.id) : undefined;
  const primaryAccounts = ledger.accounts.filter((item) => !item.parentAccountId && item.id !== account?.id);
  const [isCredit, setIsCredit] = useState(Boolean(linkedCredit));
  const [role, setRole] = useState<"primary" | "child">(account?.parentAccountId || initialParentId ? "child" : "primary");
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<Account["kind"]>(account?.kind ?? "bank"); const [balance, setBalance] = useState(account?.balance ?? 0);
  const [currency, setCurrency] = useState(account?.currency ?? initialCurrency ?? ledger.baseCurrency);
  const repaymentAccounts = ledger.accounts.filter((item) => item.id !== account?.id && Boolean(item.parentAccountId) && (item.currency ?? ledger.baseCurrency) === currency);
  const [color, setColor] = useState(account?.color ?? colors[0]); const [parentAccountId, setParentAccountId] = useState(account?.parentAccountId ?? initialParentId ?? "");
  const [icon, setIcon] = useState(account?.icon ?? (account?.kind === "bank" ? "bank" : account?.kind === "cash" ? "cash" : "wallet"));
  const [customIcon, setCustomIcon] = useState<string | undefined>(account?.customIcon); const [iconError, setIconError] = useState("");
  const [aliasesText, setAliasesText] = useState((account?.aliases ?? []).join("、"));
  const [statementDay, setStatementDay] = useState(linkedCredit?.statementDay ?? 20); const [repaymentDay, setRepaymentDay] = useState(linkedCredit?.repaymentDay ?? 10);
  const [repaymentAccountIds, setRepaymentAccountIds] = useState<string[]>(() => {
    const saved = linkedCredit?.repaymentAccountIds?.filter((id) => repaymentAccounts.some((item) => item.id === id)) ?? [];
    return saved.length ? saved : [repaymentAccounts[0]?.id ?? ""];
  });
  const [autoRepay, setAutoRepay] = useState(linkedCredit?.autoRepay ?? false);
  const [candidate, setCandidate] = useState("");
  const managedChildren = account ? accountChildren(ledger, account.id) : [];
  const upload = async (file?: File) => { if (!file) return; setIconError(""); try { setCustomIcon(await compressCategoryIcon(file)); } catch (error) { setIconError(error instanceof Error ? error.message : "图片处理失败"); } };
  const moveRepayment = (index: number, offset: number) => setRepaymentAccountIds((current) => { const next = [...current]; const target = index + offset; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; });
  return <ModalShell title={account ? `编辑 ${account.name}` : initialParentId ? "新增子账户" : "添加账户"} kicker="统一账户管理" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (!name.trim() || (!account && !currency) || (role === "child" && !parentAccountId) || (isCredit && !repaymentAccountIds[0])) return; const aliases = role === "child" ? parseRecognitionTerms(aliasesText) : undefined; const id = account?.id ?? crypto.randomUUID(); const isPrimary = role === "primary"; const nextAccount: Account = { id, name: name.trim(), institution: isPrimary ? name.trim() : (ledger.accounts.find((item) => item.id === parentAccountId)?.name ?? name.trim()), kind, balance: isPrimary ? 0 : balance, currency: isPrimary ? undefined : currency, color, icon, customIcon, aliases, parentAccountId: isPrimary ? undefined : parentAccountId, hierarchyConfigured: true }; const initialChild: Account | undefined = !account && isPrimary ? { ...nextAccount, id: `${id}-balance`, balance, currency, aliases: [name.trim()], parentAccountId: id, hierarchyConfigured: true } : undefined; const creditAccount = initialChild ?? nextAccount; const creditTool = isCredit ? { id: linkedCredit?.id ?? `${creditAccount.id}-credit`, accountId: creditAccount.id, name: creditAccount.name, parentAccountId: creditAccount.parentAccountId ?? id, statementDay, repaymentDay, repaymentAccountId: repaymentAccountIds[0], repaymentAccountIds, priority: linkedCredit?.priority ?? ledger.creditTools.length + 1, autoRepay, aliases: creditAccount.aliases } : undefined; onSave(nextAccount, creditTool, initialChild); }}>
    {role === "child" && <label className="field recognition-field"><span>识别库关键词</span><input value={aliasesText} onChange={(event) => setAliasesText(event.target.value)} placeholder={isCredit ? "例如：汇丰万事达、HSBC Mastercard" : "例如：中银香港 VISA、BOCHK"} /><small>用逗号分隔；只有子账户会参与文字记账匹配。</small></label>}
    <div className="editor-grid"><label className="field"><span>账户名称</span><input value={name} onChange={(event) => setName(event.target.value)} autoFocus placeholder={isCredit ? "例如：汇丰万事达" : "例如：建设银行"} /></label><label className="field"><span>账户层级</span><select value={role} disabled={Boolean(account)} onChange={(event) => { const next = event.target.value as "primary" | "child"; setRole(next); if (next === "child" && !parentAccountId) setParentAccountId(primaryAccounts[0]?.id ?? ""); if (next === "primary") setIsCredit(false); }}><option value="primary">主账户</option><option value="child">子账户</option></select></label><label className="field"><span>账户类型</span><select value={kind} onChange={(event) => setKind(event.target.value as Account["kind"])}><option value="bank">银行卡</option><option value="wallet">电子钱包</option><option value="cash">现金</option></select></label>{role === "primary" && account ? <label className="field"><span>子账户合计 · {ledger.baseCurrency}</span><input value={money(accountDisplayBalance(ledger, account), ledger.baseCurrency)} readOnly /></label> : <><label className="field"><span>{role === "primary" ? "初始子账户币种" : "账户币种"}</span><select value={currency} disabled={Boolean(account)} onChange={(event) => { const next = event.target.value; setCurrency(next); const first = ledger.accounts.find((item) => item.parentAccountId && item.id !== account?.id && (item.currency ?? ledger.baseCurrency) === next); setRepaymentAccountIds(first ? [first.id] : []); }}><option value="">请选择币种</option>{ledger.rates.map((rate) => <option key={rate.code} value={rate.code}>{rate.name} {rate.code}</option>)}</select></label><label className="field"><span>当前余额 · {currency}</span><input type="number" step="0.01" value={balance} onChange={(event) => setBalance(Number(event.target.value))} /></label></>}</div>
    {role === "child" && <label className="field recognition-field"><span>挂靠主账户</span><select value={parentAccountId} disabled={Boolean(initialParentId)} onChange={(event) => setParentAccountId(event.target.value)}><option value="">请选择主账户</option>{primaryAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {role === "child" && <div className="account-capabilities"><label className="check-row"><input type="checkbox" checked={isCredit} onChange={(event) => setIsCredit(event.target.checked)} /><span>信用账户</span></label></div>}
    {isCredit && <div className="credit-account-fields"><div className="editor-grid"><label className="field"><span>每月出账日</span><input type="number" min="1" max="28" value={statementDay} onChange={(event) => setStatementDay(Number(event.target.value))} /></label><label className="field"><span>每月还款日</span><input type="number" min="1" max="28" value={repaymentDay} onChange={(event) => setRepaymentDay(Number(event.target.value))} /></label></div><div className="ordered-accounts"><div><b>还款账户顺序</b><small>自动或手动还款时按顺序使用。</small></div>{repaymentAccountIds.filter(Boolean).map((id, index) => <div className="ordered-row" key={id}><span>{index + 1}</span><b>{ledger.accounts.find((item) => item.id === id)?.name}</b><button type="button" onClick={() => moveRepayment(index, -1)} disabled={index === 0} title="上移"><ArrowUp size={15} /></button><button type="button" onClick={() => moveRepayment(index, 1)} disabled={index === repaymentAccountIds.length - 1} title="下移"><ArrowDown size={15} /></button><button type="button" onClick={() => setRepaymentAccountIds((current) => current.filter((item) => item !== id))} disabled={repaymentAccountIds.length === 1} title="移除"><Trash size={15} /></button></div>)}<div className="add-ordered"><select value={candidate} onChange={(event) => setCandidate(event.target.value)}><option value="">选择还款账户</option>{repaymentAccounts.filter((item) => !repaymentAccountIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="text-button" disabled={!candidate} onClick={() => { setRepaymentAccountIds((current) => [...current.filter(Boolean), candidate]); setCandidate(""); }}><Plus size={15} />加入</button></div></div><label className="setting-row"><span><b>自动还款</b><small>到还款日按上述顺序记录内部转账</small></span><span className="switch"><input type="checkbox" checked={autoRepay} onChange={(event) => setAutoRepay(event.target.checked)} /><span /></span></label></div>}
    <div className="icon-editor"><span>账户图标</span><div className="icon-presets">{Object.entries(accountIconMap).map(([key, Icon]) => <button type="button" className={!customIcon && icon === key ? "selected" : ""} key={key} onClick={() => { setIcon(key); setCustomIcon(undefined); }} aria-label={`选择${key}图标`}><Icon size={19} /></button>)}<label className={customIcon ? "image-upload selected" : "image-upload"}>{customIcon ? <img src={customIcon} alt="自定义账户图标预览" /> : <ImageSquare size={19} />}<input type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void upload(event.target.files?.[0])} /><span>上传</span></label></div><small>图片会自动压缩至 160 px。</small>{iconError && <small className="form-error">{iconError}</small>}</div><ColorPicker value={color} onChange={setColor} /><button className="save-button modal-primary" type="submit">保存账户</button></form></ModalShell>;
}

function DeleteAccountModal({ ledger, account, onClose, onConfirm }: { ledger: LedgerState; account: Account; onClose: () => void; onConfirm: (replacementId: string) => void }) {
  const accountCurrency = account.currency ?? ledger.baseCurrency;
  const options = ledger.accounts.filter((item) => item.parentAccountId && item.id !== account.id && (item.currency ?? ledger.baseCurrency) === accountCurrency && !ledger.creditTools.some((tool) => tool.accountId === item.id));
  const [replacementId, setReplacementId] = useState("");
  return <ModalShell title={`删除 ${account.name}`} kicker="转移账户流水" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (replacementId) onConfirm(replacementId); }}><p className="recognition-note">删除前必须把该账户的余额、流水、订阅、借款和还款资料转入另一个 {accountCurrency} 子账户。</p><label className="field"><span>转入子账户</span><select value={replacementId} onChange={(event) => setReplacementId(event.target.value)}><option value="">请选择</option>{options.map((item) => <option key={item.id} value={item.id}>{ledger.accounts.find((parent) => parent.id === item.parentAccountId)?.name} / {item.name}</option>)}</select></label>{options.length === 0 && <small className="form-error">没有其他 {accountCurrency} 子账户，请先新增一个。</small>}<button className="save-button modal-primary danger" type="submit" disabled={!replacementId}><Trash size={17} />转移并删除</button></form></ModalShell>;
}

function DeletePrimaryModal({ account, onClose, onConfirm }: { account: Account; onClose: () => void; onConfirm: () => void }) {
  return <ModalShell title={`删除主账户 ${account.name}`} kicker="二次确认" onClose={onClose}><div className="delete-primary-confirm"><p className="recognition-note">该主账户内已经没有子账户。删除后无法恢复，但不会影响其他主账户。</p><div className="delete-actions"><button type="button" onClick={onClose}>取消</button><button type="button" className="confirm-danger" onClick={onConfirm}><Trash size={16} />确认删除</button></div></div></ModalShell>;
}

function Categories({ ledger, setLedger, notify, preserveHeight }: { ledger: LedgerState; setLedger: React.Dispatch<React.SetStateAction<LedgerState>>; notify: (message: string) => void; preserveHeight: () => void }) {
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const pages = usePagedItems(ledger.categories, 24);
  const save = (category: Category) => {
    const previous = ledger.categories.find((item) => item.id === category.id);
    if (previous?.name !== category.name && ledger.categories.some((item) => item.id !== category.id && item.name === category.name)) {
      notify("已有同名类别，请使用其他名称");
      return;
    }
    setLedger((current) => {
      const next = { ...current, categories: previous ? current.categories.map((item) => item.id === category.id ? { ...category, aliases: category.aliases ?? item.aliases } : item) : [...current.categories, category] };
      return previous ? renameCategoryReferences(next, previous.name, category.name) : next;
    });
    if (previous && previous.name !== category.name) updateSavedTiles((tiles) => remapTileCategoryReferences(tiles, previous.name, category.name));
    setEditing(null); notify("类别已保存");
  };
  return <><SectionHeader title="类别管理" description="每个类别都可以更名、换色或使用自定义图标。" action={<button className="text-button" onClick={() => setEditing("new")}><Plus size={16} />新增类别</button>} /><div className="category-sections">{(["expense", "income"] as EntryType[]).map((type) => <div key={type}><h3>{type === "expense" ? "支出类别" : "收入类别"}</h3><div className="category-cloud">{pages.items.filter((item) => item.type === type).map((item) => <button key={item.id} style={{ "--category-color": item.color } as React.CSSProperties} onClick={() => setEditing(item)}><CategoryIcon category={item} size={17} />{item.name}<span>{ledger.transactions.filter((tx) => tx.category === item.name).length}</span><CaretRight size={13} /></button>)}</div></div>)}</div><Pagination page={pages.page} pageCount={pages.pageCount} total={ledger.categories.length} onPageChange={(next) => { preserveHeight(); pages.setPage(next); }} /><AnimatePresence>{editing && <CategoryModal initial={editing === "new" ? undefined : editing} notify={notify} onClose={() => setEditing(null)} onSave={save} />}</AnimatePresence></>;
}

export function CategoryModal({ initial, defaultType = "expense", notify, onClose, onSave }: { initial?: Category; defaultType?: EntryType; notify: (message: string) => void; onClose: () => void; onSave: (category: Category) => void }) {
  const [name, setName] = useState(initial?.name ?? ""); const [type, setType] = useState<EntryType>(initial?.type ?? defaultType); const [color, setColor] = useState(initial?.color ?? colors[1]); const [icon, setIcon] = useState(initial?.icon ?? "tag"); const [customIcon, setCustomIcon] = useState<string | undefined>(initial?.customIcon);
  const [aliasesText, setAliasesText] = useState((initial?.aliases ?? []).join("、"));
  const upload = async (file?: File) => { if (!file) return; try { setCustomIcon(await compressCategoryIcon(file)); } catch (error) { notify(error instanceof Error ? error.message : "图片处理失败"); } };
  return <ModalShell title={initial ? `编辑 ${initial.name}` : "新增类别"} kicker="分类资料" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave({ id: initial?.id ?? crypto.randomUUID(), name: name.trim(), type, color, icon, customIcon, aliases: parseRecognitionTerms(aliasesText) }); }}>
    <div className="editor-grid"><label className="field"><span>类别名称</span><input value={name} onChange={(event) => setName(event.target.value)} autoFocus placeholder="例如：运动健康" /></label><label className="field"><span>收支类型</span><select value={type} disabled={Boolean(initial)} onChange={(event) => setType(event.target.value as EntryType)}><option value="expense">支出</option><option value="income">收入</option></select></label></div>
    <label className="field recognition-field"><span>识别库关键词</span><input value={aliasesText} onChange={(event) => setAliasesText(event.target.value)} placeholder="例如：ChatGPT、GPT、Claude" /><small>用逗号分隔；支持 GPT → ChatGPT 这类英文子串反向匹配。</small></label>
    <div className="icon-editor"><span>类别图标</span><div className="icon-presets">{Object.entries(iconMap).map(([key, Icon]) => <button type="button" className={!customIcon && icon === key ? "selected" : ""} key={key} onClick={() => { setIcon(key); setCustomIcon(undefined); }} aria-label={`选择${key}图标`}><Icon size={19} /></button>)}<label className={customIcon ? "image-upload selected" : "image-upload"}>{customIcon ? <img src={customIcon} alt="自定义图标预览" /> : <ImageSquare size={19} />}<input type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void upload(event.target.files?.[0])} /><span>上传</span></label></div><small>图片会自动压缩至 160 px，避免拖慢应用。</small></div><ColorPicker label="类别颜色" value={color} onChange={setColor} /><button className="save-button modal-primary" type="submit" disabled={!name.trim()}>保存类别</button>
  </form></ModalShell>;
}

function CategoryIcon({ category, size = 16 }: { category: Category; size?: number }) { if (category.customIcon) return <img className="category-custom-icon" src={category.customIcon} alt="" style={{ width: size, height: size }} />; const Icon = iconMap[category.icon as keyof typeof iconMap] ?? Tag; return <Icon size={size} weight="duotone" style={{ color: category.color }} />; }
function AccountIcon({ account, size = 16 }: { account: Account; size?: number }) { if (account.customIcon) return <img className="category-custom-icon" src={account.customIcon} alt="" style={{ width: size, height: size }} />; const Icon = accountIconMap[account.icon as keyof typeof accountIconMap] ?? (account.kind === "bank" ? Bank : account.kind === "cash" ? CurrencyCircleDollar : Wallet); return <Icon size={size} weight="duotone" />; }
function ColorPicker({ value, onChange, label = "账户颜色" }: { value: string; onChange: (color: string) => void; label?: string }) { return <div className="color-picker"><span><Palette size={16} />{label}</span><div>{colors.map((color) => <button type="button" key={color} className={value === color ? "selected" : ""} style={{ background: color }} onClick={() => onChange(color)} aria-label={`选择颜色 ${color}`} />)}<input type="color" value={value} onChange={(event) => onChange(event.target.value)} title="自定义颜色" /></div></div>; }

function CurrencySettings({ ledger, setLedger, notify, preserveHeight }: { ledger: LedgerState; setLedger: React.Dispatch<React.SetStateAction<LedgerState>>; notify: (message: string) => void; preserveHeight: () => void }) {
  const [updating, setUpdating] = useState(false); const [adding, setAdding] = useState(false);
  const pages = usePagedItems(ledger.rates, 16);
  const updateOnline = async () => { setUpdating(true); try { const rates = await fetchRatesToCny(ledger.rates); setLedger((current) => ({ ...current, rates })); notify("参考汇率已更新"); } catch { notify("联网更新失败，已保留本地汇率"); } finally { setUpdating(false); } };
  const remove = (code: string) => { if (code === "CNY" || code === ledger.baseCurrency) return; if (currencyIsReferenced(ledger, code)) { notify(`${code} 已被账户或账簿使用，不能删除`); return; } setLedger((current) => ({ ...current, rates: current.rates.filter((item) => item.code !== code) })); };
  const changeBaseCurrency = (baseCurrency: string) => {
    if (baseCurrency === ledger.baseCurrency) return;
    if (!hasSpendableAccountForCurrency(ledger, baseCurrency)) {
      notify(`请先在账户管理中创建一个 ${baseCurrency} 子账户`);
      return;
    }
    setLedger((current) => ({ ...current, baseCurrency }));
    notify(`后续记账将以 ${baseCurrency} 结算，历史账户与流水保持不变`);
  };
  const baseRate = ledger.rates.find((item) => item.code === ledger.baseCurrency)?.rateToCny || 1;
  return <><SectionHeader title="币种与汇率" description="输入代码或名称即可联网匹配，也可直接修改汇率。" action={<div className="header-actions"><button className="text-button" onClick={() => setAdding(true)}><Plus size={16} />新增币种</button><button className="text-button" onClick={updateOnline} disabled={updating}><ArrowsClockwise size={16} />{updating ? "更新中" : "联网更新"}</button></div>} /><div className="currency-settings"><label className="setting-row"><span><b>本位币</b><small>只影响后续结算；历史流水和账户币种不会改写。切换前需先创建对应币种的子账户。</small></span><select value={ledger.baseCurrency} onChange={(event) => changeBaseCurrency(event.target.value)}>{ledger.rates.map((rate) => <option key={rate.code} value={rate.code}>{rate.name} {rate.code}</option>)}</select></label><label className="setting-row"><span><b>打开应用时自动更新</b><small>仅在允许联网时执行</small></span><span className="switch"><input type="checkbox" checked={ledger.autoUpdateRates} onChange={(event) => setLedger((current) => ({ ...current, autoUpdateRates: event.target.checked }))} /><span /></span></label><div className="rate-list">{pages.items.map((rate) => <label key={rate.code}><span><b>{rate.symbol} {rate.code}</b><small>{rate.name}</small></span><div><small>1 {rate.code} =</small><input type="number" step="any" value={Number((rate.rateToCny / baseRate).toFixed(6))} disabled={rate.code === "CNY" || rate.code === ledger.baseCurrency} onChange={(event) => setLedger((current) => { const currentBaseRate = current.rates.find((item) => item.code === current.baseCurrency)?.rateToCny || 1; return { ...current, rates: current.rates.map((item) => item.code === rate.code ? { ...item, rateToCny: Number(event.target.value) * currentBaseRate } : item) }; })} /><small>{ledger.baseCurrency}</small><button type="button" className="mini-delete" disabled={rate.code === "CNY" || rate.code === ledger.baseCurrency} onClick={() => remove(rate.code)} title="删除币种"><Trash size={15} /></button></div></label>)}</div></div><Pagination page={pages.page} pageCount={pages.pageCount} total={ledger.rates.length} onPageChange={(next) => { preserveHeight(); pages.setPage(next); }} /><AnimatePresence>{adding && <CurrencyModal existing={ledger.rates.map((rate) => rate.code)} baseCurrency={ledger.baseCurrency} baseRateToCny={baseRate} onClose={() => setAdding(false)} onSave={(rate) => { setLedger((current) => ({ ...current, rates: [...current.rates, rate] })); setAdding(false); notify(`${rate.code} 已添加`); }} />}</AnimatePresence></>;
}

function CurrencyModal({ existing, baseCurrency, baseRateToCny, onClose, onSave }: { existing: string[]; baseCurrency: string; baseRateToCny: number; onClose: () => void; onSave: (rate: ExchangeRate) => void }) {
  const [query, setQuery] = useState(""); const [match, setMatch] = useState<ExchangeRate | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const search = async () => { setLoading(true); setError(""); try { const next = await lookupCurrency(query); if (existing.includes(next.code)) throw new Error("该币种已经存在"); setMatch(next); } catch (caught) { setError(caught instanceof Error ? caught.message : "匹配失败"); setMatch(null); } finally { setLoading(false); } };
  return <ModalShell title="新增币种" kicker="联网匹配" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (match) onSave(match); else void search(); }}><label className="field currency-search"><span>币种代码或名称</span><div><input value={query} onChange={(event) => { setQuery(event.target.value); setMatch(null); }} autoFocus placeholder="例如 GBP、英镑、韩元" /><button type="button" onClick={() => void search()} disabled={!query.trim() || loading}><MagnifyingGlass size={16} />{loading ? "匹配中" : "联网匹配"}</button></div></label>{error && <p className="form-error">{error}</p>}{match && <div className="currency-match"><span>{match.symbol}</span><p><b>{match.name}</b><small>{match.code}</small></p><label><small>1 {match.code} =</small><input type="number" step="any" min="0.000001" value={Number((match.rateToCny / baseRateToCny).toFixed(6))} onChange={(event) => setMatch({ ...match, rateToCny: Number(event.target.value) * baseRateToCny })} /><small>{baseCurrency}</small></label><Check size={19} weight="bold" /></div>}<button className="save-button modal-primary" type="submit" disabled={!query.trim() || loading}>{match ? "添加这个币种" : "查找币种"}</button></form></ModalShell>;
}

function ProjectMemory({ ledger, setLedger, preserveHeight }: { ledger: LedgerState; setLedger: React.Dispatch<React.SetStateAction<LedgerState>>; preserveHeight: () => void }) {
  const [editing, setEditing] = useState<ProjectRule | null>(null);
  const pages = usePagedItems(ledger.projectRules);
  return <><SectionHeader title="项目记忆库" description="这里只纠正项目名称；类别、账户与币种分别使用各自的识别库。" /><div className="project-memory">{pages.items.map((rule) => <div key={rule.id} onClick={() => setEditing(rule)}><span><Repeat size={18} /></span><p><b>{rule.keyword}</b><small>项目名称识别为“{rule.item}”</small></p><em>已命中 {rule.uses} 次</em><button title="编辑规则" aria-label={`编辑${rule.keyword}`} onClick={(event) => { event.stopPropagation(); setEditing(rule); }}><PencilSimple size={15} /></button><button className="memory-delete" aria-label={`删除${rule.keyword}`} onClick={(event) => { event.stopPropagation(); setLedger((current) => ({ ...current, projectRules: current.projectRules.filter((item) => item.id !== rule.id) })); }}><Trash size={15} /></button></div>)}</div><Pagination page={pages.page} pageCount={pages.pageCount} total={ledger.projectRules.length} onPageChange={(next) => { preserveHeight(); pages.setPage(next); }} /><AnimatePresence>{editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} onSave={(rule) => { setLedger((current) => ({ ...current, projectRules: current.projectRules.map((item) => item.id === rule.id ? rule : item) })); setEditing(null); }} />}</AnimatePresence></>;
}

function RuleEditor({ rule, onClose, onSave }: { rule: ProjectRule; onClose: () => void; onSave: (rule: ProjectRule) => void }) {
  const [draft, setDraft] = useState(rule);
  return <ModalShell title="编辑识别规则" kicker="项目记忆库" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (draft.keyword.trim() && draft.item.trim()) onSave({ ...draft, keyword: draft.keyword.trim(), item: draft.item.trim(), category: undefined, accountId: undefined, currency: undefined }); }}><div className="editor-grid"><label className="field"><span>匹配关键词</span><input value={draft.keyword} onChange={(event) => setDraft({ ...draft, keyword: event.target.value })} autoFocus /></label><label className="field"><span>项目名称</span><input value={draft.item} onChange={(event) => setDraft({ ...draft, item: event.target.value })} /></label></div><p className="recognition-note">账户、类别和币种会根据本次文字重新识别，不再由项目规则覆盖。</p><button className="save-button modal-primary" type="submit">保存规则</button></form></ModalShell>;
}
function ModalShell({ title, kicker, onClose, children }: { title: string; kicker: string; onClose: () => void; children: React.ReactNode }) { return <motion.div className="modal-backdrop clean" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.div className="settings-modal liquid-modal glass-panel" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} transition={{ duration: .24, ease: [0.16, 1, .3, 1] }}><div className="modal-liquid-content"><div className="modal-header"><div><span className="modal-kicker">{kicker}</span><h2>{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button></div>{children}</div></motion.div></motion.div>; }
