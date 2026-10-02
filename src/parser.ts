import type { CurrencyCode, LedgerState, ParsedEntry, PaymentKind } from "./types";

const today = () => new Date().toISOString().slice(0, 10);

const categoryKeywords: Record<string, string[]> = {
  餐饮: ["咖啡", "午饭", "晚饭", "早餐", "餐厅", "奶茶", "外卖", "火锅", "麦当劳"],
  交通: ["地铁", "公交", "打车", "滴滴", "高铁", "机票", "停车", "加油"],
  娱乐: ["电影", "游戏", "任天堂", "演出", "音乐", "会员", "玩具"],
  学习: ["书", "课程", "培训", "域名", "软件", "学费", "考试"],
  数码: ["充电器", "耳机", "airpods", "iphone", "ipad", "macbook", "键盘", "电脑", "相机", "手机"],
  日用: ["超市", "山姆", "房租", "家具", "日用品", "水电", "物业"],
};

const creditAliases: Record<string, string[]> = {
  花呗: ["花呗"],
  京东白条: ["京东白条", "白条"],
  抖音月付: ["抖音月付", "抖音分期", "dou分期", "月付"],
  美团月付: ["美团月付"],
  信用卡: ["招商信用卡", "招行信用卡", "信用卡", "贷记卡"],
};

const currencyAliases: Record<string, string[]> = {
  CNY: ["人民币", "人民币元", "元", "块钱", "块", "CNY", "RMB", "￥", "¥"],
  USD: ["美元", "美金", "美刀", "USD", "$"],
  EUR: ["欧元", "欧", "EUR", "€"],
  GBP: ["英镑", "GBP", "£"],
  JPY: ["日元", "日币", "JPY"],
  KRW: ["韩元", "韩币", "KRW", "₩"],
  SGD: ["新加坡元", "新币", "SGD", "S$"],
  HKD: ["港币", "港元", "港纸", "HKD", "HK$"],
  IDR: ["印度尼西亚卢比", "印尼盾", "印尼卢比", "IDR", "Rp"],
};

const amountPatterns = [
  /(?:花了|花费|消费|支付|付款|用了|价格(?:是|为)?|售价(?:是|为)?|共计?|合计|收入|收到|到账|赚了)\s*[约大概]?[¥￥$€£₩]?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:元|块钱?|人民币|美元|美金|美刀|欧元|欧|港币|港元|日元|日币|英镑|韩元|韩币|新加坡元|新币|印尼盾)?/i,
  /[¥￥$€£₩]\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
  /(?<![a-z\d])([0-9][\d,]*(?:\.\d{1,2})?)\s*(?:元|块钱?|人民币|美元|美金|美刀|欧元|欧|港币|港元|日元|日币|英镑|韩元|韩币|新加坡元|新币|印尼盾)(?![a-z\d])/i,
  /(?<![a-z\d])([0-9][\d,]*(?:\.\d{1,2})?)(?![a-z\d])/i,
];

function extractAmount(source: string) {
  for (const pattern of amountPatterns) {
    const match = source.match(pattern);
    if (match) return { amount: Number(match[1].replace(/,/g, "")), matched: match[0] };
  }
  return { amount: 0, matched: "" };
}

function extractDate(source: string) {
  const date = new Date();
  if (source.includes("昨天")) date.setDate(date.getDate() - 1);
  if (source.includes("前天")) date.setDate(date.getDate() - 2);
  const full = source.match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})[日号]?/);
  const short = source.match(/(?<!\d)(\d{1,2})[月\/-](\d{1,2})[日号]?/);
  if (full) date.setFullYear(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
  else if (short) date.setMonth(Number(short[1]) - 1, Number(short[2]));
  return {
    date: /今天|刚才/.test(source) || (!full && !short && !/昨天|前天/.test(source)) ? today() : date.toISOString().slice(0, 10),
    explicit: Boolean(full || short || /今天|昨天|前天|刚才/.test(source)),
  };
}

function cleanItem(source: string, amountText: string) {
  let value = source;
  if (amountText) value = value.replace(amountText, " ");
  return value
    .replace(/(?:花呗|京东白条|白条|抖音月付|美团月付|招商信用卡|招行信用卡|信用卡)(?:支付|付款)?/gi, " ")
    .replace(/(?:今天|昨天|前天|刚才|这周|本月|20\d{2}[年\/-]\d{1,2}[月\/-]\d{1,2}[日号]?|\d{1,2}[月\/-]\d{1,2}[日号]?)/g, " ")
    .replace(/(?:购买了?|买了|买|购入了?|入手了?|花了|花费了?|消费了?|支出|用了|支付了?|付款|收入|收到|赚了|转入|到账|报销了?)/g, " ")
    .replace(/(?:分\s*\d+\s*期|分期)/g, " ")
    .replace(/[，。,.！!；;：:]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:一|两|三|四|五|六|七|八|九|十)?(?:个|台|部|件|份|套|只|本|张|瓶|杯|盒|包|支|双|对|副|枚|条|辆|颗|把|块)\s*/i, "")
    .trim();
}

