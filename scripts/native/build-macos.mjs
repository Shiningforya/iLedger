import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, lstatSync, unlinkSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

if (process.platform !== "darwin") throw new Error("macOS is required");
const root = resolve("native"), out = join(root,".build"), app = join(out,"iLedger Native.app"), contents = join(app,"Contents");
const version = JSON.parse(readFileSync(join(root,"version.json"),"utf8"));
rmSync(app,{recursive:true,force:true});
for (const folder of ["MacOS","Resources","Frameworks","Helpers"]) mkdirSync(join(contents,folder),{recursive:true});
execFileSync(process.execPath,["scripts/native/build-core.mjs"],{stdio:"inherit"});
cpSync(join(out,"libiledger_core.dylib"),join(contents,"Frameworks/libiledger_core.dylib"));
cpSync(join(root,"core/resources/presets.json"),join(contents,"Resources/presets.json"));
const source = join(root,"macos/Sources");
const sdk = execFileSync("xcrun",["--show-sdk-path"],{encoding:"utf8"}).trim();
mkdirSync(join(out,"module-cache"),{recursive:true});
const compiler = execFileSync("xcrun",["-f","swiftc"],{encoding:"utf8"}).trim();
const includes = resolve(dirname(compiler),"../include/swift"), flags = [];
// Some upgraded CLT installations retain the obsolete duplicate module map.
// Hide only that duplicate in this build; never modify the installed SDK.
if (existsSync(join(includes,"module.modulemap")) && existsSync(join(includes,"bridging.modulemap"))) {
  const empty = join(out,"empty.modulemap"), overlay = join(out,"clt-overlay.json");
  writeFileSync(empty,"");
  writeFileSync(overlay,JSON.stringify({version:0,roots:[{type:"file",name:join(includes,"module.modulemap"),"external-contents":empty}]}));
  flags.push("-vfsoverlay",overlay,"-Xcc","-ivfsoverlay","-Xcc",overlay);
}
execFileSync(compiler,["-O","-swift-version","5","-parse-as-library",...flags,"-target",`${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx14.0`,"-sdk",sdk,"-module-cache-path",join(out,"module-cache"),"-import-objc-header",join(root,"core/include/iledger.h"),"-L",out,"-liledger_core","-Xlinker","-rpath","-Xlinker","@executable_path/../Frameworks",...readdirSync(source).filter(f=>f.endsWith(".swift")).map(f=>join(source,f)),"-o",join(contents,"MacOS/iLedger")],{stdio:"inherit",timeout:180000});
const iconset = join(out,"iLedger.iconset"); mkdirSync(iconset,{recursive:true});
for (const size of [16,32,128,256,512]) for (const scale of [1,2]) await sharp("public/iledger-favicon.svg").resize(size*scale,size*scale).png().toFile(join(iconset,`icon_${size}x${size}${scale===2?"@2x":""}.png`));
execFileSync("iconutil",["-c","icns",iconset,"-o",join(contents,"Resources/iLedger.icns")],{stdio:"inherit"});
const llama = join(root,".deps/llama-b11482");
if (existsSync(llama)) cpSync(llama,join(contents,"Helpers/llama"),{recursive:true,dereference:true});
const speech = join(root,".deps/sherpa-onnx-v1.13.8-osx-arm64-shared-no-tts-lib");
if (existsSync(speech)) {
  const destination = join(contents,"Helpers/speech"); mkdirSync(destination,{recursive:true});
  cpSync(join(speech,"lib"),join(destination,"lib"),{recursive:true,dereference:true});
  execFileSync("clang++",["-std=c++17","-O2","-I",join(root,".deps/sherpa-headers"),join(root,"core/src/speech_cli.cpp"),"-L",join(speech,"lib"),"-lsherpa-onnx-c-api","-Wl,-rpath,@executable_path/lib","-o",join(destination,"iledger-speech")],{stdio:"inherit"});
}
function materializeLinks(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory,name), info = lstatSync(path);
    if (info.isSymbolicLink()) { const bytes=readFileSync(path);unlinkSync(path);writeFileSync(path,bytes,{mode:0o755}); }
    else if (info.isDirectory()) materializeLinks(path);
  }
}
materializeLinks(join(contents,"Helpers"));
writeFileSync(join(contents,"Info.plist"),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>iLedger Native</string><key>CFBundleDisplayName</key><string>iLedger Native</string>
<key>CFBundleIdentifier</key><string>com.iledger.native</string><key>CFBundleExecutable</key><string>iLedger</string>
<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIconFile</key><string>iLedger.icns</string>
<key>CFBundleShortVersionString</key><string>${version.version}</string><key>CFBundleVersion</key><string>${version.build}</string>
<key>LSMinimumSystemVersion</key><string>14.0</string><key>NSPrincipalClass</key><string>NSApplication</string>
<key>NSHighResolutionCapable</key><true/><key>NSMicrophoneUsageDescription</key><string>将录音在本机转换为记账文字，不上传录音。</string>
<key>CFBundleDevelopmentRegion</key><string>zh_CN</string><key>CFBundleLocalizations</key><array><string>zh_CN</string><string>en</string></array>
</dict></plist>`);
execFileSync("codesign",["--force","--deep","--sign","-",app],{stdio:"inherit"});
execFileSync("codesign",["--verify","--deep","--strict",app],{stdio:"inherit"});
console.log(`Native macOS candidate: ${app}`);
