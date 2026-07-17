# 拾页

> 网站藏宝库浏览器插件：产品与技术实现方案
>
> 面向 Claude Code 的项目实现说明  
> 目标：开发一个浏览器侧边栏插件，以“围绕网页的 AI 对话”为主视图，支持快速读取当前页面、使用 AI 自动整理，并保存到个人“网站藏宝库”。

## 当前状态（2026-07）

- V0 / V1 / V2 均已完成：本地收藏、AI 整理（摘要 + 标签）、网页对话（流式 + Markdown 渲染）
- 对话为主视图；头部图标依次为：新对话、历史对话、收藏当前网页（☆）、我的收藏、设置
- AI 已泛化为多供应商（OpenAI 兼容接口）：DeepSeek、Kimi、智谱 GLM、通义千问、OpenAI、自定义
- AI 结果已简化：只保留摘要（≤100 汉字）和标签（3~5 个），移除“好玩的地方 / 值得借鉴 / 分类”
- 附加能力：页面元素选取（类 F12 拾取器）、对话输入框内切换模型、历史对话标题搜索
- V3（语义搜索 / 推荐 / 专题）暂缓

---

## 1. 项目目标

用户在浏览网页时，点击浏览器插件图标，右侧打开一个侧边栏。

插件需要支持：

1. 读取当前网页的基础信息。
2. 提取用户选中的文字和网页主要正文。
3. 让用户填写“为什么收藏这个网站”。
4. 调用 AI 模型接口（OpenAI 兼容，多供应商可选），自动生成：
   - 摘要（让用户快速了解这个收藏）
   - 标签（最多 5 个）
5. 用户确认后保存到个人收藏库（浏览器本地存储）。
6. 支持查询、编辑、删除、搜索和针对网页继续提问（已实现）。

核心体验应尽量简单：

```text
看到好网站
→ 点击插件
→ AI 自动整理
→ 点击保存
```

第一版最好控制在两次点击以内。

---

## 2. 产品定位

这不是普通的书签插件，而是一个带 AI 整理能力的“互联网藏宝库”。

传统书签通常只保存：

```text
标题
网址
文件夹
```

本项目需要保存：

```text
标题
网址
AI 摘要
用户备注
标签
正文快照
用户选中的文字
```

后续可以逐步扩展为：

- 相似网站推荐
- 重复收藏检测
- 每周随机回顾
- 兴趣专题自动生成
- 网站关系图谱
- Markdown 导出
- Notion、Obsidian、飞书同步
- 基于收藏内容的对话问答

---

## 3. 推荐技术栈

### 3.1 浏览器插件

```text
WXT
React
TypeScript
Chrome Manifest V3
Chrome Side Panel API
```

推荐使用 WXT，而不是手工维护 Manifest V3 工程。

原因：

- 支持 React 和 TypeScript
- 支持 Chrome、Edge 等浏览器
- 开发和打包流程更顺畅
- 适合管理 Side Panel、Background、Options 等多个入口
- 后续发布到浏览器应用商店更方便

### 3.2 数据存储

**不引入后端和数据库。** 所有数据保存在浏览器本地：

```text
browser.storage.local
```

存储内容：

- 收藏记录（web clip）
- 对话记录（后续版本）
- 用户设置（含 DeepSeek API Key）
- 草稿和缓存

### 3.3 AI 接入

统一走 **OpenAI 兼容接口**（`POST /chat/completions`），内置多个供应商预设，设置页先选供应商再填 Key：

```text
DeepSeek（默认）  https://api.deepseek.com          deepseek-chat / deepseek-reasoner
Kimi（月之暗面）  https://api.moonshot.cn/v1        kimi-latest / moonshot-v1-*
智谱 GLM          https://open.bigmodel.cn/api/paas/v4   glm-4-flash / glm-4-air / glm-4-plus
通义千问          https://dashscope.aliyuncs.com/compatible-mode/v1   qwen-plus / qwen-turbo / qwen-max
OpenAI            https://api.openai.com/v1         gpt-4o-mini / gpt-4o
自定义            任意 OpenAI 兼容地址
```

由于没有后端，AI 调用直接从插件（Side Panel）发起。

API Key 由用户在插件“设置”页自行填写，保存在 `browser.storage.local`，仅在本机使用；各家 Key 不通用，切换供应商后需重新填写。

### 3.4 第一版不建议引入

第一版暂时不要引入：

