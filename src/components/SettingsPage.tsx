import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowCounterClockwise, Brain, Check, CheckCircle, CloudArrowDown, CloudArrowUp, CloudCheck, Desktop, DownloadSimple, HardDrive, Microphone, Moon,
  PaintBrush, Plus, SlidersHorizontal, Sparkle, Sun, TextAa, Trash, UploadSimple,
  WarningCircle, X,
} from "@phosphor-icons/react";
import { defaultSlogans } from "../data";
import { exportTransactionsCsv, importTransactionsCsv, type CsvImportResult } from "../csv";
import { applyNewTransactionsToAccounts, spendableAccounts, stabilizeAccountCurrencies, withBookedMoney } from "../transactionAccounting";
import {
  getModelDownloadSource, getModelRuntimeInfo, isModelPackInstalled, modelDownloadSources, modelPackInfo,
  prepareModelPack, removeLegacyModelCache, removeModelPack, setModelDownloadSource,
  subscribeToModelPacks, type ModelDownloadSource, type ModelPackId,
} from "../localModels";
import type { DockAction, LedgerState, ThemeMode, Transaction } from "../types";
import { clearWebDavLogin, downloadLedgerFromWebDav, loadSavedWebDavLogin, saveWebDavLogin, testWebDav, uploadLedgerToWebDav, type SavedWebDavLogin, type WebDavCredentials } from "../webdav";

const accentOptions = [
  { name: "鼠尾草", value: "#6D9E8A" }, { name: "矿物蓝", value: "#6E9DC6" },
  { name: "珊瑚红", value: "#D98278" }, { name: "鸢尾紫", value: "#9A83BA" },
  { name: "银杏黄", value: "#C99B4E" }, { name: "湖水绿", value: "#5FAAA7" },
];

type PackPhase = "idle" | "downloading" | "installed" | "error";
type PackState = { phase: PackPhase; progress: number; message?: string };
const packVisuals = { language: { icon: Brain, tone: "language" }, speech: { icon: Microphone, tone: "speech" } } as const;

