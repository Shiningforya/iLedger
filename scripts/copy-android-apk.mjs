import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const destination = path.join(projectRoot, "release", `iLedger-${version}-android-debug.apk`);

await mkdir(path.dirname(destination), { recursive: true });
await copyFile(path.join(projectRoot, "android/app/build/outputs/apk/debug/app-debug.apk"), destination);
console.log(`Android APK copied to ${destination}`);