- 后端服务（Spring Boot 等）
- 数据库（PostgreSQL 等）
- AgentScope-Java
- 多智能体
- 向量数据库
- Elasticsearch
- 消息队列
- 复杂工作流引擎

当前流程是确定性的：

```text
网页采集
→ AI 整理
→ 用户确认
→ 本地保存
```

一个纯前端插件工程足够。

---

## 4. 总体架构

```text
┌──────────────────────────────────┐
│          浏览器插件               │
│                                  │
│  Side Panel                      │
│  - 当前网页信息                   │
│  - 用户备注                       │
│  - AI 整理结果                    │
│  - 保存按钮                       │
│  - 收藏列表 / 搜索                │
│                                  │
│  Background Service Worker       │
│  - 打开侧边栏                     │
│  - 消息转发                       │
│                                  │
│  Page Extractor                  │
│  - 读取当前标签页                 │
│  - 注入网页采集脚本               │
│                                  │
│  Clip Store（本地收藏库）         │
│  - browser.storage.local         │
│  - 收藏 CRUD / 去重 / 搜索        │
│                                  │
│  AI Client                       │
│  - 提示词组装                     │
│  - JSON 解析与校验                │
└────────────────┬─────────────────┘
                 │ HTTPS / JSON
                 ▼
        ┌──────────────────┐
        │  DeepSeek API    │
        │  (OpenAI 兼容)    │
        └──────────────────┘
```

---

## 5. 用户操作流程

### 5.1 收藏当前网页

```text
1. 用户打开一个网页
2. 点击浏览器插件图标，右侧打开 Side Panel（默认进入对话视图）
3. 点击头部 ☆ 进入“收藏当前网页”视图，自动显示：
   - 页面标题
   - 域名
   - 网站图标
   - 当前网址
4. 用户可填写收藏理由（可选）
5. 点击“整理”：插件读取标题、描述、canonical URL、选中文字、主要正文，
   调用 AI 生成摘要和标签
6. 用户可修改结果，或点击“重新整理”
7. 同一按钮变为“收藏”，点击后完成去重并写入 browser.storage.local
8. 已收藏过的网页给出“更新原收藏”选项
```

### 5.2 查询收藏

```text
1. 用户进入“我的收藏”
2. 支持按以下条件查询（在本地数据中过滤）：
   - 关键词（标题 / 域名 / 摘要 / 标签）
   - 标签筛选
3. 点击收藏项查看详情
4. 支持打开原网页
5. 支持修改或删除
```

### 5.3 针对网页继续提问

已实现（对话记录保存在 `browser.storage.local`，支持流式回复、Markdown 渲染、页面元素选取和对话内切换模型）：

```text
这个网站为什么让人上瘾？
它有哪些产品设计值得借鉴？
这个网站和我之前收藏的哪些网站相似？
帮我提炼三个可落地的产品创意。
```

---

## 6. 插件页面设计

侧边栏以对话为主视图，其余功能通过头部图标切换（各视图保持挂载、切换显示以保留状态）；设置为独立 Options 页。

头部图标（自左向右）：＋ 新对话、历史对话、☆ 收藏当前网页、我的收藏、设置。

### 6.1 对话（主视图）

- 围绕当前网页或某条收藏提问，流式回复，气泡支持 Markdown（GFM）
- 会话上下文在首条消息时固化（页面快照或收藏内容）
- 输入卡片：上方输入域（Enter 发送 / Shift+Enter 换行），卡片脚左下角为模型选择（当前供应商的可选模型），右下角为发送 / 停止、选取页面元素按钮
- 元素选取：类 F12 拾取器，悬停高亮页面元素，点击选取，文本（≤3000 字）随下一条消息发送

### 6.2 历史对话

- 会话列表：标题、类型（网页对话 / 收藏对话）、消息数、更新时间
- 标题搜索、删除、点击打开继续对话

### 6.3 收藏当前网页

- 显示当前网页标题、域名、favicon、网址
- 填写收藏理由（可选，作为 AI 整理参考）
- 单按钮流程：整理 → 收藏 → 已收藏；结果卡片支持“重新整理”
- AI 结果（摘要 + 标签）可编辑；重复收藏时提示“更新原收藏”

### 6.4 我的收藏

- 收藏列表：favicon、标题、域名、日期、摘要（折叠两行）、标签
- 关键词搜索 + 标签筛选
- 展开卡片：编辑备注和标签、打开网页、发起对话、删除

