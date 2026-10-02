import type { LedgerState, PageSlogans, Transaction } from "./types";

export const defaultSlogans: PageSlogans = {
  dashboard: {
    title: "每一笔，都有来处。",
    subtitle: "本地记录、清晰归类，在需要时看见真正重要的变化。",
  },
  database: {
    title: "每一条记录，都可以追溯。",
    subtitle: "收支、账期、借款、订阅与折旧资产保存在同一套本地数据中。",
  },
  profile: {
    title: "账户、类别与规则。",
    subtitle: "点击任意项目即可进入编辑，敏感资料默认只保存在本机。",
  },
};

const isoDay = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const monthDay = (monthOffset: number, day: number) => {
  const date = new Date();
  date.setMonth(date.getMonth() + monthOffset, day);
  return date.toISOString().slice(0, 10);
};

const tx = (
  id: string,
  item: string,
  amount: number,
  category: string,
  accountId: string,
  dayOffset: number,
  extra: Partial<Transaction> = {},
): Transaction => ({
  id,
  type: "expense",
  item,
  amount,
  category,
  accountId,
  date: isoDay(dayOffset),
  currency: "CNY",
  paymentKind: "normal",
  status: "posted",
  ...extra,
});

export const initialLedger: LedgerState = {
  accounts: [
    { id: "cmb", name: "招商银行", institution: "招商银行", kind: "bank", balance: 23842.16, color: "#AAB9D1", icon: "bank", aliases: ["招行", "招商", "银行卡", "储蓄卡", "借记卡", "刷卡"] },
    { id: "alipay", name: "支付宝", institution: "蚂蚁集团", kind: "wallet", balance: 3260.8, color: "#93BEEA", icon: "wallet", aliases: ["支付宝"] },
    { id: "yu-ebao", name: "余额宝", institution: "蚂蚁集团", kind: "wallet", balance: 8650.32, color: "#E9B98D", icon: "trend", parentAccountId: "alipay", aliases: ["余额宝"] },
    { id: "wechat", name: "微信支付", institution: "腾讯", kind: "wallet", balance: 1286.42, color: "#8EC9A6", icon: "mobile", aliases: ["微信", "WeChat", "零钱通"] },
    { id: "cash", name: "现金", institution: "随身现金", kind: "cash", balance: 680, color: "#D6B28B", icon: "cash", aliases: ["现金", "纸币"] },
  ],
  categories: [
    { id: "daily", name: "日用", type: "expense", color: "#88C8AE", icon: "basket", aliases: ["纸巾", "洗衣液", "洗发", "沐浴露", "牙膏", "收纳", "清洁", "超市", "杂货", "房租", "水电", "燃气", "物业", "宽带", "话费", "网费", "电费", "药", "医院", "挂号", "体检", "看病"] },
    { id: "food", name: "餐饮", type: "expense", color: "#F0A49B", icon: "fork", aliases: ["饭", "早餐", "午餐", "晚餐", "外卖", "奶茶", "咖啡", "拿铁", "零食", "水果", "火锅", "烧烤", "麻辣烫", "麦当劳", "肯德基", "饮料", "可乐", "豆浆", "包子", "星巴克", "瑞幸", "蜜雪"] },
    { id: "transport", name: "交通", type: "expense", color: "#85B7E6", icon: "train", aliases: ["地铁", "公交", "打车", "滴滴", "出租", "加油", "停车", "高铁", "火车", "机票", "骑行", "单车", "车费", "通勤"] },
    { id: "entertainment", name: "娱乐", type: "expense", color: "#C9A2D5", icon: "game", aliases: ["电影", "游戏", "Steam", "会员", "视频", "音乐", "演唱会", "剧本杀", "KTV", "酒吧", "B站", "哔哩哔哩", "大会员", "网易云", "黑胶"] },
    { id: "study", name: "学习", type: "expense", color: "#EFC574", icon: "book", aliases: ["书", "课程", "网课", "文具", "考试", "资料", "教材", "讲座", "ChatGPT", "OpenAI", "Claude", "Gemini", "Copilot", "Cursor", "DeepSeek", "豆包", "千问", "通义", "Kimi", "文心一言", "智谱", "Midjourney", "AI会员", "人工智能", "大模型"] },
    { id: "digital", name: "数码", type: "expense", color: "#7DC8C7", icon: "device", aliases: ["电子", "数码", "iPad", "电脑", "笔记本", "手机", "耳机", "AirPods", "鼠标", "键盘", "显示器", "Switch", "相机", "镜头", "手表", "硬盘", "路由器", "无人机", "Kindle", "投影仪", "淘宝", "京东", "拼多多", "网购", "快递", "iCloud", "云存储", "网盘"] },
    { id: "salary", name: "工资", type: "income", color: "#79BD93", icon: "briefcase", aliases: ["工资", "薪水", "发薪", "薪资", "劳务", "兼职", "稿费", "外快"] },
    { id: "allowance", name: "生活费", type: "income", color: "#B7CF7B", icon: "wallet", aliases: ["生活费", "零花钱", "红包", "退款", "报销", "中奖", "返还"] },
    { id: "investment", name: "理财", type: "income", color: "#75B6AE", icon: "trend", aliases: ["理财", "收益", "利息", "基金", "股票", "分红"] },
    { id: "borrowing", name: "借款", type: "income", color: "#A9A0C8", icon: "handshake", aliases: ["借款", "借入", "借到"] },
    { id: "loan-repayment", name: "归还借款", type: "expense", color: "#D69A92", icon: "repay", aliases: ["归还借款", "还借款", "还钱"] },
  ],
  creditTools: [
    { id: "huabei", name: "花呗", parentAccountId: "alipay", statementDay: 20, repaymentDay: 8, repaymentAccountId: "cmb", repaymentAccountIds: ["cmb", "alipay"], priority: 1, autoRepay: true, aliases: ["花呗"] },
    { id: "cmb-credit", name: "招商信用卡", parentAccountId: "cmb", statementDay: 18, repaymentDay: 6, repaymentAccountId: "cmb", repaymentAccountIds: ["cmb"], priority: 2, autoRepay: false, aliases: ["招商信用卡", "招行信用卡", "信用卡", "贷记卡"] },
    { id: "jd-baitiao", name: "京东白条", parentAccountId: "alipay", statementDay: 1, repaymentDay: 9, repaymentAccountId: "cmb", repaymentAccountIds: ["cmb", "alipay"], priority: 3, autoRepay: false, aliases: ["京东白条", "白条"] },
    { id: "douyin-monthly", name: "抖音月付", parentAccountId: "alipay", statementDay: 1, repaymentDay: 6, repaymentAccountId: "cmb", repaymentAccountIds: ["cmb"], priority: 4, autoRepay: false, aliases: ["抖音月付", "抖音分期", "Dou分期", "月付"] },
    { id: "meituan-monthly", name: "美团月付", parentAccountId: "alipay", statementDay: 1, repaymentDay: 8, repaymentAccountId: "cmb", repaymentAccountIds: ["cmb"], priority: 5, autoRepay: false, aliases: ["美团月付"] },
  ],
  transactions: [
    tx("t1", "山姆会员店", 386.2, "日用", "alipay", 0),
    tx("t2", "地铁通勤", 8, "交通", "alipay", 0),
    tx("t3", "独立电影票", 88, "娱乐", "wechat", 0),
    tx("t4", "咖啡豆", 128, "餐饮", "wechat", 0),
    tx("t5", "酷态科 10 号充电器", 259, "数码", "alipay", 0, { paymentKind: "credit", creditToolId: "huabei" }),
    tx("t6", "线上课程", 699, "学习", "cmb", 0),
    tx("t7", "房租", 3200, "日用", "cmb", 0),
    tx("t8", "AirPods Pro", 1899, "数码", "alipay", 0, { paymentKind: "credit", creditToolId: "huabei" }),
    tx("t9", "十月工资", 12680, "工资", "cmb", 0, { type: "income" }),
    tx("t10", "基金收益", 436.8, "理财", "cmb", 0, { type: "income" }),
    tx("t11", "Nintendo eShop", 268, "娱乐", "cmb", -18, { paymentKind: "credit", creditToolId: "cmb-credit" }),
    tx("t12", "年度域名续费", 96, "学习", "alipay", -20),
    tx("t13", "机械键盘", 1299, "数码", "cmb", -34),
    tx("t14", "高铁票", 553, "交通", "alipay", -38),
    tx("t15", "九月工资", 12460, "工资", "cmb", -35, { type: "income" }),
  ],
  subscriptions: [
    { id: "s1", name: "Apple Music", amount: 11, cycle: "monthly", startedAt: monthDay(-8, 12), endsAt: monthDay(1, 12), accountId: "alipay", category: "娱乐", renewalMode: "auto", reminderDays: 7 },
    { id: "s2", name: "iCloud+", amount: 21, cycle: "monthly", startedAt: monthDay(-16, 3), endsAt: monthDay(1, 3), accountId: "alipay", category: "数码", renewalMode: "auto", reminderDays: 7 },
    { id: "s3", name: "Setapp", amount: 338, cycle: "yearly", startedAt: monthDay(-5, 26), endsAt: monthDay(7, 26), accountId: "cmb", category: "学习", renewalMode: "fixed", reminderDays: 14 },
  ],
  assets: [
    { id: "a1", name: "MacBook Pro", price: 14999, purchasedAt: monthDay(-14, 8), lifeDays: 1460, category: "数码" },
    { id: "a2", name: "人体工学椅", price: 2899, purchasedAt: monthDay(-7, 16), lifeDays: 1095, category: "日用" },
    { id: "a3", name: "相机镜头", price: 4680, purchasedAt: monthDay(-3, 2), lifeDays: 1825, category: "娱乐" },
  ],
  repayments: [
    { id: "r1", creditToolId: "huabei", accountId: "cmb", amount: 742.6, date: monthDay(-1, 8), automatic: true },
  ],
  loans: [],
  projectRules: [
    { id: "p1", keyword: "酷态科", item: "酷态科 10 号充电器", category: "数码", accountId: "alipay", uses: 3 },
    { id: "p2", keyword: "任天堂", item: "Nintendo eShop", category: "娱乐", uses: 5 },
    { id: "p3", keyword: "地铁", item: "地铁通勤", category: "交通", accountId: "alipay", uses: 12 },
  ],
  rates: [
    { code: "CNY", name: "人民币", symbol: "¥", rateToCny: 1 },
    { code: "USD", name: "美元", symbol: "$", rateToCny: 7.08, aliases: ["美金", "美元"] },
    { code: "EUR", name: "欧元", symbol: "€", rateToCny: 8.31 },
    { code: "JPY", name: "日元", symbol: "¥", rateToCny: 0.047 },
    { code: "SGD", name: "新加坡元", symbol: "S$", rateToCny: 5.52 },
  ],
  baseCurrency: "CNY",
  autoUpdateRates: false,
  glassOpacity: 42,
  accentColor: "#6D9E8A",
  themeMode: "system",
  dockAction: "manual",
  slogans: defaultSlogans,
  webDav: {
    provider: "jianguoyun",
    endpoint: "https://dav.jianguoyun.com/dav/",
    username: "",
    remotePath: "iLedger/ledger.json",
    autoSync: false,
    syncOnLaunch: true,
    syncIntervalMinutes: 5,
  },
  designVersion: 7,
};
