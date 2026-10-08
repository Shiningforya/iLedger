import {cpSync,mkdirSync,readFileSync,writeFileSync,existsSync} from "node:fs";
import {join} from "node:path";
import sharp from "sharp";

mkdirSync("native/android/gradle/wrapper",{recursive:true});
for(const file of ["gradlew","gradlew.bat","gradle/wrapper/gradle-wrapper.jar","gradle/wrapper/gradle-wrapper.properties"])cpSync(join("android",file),join("native/android",file));
for(const [density,size]of [["mdpi",48],["hdpi",72],["xhdpi",96],["xxhdpi",144],["xxxhdpi",192]]){
  const dir=`native/android/app/src/main/res/mipmap-${density}`;mkdirSync(dir,{recursive:true});
  await sharp("public/iledger-favicon.svg").resize(size,size).png().toFile(join(dir,"ic_launcher.png"));
}
mkdirSync("native/windows/Assets",{recursive:true});
const png=await sharp("public/iledger-favicon.svg").resize(256,256).png().toBuffer();
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);
writeFileSync("native/windows/Assets/iLedger.ico",Buffer.concat([ico,png]));
console.log("Native wrapper scripts and platform icons prepared from iledger-favicon.svg");