### 6.5 设置（Options 页）

- AI 模型：供应商 → API Key → 模型 → Base URL（选择供应商后自动填好 Base URL 和默认模型，Key 需重新填写）
- 网页采集：是否包含选中文字；隐私说明
- 数据管理：导出 / 导入收藏 JSON

---

## 7. 插件工程结构

当前目录（工程位于仓库根目录）：

```text
PageTrove/
├─ entrypoints/
│  ├─ background.ts
│  ├─ sidepanel/             # index.html / main.tsx / App.tsx / style.css
│  └─ options/               # index.html / main.tsx / App.tsx
├─ components/
│  ├─ ChatView.tsx           # 对话主视图
│  ├─ ChatHistoryView.tsx    # 历史对话
│  ├─ CurrentPageView.tsx    # 收藏当前网页
│  ├─ ClipListView.tsx       # 我的收藏
│  └─ AnalyzeResultEditor.tsx
├─ hooks/
│  └─ useCurrentTab.ts
├─ services/
│  ├─ page-extractor.ts      # 网页采集
│  ├─ element-picker.ts      # 页面元素选取
│  ├─ deepseek-client.ts     # AI 客户端（整理 + 流式对话，OpenAI 兼容）
│  ├─ clip-store.ts          # 收藏存储
│  ├─ chat-store.ts          # 对话存储
│  ├─ settings-store.ts      # 设置存储（含旧字段迁移）
│  └─ url-utils.ts
├─ types/                    # page-snapshot / clip / chat / ai / settings
├─ utils/
│  └─ errors.ts
├─ public/icon/              # 16 / 32 / 48 / 96 / 128
├─ scripts/resize-icon.ps1   # 图标裁剪缩放脚本
├─ wxt.config.ts
├─ package.json
└─ tsconfig.json
```

---

## 8. 插件权限

当前权限配置：

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  manifest: {
    name: '拾页',
    description: '记录、整理和回顾有趣的网站',
    version: '0.1.0',

    permissions: [
      'activeTab',
      'scripting',
      'storage',
      'tabs',
      'sidePanel',
    ],

    host_permissions: [
      '<all_urls>',
      'https://api.deepseek.com/*',
    ],

    action: {
      default_title: '打开网站藏宝库',
    },
  },
});
```

权限用途：

| 权限                          | 用途                                 |
| ----------------------------- | ------------------------------------ |
| `activeTab`                   | 用户主动点击插件后，临时访问当前页面 |
| `scripting`                   | 向当前标签页注入网页采集脚本         |
| `storage`                     | 保存收藏、对话记录、设置和缓存       |
| `tabs`                        | 获取当前标签页标题、URL、favicon     |
| `sidePanel`                   | 使用 Chrome Side Panel API           |
| `<all_urls>`                  | 在任意网页注入采集脚本（见下方说明） |
| `https://api.deepseek.com/*`  | 调用 DeepSeek 接口（其余供应商由 `<all_urls>` 覆盖） |

关于 `<all_urls>`：`activeTab` 只在"点击扩展图标那一刻"授予当前标签页权限，侧边栏常驻打开后，用户切换标签或跳转页面，再点击面板内的"整理"按钮时（不算 activeTab 手势），脚本注入会被浏览器拒绝。因此剪藏类插件需要在安装时申请 `<all_urls>`。插件承诺只在用户主动点击时才注入采集脚本。

---

## 9. Side Panel 打开方式

`entrypoints/background.ts`：

```ts
export default defineBackground(() => {
  browser.sidePanel
    .setPanelBehavior({
      openPanelOnActionClick: true,
    })
    .catch((error) => {
      console.error('设置侧边栏失败：', error);
    });
});
```

注意：

Manifest V3 的 Background 是 Service Worker，可能随时被浏览器回收。

不要在 Background 中使用全局变量保存重要数据。

需要持久化的数据应保存到：

- `browser.storage.local`
- IndexedDB（数据量大时）

---

## 10. 网页采集模型

### 10.1 PageSnapshot

```ts
export interface PageSnapshot {
  url: string;
  canonicalUrl?: string;
  normalizedUrl?: string;

  title: string;
  description?: string;
  domain: string;
  favicon?: string;

  selectedText?: string;
  mainText?: string;

  author?: string;
  publishedAt?: string;
  language?: string;

  collectedAt: string;
}
```

### 10.2 页面采集实现

`services/page-extractor.ts`：

