import type { ExchangeRate } from "./types";

interface FrankfurterResponse {
  base: string;
  date: string;
  rates: Partial<Record<string, number>>;
}

const currencyCatalog = [
  { code: "USD", name: "美元", englishName: "US Dollar", symbol: "$" },
  { code: "EUR", name: "欧元", englishName: "Euro", symbol: "€" },
  { code: "JPY", name: "日元", englishName: "Japanese Yen", symbol: "¥" },
  { code: "GBP", name: "英镑", englishName: "British Pound", symbol: "£" },
  { code: "KRW", name: "韩元", englishName: "South Korean Won", symbol: "₩" },
  { code: "HKD", name: "港币", englishName: "Hong Kong Dollar", symbol: "HK$" },
  { code: "AUD", name: "澳元", englishName: "Australian Dollar", symbol: "A$" },
  { code: "CAD", name: "加拿大元", englishName: "Canadian Dollar", symbol: "C$" },
  { code: "CHF", name: "瑞士法郎", englishName: "Swiss Franc", symbol: "CHF" },
  { code: "SGD", name: "新加坡元", englishName: "Singapore Dollar", symbol: "S$" },
  { code: "THB", name: "泰铢", englishName: "Thai Baht", symbol: "฿" },
  { code: "MYR", name: "马来西亚林吉特", englishName: "Malaysian Ringgit", symbol: "RM" },
];

export async function fetchRatesToCny(current: ExchangeRate[]): Promise<ExchangeRate[]> {
  const symbols = current.filter((item) => item.code !== "CNY").map((item) => item.code).join(",");
  if (!symbols) return current;
  const response = await fetch(`https://api.frankfurter.dev/v1/latest?base=CNY&symbols=${encodeURIComponent(symbols)}`);
  if (!response.ok) throw new Error(`Exchange API returned ${response.status}`);
  const data = await response.json() as FrankfurterResponse;
  return current.map((item) => {
    if (item.code === "CNY") return item;
    const cnyToCurrency = data.rates[item.code];
    if (!cnyToCurrency || cnyToCurrency <= 0) return item;
    return { ...item, rateToCny: Number((1 / cnyToCurrency).toFixed(4)) };
  });
}

export async function lookupCurrency(query: string): Promise<ExchangeRate> {
  const normalized = query.trim().toUpperCase();
  const currency = currencyCatalog.find((item) =>
    item.code === normalized || item.name.includes(query.trim()) || item.englishName.toUpperCase().includes(normalized),
  );
  const code = currency?.code ?? (/^[A-Z]{3}$/.test(normalized) ? normalized : "");
  if (!code) throw new Error("请输入三位币种代码，或常见币种名称");
  if (code === "CNY") return { code, name: "人民币", symbol: "¥", rateToCny: 1 };
  const response = await fetch(`https://api.frankfurter.dev/v1/latest?base=CNY&symbols=${encodeURIComponent(code)}`);
  if (!response.ok) throw new Error("未找到这个币种，请检查名称或代码");
  const data = await response.json() as FrankfurterResponse;
  const cnyToCurrency = data.rates[code];
  if (!cnyToCurrency || cnyToCurrency <= 0) throw new Error("暂时无法取得该币种汇率");
  return {
    code,
    name: currency?.name ?? code,
    symbol: currency?.symbol ?? code,
    rateToCny: Number((1 / cnyToCurrency).toFixed(6)),
  };
}
