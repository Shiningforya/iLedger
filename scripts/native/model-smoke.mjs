import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "iledger-inference-test-"));
const executable = resolve("native/.build/iLedger Native.app/Contents/Helpers/llama/llama-completion");
const catalog = { categories: [{name:"学习",type:"expense"},{name:"工资",type:"income"}], accounts: [{id:"cny",name:"人民币余额"}], currencies:["CNY","USD"] };
const schema = {type:"object",properties:{item:{type:"string"},type:{enum:["expense","income"]},amount:{type:"number"},currency:{type:"string"},category:{type:"string"},accountId:{type:"string"}},required:["item","type","amount","currency","category","accountId"],additionalProperties:false};
try {
  for (const [text, amount, currency, type] of [
    ["用人民币余额账户购买 ChatGPT，支出20美元，类别为学习",20,"USD","expense"],
    ["工资收入300人民币，存入人民币余额账户",300,"CNY","income"],
  ]) {
    const prompt = `<|im_start|>system\n将用户记账内容解析为 JSON。只返回 item,type,amount,currency,category,accountId。type 为 expense 或 income。类别、账户、币种只从以下资料选择。资料：${JSON.stringify(catalog)}<|im_end|>\n<|im_start|>user\n${text}<|im_end|>\n<|im_start|>assistant\n`;
    const file=join(directory,"prompt.txt");writeFileSync(file,prompt,{mode:0o600});
    const start=performance.now();
    const result=spawnSync(executable,["-m",resolve("native/.deps/qwen.gguf"),"-f",file,"-n","256","-c","4096","-t","4","-ngl","0","-fa","off","--temp","0","--no-display-prompt","--no-conversation","--json-schema",JSON.stringify(schema),"--no-perf","--simple-io","--color","off"],{encoding:"utf8",timeout:120000,maxBuffer:2*1024*1024});
    assert.equal(result.status,0,result.stderr || String(result.error));
    const begin=result.stdout.indexOf("{"),end=result.stdout.lastIndexOf("}");
    const value=JSON.parse(result.stdout.slice(begin,end+1));
    assert.equal(value.amount,amount);assert.equal(value.currency,currency);assert.equal(value.type,type);
    assert.equal(value.accountId,"cny");assert.equal(value.category,type==="income"?"工资":"学习");
    console.log(JSON.stringify({fixture:text,result:value,elapsedMs:Math.round(performance.now()-start)}));
  }
  console.log("Native llama.cpp/Qwen inference smoke tests passed (not an accuracy benchmark).");
  const speech=spawnSync(resolve("native/.build/iLedger Native.app/Contents/Helpers/speech/iledger-speech"),[resolve("native/.deps/sensevoice"),resolve("native/.deps/sensevoice-zh.wav")],{encoding:"utf8",timeout:120000,maxBuffer:2*1024*1024});
  assert.equal(speech.status,0,speech.stderr || String(speech.error));
  assert.match(speech.stdout,/时间/);assert.match(speech.stdout,/9|九/);assert.match(speech.stdout,/5|五/);
  console.log(JSON.stringify({fixture:"official SenseVoice zh.wav",transcript:speech.stdout.trim()}));
  console.log("Native SenseVoice smoke test passed (one public sample, not a WER/CER benchmark).");
} finally { rmSync(directory,{recursive:true,force:true}); }