```ts
import type { PageSnapshot } from '@/types/page-snapshot';

export async function extractCurrentPage(): Promise<PageSnapshot> {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab.id || !tab.url) {
    throw new Error('无法获取当前网页');
  }

  if (isUnsupportedUrl(tab.url)) {
    throw new Error('浏览器内部页面不支持采集');
  }

  const results = await browser.scripting.executeScript({
    target: {
      tabId: tab.id,
    },

    func: () => {
      const getMeta = (
        ...selectors: string[]
      ): string | undefined => {
        for (const selector of selectors) {
          const element = document.querySelector(selector);

          const value =
            element?.getAttribute('content') ??
            element?.getAttribute('href') ??
            element?.getAttribute('datetime') ??
            element?.textContent ??
            undefined;

          if (value?.trim()) {
            return value.trim();
          }
        }

        return undefined;
      };

      const selectedText =
        window.getSelection()?.toString().trim() || undefined;

      const mainElement =
        document.querySelector('article') ??
        document.querySelector('main') ??
        document.querySelector('[role="main"]') ??
        document.body;

      const mainText = mainElement.innerText
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 20_000);

      return {
        url: location.href,

        canonicalUrl: getMeta(
          'link[rel="canonical"]',
        ),

        title:
          getMeta(
            'meta[property="og:title"]',
            'meta[name="twitter:title"]',
          ) ?? document.title,

        description: getMeta(
          'meta[name="description"]',
          'meta[property="og:description"]',
          'meta[name="twitter:description"]',
        ),

        domain: location.hostname,

        selectedText,
        mainText,

        author: getMeta(
          'meta[name="author"]',
          'meta[property="article:author"]',
        ),

        publishedAt: getMeta(
          'meta[property="article:published_time"]',
          'time[datetime]',
        ),

        language:
          document.documentElement.lang || undefined,

        collectedAt: new Date().toISOString(),
      };
    },
  });

  const snapshot = results[0]?.result;

  if (!snapshot) {
    throw new Error('网页内容读取失败');
  }

  return {
    ...snapshot,
    favicon: tab.favIconUrl,
  };
}

function isUnsupportedUrl(url: string): boolean {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension://')
  );
}
```

---

## 11. 网页正文抽取原则

第一版不要把整个 DOM 或完整 HTML 发送给模型。

只发送：

```text
标题
网址
页面描述
canonical URL
用户选中文字
主要正文纯文本
用户备注
```

默认不采集：

```text
input 内容
textarea 内容
密码框
Cookie
LocalStorage
SessionStorage
请求头
隐藏元素
完整 HTML
浏览器历史
```

正文建议最大限制：

```text
10,000 ～ 20,000 个字符
```

超出部分截断。

### 11.1 页面内容不足时的兜底方式

某些网站可能无法正常提取正文，例如：

- Figma
- 在线游戏
- Canvas 页面
- 视频站
- SPA 动态页面
- 登录后系统
- 图像为主的网站

需要提供兜底：

1. 用户选中文字后收藏。
2. 用户手动填写备注。
3. 用户主动点击“附加当前页面截图”。
4. 页面信息不足时，AI 返回“信息不足”，不得虚构。

截图功能建议放到后续版本。

---

## 12. 插件状态模型

建议使用简单状态管理。

第一版可以使用：

```text
React useState
React Context
```

数据变复杂后再考虑 Zustand。

示例状态：

```ts
export interface SidePanelState {
  page?: PageSnapshot;
  analysis?: AnalyzeResult;
  note: string;

  extracting: boolean;
  analyzing: boolean;
  saving: boolean;

  error?: string;
}
```

---

## 13. 本地数据模型

### 13.1 收藏 WebClip

```ts
export interface WebClip {
  id: string;                 // uuid

  url: string;
  canonicalUrl?: string;
  normalizedUrl: string;
  domain: string;

  title: string;
  description?: string;
  faviconUrl?: string;

  summary?: string;
  tags: string[];

  userNote?: string;
  selectedText?: string;
  extractedText?: string;     // 正文快照，按固定长度截断

  createdAt: string;          // ISO 时间
  updatedAt: string;
}
```

### 13.2 对话记录 ChatSession（已实现）

```ts
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/** 针对“当前网页”发起对话时固化的页面上下文 */
export interface ChatPageContext {
  title: string;
  url: string;
  content: string;
}

export interface ChatSession {
  id: string;                 // uuid
  clipId?: string;            // 关联的收藏；与 page 二选一
  page?: ChatPageContext;     // 当前网页对话的页面快照
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
```