function ModelPackManager({ notify }: { notify: (message: string) => void }) {
  const reduceMotion = useReducedMotion();
  const runtime = getModelRuntimeInfo();
  const installedState = (): Record<ModelPackId, PackState> => ({
    language: { phase: isModelPackInstalled("language") ? "installed" : "idle", progress: isModelPackInstalled("language") ? 100 : 0 },
    speech: { phase: isModelPackInstalled("speech") ? "installed" : "idle", progress: isModelPackInstalled("speech") ? 100 : 0 },
  });
  const [states, setStates] = useState(installedState);
  const [downloadSource, setDownloadSourceState] = useState<ModelDownloadSource>(getModelDownloadSource);
  useEffect(() => { void removeLegacyModelCache(); return subscribeToModelPacks(() => setStates(installedState())); }, []);
  const updatePack = (id: ModelPackId, next: Partial<PackState>) => setStates((current) => ({ ...current, [id]: { ...current[id], ...next } }));
  const install = async (id: ModelPackId) => {
    updatePack(id, { phase: "downloading", progress: 0, message: downloadSource === "auto" ? "正在测速并选择下载源" : undefined });
    try {
      const resolvedSource = await prepareModelPack(id, ({ progress }) => updatePack(id, { progress: Math.round(progress) }));
      const sourceName = resolvedSource === "mirror" ? "国内镜像" : "官方源";
      updatePack(id, { phase: "installed", progress: 100, message: sourceName });
      notify(`${modelPackInfo[id].name}已通过${sourceName}安装`);
    } catch (error) {
      updatePack(id, { phase: "error", progress: 0, message: error instanceof Error ? error.message : "下载或初始化失败" });
      notify(`${modelPackInfo[id].name}准备失败`);
    }
  };
  const remove = async (id: ModelPackId) => { await removeModelPack(id); updatePack(id, { phase: "idle", progress: 0, message: undefined }); notify(`已移除${modelPackInfo[id].name}`); };
  const downloading = Object.values(states).some((state) => state.phase === "downloading");
  const chooseSource = (source: ModelDownloadSource) => {
    setModelDownloadSource(source);
    setDownloadSourceState(source);
  };
  return <section className="settings-group">
    <header><span className="settings-group-icon intelligence"><Brain size={21} weight="duotone" /></span><div><h2>离线能力包</h2><p>下载完成后直接接管对应的本地识别流程</p></div></header>
    <div className="model-source-picker">
      <div><b>下载源</b><small>自动测速会比较可用线路；国内镜像为第三方服务。</small></div>
      <div role="group" aria-label="模型下载源">{modelDownloadSources.map((source) => { const selected = downloadSource === source.id; return <motion.button key={source.id} type="button" className={selected ? "selected" : ""} disabled={downloading} onClick={() => chooseSource(source.id)} title={source.description} whileTap={reduceMotion ? undefined : { scale: .96 }}>{selected && <motion.i className="settings-choice-indicator" layoutId="model-source-indicator" transition={{ type: "spring", stiffness: 430, damping: 35 }} />}<span>{source.label}</span>{selected && <Check size={12} weight="bold" />}</motion.button>; })}</div>
    </div>
    <div className="model-pack-list">{(Object.keys(modelPackInfo) as ModelPackId[]).map((id) => {
      const pack = modelPackInfo[id]; const state = states[id]; const Icon = packVisuals[id].icon;
      return <article className={`model-pack-row ${packVisuals[id].tone}`} key={id}>
        <span className="model-pack-icon"><Icon size={23} weight="duotone" /></span>
        <div className="model-pack-copy"><div><b>{pack.name}</b>{state.phase === "installed" && <span className="installed-label"><CheckCircle size={14} weight="fill" />已就绪</span>}</div><p>{pack.description}</p><small>{pack.model}<i />{pack.size}{state.phase === "installed" && state.message ? <><i />{state.message}</> : null}</small>{state.phase === "downloading" && <><div className="model-pack-progress"><div><span style={{ width: `${state.progress}%` }} /></div><output>{state.progress}%</output></div>{state.message && <span className="model-pack-status">{state.message}</span>}</>}{state.phase === "error" && <span className="model-pack-error"><WarningCircle size={14} />{state.message}</span>}</div>
        <div className="model-pack-actions">{(state.phase === "idle" || state.phase === "error") && <button className="text-button pack-download" onClick={() => void install(id)}><DownloadSimple size={17} />下载安装</button>}{state.phase === "downloading" && <button className="text-button" disabled>正在准备</button>}{state.phase === "installed" && <button className="icon-button pack-remove" title="移除能力包" aria-label={`移除${pack.name}`} onClick={() => void remove(id)}><Trash size={18} /></button>}</div>
      </article>;
    })}</div>
    <p className={`model-storage-note ${runtime.languageCompatible ? "compatible" : "incompatible"}`}><HardDrive size={16} />模型仅保存在当前设备；{runtime.label}。</p>
  </section>;
}

