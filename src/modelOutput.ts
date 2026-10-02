export function extractModelJson(text: string) {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) candidates.push(text.slice(start, index + 1));
    }
  }

  for (const candidate of candidates.reverse()) {
    try {
      const value = JSON.parse(candidate) as Record<string, unknown>;
      const normalized = { ...value };
      const aliases = { item: value["项目"] ?? value["项目名称"], amount: value["金额"], type: value["类型"] ?? value["收支类型"], category: value["分类"], currency: value["币种"] ?? value["货币"] };
      for (const [key, alias] of Object.entries(aliases)) if (!(key in normalized) && alias !== undefined) normalized[key] = alias;
      if (normalized.item !== undefined || normalized.amount !== undefined) return normalized;
    } catch {
      // Small local models sometimes echo an example before the valid result.
    }
  }
  throw new Error("模型没有返回可用的记账结构");
}

export function generatedModelText(output: any) {
  const generated = output?.[0]?.generated_text;
  if (typeof generated === "string") return generated;
  if (!Array.isArray(generated)) return "";
  const assistant = [...generated].reverse().find((message) => message?.role === "assistant");
  const content = assistant?.content ?? generated.at(-1)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? "").join("");
  return "";
}