### 13.3 存储键设计

`browser.storage.local` 按 key 分区：

```text
settings              用户设置（含 API Key）
clips:index           收藏 id 列表 + 轻量索引（标题/域名/标签/时间）
clip:{id}             单条收藏完整数据（含正文快照）
chats:index           对话 id 列表
chat:{id}             单个对话完整数据
```

设计原因：

- `storage.local` 单次读写整个 key，收藏正文较大，拆 key 避免每次全量读写。
- 列表页只需读 `clips:index`，详情页再读 `clip:{id}`。

容量说明：

- `storage.local` 默认约 10MB；正文快照按设置截断。
- 数据量大后可迁移 IndexedDB，第一版不需要。

### 13.4 本地搜索能力

第一版只需要（全部在内存中对索引过滤）：

- 标题模糊搜索
- 域名搜索
- 标签筛选
- 摘要搜索
- 时间排序

暂时不需要向量数据库。

---

## 14. AI 接入设计

### 14.1 请求方式

所有供应商统一使用 OpenAI 兼容接口：

```http
POST {baseUrl}/chat/completions
Authorization: Bearer {API_KEY}
Content-Type: application/json
```

请求体示例：

```json
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "系统提示词" },
    { "role": "user", "content": "用户提示词（含网页快照）" }
  ],
  "response_format": { "type": "json_object" },
  "temperature": 1.0,
  "stream": false
}
```

要点：

- 使用 `response_format: json_object` 强制 JSON 输出。
- 提示词中必须包含 “json” 字样（DeepSeek 对 json_object 的要求）。
- 分析场景不使用流式；对话场景使用 `stream: true`（已实现，SSE 增量渲染）。

### 14.2 AI Client 接口

`services/deepseek-client.ts`：

```ts
export interface AnalyzeResult {
  summary: string;
  tags: string[];
  confidence: number;
}

export async function analyzePage(
  snapshot: PageSnapshot,
  note: string,
  settings: ExtensionSettings,
): Promise<AnalyzeResult>;

/** 流式对话：onDelta 收到累计全文，返回完整回复 */
export async function streamChat(
  ctx: ChatContext,
  history: { role: 'user' | 'assistant'; content: string }[],
  settings: ExtensionSettings,
  onDelta: (fullText: string) => void,
  signal?: AbortSignal,
): Promise<string>;
```

### 14.3 调用位置

建议在 Side Panel 中直接 `fetch` 调用（Side Panel 页面生命周期由用户控制，不易被回收）。需要长任务时再移到 Background。

---

## 15. 本地收藏库操作

`services/clip-store.ts` 提供：

```ts
export interface ClipQuery {
  keyword?: string;
  tag?: string;
  domain?: string;
  sort?: 'createdAt_desc' | 'createdAt_asc';
}

export interface ClipStore {
  create(clip: WebClip): Promise<void>;
  update(id: string, patch: Partial<WebClip>): Promise<void>;
  remove(id: string): Promise<void>;
  get(id: string): Promise<WebClip | undefined>;
  query(query: ClipQuery): Promise<WebClip[]>;
  findByNormalizedUrl(url: string): Promise<WebClip | undefined>;
  exportAll(): Promise<string>;   // JSON
  importAll(json: string): Promise<void>;
}
```

---

## 16. URL 标准化

同一个网页可能出现不同 URL：

```text
https://example.com/page
https://example.com/page/
https://example.com/page?utm_source=twitter
https://example.com/page?utm_campaign=test
```

保存前需要生成 `normalizedUrl`。

建议规则：

1. 优先使用 canonical URL。
2. 域名转小写。
3. 去掉 URL fragment。
4. 删除常见跟踪参数：
   - `utm_source`
   - `utm_medium`
   - `utm_campaign`
   - `utm_term`
   - `utm_content`
   - `fbclid`
   - `gclid`
5. 合理处理尾部 `/`。
6. 保留真正影响内容的业务参数。

示例：

```ts
export function normalizeUrl(
  url: string,
  canonicalUrl?: string,
): string;
```

---

## 17. 重复收藏处理

保存时按以下顺序判断：

```text
1. normalized_url 是否已经存在
2. canonical_url 是否已经存在
3. content_hash 是否重复
```

发现重复时不要直接报错。

前端提示用户：