function WebDavManager({ ledger, setLedger, notify }: { ledger: LedgerState; setLedger: React.Dispatch<React.SetStateAction<LedgerState>>; notify: (message: string) => void }) {
  const reduceMotion = useReducedMotion();
  const [password, setPassword] = useState("");
  const [savedLogin, setSavedLogin] = useState<SavedWebDavLogin | null>(null);
  const [loadingLogin, setLoadingLogin] = useState(true);
  const [busy, setBusy] = useState<"login" | "logout" | "test" | "upload" | "download" | null>(null);
  const [message, setMessage] = useState("");
  const config = ledger.webDav;
  const update = (next: Partial<LedgerState["webDav"]>) => setLedger((current) => ({ ...current, webDav: { ...current.webDav, ...next } }));
  useEffect(() => {
    let active = true;
    sessionStorage.removeItem("iledger-webdav-session-secret");
    void loadSavedWebDavLogin().then((login) => {
      if (!active) return;
      if (login) {
        setSavedLogin(login);
        setLedger((current) => ({ ...current, webDav: { ...current.webDav, provider: login.provider, endpoint: login.endpoint, username: login.username } }));
      }
    }).catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : "无法恢复 WebDAV 登录，请重新登录");
    }).finally(() => { if (active) setLoadingLogin(false); });
    return () => { active = false; };
  }, [setLedger]);
  const credentials = (): WebDavCredentials => {
    if (!savedLogin) throw new Error("请先登录 WebDAV 账户");
    return { ...config, provider: savedLogin.provider, endpoint: savedLogin.endpoint, username: savedLogin.username, password: savedLogin.password };
  };
  const login = async () => {
    setBusy("login"); setMessage("");
    try {
      const candidate: SavedWebDavLogin = { provider: config.provider, endpoint: config.endpoint.trim(), username: config.username.trim(), password };
      await testWebDav({ ...config, ...candidate });
      await saveWebDavLogin(candidate);
      setSavedLogin(candidate);
      setPassword("");
      setMessage((window.iLedgerNative || Capacitor.isNativePlatform())
        ? "登录成功。现在可以检测云端、上传或下载账本；退出应用后仍保持登录。"
        : "登录成功。现在可以检测云端、上传或下载账本；网页预览会在本次浏览器会话中保持登录。");
      notify("WebDAV 已登录");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "WebDAV 登录失败");
    } finally { setBusy(null); }
  };
  const logout = async () => {
    setBusy("logout"); setMessage("");
    try {
      await clearWebDavLogin();
      setSavedLogin(null);
      setPassword("");
      setMessage("已注销 WebDAV 账户，云端操作需要重新登录。");
      notify("WebDAV 已注销");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "注销失败");
    } finally { setBusy(null); }
  };
  const run = async (kind: "test" | "upload" | "download") => {
    setBusy(kind);
    setMessage("");
    try {
      if (kind === "test") {
        await testWebDav(credentials());
        setMessage("连接成功，可以同步账本");
        notify("WebDAV 连接成功");
      } else if (kind === "upload") {
        await uploadLedgerToWebDav(credentials(), ledger);
        const syncedAt = new Date().toISOString();
        update({ lastSyncAt: syncedAt });
        setMessage("本地账本已上传");
        notify("账本已上传到 WebDAV");
      } else {
        if (!window.confirm("下载云端账本将覆盖当前本地数据，是否继续？")) return;
        const remote = await downloadLedgerFromWebDav(credentials());
        const syncedAt = new Date().toISOString();
        setLedger((current) => {
          const restored = { ...current, ...remote, webDav: { ...current.webDav, lastSyncAt: syncedAt } } as LedgerState;
          return { ...restored, accounts: stabilizeAccountCurrencies(restored) };
        });
        setMessage("云端账本已下载并应用");
        notify("已从 WebDAV 恢复账本");
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "WebDAV 操作失败";
      setMessage(text);
      notify(text);
    } finally {
      setBusy(null);
    }
  };
  const chooseProvider = (provider: "jianguoyun" | "custom") => update({
    provider,
    endpoint: provider === "jianguoyun" ? "https://dav.jianguoyun.com/dav/" : (config.provider === "jianguoyun" ? "" : config.endpoint),
  });

  return <section className="settings-group webdav-settings">
    <header><span className="settings-group-icon webdav"><CloudCheck size={21} weight="duotone" /></span><div><h2>WebDAV 云同步</h2><p>连接坚果云或支持 WebDAV 的自有 NAS</p></div></header>
    <div className="webdav-provider" role="group" aria-label="WebDAV 服务商">{([['jianguoyun', '坚果云'], ['custom', '自定义 NAS']] as const).map(([key, label]) => { const selected = config.provider === key; return <motion.button key={key} type="button" className={selected ? "selected" : ""} disabled={Boolean(savedLogin) || loadingLogin || busy !== null} onClick={() => chooseProvider(key)} whileTap={reduceMotion ? undefined : { scale: .96 }}>{selected && <motion.i className="settings-choice-indicator" layoutId="webdav-provider-indicator" transition={{ type: "spring", stiffness: 430, damping: 35 }} />}<span>{label}</span></motion.button>; })}</div>
    <div className="webdav-fields">
      <label className="field wide"><span>服务器地址</span><input value={config.endpoint} disabled={Boolean(savedLogin) || loadingLogin} onChange={(event) => update({ endpoint: event.target.value })} placeholder="https://dav.example.com/" /></label>
      <label className="field"><span>用户名</span><input value={config.username} disabled={Boolean(savedLogin) || loadingLogin} onChange={(event) => update({ username: event.target.value })} autoComplete="username" placeholder={config.provider === "jianguoyun" ? "坚果云注册邮箱" : "WebDAV 用户名"} /></label>
      <label className="field"><span>应用密码</span><input type="password" value={password} disabled={Boolean(savedLogin) || loadingLogin} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !savedLogin && !busy) void login(); }} autoComplete="current-password" placeholder={savedLogin ? "已安全保存于此设备" : "不会写入账本文件"} /></label>
      <label className="field wide"><span>远程文件路径</span><input value={config.remotePath} onChange={(event) => update({ remotePath: event.target.value })} placeholder="iLedger/ledger.json" /></label>
    </div>
    <div className="webdav-login-row"><span className={savedLogin ? "webdav-login-status connected" : "webdav-login-status"}><CloudCheck size={16} />{loadingLogin ? "正在读取登录状态" : savedLogin ? `已登录 · ${savedLogin.username}` : "尚未登录"}</span>{savedLogin ? <button className="text-button" type="button" disabled={busy !== null} onClick={() => void logout()}>注销</button> : <button className="text-button" type="button" disabled={loadingLogin || busy !== null || !config.username.trim() || !password} onClick={() => void login()}>{busy === "login" ? "登录中" : "登录"}</button>}</div>
    <div className="webdav-auto-sync">
      <label className="setting-row"><span><b>无感同步</b><small>自动合并传输尚未启用；此开关暂只保存偏好，请按需上传或下载。</small></span><span className="switch"><input type="checkbox" checked={config.autoSync} onChange={(event) => update({ autoSync: event.target.checked })} /><span /></span></label>
      <AnimatePresence initial={false}>{config.autoSync && <motion.div className="webdav-auto-sync-details" initial={reduceMotion ? false : { height: 0, opacity: 0, y: -6 }} animate={{ height: "auto", opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { height: 0, opacity: 0, y: -4 }} transition={{ duration: .25, ease: [0.16, 1, 0.3, 1] }}><label className="setting-row"><span><b>启动时检查云端</b><small>打开应用时比较本地与云端版本。</small></span><span className="switch"><input type="checkbox" checked={config.syncOnLaunch ?? true} onChange={(event) => update({ syncOnLaunch: event.target.checked })} /><span /></span></label><label className="setting-row"><span><b>后台检查间隔</b><small>有本地改动时仍会优先安排同步。</small></span><select value={config.syncIntervalMinutes ?? 5} onChange={(event) => update({ syncIntervalMinutes: Number(event.target.value) })}><option value={1}>1 分钟</option><option value={5}>5 分钟</option><option value={15}>15 分钟</option><option value={30}>30 分钟</option></select></label></motion.div>}</AnimatePresence>
    </div>
    <div className="webdav-actions"><button className="text-button" type="button" disabled={busy !== null || !savedLogin} onClick={() => void run("test")}><CloudCheck size={17} />{busy === "test" ? "检测中" : "检测云端"}</button><button className="text-button upload" type="button" disabled={busy !== null || !savedLogin} onClick={() => void run("upload")}><CloudArrowUp size={17} />{busy === "upload" ? "上传中" : "上传本地"}</button><button className="text-button download" type="button" disabled={busy !== null || !savedLogin} onClick={() => void run("download")}><CloudArrowDown size={17} />{busy === "download" ? "下载中" : "下载云端"}</button></div>
    {message && <p className={message.includes("成功") || message.includes("已") ? "webdav-message success" : "webdav-message"}>{message}</p>}
    <p className="webdav-note">{config.lastSyncAt ? `上次传输：${new Date(config.lastSyncAt).toLocaleString("zh-CN")}` : "尚未传输"}。封装应用会保持登录直至注销；网页预览仅保留当前浏览器会话。</p>
  </section>;
}

