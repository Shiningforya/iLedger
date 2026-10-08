import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, cpSync, rmSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

const manifest=JSON.parse(readFileSync("native/dependencies.json","utf8"));
const directory=resolve("native/.deps");mkdirSync(directory,{recursive:true});
async function hash(path,algorithm){const digest=createHash(algorithm);for await(const chunk of createReadStream(path))digest.update(chunk);return digest.digest("hex");}
async function obtain(key){
  const entry=manifest[key],file=join(directory,entry.file);
  if(existsSync(file)&&await hash(file,entry.algorithm)===entry.checksum)return file;
  const temporary=file+".download";
  console.log(`Downloading verified dependency: ${key} ${entry.version}`);
  const response=await fetch(entry.url,{signal:AbortSignal.timeout(900000)});
  if(!response.ok||!response.body)throw Error(`Download failed: ${response.status}`);
  await pipeline(response.body,createWriteStream(temporary,{mode:0o600}));
  if(await hash(temporary,entry.algorithm)!==entry.checksum){rmSync(temporary);throw Error(`${key}: checksum mismatch; nothing installed`);}
  renameSync(temporary,file);return file;
}
await obtain("json");
const archive=await obtain("sqlite");
const extraction=join(directory,"sqlite-extract");mkdirSync(extraction,{recursive:true});
if(process.platform==="win32")execFileSync("powershell",["-NoProfile","-Command",`Expand-Archive -Force -LiteralPath '${archive.replaceAll("'","''")}' -DestinationPath '${extraction.replaceAll("'","''")}'`],{stdio:"inherit"});
else execFileSync("unzip",["-oq",archive,"-d",extraction],{stdio:"inherit"});
for(const file of ["sqlite3.c","sqlite3.h"])cpSync(join(extraction,"sqlite-amalgamation-3530400",file),join(directory,file));
if(process.argv.includes("--mac-model-engines")) {
  if(process.platform!=="darwin"||process.arch!=="arm64")throw Error("This engine bundle requires Apple Silicon");
  for(const key of ["llamaMacArm64","sherpaMacArm64"])execFileSync("tar",["-xf",await obtain(key),"-C",directory],{stdio:"inherit"});
  const header=join(directory,"sherpa-headers/sherpa-onnx/c-api");mkdirSync(header,{recursive:true});
  cpSync(await obtain("sherpaHeader"),join(header,"c-api.h"));
}
if(process.argv.includes("--qwen"))await obtain("qwen");
console.log("Native dependencies verified.");