```text
这个网站之前已经收藏过。

[打开原收藏]
[更新本次备注]
[重新分析]
```

---

## 18. AI 提示词

### 18.1 System Prompt

```text
你是一个“有趣网站收藏整理助手”。

你的任务是根据用户提供的网页快照，整理这个网站值得收藏的原因，并输出结构化 JSON 结果。

要求：

1. 只能依据输入内容，不得虚构网页功能。
2. 如果网页信息不足，应明确体现“信息不足”。
3. 摘要用于让用户快速了解这个收藏：说明网站是什么、有什么内容、为什么值得收藏，控制在100个汉字以内。
4. 标签输出3至5个。
5. 不要复述大段网页原文。
6. 不要输出Markdown。
7. 只输出符合约定结构的JSON。
8. confidence 为0到1之间的小数。
```

### 18.2 User Prompt 模板

```text
请整理下面的网页快照，输出 JSON。

网页标题：
{{title}}

网页地址：
{{url}}

网页描述：
{{description}}

用户选中的内容：
{{selectedText}}

网页正文：
{{mainText}}

用户备注：
{{userNote}}
```

### 18.3 输出 JSON

```json
{
  "summary": "摘要",
  "tags": [
    "标签1",
    "标签2",
    "标签3"
  ],
  "confidence": 0.85
}
```

---

## 19. AI 输出校验

插件端不能直接信任模型返回。

必须进行：

1. JSON 解析。
2. 字段非空校验。
3. 标签数量校验。
4. 字符长度限制。
5. confidence 范围校验。
6. 数组最大数量限制。
7. 输出失败时允许重试一次。
8. 二次失败后返回可识别错误。

建议限制：

```text
summary：最多 200 字符
tags：3 至 5 条，单个最长 20 字符
```

---

## 20. API Key 安全要求

由于没有后端，API Key 由用户自行填写并保存在本机 `browser.storage.local`。

必须做到：

```text
Key 只保存在 browser.storage.local，不使用 sync 存储
Key 不写入代码、不提交 Git、不进入打包产物
Key 不出现在日志和错误信息中
设置页对 Key 做掩码显示
导出收藏数据时不包含 Key
```

需要向用户说明的风险：

```text
API Key 保存在本地浏览器中，仅供本插件调用你配置的 AI 接口使用。
请使用独立的、设置了额度上限的 Key。
```

如果后续需要多设备同步或对外发布，再考虑引入后端代理 Key。

---

## 21. 本地存储设计

插件端使用 `browser.storage.local` 保存：

```ts
export interface ExtensionSettings {
  provider: string;               // deepseek / kimi / zhipu / qwen / openai / custom
  apiKey: string;
  baseUrl: string;                // OpenAI 兼容接口地址
  model: string;

  maxContentLength: number;       // 内部固定默认 12000，不在设置页暴露
  includeSelectedText: boolean;
}
```

可以保存：

- API Key（用户自填，仅本机）
- 用户设置
- 收藏记录
- 对话记录
- 尚未提交的备注草稿
- 最近一次分析结果

不要保存：

- 密码
- 无关的敏感信息

---

## 22. 错误处理

插件端至少处理：

```text
无法获取当前标签页
浏览器内部页面不支持采集
页面脚本无法注入
正文为空
未配置 API Key
DeepSeek 请求失败
DeepSeek 超时
API Key 无效或额度不足
AI 返回格式错误
保存失败
重复收藏
本地存储空间不足
```

统一错误类型：

```ts
export type ErrorCode =
  | 'UNSUPPORTED_PAGE'
  | 'PAGE_EXTRACT_FAILED'
  | 'EMPTY_CONTENT'
  | 'MISSING_API_KEY'
  | 'NETWORK_ERROR'
  | 'AI_UNAUTHORIZED'
  | 'AI_ANALYZE_FAILED'
  | 'INVALID_AI_RESPONSE'
  | 'DUPLICATE_CLIP'
  | 'STORAGE_FULL'
  | 'SAVE_FAILED';
```

---

## 23. 隐私设计

插件界面需要明确说明：

```text
插件只会在用户主动点击“整理”时读取页面内容。
默认不会读取输入框、密码、Cookie 或本地存储。
页面内容只会发送给用户自己配置的 AI 接口，用于生成整理结果。
所有收藏数据只保存在本机浏览器中。
```

当前提供的开关：

```text
[x] 包含当前选中文字
```

截图功能未实现（默认不做）。