function CsvImportReview({ result, ledger, onClose, onConfirm }: { result: CsvImportResult; ledger: LedgerState; onClose: () => void; onConfirm: (selected: Transaction[]) => void }) {
  const [selected, setSelected] = useState<string[]>(() => result.review.map((item) => item.id));
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Transaction>>(() => Object.fromEntries(result.review.map((item) => [item.id, item.transaction])));
  const selectedCount = selected.length;
  const importCount = result.transactions.length + selectedCount;
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const accounts = spendableAccounts(ledger);
  const updateDraft = (id: string, patch: Partial<Transaction>) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const updateMoney = (id: string, patch: Pick<Partial<Transaction>, "amount" | "currency">) => setDrafts((current) => {
    const previous = current[id];
    const next = { ...previous, ...patch };
    const currencyChanged = patch.currency !== undefined && patch.currency !== previous.currency;
    return {
      ...current,
      [id]: withBookedMoney(
        next,
        ledger.rates,
        currencyChanged ? undefined : previous.exchangeRateToBase,
        undefined,
        previous.bookedBaseCurrency ?? ledger.baseCurrency,
      ),
    };
  });
  return <motion.div className="modal-backdrop clean csv-review-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <motion.section className="settings-modal csv-review-modal glass-panel liquid-modal" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ duration: .22, ease: [0.16, 1, .3, 1] }}>
      <div className="modal-liquid-content"><div className="modal-header"><div><span className="modal-kicker">CSV 导入检查</span><h2>确认不确定记录</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭导入检查"><X size={18} /></button></div>
      <div className="csv-import-summary"><span><b>{result.transactions.length}</b> 可直接导入</span><span><b>{result.duplicates}</b> 确定重复</span><span><b>{result.review.length}</b> 需要确认</span><span><b>{result.skipped}</b> 无效行</span></div>
      {(result.duplicates > 0 || result.ignoredColumns.length > 0) && <p className="csv-import-note">{result.duplicates > 0 ? `确定重复的 ${result.duplicates} 条已自动跳过。` : ""}{result.ignoredColumns.length > 0 ? `未使用的列：${result.ignoredColumns.join("、")}。` : ""}</p>}
      <div className="csv-review-toolbar"><div><b>已按识别结果预选</b><small>可以直接一键导入；仅在需要时取消或调整单条记录。</small></div><button className="text-button" type="button" onClick={() => setSelected(selectedCount === result.review.length ? [] : result.review.map((item) => item.id))}>{selectedCount === result.review.length ? "全部取消" : "全部选择"}</button></div>
      <div className="csv-review-list">{result.review.map((candidate) => {
        const draft = drafts[candidate.id];
        const isEditing = editing === candidate.id;
        return <article className={selected.includes(candidate.id) ? "csv-review-row selected" : "csv-review-row"} key={candidate.id}>
          <div className="csv-review-row-summary">
            <label className="csv-review-check"><input type="checkbox" checked={selected.includes(candidate.id)} onChange={() => toggle(candidate.id)} /><span className="sr-only">导入{draft.item}</span></label>
            <span className={candidate.kind === "possible-duplicate" ? "csv-review-kind duplicate" : "csv-review-kind"}>{candidate.kind === "possible-duplicate" ? "疑似重复" : "字段待确认"}</span>
            <div className="csv-review-copy"><b>{draft.item}</b><small>第 {candidate.rowNumber} 行 · {draft.date} · {draft.category}</small><p>{candidate.reasons.join("；")}</p>{candidate.existing && <em>已有：{candidate.existing.item} · {candidate.existing.date} · {candidate.existing.currency} {candidate.existing.amount.toLocaleString("zh-CN")}</em>}</div>
            <strong>{draft.currency} {draft.amount.toLocaleString("zh-CN")}</strong>
            <button className={isEditing ? "csv-review-adjust active" : "csv-review-adjust"} type="button" aria-label={`调整${draft.item}的导入字段`} title="调整导入字段" onClick={() => setEditing(isEditing ? null : candidate.id)}><SlidersHorizontal size={15} /></button>
          </div>
          <AnimatePresence initial={false}>{isEditing && <motion.div className="csv-review-editor" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .2, ease: [0.16, 1, .3, 1] }}>
            <div><label className="field"><span>金额</span><input type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => updateMoney(candidate.id, { amount: Number(event.target.value) })} /></label><label className="field"><span>币种</span><select value={draft.currency} onChange={(event) => updateMoney(candidate.id, { currency: event.target.value })}>{ledger.rates.map((rate) => <option key={rate.code} value={rate.code}>{rate.name} {rate.code}</option>)}</select></label><label className="field"><span>分类</span><select value={draft.category} onChange={(event) => updateDraft(candidate.id, { category: event.target.value })}>{ledger.categories.filter((category) => category.type === draft.type).map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label><label className="field"><span>子账户</span><select value={draft.accountId} onChange={(event) => updateDraft(candidate.id, { accountId: event.target.value })}>{accounts.map((account) => { const parent = ledger.accounts.find((item) => item.id === account.parentAccountId); return <option key={account.id} value={account.id}>{parent ? `${parent.name} / ` : ""}{account.name}</option>; })}</select></label></div>
          </motion.div>}</AnimatePresence>
        </article>;
      })}</div>
      <div className="csv-review-actions"><button type="button" onClick={onClose}>取消导入</button><button className="save-button modal-primary" type="button" disabled={importCount === 0} onClick={() => onConfirm(selected.map((id) => drafts[id]).filter(Boolean))}>导入 {importCount} 条</button></div></div>
    </motion.section>
  </motion.div>;
}

