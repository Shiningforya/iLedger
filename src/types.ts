export type PageKey = "dashboard" | "database" | "profile";
export type ThemeMode = "light" | "dark" | "system";
export type DockAction = "manual" | "text" | "voice";
export type EntryType = "expense" | "income";
export type PaymentKind = "normal" | "credit" | "installment";
export type CurrencyCode = string;

export interface Account {
  id: string;
  name: string;
  institution: string;
  kind: "bank" | "wallet" | "cash";
  balance: number;
  /** Currency in which this spendable child account keeps its balance. */
  currency?: CurrencyCode;
  color: string;
  icon?: string;
  customIcon?: string;
  parentAccountId?: string;
  hierarchyConfigured?: boolean;
  aliases?: string[];
}

export interface Category {
  id: string;
  name: string;
  type: EntryType;
  color: string;
  icon: string;
  customIcon?: string;
  aliases?: string[];
}

export interface CreditTool {
  id: string;
  name: string;
  accountId?: string;
  parentAccountId: string;
  statementDay: number;
  repaymentDay: number;
  repaymentAccountId: string;
  repaymentAccountIds: string[];
  priority: number;
  autoRepay: boolean;
  aliases?: string[];
}

export interface InstallmentInfo {
  planId: string;
  index: number;
  count: number;
  interestMode: "monthly" | "total";
  interest: number;
  originalAmount: number;
}

export interface Transaction {
  id: string;
  type: EntryType;
  item: string;
  category: string;
  accountId: string;
  amount: number;
  /** The booked conversion rate at the time of the transaction. */
  exchangeRateToCny?: number;
  /** The CNY value frozen at booking time for balances and analytics. */
  amountCny?: number;
  /** The base currency selected when this transaction was booked. */
  bookedBaseCurrency?: CurrencyCode;
  /** The conversion rate from the original currency to the booked base currency. */
  exchangeRateToBase?: number;
  /** The value in the booked base currency, frozen at booking time. */
  amountInBase?: number;
  date: string;
  currency: CurrencyCode;
  paymentKind: PaymentKind;
  creditToolId?: string;
  installment?: InstallmentInfo;
  note?: string;
  subscriptionId?: string;
  assetId?: string;
  loanId?: string;
  status?: "posted" | "scheduled";
  /** True only when this transaction has already changed its account balance. */
  balanceApplied?: boolean;
}

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  bookedBaseCurrency?: CurrencyCode;
  amountCny?: number;
  cycle: "monthly" | "yearly";
  startedAt: string;
  endsAt: string;
  accountId: string;
  category: string;
  renewalMode: "auto" | "fixed";
  reminderDays: number;
}

export interface Asset {
  id: string;
  name: string;
  price: number;
  bookedBaseCurrency?: CurrencyCode;
  priceCny?: number;
  purchasedAt: string;
  lifeDays?: number;
  category: string;
}

export interface Repayment {
  id: string;
  creditToolId: string;
  accountId: string;
  amount: number;
  bookedBaseCurrency?: CurrencyCode;
  amountCny?: number;
  date: string;
  automatic: boolean;
}

export interface ProjectRule {
  id: string;
  keyword: string;
  item: string;
  category?: string;
  accountId?: string;
  currency?: CurrencyCode;
  uses: number;
}

export interface ExchangeRate {
  code: CurrencyCode;
  name: string;
  symbol: string;
  rateToCny: number;
  aliases?: string[];
}

export interface Loan {
  id: string;
  transactionId: string;
  name: string;
  principal: number;
  currency: CurrencyCode;
  accountId: string;
  borrowedAt: string;
  dueDate?: string;
  repaidAt?: string;
  repaymentAccountId?: string;
  status: "outstanding" | "repaid";
}

export interface WebDavSettings {
  provider: "jianguoyun" | "custom";
  endpoint: string;
  username: string;
  remotePath: string;
  lastSyncAt?: string;
  autoSync: boolean;
  syncOnLaunch: boolean;
  syncIntervalMinutes: number;
}

export interface PageSlogan {
  title: string;
  subtitle: string;
}

export interface PageSlogans {
  dashboard: PageSlogan;
  database: PageSlogan;
  profile: PageSlogan;
}

export interface LedgerState {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  creditTools: CreditTool[];
  subscriptions: Subscription[];
  assets: Asset[];
  repayments: Repayment[];
  loans: Loan[];
  projectRules: ProjectRule[];
  rates: ExchangeRate[];
  baseCurrency: CurrencyCode;
  autoUpdateRates: boolean;
  glassOpacity: number;
  accentColor: string;
  themeMode: ThemeMode;
  dockAction: DockAction;
  slogans: PageSlogans;
  webDav: WebDavSettings;
  designVersion: number;
}

export interface ParsedEntry {
  type: EntryType;
  item: string;
  amount: number;
  category: string;
  accountId: string;
  date: string;
  paymentKind: PaymentKind;
  creditToolId?: string;
  currency: CurrencyCode;
  confidence: Record<"type" | "item" | "amount" | "currency" | "category" | "accountId" | "date", number>;
  source: string;
}

export type TileKey =
  | "summary"
  | "structure"
  | "weekly"
  | "trend"
  | "subscriptions"
  | "assets"
  | "credit"
  | "recent";
