import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ChartBar,
  ChartDonut,
  ChartLineUp,
  ChartPieSlice,
  Check,
  CreditCard,
  CurrencyCircleDollar,
  Hash,
  ListBullets,
  PencilSimple,
  Plus,
  Receipt,
  Repeat,
  SquaresFour,
  Table,
  TrendDown,
  TrendUp,
  X,
} from "@phosphor-icons/react";
import { Responsive, WidthProvider, type Layout, type Layouts } from "react-grid-layout";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  LabelList,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LedgerState, TileKey } from "../types";
import {
  CUSTOM_TILES_STORAGE_KEY,
  buildAnalyticsModel,
  analyticsBoardColumns,
  analyticsDisplayCapacity,
  calendarMonthWindow,
  chartGroupKeys,
  chartMetricKeys,
  chartTypeLabels,
  createDefaultTile,
  defaultTileTitle,
  filterLabels,
  groupLabels,
  isDetailMetric,
  metricLabels,
  normalizeCustomTile,
  piePlotValue,
  rangeLabels,
  relativeUnitLabels,
  timeRangeTitle,
  type ChartType,
  type CustomTile,
  type FilterKey,
  type GroupKey,
  type MetricKey,
  type RangeKey,
  type RelativeUnit,
} from "../tileAnalytics";
import { assetPriceInBase, repaymentAmountInBase, subscriptionAmountInBase, transactionAmountInBase } from "../transactionAccounting";

const ResponsiveGrid = WidthProvider(Responsive);
const money = (value: number, currency: string) => new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
const chartMoney = (value: number, currency: string) => value ? new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value) : "";
const MORANDI = ["#88C8AE", "#F0A49B", "#85B7E6", "#C9A2D5", "#EFC574", "#7DC8C7", "#B7CF7B", "#D6B28B"];

const initialLayouts: Layouts = {
  lg: [
    { i: "summary", x: 0, y: 0, w: 5, h: 3, minW: 3, minH: 2 }, { i: "structure", x: 5, y: 0, w: 3, h: 3, minW: 3, minH: 3 }, { i: "weekly", x: 8, y: 0, w: 4, h: 3, minW: 3, minH: 3 },
    { i: "trend", x: 0, y: 3, w: 7, h: 3, minW: 4, minH: 3 }, { i: "credit", x: 7, y: 3, w: 5, h: 3, minW: 4, minH: 3 },
    { i: "subscriptions", x: 0, y: 6, w: 4, h: 4, minW: 3, minH: 3 }, { i: "assets", x: 4, y: 6, w: 4, h: 4, minW: 3, minH: 3 }, { i: "recent", x: 8, y: 6, w: 4, h: 4, minW: 3, minH: 3 },
  ],
  md: [
    { i: "summary", x: 0, y: 0, w: 6, h: 3 }, { i: "structure", x: 6, y: 0, w: 4, h: 3 }, { i: "weekly", x: 0, y: 3, w: 5, h: 3 }, { i: "trend", x: 5, y: 3, w: 5, h: 3 },
    { i: "credit", x: 0, y: 6, w: 5, h: 3 }, { i: "subscriptions", x: 5, y: 6, w: 5, h: 4 }, { i: "assets", x: 0, y: 10, w: 5, h: 4 }, { i: "recent", x: 5, y: 10, w: 5, h: 4 },
  ],
};

