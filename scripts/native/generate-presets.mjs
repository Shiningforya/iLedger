import { readFile, writeFile, mkdir } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../../src/data.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { initialLedger } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const destination = new URL("../../native/core/resources/", import.meta.url);
await mkdir(destination, { recursive: true });
await writeFile(new URL("presets.json", destination), JSON.stringify({ ...initialLedger, tiles: [] }, null, 2) + "\n");
console.log("Native presets generated without sample accounts or transactions.");
