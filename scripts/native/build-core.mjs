import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const header = await readFile(new URL("../../native/.deps/json.hpp", import.meta.url));
if (createHash("sha256").update(header).digest("hex") !== "aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63") throw new Error("JSON dependency checksum mismatch");
await mkdir(new URL("../../native/.build", import.meta.url), { recursive: true });
const args = ["-std=c++17", "-O2", "-Wall", "-Wextra", "-Werror", "-Inative/.deps", "-Inative/core/include", "-Inative/core/src", "native/core/src/core.cpp", "native/core/src/store.cpp", "-lsqlite3"];
for (const suffix of [["native/core/src/cli.cpp", "-o", "native/.build/iledger-core"], ["-dynamiclib", "-o", "native/.build/libiledger_core.dylib", "-Wl,-install_name,@rpath/libiledger_core.dylib"]]) {
  const result = spawnSync("clang++", [...args, ...suffix], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
