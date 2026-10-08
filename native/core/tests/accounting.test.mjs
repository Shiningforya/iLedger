import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "iledger-native-test-"));
const database = join(directory, "ledger.sqlite");
const requests = [
  { action: "snapshot" },
  { action: "saveAccount", value: { id: "wallet", name: "钱包" }, initialChild: { id: "cny", name: "人民币余额", balance: 1000, currency: "CNY" } },
  { action: "saveAccount", value: { id: "usd", name: "美元余额", parentAccountId: "wallet", balance: 100, currency: "USD", aliases: ["VISA"] } },
  { action: "saveTransaction", value: { id: "gpt", item: "ChatGPT", type: "expense", amount: 20, currency: "USD", accountId: "cny", date: "2026-10-08", category: "学习", exchangeRateToBase: 7.1, isSubscription: true, subscriptionEndsAt: "2026-11-08", trackDepreciation: true } },
  { action: "snapshot" },
  { action: "settings", value: { baseCurrency: "USD" } },
  { action: "snapshot" },
  { action: "saveRate", value: { code: "USD", name: "美元", rateToCny: 9 } },
  { action: "saveTransaction", value: { id: "gpt", item: "GPT Plus" } },
  { action: "snapshot" },
  { action: "summary", year: "2026", month: "2026-10", currency: "CNY" },
  { action: "saveTransaction", value: { id: "bad", item: "错误", type: "expense", amount: 50, currency: "CNY", accountId: "wallet", date: "2026-10-08", category: "学习" } },
  { action: "snapshot" },
  { action: "deleteTransaction", id: "gpt" },
  { action: "snapshot" },
  { action: "saveTransaction", value: { id: "loan", item: "旅行借款", type: "income", amount: 50, currency: "USD", accountId: "usd", date: "2026-10-08", category: "借款" } },
  { action: "saveTransaction", value: { id: "repay", item: "归还借款", type: "expense", amount: 50, currency: "USD", accountId: "usd", date: "2026-10-08", category: "归还借款", repaymentLoanId: "loan-loan" } },
  { action: "snapshot" },
  { action: "deleteTransaction", id: "repay" },
  { action: "snapshot" },
  { action: "settings", value: { baseCurrency: "EUR" } },
  { action: "saveCategory", value: { id: "study", name: "知识", type: "expense", aliases: ["ChatGPT", "GPT"] } },
  { action: "parse", text: "购买ChatGPT，VISA花了20美刀", date: "2026-10-08" },
  { action: "settings", expectedRevision: 0, value: { themeMode: "dark" } },
  { action: "query", page: 999, pageSize: 20 },
  { action: "saveAccount", value: { id: "cny", name: "人民币余额", parentAccountId: "wallet", currency: "CNY", balance: 1000 } },
  { action: "deleteAccount", id: "wallet" },
  { action: "snapshot" },
];

