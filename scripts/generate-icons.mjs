// 生成拾页产品图标(public/icon/{16,32,48,96,128}.png)。
// 设计:透明底 + 线条与色块组合——品牌渐变描边的圆角六边形 + 内部渐变书签。
// 延续原版"轮廓+渐变实体"的结构(用户认可),换成品牌青碧→翡翠渐变并 refined 几何。
// 无填充背景底:工具栏上轮廓+渐变实体比实心填充底更醒目、更轻盈。
// 运行:pnpm icons
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'public', 'icon');

// 单一母版:六边形描边(线条) + 书签(渐变色块),所有尺寸共用。
// 书签比例符合黄金比:宽 42 × 高 68 (68/42≈1.619≈φ),比旧版 32×64(1:2) 更粗;
// 缺口深 = 宽/φ² ≈ 16。
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#06b6d4"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2dd4bf"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
  </defs>
  <polygon points="64,10 111,37 111,91 64,118 17,91 17,37"
    fill="none" stroke="url(#ring)" stroke-width="9" stroke-linejoin="round"/>
  <path d="M43 35A5 5 0 0 1 48 30H80A5 5 0 0 1 85 35V98L64 82L43 98Z" fill="url(#mark)"/>
</svg>`;

const sizes = [16, 32, 48, 96, 128];
await mkdir(outDir, { recursive: true });
for (const size of sizes) {
  // 4 倍超采样再降采样,边缘平滑。
  const png = await sharp(Buffer.from(ICON_SVG))
    .resize(size, size, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const file = path.join(outDir, `${size}.png`);
  await sharp(png).toFile(file);
  console.log(`saved ${path.relative(root, file)}`);
}
console.log('done.');