---

## 24. 分阶段实施计划

### V0：纯本地版（已完成）

目标：验证交互是否舒服。

功能：

- 点击图标打开 Side Panel
- 获取当前网页标题、URL、favicon
- 用户填写备注
- 保存到 `browser.storage.local`
- 展示本地收藏列表
- 删除收藏

暂不需要：

- AI

验收标准：

```text
用户可以在任意普通网页中打开插件，
填写备注并完成本地收藏。
```

### V1：AI 整理版（已完成，后续迭代有调整）

功能：

- 设置页配置 API Key（已扩展为多供应商）
- 网页正文抽取
- AI 自动摘要
- AI 自动标签
- AI 输出 JSON 解析与校验
- 收藏查询（关键词 / 标签）
- URL 标准化与重复收藏检测
- 导出 / 导入 JSON

> 迭代调整：移除“好玩的地方 / 值得借鉴 / 分类”，AI 结果只保留摘要和标签；“整理”和“收藏”合并为单按钮流程。

验收标准：

```text
用户点击一次分析，
可以获得结构化结果，
修改后成功保存到本地收藏库。
```

### V2：网页对话版（已完成）

功能：

- 针对当前网页提问
- 针对已收藏网页提问
- 对话引用原网页内容
- 对话历史保存在 browser.storage.local
- 流式回复 + Markdown 气泡
- 页面元素选取（类 F12 拾取器）
- 对话内切换模型
- 历史对话标题搜索

验收标准：

```text
用户可以针对某个收藏持续提问，
并得到基于网页内容的回答，
对话记录可以在本地查看。
```

### V3：智能藏宝库（暂缓）

功能：

- 相似网站推荐
- 语义搜索
- 自动专题
- 每周回顾
- 随机发现
- 收藏关系图谱
- Markdown 导出
- 第三方同步（可能需要引入后端）

---

## 25. 第一阶段任务拆分

建议 Claude Code 按以下顺序实现。

### 任务 1：初始化插件工程

- 创建 WXT + React + TypeScript 工程
- 配置 Side Panel
- 配置 Background
- 配置 Manifest 权限
- 确保点击扩展图标可以打开侧边栏

### 任务 2：读取当前标签页

- 获取 URL
- 获取标题
- 获取 favicon
- 获取域名
- 处理浏览器内部页面

### 任务 3：实现网页正文提取

- 获取 meta description
- 获取 canonical URL
- 获取选中文字
- 获取 article/main/body 主要文本
- 截断最大长度
- 过滤空白字符

### 任务 4：实现纯本地收藏

- 定义 WebClip 模型和存储键
- 实现 ClipStore（基于 browser.storage.local）
- 展示收藏列表
- 删除收藏
- URL 标准化
- 防止 URL 重复保存

### 任务 5：实现设置页

- DeepSeek API Key 配置（掩码显示）
- 模型和 Base URL 配置
- 正文抽取相关开关
- 清理本地缓存

### 任务 6：接入 DeepSeek 分析

- 实现 deepseek-client
- 实现提示词模板
- 使用 response_format: json_object
- 实现 JSON 解析和校验
- 失败重试一次

### 任务 7：完善收藏管理

- 编辑 AI 结果后保存
- 修改收藏
- 关键词 / 标签 / 分类 / 域名搜索
- 重复收藏检测与提示
- 导出 / 导入 JSON

### 任务 8：补充测试

- URL 标准化测试
- AI 输出解析测试
- ClipStore 测试
- 页面抽取函数测试
- 插件端基本交互测试

---

## 26. 第一版完成定义

第一版已全部完成：

- [x] Chrome 和 Edge 可以加载插件
- [x] 点击插件图标打开右侧栏
- [x] 可以读取当前网页标题、URL、favicon
- [x] 可以获取用户选中文字
- [x] 可以抽取主要正文
- [x] 可以填写用户备注
- [x] 可以在设置页配置 API Key（多供应商）
- [x] 可以调用 AI 完成分析
- [x] AI 返回结构化 JSON 并通过校验
- [x] 用户可以修改分析结果
- [x] 可以保存到 browser.storage.local
- [x] 可以查询收藏列表
- [x] 可以删除收藏
- [x] 可以处理重复 URL
- [x] 浏览器内部页面有友好提示
- [x] 各类错误有清晰提示
- [x] API Key 不进入代码仓库、日志和导出数据

---

## 27. Claude Code 项目执行提示词（历史存档）

