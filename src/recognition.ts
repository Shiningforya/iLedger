import type { LedgerState, ParsedEntry } from "./types";

export interface RecognitionCorrection {
  category: string;
  accountId: string;
  creditToolId?: string;
  currency: string;
}

const appendAlias = (aliases: string[] | undefined, alias: string) => {
  const normalized = alias.trim();
  if (!normalized || normalized === "未命名项目") return aliases;
  return [...new Set([...(aliases ?? []), normalized])];
};

export const currencyAliasFromSource = (source: string, fallback: string) => {
  const suffix = source.match(/\d[\d,]*(?:\.\d+)?\s*([\p{Script=Han}A-Za-z]{1,12})/u)?.[1];
  return suffix?.replace(/(?:整|左右|上下)$/, "") || fallback;
};

export const accountAliasFromSource = (source: string, item: string) => {
  const direct = source.match(/(?:用|从|通过|账户(?:为|是)?)[\s：:]*(.+?)(?:支付|付款|花费了?|花了?|消费|购买|买|，|,)/i)?.[1];
  const withoutItem = source.replace(item, " ");
  const beforeSpend = withoutItem.match(/(?:^|[，,])\s*([^，,]+?)\s*(?:花费了?|花了?|支付了?|付款|消费了?)/i)?.[1];
  const candidate = direct ?? beforeSpend ?? withoutItem.split(/(?:花费了?|花了?|支付了?|付款|消费了?|购买了?|买了?)/i)[0];
  return candidate
    .replace(/(?:今天|昨天|前天|刚才|购买|买|用|从|通过|账户(?:为|是)?)/g, " ")
    .replace(/[，。,.！!；;：:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export const projectKeywordFromCorrection = (parsedItem: string, correctedItem: string) => {
  const parsed = parsedItem.trim();
  const corrected = correctedItem.trim();
  if (!parsed) return corrected;
  if (!corrected) return parsed;
  if (parsed.toLowerCase().includes(corrected.toLowerCase())) return corrected;
  if (corrected.toLowerCase().includes(parsed.toLowerCase())) return parsed;
  return corrected;
};

export function learnRecognitionCorrections(state: LedgerState, parsed: ParsedEntry, correction: RecognitionCorrection) {
  return {
    categories: correction.category !== parsed.category
      ? state.categories.map((category) => category.name === correction.category ? { ...category, aliases: appendAlias(category.aliases, parsed.item) } : category)
      : state.categories,
    accounts: correction.accountId !== parsed.accountId
      ? state.accounts.map((account) => account.id === correction.accountId ? { ...account, aliases: appendAlias(account.aliases, accountAliasFromSource(parsed.source, parsed.item)) } : account)
      : state.accounts,
    creditTools: correction.creditToolId !== parsed.creditToolId && correction.creditToolId
      ? state.creditTools.map((tool) => tool.id === correction.creditToolId ? { ...tool, aliases: appendAlias(tool.aliases, accountAliasFromSource(parsed.source, parsed.item)) } : tool)
      : state.creditTools,
    rates: correction.currency !== parsed.currency
      ? state.rates.map((rate) => rate.code === correction.currency ? { ...rate, aliases: appendAlias(rate.aliases, currencyAliasFromSource(parsed.source, parsed.item)) } : rate)
      : state.rates,
  };
}
