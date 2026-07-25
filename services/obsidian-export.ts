import { zipSync, strToU8 } from 'fflate';
import type { WebClip } from '@/types/clip';

export interface ObsidianExportOptions {
  /** 是否包含采集正文，默认 true */
  includeContent?: boolean;
}

/** 转义为 YAML 双引号字符串。 */
function yamlString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')
    .replace(/\t/g, '\\t')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')}"`;
}

const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** 将收藏标题清洗为安全的文件名（不含扩展名）。 */
export function sanitizeObsidianFilename(title: string): string {
  let name = title
    .replace(/[<>:"/\\|?*]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 100)
    .trim();

  if (!name) name = '未命名收藏';
  if (WINDOWS_RESERVED.has(name.toUpperCase())) name = `${name}-拾页`;
  return name;
}

/** 将单条收藏转换为 Obsidian 兼容 Markdown。 */
export function clipToObsidianMarkdown(
  clip: WebClip,
  options: ObsidianExportOptions = {},
): string {
  const includeContent = options.includeContent !== false;

  const frontmatter = [
    '---',
    `title: ${yamlString(clip.title)}`,
    `source: ${yamlString(clip.url)}`,
    `domain: ${yamlString(clip.domain)}`,
    `created: ${yamlString(clip.createdAt)}`,
    `updated: ${yamlString(clip.updatedAt)}`,
    ...(clip.tags.length > 0
      ? ['tags:', ...clip.tags.map((tag) => `  - ${yamlString(tag)}`)]
      : []),
    '---',
  ].join('\n');

  const sections: string[] = [`# ${clip.title}`];
  if (clip.summary) sections.push(`## 摘要\n\n${clip.summary}`);
  if (clip.userNote) sections.push(`## 收藏理由\n\n${clip.userNote}`);
  if (clip.selectedText) sections.push(`## 摘录\n\n${clip.selectedText}`);
  if (includeContent && clip.extractedText) {
    sections.push(`## 正文\n\n${clip.extractedText}`);
  }
  sections.push(`---\n\n[查看原网页](${clip.url})`);

  return `${frontmatter}\n\n${sections.join('\n\n')}\n`;
}

/** 为一组收藏分配互不重复的文件名（不含扩展名）。 */
function assignFilenames(clips: WebClip[]): Map<string, string> {
  const used = new Map<string, number>();
  const names = new Map<string, string>();
  for (const clip of clips) {
    const base = sanitizeObsidianFilename(clip.title);
    const key = base.toLowerCase();
    const count = used.get(key) ?? 0;
    used.set(key, count + 1);
    names.set(clip.id, count === 0 ? base : `${base}-${count + 1}`);
  }
  return names;
}

/** 构建包含索引文件的 Obsidian ZIP。 */
export function buildObsidianArchive(
  clips: WebClip[],
  options: ObsidianExportOptions = {},
): Uint8Array {
  const names = assignFilenames(clips);
  const files: Record<string, Uint8Array> = {};

  const indexLines = ['# 拾页收藏', ''];
  for (const clip of clips) {
    const name = names.get(clip.id)!;
    files[`PageTrove/${name}.md`] = strToU8(
      clipToObsidianMarkdown(clip, options),
    );
    indexLines.push(`- [[${name}]]`);
  }
  files['PageTrove/_拾页索引.md'] = strToU8(`${indexLines.join('\n')}\n`);

  return zipSync(files);
}

/** 触发浏览器下载并释放对象 URL。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 导出单条收藏为 .md 文件。 */
export function downloadClipMarkdown(
  clip: WebClip,
  options: ObsidianExportOptions = {},
): void {
  const markdown = clipToObsidianMarkdown(clip, options);
  downloadBlob(
    new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
    `${sanitizeObsidianFilename(clip.title)}.md`,
  );
}

/** 导出多条收藏为 Obsidian ZIP。 */
export function downloadClipsArchive(
  clips: WebClip[],
  options: ObsidianExportOptions = {},
): void {
  const data = buildObsidianArchive(clips, options);
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  downloadBlob(
    new Blob([buffer], { type: 'application/zip' }),
    `PageTrove-${new Date().toISOString().slice(0, 10)}.zip`,
  );
}