项目初始实施时使用的提示词，现已完成，仅作记录。

```text
你是一名高级前端工程师，请帮助我实现一个“网站藏宝库”浏览器插件项目。

技术栈：

- WXT
- React
- TypeScript
- Chrome Manifest V3
- Chrome Side Panel API

数据与 AI：

- 不引入任何后端和数据库
- 收藏和对话记录全部保存在 browser.storage.local
- AI 使用 DeepSeek（OpenAI 兼容接口），API Key 由用户在设置页填写

项目目标：

用户浏览网页时，点击浏览器插件图标，右侧打开 Side Panel。
用户可以读取当前网页，填写备注，调用 DeepSeek 自动生成网站摘要、好玩的地方、值得借鉴的内容、标签和分类，确认后保存到本地收藏库。

请严格按照仓库中的 README 实施。

开发要求：

1. 先阅读完整方案，再开始编码。
2. 不要一次性实现所有功能。
3. 按阶段拆分任务，每完成一个阶段就执行构建和测试。
4. 优先完成 V0 纯本地版本，再实现 V1 AI 整理。
5. 不要引入未要求的复杂框架和后端。
6. API Key 只保存在 browser.storage.local，不进入代码和打包产物。
7. 使用 activeTab 和 scripting 读取当前网页。
8. 需要申请 <all_urls> 主机权限（侧边栏内点击按钮不授予 activeTab），但只在用户主动点击时注入脚本。
9. 页面采集不得读取密码框、Cookie、LocalStorage 和输入框内容。
10. 所有 TypeScript 开启严格模式。
11. AI 输出必须进行 JSON 解析和字段校验。
12. 每个阶段完成后更新 README 中的进度和启动方式。

请先执行以下内容：

第一阶段：
- 初始化 WXT + React + TypeScript 插件工程
- 创建 Side Panel
- 创建 Background Service Worker
- 配置 Manifest 权限
- 实现点击扩展图标打开 Side Panel
- 在 Side Panel 中显示当前网页标题、URL、域名和 favicon
- 对 chrome://、edge://、about: 等页面给出友好错误提示
- 完成后执行构建检查
- 输出本阶段新增文件、主要实现和验证方式

在我确认第一阶段之后，再继续下一阶段。
```

---

## 28. 推荐仓库结构

WXT 插件工程直接放在仓库根目录：

```text
PageTrove/
├─ entrypoints/
├─ components/
├─ services/
├─ types/
├─ wxt.config.ts
├─ package.json
├─ .gitignore
└─ README.md
```

---

## 29. 本地开发环境

建议准备：

```text
Node.js 22
pnpm
Chrome 或 Edge
任一支持供应商的 API Key（默认 DeepSeek：https://platform.deepseek.com）
```

---

## 30. 后续可扩展方向

当收藏数据积累后，可以增加：

### 30.1 语义搜索

例如：

```text
找出我收藏过的桌宠相关网站
找几个适合摸鱼的小游戏
找出视觉交互很有意思的网站
```

### 30.2 每周回顾

自动生成：

```text
本周收藏了 12 个网站
其中 5 个属于 AI 工具
3 个属于设计灵感
最值得重新访问的是……
```

### 30.3 自动专题

例如：

```text
桌宠设计灵感
有趣的小游戏
小红书风格设计参考
AI 工作流工具
适合消磨时间的网站
```

### 30.4 相似网站发现

基于：

- 标签
- 摘要
- 用户备注
- 域名类型
- 用户打开频率

### 30.5 引入后端的时机

出现以下需求时再考虑引入后端和数据库：

- 多设备同步
- 对外发布（不方便让用户自带 Key）
- 大量数据的全文 / 语义搜索
- 多用户共享藏宝库

第一版不需要。

---

## 31. 结论

最合适的落地路径是：

```text
V0：浏览器侧边栏 + 本地收藏            ✅ 已完成
V1：AI 整理（摘要 + 标签）+ 本地收藏库  ✅ 已完成
V2：网页对话（对话记录本地保存）        ✅ 已完成
V3：语义搜索、相似推荐和自动专题        ⏸ 暂缓
```

第一阶段不要追求“大而全”。

先确保下面这个动作足够顺畅：

```text
看到一个好玩的网站
→ 点击插件
→ 自动读取
→ 写一句备注
→ 保存
```

当这个核心动作真正好用后，再逐步加入 AI、搜索、对话和智能推荐。