function run(input) {
  const process = spawnSync(resolve(globalThis.process.env.ILEDGER_CORE_BIN || "native/.build/iledger-core"), [database, resolve("native/core/resources/presets.json")], { input: input.map(value => JSON.stringify(value)).join("\n") + "\n", encoding: "utf8" });
  assert.equal(process.status, 0, process.stderr);
  return process.stdout.trim().split("\n").map(value => JSON.parse(value));
}
try {
  const r = run(requests);
  for (const i of [11, 20, 23, 26]) assert.equal(r[i].ok, false, `request ${i} must reject`);
  for (let i=0;i<r.length;i++) if (![11,20,23,26].includes(i)) assert.equal(r[i].ok, true, `${i}: ${r[i].error}`);
  assert.equal(r[0].data.accounts.length, 0);
  assert.equal(r[4].data.accounts.find(a=>a.id==="cny").balance, 858);
  assert.equal(r[4].data.transactions[0].amountInBase, 142);
  assert.equal(r[4].data.subscriptions[0].amount, 142);
  assert.equal(r[4].data.assets[0].price, 142);
  assert.deepEqual(r[6].data.transactions, r[4].data.transactions, "base switch preserves booked transactions");
  assert.deepEqual(r[6].data.accounts, r[4].data.accounts, "base switch preserves accounts");
  assert.equal(r[9].data.accounts.find(a=>a.id==="cny").balance, 858, "name edits after rate changes do not move money");
  assert.equal(r[9].data.subscriptions[0].name, "GPT Plus");
  assert.equal(r[10].data.net, -142);
  assert.deepEqual(r[10].data.months.map(m=>m.month), Array.from({length:12},(_,i)=>i+1));
  assert.equal(r[12].data.transactions.length, 1, "invalid account causes full rollback");
  assert.equal(r[14].data.accounts.find(a=>a.id==="cny").balance, 1000, "deleting restores frozen account amount");
  assert.equal(r[14].data.assets.length, 0);
  assert.equal(r[14].data.subscriptions.length, 0);
  assert.equal(r[17].data.loans[0].status, "repaid");
  assert.equal(r[19].data.loans[0].status, "outstanding");
  assert.equal(r[22].data.currency, "USD");
  assert.equal(r[22].data.accountId, "usd");
  assert.equal(r[22].data.category, "知识");
  assert.equal(r[22].data.amount, 20);
  assert.equal(r[24].data.page, 1);
  const reopened = run([{action:"snapshot"}])[0];
  assert.deepEqual(reopened.data, r[27].data, "SQLite state survives process restart");
  const invalidImport = run([{ action: "import", value: { accounts: [], transactions: [{id:"broken"}] } }, {action:"snapshot"}]);
  assert.equal(invalidImport[0].ok,false);
  assert.deepEqual(invalidImport[1].data,reopened.data,"invalid import cannot replace the existing database");
  const more = run([
    {action:"settings",value:{baseCurrency:"CNY"}},
    {action:"saveTransaction",value:{id:"foreign",item:"外币订阅",amount:20,currency:"USD",type:"expense",category:"知识",accountId:"cny",date:"2026-10-08",isSubscription:true,subscriptionEndsAt:"2026-11-08"}},
    {action:"snapshot"},
    {action:"saveTransaction",value:{id:"foreign",currency:"EUR"}},
    {action:"snapshot"},
    {action:"resolveModel",text:"ChatGPT，VISA花了20美刀",date:"2026-10-08",value:{item:"GPT订阅",amount:300,currency:"EUR",type:"income",category:"工资",accountId:"cny"}},
    {action:"saveRate",value:{code:"EUR",name:"欧元",rateToCny:0}},
    {action:"saveCategory",value:{id:"study",name:"学术",type:"expense"}},
    {action:"snapshot"},
    {action:"deleteTransaction",id:"foreign"},
    {action:"snapshot"},
  ]);
  assert.equal(more[2].data.accounts.find(a=>a.id==="cny").balance,820);
  const eurRate=more[2].data.rates.find(r=>r.code==="EUR").rateToCny;
  assert.equal(more[4].data.transactions.find(t=>t.id==="foreign").exchangeRateToBase,eurRate,"changing original currency must not reuse the old currency rate");
  assert.equal(more[5].data.accountId,"usd","model cannot override explicit account recognition");
  assert.equal(more[5].data.currency,"USD","model cannot override currency recognition");
  assert.equal(more[5].data.category,"知识");assert.equal(more[5].data.amount,20);
  assert.equal(more[6].ok,false,"invalid exchange rate rolls back");
  assert.equal(more[8].data.subscriptions[0].category,"学术","category rename updates related records");
  assert.equal(more[10].data.accounts.find(a=>a.id==="cny").balance,1000);
  const many = structuredClone(more[10].data);
  many.transactions = Array.from({length:101},(_,i)=>({id:`page-${i}`,item:`账单 ${i}`,amount:1,currency:"CNY",bookedBaseCurrency:"CNY",amountInBase:1,amountCny:1,type:"expense",category:"学术",accountId:"cny",date:"2026-10-08",status:"posted",balanceApplied:false}));
  many.loans=[];
  const pagination=run([{action:"import",value:many},{action:"query",page:6,pageSize:20},{action:"query",pageSize:10000},{action:"snapshot"}]);
  assert.equal(pagination[0].ok,true);
  assert.equal(pagination[1].data.items.length,1);assert.equal(pagination[1].data.pageCount,6);
  assert.equal(pagination[2].data.items.length,100,"queries have a hard page-size bound");
  assert.equal(pagination[3].data.transactions.length,101,"pagination does not discard records");
  const recovery=run([{action:"hasImportBackup"},{action:"restoreImportBackup"},{action:"snapshot"},{action:"restoreImportBackup"},{action:"snapshot"}]);
  assert.equal(recovery[0].data.available,true);
  assert.deepEqual(recovery[2].data,more[10].data,"import recovery survives process restart and restores every collection");
  assert.deepEqual(recovery[4].data,pagination[3].data,"restoring keeps a reversible copy of the current state");
  const credit=run([
    {action:"saveAccount",value:{id:"visa",name:"测试信用卡",parentAccountId:"wallet",currency:"CNY",balance:10},credit:{id:"legacy-credit",statementDay:20,repaymentDay:8,repaymentAccountIds:["cny"],autoRepay:true}},
    {action:"saveAccount",value:{id:"visa",name:"更新信用卡"},credit:{statementDay:21,repaymentDay:9}},
    {action:"snapshot"},
  ]);
  assert.equal(credit[0].ok,true);assert.equal(credit[1].ok,true);
  assert.equal(credit[2].data.creditTools.length,1,"editing a migrated credit child must not duplicate its credit record");
  assert.equal(credit[2].data.creditTools[0].id,"legacy-credit");
  assert.deepEqual(credit[2].data.creditTools[0].repaymentAccountIds,["cny"]);
  assert.equal(credit[2].data.creditTools[0].autoRepay,true);
  assert.equal(credit[2].data.accounts.find(a=>a.id==="visa").balance,10);
  const explicit=run([{action:"resolveModel",text:"用人民币余额账户购买 ChatGPT，支出20美元，类别为学术",date:"2026-10-08",value:{item:"ChatGPT",amount:20,currency:"USD",category:"学术",accountId:"cny",type:"income"}}]);
  assert.equal(explicit[0].ok,true,explicit[0].error);
  assert.equal(explicit[0].data.currency,"USD","currency within account name must not override currency adjacent to amount");
  assert.equal(explicit[0].data.type,"expense","model cannot override explicit expense verb");
  console.log("Native SQLite, currency, relationship, recognition and rollback regression tests passed.");
} finally { rmSync(directory, { recursive: true, force: true }); }
