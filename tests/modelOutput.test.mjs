import assert from "node:assert/strict";
import { extractModelJson, generatedModelText } from "../.test-build/modelOutput.js";

const echoed = [
  '规则解析候选：{"item":"对AirPods","amount":0,"type":"expense","category":"日用"}',
  '```json',
  '{"item":"AirPods","amount":1899,"type":"expense","category":"数码"}',
  '```',
].join("\n");

assert.deepEqual(extractModelJson(echoed), {
  item: "AirPods",
  amount: 1899,
  type: "expense",
  category: "数码",
});

assert.equal(generatedModelText([{ generated_text: [
  { role: "user", content: "买了一对AirPods，1899元" },
  { role: "assistant", content: '{"item":"AirPods","amount":1899}' },
] }]), '{"item":"AirPods","amount":1899}');

assert.equal(generatedModelText([{ generated_text: '{"item":"iPad 2021 M1","amount":5999}' }]), '{"item":"iPad 2021 M1","amount":5999}');

const chineseKeys = extractModelJson('{"项目名称":"咖啡","金额":35,"类型":"expense","分类":"餐饮","币种":"CNY"}');
assert.equal(chineseKeys.item, "咖啡");
assert.equal(chineseKeys.currency, "CNY");

console.log("model output regression tests: 5 passed");
