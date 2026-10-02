import assert from "node:assert/strict";
import { initialLedger } from "../.test-build/demoData.js";
import { parseNaturalEntry, recognitionLibraryMatches } from "../.test-build/parser.js";

const iphone = parseNaturalEntry("购买了iPhone18Pro，花了8999元", initialLedger);
assert.equal(iphone.item, "iPhone18Pro");
assert.equal(iphone.amount, 8999);
assert.equal(iphone.category, "数码");

const huabei = parseNaturalEntry("花呗买了 AirPods，花费 1000 元", initialLedger);
assert.equal(huabei.item, "AirPods");
assert.equal(huabei.amount, 1000);
assert.equal(huabei.paymentKind, "credit");
assert.equal(huabei.creditToolId, "huabei");

const baitiao = parseNaturalEntry("昨天京东白条买机械键盘 1299元", initialLedger);
assert.equal(baitiao.item, "机械键盘");
assert.equal(baitiao.amount, 1299);
assert.equal(baitiao.creditToolId, "jd-baitiao");

const learned = parseNaturalEntry("微信买了酷态科，259元", initialLedger);
assert.equal(learned.item, "酷态科 10 号充电器");
assert.equal(learned.category, "日用");
assert.equal(learned.accountId, "wechat");

const ipad = parseNaturalEntry("昨天买了个iPad 2021 M1，花了5999元", initialLedger);
assert.equal(ipad.item, "iPad 2021 M1");
assert.equal(ipad.amount, 5999);
assert.equal(ipad.category, "数码");

const airpodsPair = parseNaturalEntry("买了一对AirPods，花了1899元", initialLedger);
assert.equal(airpodsPair.item, "AirPods");
assert.equal(airpodsPair.amount, 1899);
assert.equal(airpodsPair.category, "数码");

const dollars = parseNaturalEntry("买了耳机，花费了100美元", initialLedger);
assert.equal(dollars.item, "耳机");
assert.equal(dollars.amount, 100);
assert.equal(dollars.currency, "USD");

const customized = {
  ...initialLedger,
  rates: [...initialLedger.rates, { code: "IDR", name: "印度尼西亚卢比", symbol: "Rp", rateToCny: 0.00046, aliases: ["印尼盾"] }],
  categories: [...initialLedger.categories, { id: "fitness", name: "运动健康", type: "expense", color: "#789", icon: "tag", aliases: ["健身"] }],
  accounts: [...initialLedger.accounts, { id: "custom-parent", name: "旅行金融", institution: "自定义", kind: "bank", balance: 0, color: "#789", aliases: ["不应命中的主账户"] }, { id: "custom-card", name: "旅行卡", institution: "自定义", kind: "bank", balance: 0, currency: "CNY", color: "#789", parentAccountId: "custom-parent", aliases: ["出境卡"] }],
};
const rupiah = parseNaturalEntry("买咖啡花了50000印尼盾", customized);
assert.equal(rupiah.currency, "IDR");
const dynamicFields = parseNaturalEntry("用出境卡支付健身课程300元", customized);
assert.equal(dynamicFields.category, "运动健康");
assert.equal(dynamicFields.accountId, "custom-card");
assert.equal(recognitionLibraryMatches("使用不应命中的主账户付款", customized).accountId, undefined, "primary account aliases must not participate in recognition");

const borrowingLedger = { ...initialLedger, accounts: [...initialLedger.accounts, { ...initialLedger.accounts.find((account) => account.id === "cmb"), id: "cmb-balance", parentAccountId: "cmb", currency: "CNY" }] };
const borrowing = parseNaturalEntry("从朋友借款5000元到账招商银行", borrowingLedger);
assert.equal(borrowing.type, "income");
assert.equal(borrowing.category, "借款");
assert.equal(borrowing.accountId, "cmb-balance");

const aiSubscription = parseNaturalEntry("ChatGPT Plus花了20美元", initialLedger);
assert.equal(aiSubscription.category, "学习");
assert.equal(aiSubscription.currency, "USD");

const freelanceIncome = parseNaturalEntry("兼职稿费到账3000元", initialLedger);
assert.equal(freelanceIncome.type, "income");
assert.equal(freelanceIncome.category, "工资");

const contextual = {
  ...initialLedger,
  categories: initialLedger.categories.map((category) => category.id === "study" ? { ...category, aliases: ["ChatGPT"] } : category),
  creditTools: [
    ...initialLedger.creditTools,
    { id: "bochk-visa", name: "中银香港 VISA", aliases: ["中银香港VISA"], parentAccountId: "cmb", statementDay: 5, repaymentDay: 25, repaymentAccountId: "cmb", repaymentAccountIds: ["cmb"], priority: 8, autoRepay: false },
    { id: "hsbc-mastercard", name: "汇丰万事达", aliases: ["HSBC Mastercard"], parentAccountId: "wechat", statementDay: 6, repaymentDay: 26, repaymentAccountId: "cmb", repaymentAccountIds: ["cmb"], priority: 9, autoRepay: false },
  ],
  projectRules: [{ id: "chatgpt", keyword: "ChatGPT", item: "ChatGPT", category: "数码", accountId: "cmb", currency: "EUR", uses: 1 }],
};
const firstChatGpt = parseNaturalEntry("购买ChatGPT，中银香港VISA花了20欧", contextual);
assert.equal(firstChatGpt.item, "ChatGPT");
assert.equal(firstChatGpt.creditToolId, "bochk-visa");
assert.equal(firstChatGpt.currency, "EUR");
assert.equal(firstChatGpt.category, "学习");

const changedContext = parseNaturalEntry("ChatGPT，汇丰万事达花了20美刀", contextual);
assert.equal(changedContext.item, "ChatGPT");
assert.equal(changedContext.creditToolId, "hsbc-mastercard");
assert.equal(changedContext.accountId, "wechat");
assert.equal(changedContext.currency, "USD");
assert.equal(changedContext.category, "学习");

const reverseSubstring = parseNaturalEntry("GPT，汇丰万事达花了20美刀", contextual);
assert.equal(reverseSubstring.item, "ChatGPT");
assert.equal(reverseSubstring.category, "学习");
const locked = recognitionLibraryMatches("GPT，汇丰万事达花了20美刀", contextual);
assert.equal(locked.item, "ChatGPT");
assert.equal(locked.type, "expense");
assert.equal(locked.category, "学习");
assert.equal(locked.currency, "USD");
assert.equal(locked.creditToolId, "hsbc-mastercard");

console.log("parser regression tests: 16 scenarios passed");