const compact = (value: string) => value.toLowerCase().replace(/[\s，、,。.!！；;：:]/g, "");

function recognitionScore(source: string, keyword: string): number {
  const lower = source.toLowerCase();
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return 0;
  const index = lower.indexOf(normalized);
  if (index >= 0) return normalized.length * 100 - index * 0.5;
  const compactSource = compact(source);
  const compactKeyword = compact(keyword);
  const compactIndex = compactSource.indexOf(compactKeyword);
  if (compactIndex >= 0) return compactKeyword.length * 95 - compactIndex * 0.5;
  if (/^[a-z0-9+#.\-\s]+$/i.test(normalized) && compactKeyword.length >= 4) {
    const tokens: string[] = Array.from(lower.match(/[a-z][a-z0-9+#.\-]{2,}/g) ?? []);
    let best = 0;
    for (const token of tokens) {
      if (token.length >= 3 && token.length < compactKeyword.length && compactKeyword.includes(token)) {
        best = Math.max(best, token.length * 70 + compactKeyword.length * 0.1);
      }
    }
    return best;
  }
  return 0;
}

function findCreditTool(source: string, state: LedgerState) {
  const dynamic = state.creditTools
    .flatMap((tool) => [tool.name, ...(tool.aliases ?? [])].map((alias) => ({ tool, alias, score: recognitionScore(source, alias) })))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  if (dynamic) return { id: dynamic.tool.id, alias: dynamic.alias };
  const alias = Object.entries(creditAliases).find(([, words]) => words.some((word) => source.toLowerCase().includes(word.toLowerCase())));
  if (!alias) return undefined;
  const [label, words] = alias;
  const tool = state.creditTools.find((item) => item.name.includes(label) || words.some((word) => item.name.toLowerCase().includes(word.toLowerCase())));
  return tool ? { id: tool.id, alias: words.find((word) => source.toLowerCase().includes(word.toLowerCase())) ?? tool.name } : undefined;
}

function findCurrency(source: string, state: LedgerState): { code: CurrencyCode; confidence: number } {
  const lower = source.toLowerCase();
  const candidates = state.rates.flatMap((rate) => {
    const defaults = currencyAliases[rate.code.toUpperCase()] ?? [];
    return [rate.name, rate.code, ...(rate.aliases ?? []), ...defaults]
      .filter((alias) => alias && !(alias === "¥" && rate.code !== "CNY"))
      .map((alias) => ({ code: rate.code, alias, normalized: alias.toLowerCase() }));
  }).sort((a, b) => b.normalized.length - a.normalized.length);
  const match = candidates.find((candidate) => lower.includes(candidate.normalized));
  return match ? { code: match.code, confidence: 0.99 } : { code: state.baseCurrency, confidence: 0.54 };
}

function findCategory(source: string, type: "income" | "expense", state: LedgerState) {
  const available = state.categories.filter((category) => category.type === type);
  const explicit = available
    .flatMap((category) => [category.name, ...(category.aliases ?? [])].map((alias) => ({ category, alias, score: recognitionScore(source, alias) })))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  if (explicit) return { name: explicit.category.name, confidence: 0.98, alias: explicit.alias };
  if (type === "expense") {
    const detected = Object.entries(categoryKeywords)
      .flatMap(([name, keywords]) => keywords.map((alias) => ({ name, alias, score: recognitionScore(source, alias) })))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    const existing = detected && available.find((category) => category.name === detected.name);
    if (existing) return { name: existing.name, confidence: 0.93, alias: detected.alias };
  }
  if (type === "income") {
    const preferred = /借|借款/.test(source) ? "借款" : /工资/.test(source) ? "工资" : /收益|理财/.test(source) ? "理财" : "生活费";
    return { name: available.find((category) => category.name === preferred)?.name ?? available[0]?.name ?? preferred, confidence: 0.84 };
  }
  return { name: available.find((category) => category.name === "日用")?.name ?? available[0]?.name ?? "日用", confidence: 0.46 };
}

function findAccount(source: string, state: LedgerState) {
  return state.accounts
    .filter((account) => Boolean(account.parentAccountId))
    .flatMap((account) => [account.name, ...(account.aliases ?? [])].map((alias) => ({ account, alias, score: recognitionScore(source, alias) })))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0];
}

function spendableAccountId(state: LedgerState, accountId?: string) {
  if (!accountId) return undefined;
  const account = state.accounts.find((item) => item.id === accountId);
  if (account?.parentAccountId) return account.id;
  return state.accounts.find((item) => item.parentAccountId === accountId && item.name === account?.name)?.id
    ?? state.accounts.find((item) => item.parentAccountId === accountId)?.id
    ?? accountId;
}

function findProjectRule(source: string, state: LedgerState) {
  return state.projectRules
    .map((rule) => ({ rule, score: recognitionScore(source, rule.keyword) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.rule;
}

const detectEntryType = (source: string): "income" | "expense" => {
  const protectedSource = source.replace(/外卖/g, "");
  const income = /收入|收到|工资|薪水|发薪|薪资|生活费|收益|利息|基金|股票|分红|红包|转入|到账|赚了|赚到|报销|退款|返还|借款|借入|借到|中奖|稿费|兼职|外快|卖出|出售|转卖|变卖/.test(protectedSource);
  const expense = /支出|消费|花了|花费|买|购买|支付|付款|缴费|充值/.test(protectedSource);
  return income && !expense ? "income" : "expense";
};

export function recognitionLibraryMatches(source: string, state: LedgerState) {
  const normalized = source.trim();
  const type = detectEntryType(normalized);
  const project = findProjectRule(normalized, state);
  const category = findCategory(normalized, type, state);
  const currency = findCurrency(normalized, state);
  const account = findAccount(normalized, state);
  const credit = findCreditTool(normalized, state);
  const creditTool = credit ? state.creditTools.find((tool) => tool.id === credit.id) : undefined;
  return {
    type: category.confidence >= 0.98 ? type : undefined,
    item: project?.item,
    category: category.confidence >= 0.98 ? category.name : undefined,
    currency: currency.confidence >= 0.99 ? currency.code : undefined,
    accountId: credit ? spendableAccountId(state, creditTool?.accountId ?? creditTool?.parentAccountId) : spendableAccountId(state, account?.account.id),
    creditToolId: credit?.id,
  };
}

export function parseNaturalEntry(source: string, state: LedgerState): ParsedEntry {
  const normalized = source.trim();
  const learned = findProjectRule(normalized, state);
  const { amount, matched: amountText } = extractAmount(normalized);
  const type = detectEntryType(normalized);
  const detectedCategory = findCategory(normalized, type, state);
  const category = detectedCategory.name;
  const categoryConfidence = detectedCategory.confidence;

  const creditMatch = findCreditTool(normalized, state);
  const creditToolId = creditMatch?.id;
  const hasCreditPhrase = Boolean(creditMatch) || Object.values(creditAliases).flat().some((word) => normalized.includes(word));
  const installment = /分\s*\d+\s*期|分期/.test(normalized);
  const paymentKind: PaymentKind = installment ? "installment" : hasCreditPhrase ? "credit" : "normal";
  const creditTool = state.creditTools.find((tool) => tool.id === creditToolId);
  const namedAccount = findAccount(normalized, state);
  const preferredId = normalized.includes("微信") ? "wechat" : normalized.includes("现金") ? "cash" : normalized.includes("银行卡") ? "cmb" : "alipay";
  const fallbackId = state.accounts.some((account) => account.id === preferredId) ? preferredId : state.accounts.find((account) => Boolean(account.parentAccountId))?.id ?? "";
  const accountId = creditTool ? (spendableAccountId(state, creditTool.accountId ?? creditTool.parentAccountId) ?? fallbackId) : (spendableAccountId(state, namedAccount?.account.id ?? fallbackId) ?? fallbackId);
  const detectedCurrency = findCurrency(normalized, state);
  const currency = detectedCurrency.code;
  const currencyConfidence = detectedCurrency.confidence;
  const parsedDate = extractDate(normalized);
  const dynamicNames = [namedAccount?.alias, creditMatch?.alias].filter((name): name is string => Boolean(name));
  const rawItem = dynamicNames.reduce((value, name) => value.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " "), cleanItem(normalized, amountText))
    .replace(/^(?:用|从|账户(?:为|是)?|通过)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const item = learned?.item ?? (rawItem || "未命名项目");

  return {
    type,
    item,
    amount,
    category,
    accountId,
    date: parsedDate.date,
    paymentKind,
    creditToolId: paymentKind === "normal" ? undefined : creditToolId,
    currency,
    source: normalized,
    confidence: {
      type: /收入|收到|工资|收益|借款|借入|借到|支出|花费|消费|购买|买了/.test(normalized) ? 0.96 : 0.74,
      item: learned ? 0.99 : rawItem.length >= 2 ? 0.91 : 0.3,
      amount: amount > 0 ? (/(?:元|块|人民币|美元|欧元|日元|英镑|韩元)|[¥￥$€£₩]/.test(amountText) ? 0.99 : 0.82) : 0.08,
      currency: currencyConfidence,
      category: categoryConfidence,
      accountId: creditToolId || namedAccount || /支付宝|微信|现金|银行卡/.test(normalized) ? 0.96 : 0.58,
      date: parsedDate.explicit ? 0.99 : 0.74,
    },
  };
}