const tileMeta: Record<TileKey, { title: string; description: string; icon: typeof ChartBar }> = {
  summary: { title: "本月收支", description: "收入、支出与结余", icon: CurrencyCircleDollar }, structure: { title: "支出结构", description: "按类别查看占比", icon: ChartDonut }, weekly: { title: "本周支出", description: "最近七日变化", icon: ChartBar }, trend: { title: "月度趋势", description: "按磁贴宽度展示月份", icon: ChartLineUp }, subscriptions: { title: "订阅管理", description: "周期扣款项目", icon: Repeat }, assets: { title: "资产折旧", description: "使用成本概览", icon: SquaresFour }, credit: { title: "信用账单", description: "待还与账期", icon: CreditCard }, recent: { title: "近期流水", description: "最近发生的记录", icon: Receipt },
};
const defaultTiles = Object.keys(tileMeta) as TileKey[];
const dayDiff = (from: string, to = new Date()) => Math.max(0, Math.floor((to.getTime() - new Date(`${from}T12:00:00`).getTime()) / 86400000));
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export default function Dashboard({ ledger }: { ledger: LedgerState }) {
  const reduceMotion = useReducedMotion();
  const [editMode, setEditMode] = useState(false);
  const [activeTiles, setActiveTiles] = useState<string[]>(() => { try { const saved = JSON.parse(localStorage.getItem("iledger-active-tiles") || localStorage.getItem("ledger-active-tiles") || "") || defaultTiles; return Array.from(new Set<string>(saved)); } catch { return defaultTiles; } });
  const [customTiles, setCustomTiles] = useState<CustomTile[]>(() => { try { const saved = JSON.parse(localStorage.getItem(CUSTOM_TILES_STORAGE_KEY) || "[]"); return Array.isArray(saved) ? saved.map(normalizeCustomTile) : []; } catch { return []; } });
  const [layouts, setLayouts] = useState<Layouts>(() => { try { return JSON.parse(localStorage.getItem("ledger-layouts") || "") || initialLayouts; } catch { return initialLayouts; } });
  const [showPicker, setShowPicker] = useState(false);
  const [editingCustom, setEditingCustom] = useState<CustomTile | null>(null);
  const longPress = useRef<number | null>(null);

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const posted = useMemo(() => ledger.transactions.filter((item) => item.status !== "scheduled"), [ledger.transactions]);
  const monthEntries = useMemo(() => posted.filter((item) => item.date.startsWith(currentMonth)), [posted, currentMonth]);
  const expenses = useMemo(() => monthEntries.filter((item) => item.type === "expense"), [monthEntries]);
  const incomes = useMemo(() => monthEntries.filter((item) => item.type === "income"), [monthEntries]);
  const totalExpense = useMemo(() => expenses.reduce((sum, item) => sum + transactionAmountInBase(item, ledger.rates, ledger.baseCurrency), 0), [expenses, ledger.rates, ledger.baseCurrency]);
  const totalIncome = useMemo(() => incomes.reduce((sum, item) => sum + transactionAmountInBase(item, ledger.rates, ledger.baseCurrency), 0), [incomes, ledger.rates, ledger.baseCurrency]);
  const structure = useMemo(() => { const values = new Map<string, number>(); expenses.forEach((item) => values.set(item.category, (values.get(item.category) || 0) + transactionAmountInBase(item, ledger.rates, ledger.baseCurrency))); return Array.from(values, ([name, value], index) => ({ name, value, color: ledger.categories.find((category) => category.name === name)?.color || MORANDI[index % MORANDI.length] })).sort((a, b) => b.value - a.value); }, [expenses, ledger.categories, ledger.rates, ledger.baseCurrency]);
  const weekly = useMemo(() => Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - (6 - index)); const day = iso(date); return { label: `${date.getMonth() + 1}/${date.getDate()}`, amount: posted.filter((item) => item.type === "expense" && item.date === day).reduce((sum, item) => sum + transactionAmountInBase(item, ledger.rates, ledger.baseCurrency), 0) }; }), [posted, ledger.rates, ledger.baseCurrency]);
  const creditBills = useMemo(() => ledger.creditTools.map((tool) => { const charges = posted.filter((item) => item.type === "expense" && item.creditToolId === tool.id).reduce((sum, item) => sum + transactionAmountInBase(item, ledger.rates, ledger.baseCurrency), 0); const repaid = ledger.repayments.filter((item) => item.creditToolId === tool.id).reduce((sum, item) => sum + repaymentAmountInBase(item, ledger.rates, ledger.baseCurrency), 0); return { ...tool, due: Math.max(0, charges - repaid) }; }), [ledger.creditTools, ledger.repayments, ledger.rates, ledger.baseCurrency, posted]);

  const persistActive = (next: string[]) => { setActiveTiles(next); localStorage.setItem("iledger-active-tiles", JSON.stringify(next)); };
  const persistCustom = (next: CustomTile[]) => { setCustomTiles(next); localStorage.setItem(CUSTOM_TILES_STORAGE_KEY, JSON.stringify(next)); };
  const removeTile = (key: string) => { persistActive(activeTiles.filter((tile) => tile !== key)); if (key.startsWith("custom-")) persistCustom(customTiles.filter((tile) => tile.id !== key)); };
  const addFixed = (key: TileKey) => { if (!activeTiles.includes(key)) persistActive([...activeTiles, key]); };
  const saveCustom = (config: CustomTile) => {
    const exists = customTiles.some((tile) => tile.id === config.id);
    persistCustom(exists ? customTiles.map((tile) => tile.id === config.id ? config : tile) : [...customTiles, config]);
    if (!exists) {
      persistActive([...activeTiles, config.id]);
      const next: Layouts = { ...layouts };
      Object.entries({ lg: 4, md: 5, sm: 4, xs: 1 }).forEach(([breakpoint, width]) => { next[breakpoint] = [...(next[breakpoint] || []), { i: config.id, x: 0, y: Infinity, w: width, h: 3, minW: Math.min(width, 3), minH: 2 }]; });
      setLayouts(next); localStorage.setItem("ledger-layouts", JSON.stringify(next));
    }
    setEditingCustom(null); setShowPicker(false);
  };
  const beginLongPress = () => { if (!editMode) longPress.current = window.setTimeout(() => setEditMode(true), 520); };
  const cancelLongPress = () => { if (longPress.current) window.clearTimeout(longPress.current); longPress.current = null; };

  const renderTile = (key: string) => {
    if (key === "summary") return <SummaryTile expense={totalExpense} income={totalIncome} currency={ledger.baseCurrency} />;
    if (key === "structure") return <StructureTile data={structure} total={totalExpense} currency={ledger.baseCurrency} />;
    if (key === "weekly") return <WeeklyTile data={weekly} currency={ledger.baseCurrency} />;
    if (key === "trend") return <TrendTile posted={posted} rates={ledger.rates} baseCurrency={ledger.baseCurrency} />;
    if (key === "credit") return <CreditTile bills={creditBills} currency={ledger.baseCurrency} />;
    if (key === "subscriptions") return <SubscriptionsTile ledger={ledger} />;
    if (key === "assets") return <AssetsTile ledger={ledger} />;
    if (key === "recent") return <RecentTile ledger={ledger} />;
    const config = customTiles.find((tile) => tile.id === key);
    return config ? <AnalyticsTile config={config} ledger={ledger} /> : null;
  };

  return <section className="dashboard-grid-section" onClick={(event) => { const target = event.target as HTMLElement; if (editMode && !target.closest(".tile-wrap") && !target.closest(".toolbar-actions")) setEditMode(false); }}>
    <div className="section-toolbar"><div><h2>我的磁贴</h2><p>{editMode ? "拖动排序，拉动右下角调整尺寸" : "长按磁贴进入编辑，图表会随尺寸重新排布"}</p></div><div className="toolbar-actions">{editMode && <button className="text-button" onClick={() => setShowPicker(true)}><Plus size={17} />添加磁贴</button>}<button className={editMode ? "text-button primary" : "text-button"} onClick={() => setEditMode((value) => !value)}>{editMode ? <Check size={17} weight="bold" /> : <PencilSimple size={17} />}{editMode ? "完成编辑" : "编辑磁贴"}</button></div></div>
    <ResponsiveGrid className={editMode ? "dashboard-grid editing" : "dashboard-grid"} layouts={layouts} breakpoints={{ lg: 1180, md: 820, sm: 560, xs: 0 }} cols={{ lg: 12, md: 10, sm: 4, xs: 1 }} rowHeight={88} margin={[16, 16]} containerPadding={[0, 0]} isDraggable={editMode} isResizable={editMode} draggableCancel="button, input, select, textarea, a" onLayoutChange={(_layout: Layout[], allLayouts: Layouts) => { setLayouts(allLayouts); localStorage.setItem("ledger-layouts", JSON.stringify(allLayouts)); }} compactType="vertical">
      {activeTiles.filter((key) => key in tileMeta || customTiles.some((tile) => tile.id === key)).map((key, index) => { const fixed = tileMeta[key as TileKey]; const custom = customTiles.find((tile) => tile.id === key); const TileIcon = fixed?.icon ?? chartIcon(custom?.chartType ?? "bar"); return <div key={key} className={editMode ? `tile-wrap wiggle wiggle-${index % 3}` : "tile-wrap"} onPointerDown={beginLongPress} onPointerUp={cancelLongPress} onPointerLeave={cancelLongPress}><article className="tile"><div className="tile-header"><div className="tile-title"><span>{fixed?.title ?? custom?.title}</span><small>{fixed?.description ?? (custom ? `${timeRangeTitle(custom)} · ${metricLabels[custom.metric]}` : "")}</small></div><div className="tile-head-actions">{editMode && custom ? <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setEditingCustom(custom); setShowPicker(true); }} title="编辑分析磁贴"><PencilSimple size={15} /></button> : !editMode ? <TileIcon size={19} weight="duotone" /> : null}</div></div><div className="tile-content">{renderTile(key)}</div>{editMode && <button className="tile-remove" onClick={() => removeTile(key)} aria-label={`移除${fixed?.title ?? custom?.title}`}><X size={15} weight="bold" /></button>}</article></div>; })}
    </ResponsiveGrid>
    <AnimatePresence>{showPicker && <TileBuilder ledger={ledger} activeTiles={activeTiles} initial={editingCustom} onAddFixed={addFixed} onClose={() => { setShowPicker(false); setEditingCustom(null); }} onSave={saveCustom} />}</AnimatePresence>
  </section>;
}