export default function SettingsPage({ ledger, setLedger, notify, onClose }: { ledger: LedgerState; setLedger: React.Dispatch<React.SetStateAction<LedgerState>>; notify: (message: string) => void; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const fileInput = useRef<HTMLInputElement>(null);
  const [csvReview, setCsvReview] = useState<CsvImportResult | null>(null);
  const themeTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (themeTimer.current) window.clearTimeout(themeTimer.current);
    document.documentElement.classList.remove("theme-shifting");
  }, []);
  const setTheme = (themeMode: ThemeMode) => {
    if (themeMode === ledger.themeMode) return;
    if (!reduceMotion) {
      if (themeTimer.current) window.clearTimeout(themeTimer.current);
      document.documentElement.classList.add("theme-shifting");
      themeTimer.current = window.setTimeout(() => {
        document.documentElement.classList.remove("theme-shifting");
        themeTimer.current = null;
      }, 460);
    }
    setLedger((current) => ({ ...current, themeMode }));
  };
  const exportCsv = () => { const blob = new Blob([exportTransactionsCsv(ledger.transactions, ledger)], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `iLedger-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); notify(`已导出 ${ledger.transactions.length} 条流水`); };
  const applyCsvImport = (result: CsvImportResult, reviewed: Transaction[] = []) => {
    const accepted = [...result.transactions, ...reviewed];
    if (accepted.length) setLedger((current) => ({ ...current, accounts: applyNewTransactionsToAccounts(current.accounts, current.rates, accepted, current.baseCurrency), transactions: [...accepted, ...current.transactions] }));
    const skipped = result.duplicates + result.skipped + result.review.length - reviewed.length;
    notify(accepted.length ? `已导入 ${accepted.length} 条，跳过 ${skipped} 条` : skipped ? `没有新增记录，已跳过 ${skipped} 条` : "没有发现可导入的有效流水");
    setCsvReview(null);
  };
  const importCsv = async (file?: File) => {
    if (!file) return;
    const bytes = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(bytes);
    if (text.includes("\uFFFD")) {
      try { text = new TextDecoder("gb18030").decode(bytes); } catch { /* Keep the UTF-8 decoding result when this browser lacks GB18030. */ }
    }
    const result = importTransactionsCsv(text, ledger);
    if (result.review.length) setCsvReview(result);
    else applyCsvImport(result);
    if (fileInput.current) fileInput.current.value = "";
  };
  const dockActions: Array<{ key: DockAction; label: string; icon: typeof Plus }> = [
    { key: "manual", label: "手动记账", icon: Plus }, { key: "text", label: "文字识别", icon: Sparkle }, { key: "voice", label: "语音输入", icon: Microphone },
  ];
  const sloganPages: Array<{ key: keyof LedgerState["slogans"]; label: string }> = [
    { key: "dashboard", label: "驾驶舱" }, { key: "database", label: "数据库" }, { key: "profile", label: "我的" },
  ];
  const updateSlogan = (page: keyof LedgerState["slogans"], field: "title" | "subtitle", value: string) => {
    setLedger((current) => ({
      ...current,
      slogans: { ...current.slogans, [page]: { ...current.slogans[page], [field]: value } },
    }));
  };
  const restoreSlogans = () => {
    setLedger((current) => ({
      ...current,
      slogans: {
        dashboard: { ...defaultSlogans.dashboard },
        database: { ...defaultSlogans.database },
        profile: { ...defaultSlogans.profile },
      },
    }));
    notify("页面文案已恢复默认");
  };
  return <motion.div className="modal-backdrop settings-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <motion.section className={`settings-sheet glass-panel liquid-modal${csvReview ? " tertiary-obscured" : ""}`} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: .24, ease: [0.16, 1, 0.3, 1] }}>
      <div className="modal-liquid-content settings-shell-content">
        <div className="modal-header settings-sheet-header"><div><span className="modal-kicker">偏好设置</span><h2>设置</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭设置"><X size={18} /></button></div>
        <div className="settings-scroll">
        <section className="settings-group">
          <header><span className="settings-group-icon appearance"><PaintBrush size={21} weight="duotone" /></span><div><h2>外观</h2><p>主题、玻璃强度与全局强调色</p></div></header>
          <div className="settings-row vertical"><div><b>显示模式</b><small>跟随系统会响应设备外观变化。</small></div><div className="theme-segment" role="group" aria-label="显示模式">{([{ key: "light", label: "亮色", icon: Sun }, { key: "dark", label: "深色", icon: Moon }, { key: "system", label: "跟随系统", icon: Desktop }] as const).map((item) => { const Icon = item.icon; const selected = ledger.themeMode === item.key; return <motion.button key={item.key} className={selected ? "selected" : ""} onClick={() => setTheme(item.key)} whileTap={reduceMotion ? undefined : { scale: .96 }}>{selected && <motion.i className="settings-choice-indicator" layoutId="theme-choice-indicator" transition={{ type: "spring", stiffness: 440, damping: 36 }} />}<Icon size={18} /><span>{item.label}</span><AnimatePresence initial={false}>{selected && <motion.span className="settings-choice-check" initial={reduceMotion ? false : { scale: .4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: .7, opacity: 0 }}><Check size={13} weight="bold" /></motion.span>}</AnimatePresence></motion.button>; })}</div></div>
          <div className="settings-row vertical"><div><b>玻璃强度</b><small>从清透到常规玻璃调整材质厚度，背景始终保持可见。</small></div><label className="glass-control"><input type="range" min="0" max="100" value={ledger.glassOpacity} style={{ "--range-value": `${ledger.glassOpacity}%` } as React.CSSProperties} onChange={(event) => setLedger((current) => ({ ...current, glassOpacity: Number(event.target.value) }))} /><span><small>通透</small><output>{ledger.glassOpacity}%</output><small>厚实</small></span></label></div>
          <div className="settings-row vertical"><div><b>强调色</b><small>用于焦点、选中状态和主要操作。</small></div><div className="accent-picker">{accentOptions.map((item) => { const selected = ledger.accentColor.toLowerCase() === item.value.toLowerCase(); return <motion.button key={item.value} className={selected ? "selected" : ""} onClick={() => setLedger((current) => ({ ...current, accentColor: item.value }))} title={item.name} aria-label={`选择${item.name}`} whileHover={reduceMotion ? undefined : { y: -2 }} whileTap={reduceMotion ? undefined : { scale: .92 }}>{selected && <motion.span className="accent-selection-ring" layoutId="accent-selection-ring" transition={{ type: "spring", stiffness: 460, damping: 34 }} />}<i style={{ background: item.value }} />{selected && <Check size={13} weight="bold" />}</motion.button>; })}<label className="custom-accent"><input type="color" value={ledger.accentColor} onChange={(event) => setLedger((current) => ({ ...current, accentColor: event.target.value }))} /><span>自定义</span></label></div></div>
        </section>
        <section className="settings-group slogan-settings-group">
          <header><span className="settings-group-icon slogans"><TextAa size={21} weight="duotone" /></span><div><h2>页面文案</h2><p>自定义驾驶舱、数据库与“我的”页面标题</p></div><button className="text-button slogan-reset" type="button" onClick={restoreSlogans}><ArrowCounterClockwise size={16} />恢复默认</button></header>
          <div className="slogan-settings">{sloganPages.map((page) => <div className="slogan-page-row" key={page.key}><strong>{page.label}</strong><div className="slogan-page-fields"><label className="field"><span>主标题</span><input value={ledger.slogans[page.key].title} maxLength={30} onChange={(event) => updateSlogan(page.key, "title", event.target.value)} /></label><label className="field"><span>说明文字</span><input value={ledger.slogans[page.key].subtitle} maxLength={80} onChange={(event) => updateSlogan(page.key, "subtitle", event.target.value)} /></label></div></div>)}</div>
        </section>
        <section className="settings-group"><header><span className="settings-group-icon shortcut"><Plus size={21} /></span><div><h2>Dock 快捷按钮</h2><p>自定义右侧主操作</p></div></header><div className="dock-action-picker">{dockActions.map((item) => { const Icon = item.icon; const selected = ledger.dockAction === item.key; return <motion.button key={item.key} className={selected ? "selected" : ""} onClick={() => setLedger((current) => ({ ...current, dockAction: item.key }))} whileHover={reduceMotion ? undefined : { y: -2 }} whileTap={reduceMotion ? undefined : { scale: .97 }}>{selected && <motion.i className="settings-choice-indicator" layoutId="dock-choice-indicator" transition={{ type: "spring", stiffness: 420, damping: 35 }} />}<Icon size={19} weight={selected ? "fill" : "regular"} /><span>{item.label}</span>{selected && <motion.span className="settings-choice-check" initial={reduceMotion ? false : { scale: .4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}><Check size={14} weight="bold" /></motion.span>}</motion.button>; })}</div></section>
        <ModelPackManager notify={notify} />
        <WebDavManager ledger={ledger} setLedger={setLedger} notify={notify} />
        <section className="settings-group"><header><span className="settings-group-icon data"><DownloadSimple size={21} weight="duotone" /></span><div><h2>数据</h2><p>导入或导出标准 CSV 流水文件</p></div></header><div className="settings-row data-transfer"><div><b>账本流水</b><small>当前共有 {ledger.transactions.length} 条流水，导入时会追加到现有账本。</small></div><div><input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => void importCsv(event.target.files?.[0])} /><button className="text-button import" onClick={() => fileInput.current?.click()}><UploadSimple size={17} />导入 CSV</button><button className="text-button export" onClick={exportCsv}><DownloadSimple size={17} />导出 CSV</button></div></div></section>
        </div>
      </div>
    </motion.section>
    <AnimatePresence>{csvReview && <CsvImportReview result={csvReview} ledger={ledger} onClose={() => setCsvReview(null)} onConfirm={(reviewed) => applyCsvImport(csvReview, reviewed)} />}</AnimatePresence>
  </motion.div>;
}
