import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  CreditCard,
  Database,
  GearSix,
  House,
  Microphone,
  Plus,
  Sparkle,
  Stop,
  UserCircle,
  Wallet,
  X,
} from "@phosphor-icons/react";
import { defaultSlogans, initialLedger } from "./data";
import { isBorrowingCategory, managedCategoryName, reconcileTransactionCompanions } from "./ledgerRelations";
import { parseNaturalEntry } from "./parser";
import type { Account, Category, CreditTool, LedgerState, Loan, PageKey, ParsedEntry, Transaction } from "./types";
import Dashboard from "./components/Dashboard";
import DatabasePage from "./components/DatabasePage";
import ProfilePage from "./components/ProfilePage";
import SettingsPage from "./components/SettingsPage";
import RepaymentSheet from "./components/RepaymentSheet";
import EntryModal, { type EntryDraft } from "./components/EntryModal";
import { fetchRatesToCny } from "./exchange";
import { audioBlobToMono16k, isModelPackInstalled, localModelErrorMessage, parseWithAdvancedModel, transcribeChinese } from "./localModels";
import { learnRecognitionCorrections, projectKeywordFromCorrection } from "./recognition";
import {
  applyNewTransactionsToAccounts,
  accountChildren,
  canAffectAccountBalance,
  removeTransactionsAndRevertBalances,
  repaymentAmountInBase,
  spendableAccountsForCurrency,
  stabilizeAccountCurrencies,
  transactionAmountInBase,
  updateAccountsForTransactionChange,
  withBookedMoney,
} from "./transactionAccounting";

const STORAGE_KEY = "iledger-local-demo-v7";
const LEGACY_STORAGE_KEY = "ledger-local-demo-v6";