function chartIcon(type: ChartType) { return type === "donut" ? ChartDonut : type === "pie" ? ChartPieSlice : type === "line" ? ChartLineUp : type === "table" ? Table : type === "board" ? ListBullets : type === "number" ? Hash : ChartBar; }

function useTileContentSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const next = { width: Math.round(node.clientWidth), height: Math.round(node.clientHeight) };
      setSize((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

function TileBuilder({ ledger, activeTiles, initial, onAddFixed, onClose, onSave }: { ledger: LedgerState; activeTiles: string[]; initial: CustomTile | null; onAddFixed: (key: TileKey) => void; onClose: () => void; onSave: (config: CustomTile) => void }) {
  const [draft, setDraft] = useState<CustomTile>(initial ? normalizeCustomTile(initial) : createDefaultTile(`custom-${crypto.randomUUID()}`));
  const [customTitle, setCustomTitle] = useState(Boolean(initial));
  const chartTypes: Array<{ key: ChartType; label: string }> = [{ key: "donut", label: "环形图" }, { key: "pie", label: "饼状图" }, { key: "bar", label: "柱状图" }, { key: "line", label: "折线图" }, { key: "table", label: "表格" }, { key: "board", label: "看板" }, { key: "number", label: "数字汇总" }];
  const refreshTitle = (next: CustomTile, preserve = customTitle) => preserve ? next : { ...next, title: defaultTileTitle(next) };
  const update = <K extends keyof CustomTile>(key: K, value: CustomTile[K]) => setDraft((current) => refreshTitle({ ...current, [key]: value }));
  const selectChart = (chartType: ChartType) => setDraft((current) => {
    const metric = chartMetricKeys[chartType].includes(current.metric) ? current.metric : chartMetricKeys[chartType][0];
    const groupBy = chartGroupKeys[chartType].length ? current.groupBy ?? "time" : undefined;
    return refreshTitle({ ...current, chartType, metric, groupBy });
  });
  const selectMetric = (metric: MetricKey) => setDraft((current) => refreshTitle({ ...current, metric }));
  const selectFilter = (filterBy: FilterKey) => setDraft((current) => ({
    ...current,
    filterBy,
    filterCategory: filterBy === "category" ? current.filterCategory ?? ledger.categories[0]?.name : current.filterCategory,
    filterAccountId: filterBy === "account" ? current.filterAccountId ?? ledger.accounts[0]?.id : current.filterAccountId,
  }));
  const rangeOptions: RangeKey[] = ["today", "week", "month", "year", "relative"];
  const showsGrouping = chartGroupKeys[draft.chartType].length > 0 && !isDetailMetric(draft.metric);
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <motion.div className="tile-builder liquid-modal glass-panel" initial={{ y: 28, opacity: 0, scale: .97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 18, opacity: 0 }}>
      <div className="modal-header"><div><span className="modal-kicker">{initial ? "编辑分析组件" : "磁贴组件库"}</span><h2>{initial ? "调整磁贴" : "创建磁贴"}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭磁贴配置"><X size={19} /></button></div>
      {!initial && <div className="operational-tiles"><span>业务磁贴</span><div>{(Object.keys(tileMeta) as TileKey[]).map((key) => { const Icon = tileMeta[key].icon; const active = activeTiles.includes(key); return <button key={key} disabled={active} onClick={() => onAddFixed(key)}><Icon size={18} /><b>{tileMeta[key].title}</b><small>{active ? "已添加" : "添加"}</small></button>; })}</div></div>}
      <div className="builder-sections">
        <section><h3><span>1</span>时间范围</h3><div className="choice-grid range-choices">{rangeOptions.map((key) => <button type="button" className={draft.range === key ? "selected" : ""} key={key} onClick={() => update("range", key)}>{rangeLabels[key]}</button>)}</div>{draft.range === "relative" && <div className="inline-fields relative-range"><label className="field"><span>数量</span><input type="number" min="1" max="3650" value={draft.relativeValue} onChange={(event) => update("relativeValue", Math.max(1, Number(event.target.value)))} /></label><label className="field"><span>单位</span><select value={draft.relativeUnit} onChange={(event) => update("relativeUnit", event.target.value as RelativeUnit)}>{(Object.keys(relativeUnitLabels) as RelativeUnit[]).map((unit) => <option key={unit} value={unit}>{relativeUnitLabels[unit]}</option>)}</select></label></div>}</section>
        <section><h3><span>2</span>数据范围</h3><div className="choice-grid">{(Object.keys(filterLabels) as FilterKey[]).map((key) => <button type="button" className={draft.filterBy === key ? "selected" : ""} key={key} onClick={() => selectFilter(key)}>{filterLabels[key]}</button>)}</div>{draft.filterBy === "category" && <label className="field compact-builder"><span>指定分类</span><select value={draft.filterCategory ?? ledger.categories[0]?.name} onChange={(event) => update("filterCategory", event.target.value)}>{ledger.categories.map((category) => <option key={category.id}>{category.name}</option>)}</select></label>}{draft.filterBy === "account" && <label className="field compact-builder"><span>指定账户</span><select value={draft.filterAccountId ?? ledger.accounts[0]?.id} onChange={(event) => update("filterAccountId", event.target.value)}>{ledger.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}{draft.filterBy === "amount" && <div className="inline-fields"><label className="field"><span>最低金额</span><input type="number" min="0" step="0.01" value={draft.minAmount ?? ""} onChange={(event) => update("minAmount", event.target.value ? Number(event.target.value) : undefined)} /></label><label className="field"><span>最高金额</span><input type="number" min="0" step="0.01" value={draft.maxAmount ?? ""} onChange={(event) => update("maxAmount", event.target.value ? Number(event.target.value) : undefined)} /></label></div>}</section>
        <section><h3><span>3</span>图表类型</h3><div className="chart-type-grid">{chartTypes.map((item) => { const Icon = chartIcon(item.key); return <button type="button" className={draft.chartType === item.key ? "selected" : ""} key={item.key} onClick={() => selectChart(item.key)}><Icon size={21} /><small>{item.label}</small></button>; })}</div></section>
        <section><h3><span>4</span>字段内容</h3><div className="editor-grid">{showsGrouping && <label className="field"><span>统计类型</span><select value={draft.groupBy ?? "time"} onChange={(event) => update("groupBy", event.target.value as GroupKey)}>{chartGroupKeys[draft.chartType].map((key) => <option key={key} value={key}>{groupLabels[key]}</option>)}</select></label>}<label className={showsGrouping ? "field" : "field wide"}><span>统计字段</span><select value={draft.metric} onChange={(event) => selectMetric(event.target.value as MetricKey)}>{chartMetricKeys[draft.chartType].map((key) => <option key={key} value={key}>{metricLabels[key]}</option>)}</select></label><label className="field wide"><span>磁贴标题</span><input value={draft.title} onChange={(event) => { setCustomTitle(true); setDraft((current) => ({ ...current, title: event.target.value })); }} /><small className="field-help">未手动修改时，会随时间范围、字段和图表类型自动生成。</small></label></div></section>
      </div>
      <div className="builder-footer"><span>组合预览：{timeRangeTitle(draft)} · {filterLabels[draft.filterBy]} · {metricLabels[draft.metric]} · {chartTypeLabels[draft.chartType]}</span><button className="save-button" disabled={!draft.title.trim()} onClick={() => onSave(normalizeCustomTile(draft))}>{initial ? "保存磁贴" : "添加到驾驶舱"}</button></div>
    </motion.div>
  </motion.div>;
}

function AnalyticsTile({ config, ledger }: { config: CustomTile; ledger: LedgerState }) {
  const size = useTileContentSize();
  const model = buildAnalyticsModel(config, ledger);
  const data = model.data.map((item) => ({ ...item, color: MORANDI[item.colorIndex % MORANDI.length] }));
  const capacity = analyticsDisplayCapacity(config.chartType, size.width, size.height);
  const visibleData = config.groupBy === "time" ? data.slice(-capacity) : data.slice(0, capacity);
  const visibleDetails = model.details.slice(0, capacity);
  const pieData = visibleData.map((item) => ({ ...item, plotAmount: piePlotValue(item.amount) }));
  const tickSize = Math.max(8, Math.min(11, Math.round(size.width / 80)));
  const perPointWidth = Math.max(1, (size.width - 54) / Math.max(1, visibleData.length));
  const barSize = Math.max(18, Math.min(58, Math.round(perPointWidth * .48)));
  const pointRadius = Math.max(2.5, Math.min(5, size.height / 58));
  const format = (amount: number) => model.countMetric ? `${amount} 笔` : money(amount, ledger.baseCurrency);
  if (config.chartType === "number") return <div ref={size.ref} className="analytics-number"><small>{timeRangeTitle(config)} · {metricLabels[config.metric]}</small><strong>{format(model.value)}</strong><span>{model.relatedCount} 条相关流水</span></div>;
  if (!data.length && !model.details.length) return <div ref={size.ref} className="analytics-empty"><span>当前范围没有可显示的数据</span></div>;
  if (config.chartType === "donut" || config.chartType === "pie") return <div ref={size.ref} className="analytics-pie"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="plotAmount" nameKey="name" innerRadius={config.chartType === "donut" ? "55%" : 0} outerRadius={config.chartType === "donut" ? "84%" : "72%"} paddingAngle={config.chartType === "donut" ? 2 : 1} label={config.chartType === "pie" ? (props) => `${String(props.name)} ${format(Number(props.value))}` : false} labelLine={config.chartType === "pie"}>{pieData.map((entry) => <Cell key={entry.name} fill={entry.color} stroke="var(--surface-solid)" strokeWidth={2} />)}</Pie><Tooltip content={<AnalyticsTip count={model.countMetric} currency={ledger.baseCurrency} />} /></PieChart></ResponsiveContainer>{config.chartType === "donut" && <div className="donut-center analytics-center"><small>{metricLabels[config.metric]}</small><b>{format(model.value)}</b></div>}</div>;
  if (config.chartType === "bar") return <div ref={size.ref} className="chart-fill"><ResponsiveContainer width="100%" height="100%"><BarChart data={visibleData} margin={{ top: 28, right: 4, left: -20, bottom: 0 }}><CartesianGrid stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: tickSize }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: tickSize }} /><ReferenceLine y={0} stroke="var(--line-strong)" /><Tooltip cursor={{ fill: "var(--chart-hover)" }} content={<AnalyticsTip count={model.countMetric} currency={ledger.baseCurrency} />} /><Bar dataKey="amount" name={metricLabels[config.metric]} radius={[5, 5, 2, 2]} maxBarSize={barSize}>{visibleData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}<LabelList dataKey="amount" position="top" fontSize={tickSize} formatter={(amount) => model.countMetric ? (Number(amount) ? `${Number(amount)} 笔` : "") : chartMoney(Number(amount), ledger.baseCurrency)} /></Bar></BarChart></ResponsiveContainer></div>;
  if (config.chartType === "line") return <div ref={size.ref} className="chart-fill"><ResponsiveContainer width="100%" height="100%"><LineChart data={visibleData} margin={{ top: 28, right: 8, left: -18, bottom: 0 }}><CartesianGrid stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: tickSize }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: tickSize }} /><ReferenceLine y={0} stroke="var(--line-strong)" /><Tooltip content={<AnalyticsTip count={model.countMetric} currency={ledger.baseCurrency} />} /><Line type="monotone" dataKey="amount" name={metricLabels[config.metric]} stroke="#85B7E6" strokeWidth={Math.max(2.1, pointRadius * .62)} dot={{ fill: "#F0A49B", r: pointRadius }} activeDot={{ r: pointRadius + 2 }}><LabelList dataKey="amount" position="top" fontSize={tickSize} formatter={(amount) => model.countMetric ? (Number(amount) ? `${Number(amount)} 笔` : "") : chartMoney(Number(amount), ledger.baseCurrency)} /></Line></LineChart></ResponsiveContainer></div>;
  if (config.chartType === "board") return <div ref={size.ref} className="analytics-board detail-board" style={{ "--analytics-columns": analyticsBoardColumns(size.width) } as React.CSSProperties}>{visibleDetails.map((item, index) => <div key={item.id}><i style={{ background: MORANDI[index % MORANDI.length] }} /><span><b>{item.name}</b><small>{item.meta}</small></span><strong>{money(item.amount, ledger.baseCurrency)}</strong></div>)}</div>;
  if (isDetailMetric(config.metric)) return <div ref={size.ref} className="analytics-table detail-table"><div><b>项目</b><b>金额</b></div>{visibleDetails.map((item) => <div key={item.id}><span><b>{item.name}</b><small>{item.meta}</small></span><strong>{money(item.amount, ledger.baseCurrency)}</strong></div>)}</div>;
  return <div ref={size.ref} className="analytics-table"><div><b>{groupLabels[config.groupBy ?? "time"]}</b><b>{metricLabels[config.metric]}</b></div>{visibleData.map((item) => <div key={item.name}><span><i style={{ background: item.color }} />{item.name}</span><strong>{format(item.amount)}</strong></div>)}</div>;
}

