import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const icon = await readFile(path.join(projectRoot, "public/iledger-favicon.svg"));
const resourceRoot = path.join(projectRoot, "android/app/src/main/res");
const densities = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};

for (const [density, scale] of Object.entries(densities)) {
  const directory = path.join(resourceRoot, `mipmap-${density}`);
  const size = Math.round(48 * scale);
  const launcher = await sharp(icon).resize(size, size).png().toBuffer();
  await writeFile(path.join(directory, "ic_launcher.png"), launcher);
  await writeFile(path.join(directory, "ic_launcher_round.png"), launcher);

  const foregroundSize = Math.round(108 * scale);
  const markSize = Math.round(foregroundSize * 0.66);
  const mark = await sharp(icon).resize(markSize, markSize).png().toBuffer();
  const foreground = await sharp({
    create: {
      width: foregroundSize,
      height: foregroundSize,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toBuffer();
  await writeFile(path.join(directory, "ic_launcher_foreground.png"), foreground);
}

console.log("Android launcher icons generated from public/iledger-favicon.svg");