function migrateLedger(value: Partial<LedgerState>): LedgerState {
  const merged = { ...initialLedger, ...value } as LedgerState;
  const savedCategories = value.categories ?? initialLedger.categories;
  const refreshPalette = !value.designVersion || value.designVersion < 2;
  merged.categories = [...savedCategories, ...initialLedger.categories.filter((preset) => !savedCategories.some((category) => category.id === preset.id))].map((category) => ({
    ...category,
    name: category.id === "loan-repayment" && category.name === "借款还款" ? "归还借款" : category.name,
    icon: category.icon ?? (initialLedger.categories.find((item) => item.name === category.name)?.icon || "tag"),
    color: refreshPalette ? (initialLedger.categories.find((item) => item.id === category.id)?.color ?? category.color) : category.color,
    aliases: category.aliases ?? initialLedger.categories.find((item) => item.id === category.id)?.aliases,
  }));
  merged.transactions = (value.transactions ?? initialLedger.transactions).map((transaction) => transaction.category === "借款还款" ? { ...transaction, category: "归还借款" } : transaction);
  const savedAccounts = value.accounts ?? initialLedger.accounts;
  merged.accounts = [...savedAccounts, ...initialLedger.accounts.filter((preset) => !savedAccounts.some((account) => account.id === preset.id))].map((account) => ({
    ...account,
    color: refreshPalette ? (initialLedger.accounts.find((item) => item.id === account.id)?.color ?? account.color) : account.color,
    icon: account.icon ?? initialLedger.accounts.find((item) => item.id === account.id)?.icon ?? (account.kind === "bank" ? "bank" : account.kind === "cash" ? "cash" : "wallet"),
    parentAccountId: account.hierarchyConfigured
      ? account.parentAccountId
      : account.parentAccountId ?? initialLedger.accounts.find((item) => item.id === account.id)?.parentAccountId,
    aliases: account.aliases ?? initialLedger.accounts.find((item) => item.id === account.id)?.aliases,
  }));
  const savedTools = value.creditTools ?? initialLedger.creditTools;
  merged.creditTools = [...savedTools, ...initialLedger.creditTools.filter((preset) => !savedTools.some((tool) => tool.id === preset.id))].map((tool) => ({
    ...tool,
    repaymentAccountIds: tool.repaymentAccountIds?.length ? tool.repaymentAccountIds : [tool.repaymentAccountId],
    aliases: tool.aliases ?? initialLedger.creditTools.find((item) => item.id === tool.id)?.aliases,
  }));
  if ((value.designVersion ?? 0) < 5) {
    const accounts = [...merged.accounts];
    const defaultChildByParent = new Map<string, string>();
    const uniqueId = (preferred: string) => {
      let id = preferred;
      let index = 2;
      while (accounts.some((account) => account.id === id)) id = `${preferred}-${index++}`;
      return id;
    };
    accounts.filter((account) => !account.parentAccountId).forEach((parent) => {
      let child = accounts.find((candidate) => candidate.parentAccountId === parent.id && candidate.name === parent.name);
      if (!child) {
        child = {
          ...parent,
          id: uniqueId(`${parent.id}-balance`),
          parentAccountId: parent.id,
          hierarchyConfigured: true,
        };
        accounts.push(child);
      } else if (parent.balance && child.balance === 0) {
        child.balance = parent.balance;
      }
      parent.balance = 0;
      parent.hierarchyConfigured = true;
      defaultChildByParent.set(parent.id, child.id);
    });
    merged.creditTools = merged.creditTools.map((tool) => {
      const linked = tool.accountId ? accounts.find((account) => account.id === tool.accountId) : undefined;
      if (linked?.parentAccountId) return tool;
      const parentId = linked?.id ?? tool.parentAccountId;
      const accountId = uniqueId(`${tool.id}-account`);
      const parent = accounts.find((account) => account.id === parentId);
      accounts.push({
        id: accountId,
        name: tool.name,
        institution: parent?.name ?? tool.name,
        kind: parent?.kind ?? "bank",
        balance: 0,
        color: parent?.color ?? "#AAB9D1",
        icon: "card",
        aliases: tool.aliases,
        parentAccountId: parentId,
        hierarchyConfigured: true,
      });
      return { ...tool, accountId, parentAccountId: parentId };
    });
    const routeAccount = (accountId: string, creditToolId?: string) => {
      const toolAccountId = creditToolId ? merged.creditTools.find((tool) => tool.id === creditToolId)?.accountId : undefined;
      return toolAccountId ?? defaultChildByParent.get(accountId) ?? accountId;
    };
    merged.accounts = accounts;
    merged.transactions = merged.transactions.map((transaction) => ({ ...transaction, accountId: routeAccount(transaction.accountId, transaction.creditToolId) }));
    merged.subscriptions = merged.subscriptions.map((item) => ({ ...item, accountId: routeAccount(item.accountId) }));
    merged.repayments = merged.repayments.map((item) => ({ ...item, accountId: routeAccount(item.accountId) }));
    merged.loans = (merged.loans ?? []).map((item) => ({ ...item, accountId: routeAccount(item.accountId), repaymentAccountId: item.repaymentAccountId ? routeAccount(item.repaymentAccountId) : undefined }));
    merged.projectRules = merged.projectRules.map((item) => ({ ...item, accountId: item.accountId ? routeAccount(item.accountId) : undefined }));
    merged.creditTools = merged.creditTools.map((tool) => ({
      ...tool,
      repaymentAccountId: routeAccount(tool.repaymentAccountId),
      repaymentAccountIds: tool.repaymentAccountIds.map((id) => routeAccount(id)),
    }));
  }
  if ((value.designVersion ?? 0) < 6) {
    const bookingCurrency = merged.baseCurrency || "CNY";
    const bookingRateToCny = merged.rates.find((rate) => rate.code === bookingCurrency)?.rateToCny || 1;
    const parentAliases = new Map(merged.accounts.filter((account) => !account.parentAccountId).map((account) => [account.id, account.aliases ?? []]));
    merged.accounts = merged.accounts.map((account) => {
      if (!account.parentAccountId) return { ...account, balance: 0, currency: undefined, aliases: undefined };
      const parent = merged.accounts.find((candidate) => candidate.id === account.parentAccountId);
      const inheritedAliases = parent?.name === account.name ? (parentAliases.get(parent.id) ?? []) : [];
      return {
        ...account,
        currency: account.currency ?? bookingCurrency,
        aliases: [...new Set([...(account.aliases ?? []), ...inheritedAliases])],
      };
    });
    merged.transactions = merged.transactions.map((transaction) => transaction.bookedBaseCurrency
      ? transaction
      : withBookedMoney(transaction, merged.rates, undefined, undefined, bookingCurrency) as Transaction);
    merged.repayments = merged.repayments.map((repayment) => ({
      ...repayment,
      bookedBaseCurrency: repayment.bookedBaseCurrency ?? bookingCurrency,
      amountCny: repayment.amountCny ?? Number((repayment.amount * bookingRateToCny).toFixed(2)),
    }));
    merged.subscriptions = merged.subscriptions.map((subscription) => ({
      ...subscription,
      bookedBaseCurrency: subscription.bookedBaseCurrency ?? bookingCurrency,
      amountCny: subscription.amountCny ?? Number((subscription.amount * bookingRateToCny).toFixed(2)),
    }));
    merged.assets = merged.assets.map((asset) => ({
      ...asset,
      bookedBaseCurrency: asset.bookedBaseCurrency ?? bookingCurrency,
      priceCny: asset.priceCny ?? Number((asset.price * bookingRateToCny).toFixed(2)),
    }));
  }
  merged.glassOpacity = Number.isFinite(value.glassOpacity) ? Number(value.glassOpacity) : 42;
  merged.accentColor = value.accentColor || "#6D9E8A";
  merged.themeMode = value.themeMode || (localStorage.getItem("ledger-theme") === "dark" ? "dark" : "system");
  merged.dockAction = value.dockAction || "manual";
  merged.webDav = {
    ...initialLedger.webDav,
    ...(value.webDav ?? {}),
  };
  merged.slogans = {
    dashboard: { ...defaultSlogans.dashboard, ...(value.slogans?.dashboard ?? {}) },
    database: { ...defaultSlogans.database, ...(value.slogans?.database ?? {}) },
    profile: { ...defaultSlogans.profile, ...(value.slogans?.profile ?? {}) },
  };
  delete (merged as LedgerState & { fontChoice?: unknown }).fontChoice;
  delete (merged as LedgerState & { customFontName?: unknown }).customFontName;
  merged.assets = merged.assets.map((asset) => ({ ...asset, lifeDays: asset.lifeDays || undefined }));
  merged.subscriptions = merged.subscriptions.map((subscription) => ({
    ...subscription,
    renewalMode: subscription.renewalMode === "auto" ? "auto" : "fixed",
    reminderDays: subscription.reminderDays ?? 7,
  }));
  merged.loans = merged.loans ?? [];
  merged.accounts = stabilizeAccountCurrencies(merged);
  merged.designVersion = 7;
  return merged;
}