function AnalyticsTip({ active, payload, label, count, currency }: { active?: boolean; payload?: Array<{ value: number; name: string; color?: string }>; label?: string; count: boolean; currency: string }) { if (!active || !payload?.length) return null; return <div className="chart-tooltip">{label && <b>{label}</b>}{payload.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name} {count ? `${item.value} 笔` : money(item.value, currency)}</span>)}</div>; }
function SummaryTile({ expense, income, currency }: { expense: number; income: number; currency: string }) { const balance = income - expense; return <div className="summary-tile"><div className="primary-number"><small>本月支出</small><strong>{money(expense, currency)}</strong><span><TrendDown size={15} />实时汇总</span></div><div className="summary-split"><div><small>本月收入</small><b>{money(income, currency)}</b><span className="positive"><TrendUp size={14} />已入账</span></div><div><small>本月结余</small><b>{money(balance, currency)}</b><span>{income ? Math.round((balance / income) * 100) : 0}% 留存</span></div></div></div>; }
function StructureTile({ data, total, currency }: { data: Array<{ name: string; value: number; color: string }>; total: number; currency: string }) { const [active, setActive] = useState<string | null>(null); const size = useTileContentSize(); const capacity = size.height > 0 ? Math.max(1, Math.floor((size.height - 14) / 26)) : 3; return <div ref={size.ref} className="structure-tile"><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={2} onMouseEnter={(entry) => setActive(String(entry.name ?? ""))} onMouseLeave={() => setActive(null)}>{data.map((entry) => <Cell key={entry.name} fill={entry.color} stroke="transparent" opacity={active && active !== entry.name ? 0.38 : 1} />)}</Pie></PieChart></ResponsiveContainer><div className="donut-center"><small>{active || "总支出"}</small><b>{money(active ? data.find((item) => item.name === active)?.value || 0 : total, currency)}</b></div></div><div className="mini-legend">{data.slice(0, capacity).map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}<b>{total ? Math.round(item.value / total * 100) : 0}%</b></span>)}</div></div>; }
function WeeklyTile({ data, currency }: { data: Array<{ label: string; amount: number }>; currency: string }) { return <div className="chart-fill"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 25, right: 2, left: -24, bottom: -4 }}><CartesianGrid stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} /><Bar dataKey="amount" name="支出" fill="#F0A49B" radius={[5, 5, 2, 2]} maxBarSize={24}><LabelList dataKey="amount" position="top" formatter={(amount) => chartMoney(Number(amount), currency)} /></Bar></BarChart></ResponsiveContainer></div>; }
function TrendTile({ posted, rates, baseCurrency }: { posted: LedgerState["transactions"]; rates: LedgerState["rates"]; baseCurrency: string }) { const size = useTileContentSize(); const capacity = size.width > 0 ? Math.min(12, Math.max(3, Math.floor(size.width / 92))) : 6; const year = new Date().getFullYear(); const months = useMemo(() => calendarMonthWindow(capacity), [capacity]); const data = useMemo(() => months.map((month) => { const key = `${year}-${String(month).padStart(2, "0")}`; return { label: `${month}月`, expense: posted.filter((item) => item.type === "expense" && item.date.startsWith(key)).reduce((sum, item) => sum + transactionAmountInBase(item, rates, baseCurrency), 0), income: posted.filter((item) => item.type === "income" && item.date.startsWith(key)).reduce((sum, item) => sum + transactionAmountInBase(item, rates, baseCurrency), 0) }; }), [months, year, posted, rates, baseCurrency]); const tickSize = Math.max(8, Math.min(11, Math.round(size.width / Math.max(60, months.length * 8)))); return <div ref={size.ref} className="chart-fill"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 28, right: 46, left: -18, bottom: -4 }}><CartesianGrid stroke="var(--chart-grid)" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} interval={0} tick={{ fill: "var(--muted)", fontSize: tickSize }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} /><Area type="monotone" dataKey="expense" name="支出" stroke="#E1867E" strokeWidth={2.2} fill="transparent"><LabelList dataKey="expense" position="top" offset={9} formatter={(amount) => chartMoney(Number(amount), baseCurrency)} /></Area><Area type="monotone" dataKey="income" name="收入" stroke="#70AD88" strokeWidth={2.2} fill="transparent"><LabelList dataKey="income" position="top" offset={9} formatter={(amount) => chartMoney(Number(amount), baseCurrency)} /></Area></AreaChart></ResponsiveContainer></div>; }
function CreditTile({ bills, currency }: { bills: Array<{ id: string; name: string; due: number; statementDay: number; repaymentDay: number; autoRepay: boolean }>; currency: string }) { const size = useTileContentSize(); const total = bills.reduce((sum, bill) => sum + bill.due, 0); const capacity = size.height > 0 ? Math.max(1, Math.floor((size.height - 8) / 50)) : 4; return <div ref={size.ref} className="credit-tile"><div className="credit-total"><div><small>待还总额</small><strong>{money(total, currency)}</strong></div><span>{bills.filter((bill) => bill.autoRepay).length} 项自动还款</span></div><div className="credit-list">{bills.slice(0, capacity).map((bill) => <div key={bill.id}><span className="credit-logo"><CreditCard size={17} weight="duotone" /></span><p><b>{bill.name}</b><small>{bill.statementDay} 日出账，{bill.repaymentDay} 日还款</small></p><strong>{money(bill.due, currency)}</strong></div>)}</div></div>; }
function SubscriptionsTile({ ledger }: { ledger: LedgerState }) { const size = useTileContentSize(); const capacity = size.height > 0 ? Math.max(1, Math.floor(size.height / 50)) : 3; return <div ref={size.ref} className="detail-list">{ledger.subscriptions.slice(0, capacity).map((item) => { const remaining = Math.ceil((new Date(`${item.endsAt}T12:00:00`).getTime() - Date.now()) / 86400000); const urgent = remaining <= item.reminderDays; const linked = ledger.transactions.find((transaction) => transaction.subscriptionId === item.id); const amount = linked ? transactionAmountInBase(linked, ledger.rates, ledger.baseCurrency) : subscriptionAmountInBase(item, ledger.rates, ledger.baseCurrency); return <div key={item.id} className={urgent ? "reminder-row" : ""}><span className="list-icon"><Repeat size={17} /></span><p><b>{item.name}{urgent && <em>{remaining < 0 ? "已到期" : "即将到期"}</em>}</b><small>{item.renewalMode === "auto" ? "自动续订" : "固定期限"} · {Math.max(0, remaining)} 天</small></p><strong>{money(amount, ledger.baseCurrency)}</strong></div>; })}</div>; }
function AssetsTile({ ledger }: { ledger: LedgerState }) { const size = useTileContentSize(); const capacity = size.height > 0 ? Math.max(1, Math.floor(size.height / 50)) : 3; return <div ref={size.ref} className="detail-list asset-list">{ledger.assets.slice(0, capacity).map((asset) => { const used = dayDiff(asset.purchasedAt); const progress = asset.lifeDays ? `${Math.min(100, used / asset.lifeDays * 100)}%` : undefined; const linked = ledger.transactions.find((transaction) => transaction.assetId === asset.id); const price = linked ? transactionAmountInBase(linked, ledger.rates, ledger.baseCurrency) : assetPriceInBase(asset, ledger.rates, ledger.baseCurrency); return <div key={asset.id}><span className={asset.lifeDays ? "asset-progress" : "asset-progress actual"} style={progress ? { "--progress": progress } as React.CSSProperties : undefined}><SquaresFour size={17} /></span><p><b>{asset.name}</b><small>已使用 {used} 天 · {asset.lifeDays ? `预计 ${asset.lifeDays} 天` : "按实际天数"} · 日均 {money(price / Math.max(1, used), ledger.baseCurrency)}</small></p><strong>{money(price, ledger.baseCurrency)}</strong></div>; })}</div>; }
function RecentTile({ ledger }: { ledger: LedgerState }) { const size = useTileContentSize(); const capacity = size.height > 0 ? Math.max(1, Math.floor(size.height / 50)) : 6; return <div ref={size.ref} className="detail-list recent-list">{ledger.transactions.slice(0, capacity).map((item) => <div key={item.id}><span className={item.type === "income" ? "flow-mark income" : "flow-mark"}>{item.type === "income" ? <TrendUp size={15} /> : <TrendDown size={15} />}</span><p><b>{item.item}</b><small>{item.date.slice(5)} · {item.category}{item.currency !== ledger.baseCurrency ? ` · ${item.currency} ${item.amount.toLocaleString("zh-CN")}` : ""}</small></p><strong className={item.type === "income" ? "positive" : ""}>{item.type === "income" ? "+" : "-"}{money(transactionAmountInBase(item, ledger.rates, ledger.baseCurrency), ledger.baseCurrency)}</strong></div>)}</div>; }