function readLedger(): LedgerState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    return saved ? migrateLedger(JSON.parse(saved)) : migrateLedger(initialLedger);
  } catch {
    return migrateLedger(initialLedger);
  }
}

const addMonths = (dateString: string, months: number) => {
  const date = new Date(`${dateString}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
};

const loanRepaymentName = (loan: Loan) => {
  const [year, month, day] = loan.borrowedAt.split("-").map(Number);
  const amount = new Intl.NumberFormat("zh-CN", { style: "currency", currency: loan.currency, maximumFractionDigits: 2 }).format(loan.principal);
  return `归还${year}年${month}月${day}日的${amount}借款`;
};

export default function App() {
  const reduceMotion = useReducedMotion();
  const [page, setPage] = useState<PageKey>("dashboard");
  const [ledger, setLedger] = useState<LedgerState>(readLedger);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [entryMode, setEntryMode] = useState<"expense" | "income" | "parsed" | "edit" | null>(null);
  const [parsedEntry, setParsedEntry] = useState<ParsedEntry | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [repayingLoan, setRepayingLoan] = useState<Loan | null>(null);
  const [naturalText, setNaturalText] = useState("");
  const [toast, setToast] = useState("");
  const [repaymentOpen, setRepaymentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [dockComposerOpen, setDockComposerOpen] = useState(false);
  const [dockText, setDockText] = useState("");
  const naturalInputRef = useRef<HTMLInputElement>(null);
  const dockInputRef = useRef<HTMLInputElement>(null);
  const voiceTargetRef = useRef<"main" | "dock">("main");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  }, [ledger]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const resolved = ledger.themeMode === "system" ? (systemDark ? "dark" : "light") : ledger.themeMode;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.setProperty("--user-accent", ledger.accentColor);
  }, [ledger.themeMode, ledger.accentColor, systemDark]);

  useEffect(() => {
    const opacity = Math.max(0, Math.min(100, ledger.glassOpacity));
    const level = opacity / 100;
    document.documentElement.style.setProperty("--glass-alpha", (0.85 * (1 - Math.pow(1 - level, 2.07))).toFixed(3));
    document.documentElement.style.setProperty("--glass-sheen", (0.08 + level * 0.16).toFixed(3));
    document.documentElement.style.setProperty("--glass-edge", (0.52 + level * 0.3).toFixed(3));
    document.documentElement.style.setProperty("--glass-blur", `${(0.8 + 11.2 * (1 - Math.pow(1 - level, 1.78))).toFixed(2)}px`);
    document.documentElement.style.setProperty("--glass-refraction", (0.55 + level * 0.3).toFixed(3));
  }, [ledger.glassOpacity]);

  useEffect(() => {
    if (!ledger.autoUpdateRates) return;
    let cancelled = false;
    fetchRatesToCny(ledger.rates)
      .then((rates) => {
        if (!cancelled) setLedger((current) => ({ ...current, rates }));
      })
      .catch(() => {
        if (!cancelled) setToast("自动更新汇率失败，已保留本地数据");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const monthKey = today.slice(0, 7);
    const monthStart = `${monthKey}-01`;
    setLedger((current) => {
      let accounts = current.accounts.map((account) => ({ ...account }));
      const repayments = [...current.repayments];
      let changed = false;
      [...current.creditTools].sort((a, b) => a.priority - b.priority).forEach((tool) => {
        if (!tool.autoRepay || now.getDate() < tool.repaymentDay) return;
        if (repayments.some((item) => item.creditToolId === tool.id && item.automatic && item.date.startsWith(monthKey))) return;
        const settlementCurrency = current.accounts.find((account) => account.id === tool.accountId)?.currency ?? current.baseCurrency;
        const charges = current.transactions.filter((item) => item.status !== "scheduled" && item.creditToolId === tool.id && item.date < monthStart).reduce((sum, item) => sum + transactionAmountInBase(item, current.rates, settlementCurrency), 0);
        const paid = repayments.filter((item) => item.creditToolId === tool.id).reduce((sum, item) => sum + repaymentAmountInBase(item, current.rates, settlementCurrency), 0);
        let remaining = Math.max(0, charges - paid);
        const ordered = tool.repaymentAccountIds?.length ? tool.repaymentAccountIds : [tool.repaymentAccountId];
        ordered.forEach((configuredAccountId) => {
          if (remaining <= 0) return;
          const accountId = accountChildren(current, configuredAccountId).find((child) => (child.currency ?? current.baseCurrency) === settlementCurrency)?.id ?? configuredAccountId;
          const account = accounts.find((item) => item.id === accountId);
          if (!account || (account.currency ?? current.baseCurrency) !== settlementCurrency || account.balance <= 0) return;
          const amount = Math.min(remaining, account.balance);
          account.balance -= amount;
          remaining -= amount;
          repayments.unshift({ id: crypto.randomUUID(), creditToolId: tool.id, accountId, amount: Number(amount.toFixed(2)), bookedBaseCurrency: settlementCurrency, amountCny: Number((amount * (current.rates.find((rate) => rate.code === settlementCurrency)?.rateToCny || 1)).toFixed(2)), date: today, automatic: true });
          changed = true;
        });
      });
      return changed ? { ...current, accounts, repayments } : current;
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const pageTitle = useMemo(
    () => ({ dashboard: "驾驶舱", database: "数据库", profile: "我的" })[page],
    [page],
  );

  const openNaturalEntry = async (input = naturalText) => {
    const source = input.trim();
    if (!source || parsing) return;
    setParsing(true);
    try {
      const parsed = isModelPackInstalled("language") ? await parseWithAdvancedModel(source, ledger) : parseNaturalEntry(source, ledger);
      setParsedEntry(parsed);
      setEntryMode("parsed");
    } catch (error) {
      console.error("[iLedger] advanced language parsing failed", error);
      setParsedEntry(parseNaturalEntry(source, ledger));
      setEntryMode("parsed");
      setToast(localModelErrorMessage(error));
    } finally {
      setParsing(false);
    }
  };

  const stopVoiceInput = () => {
    if (voiceTimerRef.current) window.clearTimeout(voiceTimerRef.current);
    voiceTimerRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  useEffect(() => () => {
    if (voiceTimerRef.current) window.clearTimeout(voiceTimerRef.current);
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const startVoiceInput = async (target: "main" | "dock" = "main") => {
    if (voiceState === "recording") { stopVoiceInput(); return; }
    if (voiceState === "transcribing") return;
    voiceTargetRef.current = target;
    if (!isModelPackInstalled("speech")) {
      setSettingsOpen(true);
      setToast("请先安装中文语音包");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) voiceChunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        voiceStreamRef.current = null;
        setVoiceState("transcribing");
        try {
          const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          const audio = await audioBlobToMono16k(blob);
          const text = await transcribeChinese(audio);
          setNaturalText(text);
          if (voiceTargetRef.current === "dock") {
            setDockText(text);
            window.setTimeout(() => dockInputRef.current?.focus(), 40);
          } else {
            window.setTimeout(() => naturalInputRef.current?.focus(), 40);
          }
          setToast("语音已转写，请检查文字后再识别");
        } catch (error) {
          setToast(error instanceof Error ? error.message : "语音识别失败，请重试");
        } finally {
          setVoiceState("idle");
          recorderRef.current = null;
          voiceChunksRef.current = [];
        }
      };
      recorder.start(250);
      setVoiceState("recording");
      voiceTimerRef.current = window.setTimeout(stopVoiceInput, 30000);
    } catch {
      setToast("无法使用麦克风，请检查系统权限");
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      setVoiceState("idle");
    }
  };

  const activateDockAction = () => {
    if (ledger.dockAction === "manual") { setDockComposerOpen(false); setEntryMode("expense"); return; }
    setDockComposerOpen(true);
    window.setTimeout(() => dockInputRef.current?.focus(), 80);
  };

  const submitDockComposer = (event: React.FormEvent) => {
    event.preventDefault();
    const source = dockText.trim();
    if (!source || parsing) return;
    setNaturalText(source);
    setDockComposerOpen(false);
    void openNaturalEntry(source);
  };

  const saveEntry = (draft: EntryDraft) => {
    if (editingTransaction) {
      setLedger((current) => {
        const currentLoans = current.loans ?? [];
        const existingLoan = currentLoans.find((loan) => loan.transactionId === editingTransaction.id || loan.id === editingTransaction.loanId);
        const remainsLoan = draft.type === "income" && isBorrowingCategory(current, draft.category);
        const loanId = remainsLoan ? (existingLoan?.id ?? `${editingTransaction.id}-loan`) : undefined;
        const loans = remainsLoan ? [
          {
            id: loanId!, transactionId: editingTransaction.id, name: draft.item.trim(), principal: draft.amount, currency: draft.currency,
            accountId: draft.accountId, borrowedAt: draft.date, dueDate: draft.loanDueDate, status: existingLoan?.status ?? "outstanding" as const,
            repaidAt: existingLoan?.repaidAt, repaymentAccountId: existingLoan?.repaymentAccountId,
          },
          ...currentLoans.filter((loan) => loan.id !== existingLoan?.id),
        ] : currentLoans.filter((loan) => loan.id !== existingLoan?.id);
        const companions = reconcileTransactionCompanions(current, editingTransaction.id, draft);
        const paymentKind = draft.type === "income" ? "normal" : draft.paymentKind;
        const nextTransaction = withBookedMoney({
          ...editingTransaction,
          type: draft.type,
          item: draft.item.trim(),
          category: draft.category,
          accountId: draft.accountId,
          amount: draft.amount,
          date: draft.date,
          currency: draft.currency,
          paymentKind,
          creditToolId: draft.type === "income" || draft.paymentKind === "normal" ? undefined : draft.creditToolId,
          note: draft.note,
          loanId,
          subscriptionId: companions.subscriptionId,
          assetId: companions.assetId,
          balanceApplied: canAffectAccountBalance({ status: editingTransaction.status, paymentKind }),
        }, current.rates, draft.exchangeRateToBase, draft.amountInBase, draft.bookedBaseCurrency) as Transaction;
        return {
          ...current,
          accounts: updateAccountsForTransactionChange(current.accounts, current.rates, editingTransaction, nextTransaction, draft.bookedBaseCurrency),
          loans,
          subscriptions: companions.subscriptions,
          assets: companions.assets,
          transactions: current.transactions.map((item) => item.id === editingTransaction.id ? nextTransaction : item),
        };
      });
      setEntryMode(null);
      setEditingTransaction(null);
      setToast("流水修改已保存");
      return;
    }
    const baseId = crypto.randomUUID();
    const count = draft.type === "expense" && draft.paymentKind === "installment" ? Math.max(2, draft.installmentCount) : 1;
    const totalInterest = draft.interestMode === "total" ? draft.interest : draft.interest * count;
    const installmentAmount = count > 1 ? (draft.amount + totalInterest) / count : draft.amount;
    const isLoan = draft.type === "income" && isBorrowingCategory(ledger, draft.category);
    const loanId = isLoan ? `${baseId}-loan` : undefined;
    const linkedLoanId = repayingLoan?.id ?? loanId;
    const transactions: Transaction[] = Array.from({ length: count }, (_, index) => {
      const paymentKind = draft.type === "income" ? "normal" : draft.paymentKind;
      const status = index === 0 ? "posted" as const : "scheduled" as const;
      const amount = Number(installmentAmount.toFixed(2));
      return withBookedMoney({
        id: count > 1 ? `${baseId}-${index + 1}` : baseId,
        type: draft.type,
        item: count > 1 ? `${draft.item} (${index + 1}/${count})` : draft.item,
        category: draft.category,
        accountId: draft.accountId,
        amount,
        date: addMonths(draft.date, index),
        currency: draft.currency,
        paymentKind,
        creditToolId: draft.type === "income" || draft.paymentKind === "normal" ? undefined : draft.creditToolId,
        note: draft.note,
        status,
        balanceApplied: canAffectAccountBalance({ status, paymentKind }),
        installment: count > 1 ? {
          planId: baseId,
          index: index + 1,
          count,
          interestMode: draft.interestMode,
          interest: draft.interest,
          originalAmount: draft.amount,
        } : undefined,
        subscriptionId: draft.isSubscription ? `${baseId}-subscription` : undefined,
        assetId: draft.trackDepreciation ? `${baseId}-asset` : undefined,
        loanId: linkedLoanId,
      }, ledger.rates, draft.exchangeRateToBase, Number((amount * draft.exchangeRateToBase).toFixed(2)), draft.bookedBaseCurrency) as Transaction;
    });

    setLedger((current) => {
      const learned = parsedEntry ? learnRecognitionCorrections(current, parsedEntry, draft) : null;
      return {
      ...current,
      transactions: [...transactions, ...current.transactions],
      subscriptions: draft.isSubscription
        ? [
            {
              id: `${baseId}-subscription`,
              name: draft.item,
              amount: draft.amountInBase,
              bookedBaseCurrency: draft.bookedBaseCurrency,
              amountCny: Number((draft.amountInBase * (current.rates.find((rate) => rate.code === draft.bookedBaseCurrency)?.rateToCny || 1)).toFixed(2)),
              cycle: draft.subscriptionCycle,
              startedAt: draft.date,
              endsAt: draft.subscriptionEndsAt || addMonths(draft.date, draft.subscriptionCycle === "monthly" ? 1 : 12),
              accountId: draft.accountId,
              category: draft.category,
              renewalMode: draft.subscriptionMode,
              reminderDays: draft.subscriptionReminderDays,
            },
            ...current.subscriptions,
          ]
        : current.subscriptions,
      assets: draft.trackDepreciation
        ? [
            {
              id: `${baseId}-asset`,
              name: draft.item,
              price: draft.amountInBase,
              bookedBaseCurrency: draft.bookedBaseCurrency,
              priceCny: Number((draft.amountInBase * (current.rates.find((rate) => rate.code === draft.bookedBaseCurrency)?.rateToCny || 1)).toFixed(2)),
              purchasedAt: draft.date,
              lifeDays: draft.assetLifeDays || undefined,
              category: draft.category,
            },
            ...current.assets,
          ]
        : current.assets,
      loans: repayingLoan ? (current.loans ?? []).map((loan) => loan.id === repayingLoan.id ? {
        ...loan,
        status: "repaid",
        repaidAt: draft.date,
        repaymentAccountId: draft.accountId,
      } : loan) : isLoan ? [{
        id: loanId!,
        transactionId: baseId,
        name: draft.item.trim(),
        principal: draft.amount,
        currency: draft.currency,
        accountId: draft.accountId,
        borrowedAt: draft.date,
        dueDate: draft.loanDueDate,
        status: "outstanding",
      }, ...(current.loans ?? [])] : (current.loans ?? []),
      accounts: applyNewTransactionsToAccounts(learned?.accounts ?? current.accounts, current.rates, transactions, draft.bookedBaseCurrency),
      creditTools: learned?.creditTools ?? current.creditTools,
      categories: learned?.categories ?? current.categories,
      rates: learned?.rates ?? current.rates,
      projectRules:
        draft.rememberProject && draft.item.trim()
          ? [
              {
                id: crypto.randomUUID(),
                keyword: parsedEntry ? projectKeywordFromCorrection(parsedEntry.item, draft.item) : draft.item.trim(),
                item: draft.item.trim(),
                uses: 1,
              },
              ...current.projectRules.filter((rule) => rule.keyword !== (parsedEntry ? projectKeywordFromCorrection(parsedEntry.item, draft.item) : draft.item.trim())),
            ]
          : current.projectRules,
      };
    });
    setEntryMode(null);
    setParsedEntry(null);
    setRepayingLoan(null);
    setNaturalText("");
    setToast(repayingLoan ? "借款还款已记入本地账本" : count > 1 ? `已生成 ${count} 期账单` : "已记入本地账本");
  };

  const navItems = [
    { key: "dashboard" as const, label: "驾驶舱", icon: House, color: "#78AD93" },
    { key: "database" as const, label: "数据库", icon: Database, color: "#76A7D1" },
    { key: "profile" as const, label: "我的", icon: UserCircle, color: "#B48BBC" },
  ];
  const dockIndex = Math.max(0, navItems.findIndex((item) => item.key === page));
  const dockIndicatorLeft = ["0px", "calc(33.333333% + 1.333px)", "calc(66.666667% + 2.667px)"][dockIndex];

  const repay = (toolId: string, amount: number, accountId: string) => {
    const account = ledger.accounts.find((item) => item.id === accountId);
    const settlementCurrency = account?.currency ?? ledger.baseCurrency;
    setLedger((current) => ({
      ...current,
      repayments: [{ id: crypto.randomUUID(), creditToolId: toolId, accountId, amount, bookedBaseCurrency: settlementCurrency, amountCny: Number((amount * (current.rates.find((rate) => rate.code === settlementCurrency)?.rateToCny || 1)).toFixed(2)), date: new Date().toISOString().slice(0, 10), automatic: false }, ...current.repayments],
      accounts: current.accounts.map((item) => item.id === accountId ? { ...item, balance: item.balance - amount } : item),
    }));
    setRepaymentOpen(false);
    setToast(`已记录还款 ${new Intl.NumberFormat("zh-CN", { style: "currency", currency: settlementCurrency }).format(amount)}`);
  };

  const addCategory = (category: Category) => {
    setLedger((current) => ({ ...current, categories: [...current.categories.filter((item) => item.id !== category.id), category] }));
    setToast(`已添加分类“${category.name}”`);
  };

  const addAccount = (account: Account, initialChild?: Account) => {
    setLedger((current) => ({ ...current, accounts: [...current.accounts.filter((item) => item.id !== account.id && item.id !== initialChild?.id), account, ...(initialChild ? [initialChild] : [])] }));
    setToast(`已添加账户“${account.name}”`);
  };

  const addCredit = (tool: CreditTool) => {
    setLedger((current) => ({ ...current, creditTools: [...current.creditTools.filter((item) => item.id !== tool.id), tool] }));
    setToast(`已添加信用账户“${tool.name}”`);
  };

  const deleteTransactions = (ids: string[]) => {
    const deleting = new Set(ids);
    setLedger((current) => ({ ...removeTransactionsAndRevertBalances(current, deleting), loans: (current.loans ?? []).filter((loan) => !deleting.has(loan.transactionId)) }));
    setToast(`已删除 ${ids.length} 条流水`);
  };

  return (
    <div className="app-shell">
      <div className="ambient-field" aria-hidden="true" />
      <header className="topbar glass-panel">
        <button className="brand" onClick={() => setPage("dashboard")} aria-label="返回驾驶舱">
          <span className="brand-wordmark" aria-hidden="true"><i>i</i><b>L</b><em>e</em><strong>d</strong><span>g</span><u>e</u><small>r</small></span>
        </button>
        <div className="topbar-title">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={pageTitle}
              initial={reduceMotion ? false : { y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduceMotion ? undefined : { y: -8, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {pageTitle}
            </motion.span>
          </AnimatePresence>
        </div>
        <div className="topbar-actions">
          <button className={settingsOpen ? "icon-button active" : "icon-button"} onClick={() => setSettingsOpen(true)} aria-label="打开设置" title="设置">
            <GearSix size={18} />
          </button>
        </div>
      </header>

      <main className="main-stage">
        {page === "dashboard" && (
          <section className="dashboard-intro">
            <div>
              <p className="eyebrow">十月概览</p>
              <h1>{ledger.slogans.dashboard.title}</h1>
              <p>{ledger.slogans.dashboard.subtitle}</p>
            </div>
            <div className="quick-actions">
              <button className="action-button expense" onClick={() => setEntryMode("expense")}>
                <span><Plus size={18} weight="bold" /></span>新增支出
              </button>
              <button className="action-button income" onClick={() => setEntryMode("income")}>
                <span><Plus size={18} weight="bold" /></span>新增收入
              </button>
              <button className="action-button repayment" onClick={() => setRepaymentOpen(true)}>
                <span><CreditCard size={18} weight="bold" /></span>信用还款
              </button>
            </div>
          </section>
        )}

        {page === "dashboard" && (
          <div className="natural-entry glass-panel">
            <div className="natural-icon"><Sparkle size={20} weight="fill" /></div>
            <input
              ref={naturalInputRef}
              value={naturalText}
              onChange={(event) => setNaturalText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void openNaturalEntry();
              }}
              placeholder="试试：昨天花呗买了 AirPods，1899 元"
              aria-label="自然语言记账"
            />
            {naturalText && (
              <button className="clear-input" onClick={() => setNaturalText("")} aria-label="清空输入"><X size={16} /></button>
            )}
            <button className={`voice-input ${voiceState}`} onClick={() => void startVoiceInput("main")} aria-label={voiceState === "recording" ? "停止录音" : voiceState === "transcribing" ? "正在识别语音" : "语音输入"} title={voiceState === "recording" ? "停止录音" : "语音输入"}>{voiceState === "recording" ? <Stop size={17} weight="fill" /> : <Microphone size={18} weight={voiceState === "transcribing" ? "duotone" : "regular"} />}</button>
            <button className="parse-button" onClick={() => void openNaturalEntry()} disabled={!naturalText.trim() || parsing}>{parsing ? "理解中" : "识别"}</button>
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={page}
            className="page-carry"
            initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8, scale: 0.998 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            {page === "dashboard" && <Dashboard ledger={ledger} />}
            {page === "database" && <DatabasePage ledger={ledger} setLedger={setLedger} onEdit={(transaction) => { setRepayingLoan(null); setEditingTransaction(transaction); setEntryMode("edit"); }} onRepayLoan={(loan) => { setEditingTransaction(null); setParsedEntry(null); setRepayingLoan(loan); setEntryMode("expense"); }} onDelete={deleteTransactions} />}
            {page === "profile" && <ProfilePage ledger={ledger} setLedger={setLedger} notify={setToast} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {dockComposerOpen && ledger.dockAction !== "manual" && (
          <motion.div
            className="dock-composer-anchor"
            initial={reduceMotion ? false : { opacity: 0, y: 14, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 9, scale: .985 }}
            transition={{ duration: .22, ease: [0.16, 1, .3, 1] }}
          >
            <form className="dock-composer glass-panel" onSubmit={submitDockComposer}>
            <div className="dock-composer-content">
              <span className="dock-composer-icon">{ledger.dockAction === "voice" ? <Microphone size={19} weight="duotone" /> : <Sparkle size={19} weight="fill" />}</span>
              <input
                ref={dockInputRef}
                value={dockText}
                onChange={(event) => setDockText(event.target.value)}
                placeholder={ledger.dockAction === "voice" ? "点击麦克风说话，转写会显示在这里" : "输入一句话记账"}
                aria-label={ledger.dockAction === "voice" ? "语音转写结果" : "文字识别内容"}
              />
              {dockText && <button className="clear-input" type="button" onClick={() => { setDockText(""); dockInputRef.current?.focus(); }} aria-label="清空输入"><X size={15} /></button>}
              {ledger.dockAction === "voice" && <button className={`voice-input ${voiceState}`} type="button" onClick={() => void startVoiceInput("dock")} aria-label={voiceState === "recording" ? "停止录音" : "开始语音转写"}>{voiceState === "recording" ? <Stop size={16} weight="fill" /> : <Microphone size={17} weight="fill" />}</button>}
              <button className="dock-composer-submit" type="submit" disabled={!dockText.trim() || parsing}>{parsing ? "理解中" : "识别"}</button>
              <button className="dock-composer-close" type="button" onClick={() => setDockComposerOpen(false)} aria-label="关闭快捷输入"><X size={16} /></button>
            </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.nav className="dock glass-panel" aria-label="主导航">
        <div className="dock-pages">
          <motion.i
            className="dock-selection-track"
            initial={false}
            animate={{ left: dockIndicatorLeft }}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 430, damping: 34, mass: .72 }}
            style={{ "--nav-color": navItems[dockIndex].color } as React.CSSProperties}
          />
          {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <motion.button
              key={item.key}
              className={page === item.key ? "dock-item active" : "dock-item"}
              onClick={() => { setDockComposerOpen(false); setPage(item.key); }}
              whileHover={reduceMotion ? undefined : { y: -5, scale: 1.07 }}
              whileTap={reduceMotion ? undefined : { scale: 0.94 }}
              transition={{ type: "spring", stiffness: 420, damping: 27 }}
              style={{ "--nav-color": item.color } as React.CSSProperties}
              aria-label={item.label}
              title={item.label}
            >
              <Icon size={22} weight={page === item.key ? "fill" : "regular"} />
              <span>{item.label}</span>
            </motion.button>
          );
          })}
        </div>
        <span className="dock-separator" />
        <motion.button
          className={`dock-add ${dockComposerOpen ? "active" : ""}`}
          onClick={activateDockAction}
          whileHover={reduceMotion ? undefined : { y: -5, scale: 1.07 }}
          whileTap={reduceMotion ? undefined : { scale: 0.93 }}
          aria-label={ledger.dockAction === "voice" ? "语音输入" : ledger.dockAction === "text" ? "文字识别" : "新增记账"}
          title={ledger.dockAction === "voice" ? "语音输入" : ledger.dockAction === "text" ? "文字识别" : "新增记账"}
        >
          {ledger.dockAction === "voice" ? <Microphone size={23} weight="fill" /> : ledger.dockAction === "text" ? <Sparkle size={23} weight="fill" /> : <Plus size={23} weight="bold" />}
        </motion.button>
      </motion.nav>

      <AnimatePresence>
        {settingsOpen && <SettingsPage ledger={ledger} setLedger={setLedger} notify={setToast} onClose={() => setSettingsOpen(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {repaymentOpen && <RepaymentSheet ledger={ledger} onClose={() => setRepaymentOpen(false)} onConfirm={repay} />}
      </AnimatePresence>

      <AnimatePresence>
        {entryMode && (
          <EntryModal
            key={repayingLoan ? `loan-repayment-${repayingLoan.id}` : editingTransaction ? `edit-${editingTransaction.id}` : `entry-${entryMode}`}
            mode={entryMode}
            parsed={parsedEntry}
            initialTransaction={editingTransaction ?? (repayingLoan ? {
              id: `repayment-${repayingLoan.id}`,
              type: "expense",
              item: loanRepaymentName(repayingLoan),
              category: managedCategoryName(ledger, "loan-repayment"),
              accountId: spendableAccountsForCurrency(ledger, ledger.baseCurrency)[0]?.id ?? repayingLoan.accountId,
              amount: repayingLoan.principal,
              date: new Date().toISOString().slice(0, 10),
              currency: repayingLoan.currency,
              paymentKind: "normal",
              loanId: repayingLoan.id,
              status: "posted",
            } : null)}
            ledger={ledger}
            onAddCategory={addCategory}
            onAddAccount={addAccount}
            onAddCredit={addCredit}
            onClose={() => { setEntryMode(null); setParsedEntry(null); setEditingTransaction(null); setRepayingLoan(null); }}
            onSave={saveEntry}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}>
            <Wallet size={18} weight="fill" />{toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
