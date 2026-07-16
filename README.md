# 拾页 PageTrove

> 网站藏宝库浏览器插件：产品与技术实现方案
>
> 面向 Claude Code 的项目实现说明  
> 目标：开发一个浏览器侧边栏插件，在浏览网页时快速读取当前页面、使用 AI 自动整理，并保存到个人“网站藏宝库”。

---

## 1. 项目目标

用户在浏览网页时，点击浏览器插件图标，右侧打开一个侧边栏。

插件需要支持：

1. 读取当前网页的基础信息。
2. 提取用户选中的文字和网页主要正文。
3. 让用户填写“为什么收藏这个网站”。
4. 调用后端 AI 接口，自动生成：
   - 一句话介绍
   - 好玩的地方
   - 值得借鉴的设计或功能
   - 标签
   - 分类
5. 用户确认后保存到个人收藏库。
6. 后续支持查询、编辑、删除、搜索和针对网页继续提问。

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
网站介绍
为什么有趣
值得借鉴的内容
用户备注
标签
分类
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

### 3.2 后端

```text
Java 21
Spring Boot 3.x
Spring Web
Spring Validation
Spring Data JPA 或 MyBatis-Plus
PostgreSQL
Flyway
```

### 3.3 AI 接入

AI 调用统一放在后端，不允许在浏览器插件中保存模型 API Key。

后端可接入：

- 公司内部模型平台
- OpenAI 兼容接口
- 阿里云百炼
- Claude API
- 其他支持结构化 JSON 输出的模型

### 3.4 第一版不建议引入

第一版暂时不要引入：

- AgentScope-Java
- 多智能体
- 向量数据库
- Elasticsearch
- 消息队列
- 微服务
- 复杂工作流引擎

当前流程是确定性的：

```text
网页采集
→ AI 整理
→ 用户确认
→ 保存
```

普通 Spring Boot 单体应用足够。

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
│                                  │
│  Background Service Worker       │
│  - 打开侧边栏                     │
│  - 消息转发                       │
│                                  │
│  Page Extractor                  │
│  - 读取当前标签页                 │
│  - 注入网页采集脚本               │
└────────────────┬─────────────────┘
                 │ HTTPS / JSON
                 ▼
┌──────────────────────────────────┐
│          Spring Boot 后端         │
│                                  │
│  ClipController                  │
│  ClipService                     │
│  AiAnalyzeService                │
│  UrlNormalizeService             │
│  SearchService                   │
└────────────────┬─────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌─────────────┐    ┌──────────────┐
│ PostgreSQL  │    │ AI 模型接口   │
└─────────────┘    └──────────────┘
```

---

## 5. 用户操作流程

### 5.1 收藏当前网页

```text
1. 用户打开一个网页
2. 点击浏览器插件图标
3. 浏览器右侧打开 Side Panel
4. 插件自动显示：
   - 页面标题
   - 域名
   - 网站图标
   - 当前网址
5. 用户可填写备注
6. 用户点击“读取并整理当前网页”
7. 插件读取：
   - 页面标题
   - 页面描述
   - canonical URL
   - 当前选中文字
   - 主要正文
8. 插件调用后端分析接口
9. AI 返回结构化整理结果
10. 用户可修改结果
11. 用户点击“保存到藏宝库”
12. 后端完成去重和保存
```

### 5.2 查询收藏

```text
1. 用户进入“我的收藏”
2. 支持按以下条件查询：
   - 关键词
   - 标签
   - 分类
   - 域名
   - 收藏时间
3. 点击收藏项查看详情
4. 支持打开原网页
5. 支持修改或删除
```

### 5.3 针对网页继续提问

后续版本支持：

```text
这个网站为什么让人上瘾？
它有哪些产品设计值得借鉴？
这个网站和我之前收藏的哪些网站相似？
帮我提炼三个可落地的产品创意。
```

---

## 6. 插件页面设计

第一版只做三个页面。

### 6.1 当前网页

功能：

- 显示当前网页标题
- 显示域名和 favicon
- 显示当前网址
- 填写用户备注
- 读取并整理当前网页
- 编辑 AI 结果
- 保存收藏

建议布局：

```text
┌──────────────────────────┐
│ 网站藏宝库                │
├──────────────────────────┤
│ 当前网页                  │
│ [favicon] 网站标题        │
│ example.com               │
│                          │
│ 为什么收藏它？            │
│ ┌──────────────────────┐ │
│ │ 用户备注              │ │
│ └──────────────────────┘ │
│                          │
│ [读取并整理当前网页]       │
├──────────────────────────┤
│ 一句话介绍                │
│ ...                      │
│                          │
│ 好玩的地方                │
│ · ...                    │
│ · ...                    │
│                          │
│ 值得借鉴                  │
│ · ...                    │
│ · ...                    │
│                          │
│ 标签                      │
│ [小游戏] [创意] [摸鱼]    │
│                          │
│ [保存到藏宝库]            │
└──────────────────────────┘
```

### 6.2 我的收藏

功能：

- 收藏列表
- 关键词搜索
- 标签筛选
- 分类筛选
- 域名筛选
- 时间排序
- 打开原网页
- 编辑收藏
- 删除收藏

### 6.3 设置

功能：

- 后端服务地址
- 登录状态
- 是否默认读取正文
- 最大正文长度
- 是否允许附加选中文字
- 隐私说明
- 清理本地缓存

---

## 7. 插件工程结构

建议目录：

```text
web-treasure-extension/
├─ entrypoints/
│  ├─ background.ts
│  ├─ sidepanel/
│  │  ├─ index.html
│  │  ├─ main.tsx
│  │  ├─ App.tsx
│  │  └─ style.css
│  └─ options/
│     ├─ index.html
│     ├─ main.tsx
│     └─ App.tsx
├─ components/
│  ├─ CurrentPageCard.tsx
│  ├─ AnalyzeResultEditor.tsx
│  ├─ TagEditor.tsx
│  ├─ ClipList.tsx
│  ├─ Loading.tsx
│  └─ ErrorMessage.tsx
├─ hooks/
│  ├─ useCurrentTab.ts
│  ├─ useAnalyzePage.ts
│  └─ useExtensionSettings.ts
├─ services/
│  ├─ page-extractor.ts
│  ├─ api-client.ts
│  ├─ storage.ts
│  └─ url-utils.ts
├─ stores/
│  └─ clip-store.ts
├─ types/
│  ├─ page-snapshot.ts
│  ├─ clip.ts
│  └─ api.ts
├─ utils/
│  ├─ errors.ts
│  └─ text.ts
├─ wxt.config.ts
├─ package.json
└─ tsconfig.json
```

---

## 8. 插件权限

建议第一版权限：

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  manifest: {
    name: '网站藏宝库',
    description: '记录、整理和回顾有趣的网站',
    version: '0.1.0',

    permissions: [
      'activeTab',
      'scripting',
      'storage',
      'tabs',
    ],

    optional_host_permissions: [
      'http://*/*',
      'https://*/*',
    ],

    action: {
      default_title: '打开网站藏宝库',
    },
  },
});
```

权限用途：

| 权限                        | 用途                                 |
| --------------------------- | ------------------------------------ |
| `activeTab`                 | 用户主动点击插件后，临时访问当前页面 |
| `scripting`                 | 向当前标签页注入网页采集脚本         |
| `storage`                   | 保存设置、Token、草稿和本地缓存      |
| `tabs`                      | 获取当前标签页标题、URL、favicon     |
| `optional_host_permissions` | 需要长期访问网站时再动态授权         |

尽量不要在安装阶段直接申请 `<all_urls>`。

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
- IndexedDB
- 后端数据库

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

第一版不要上传整个 DOM 或完整 HTML。

只上传：

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

## 13. 后端工程结构

建议目录：

```text
web-treasure-server/
├─ src/main/java/com/example/treasure/
│  ├─ TreasureApplication.java
│  ├─ common/
│  │  ├─ ApiResponse.java
│  │  ├─ BusinessException.java
│  │  ├─ GlobalExceptionHandler.java
│  │  └─ ErrorCode.java
│  ├─ config/
│  │  ├─ CorsConfig.java
│  │  ├─ JacksonConfig.java
│  │  └─ AiClientConfig.java
│  ├─ clip/
│  │  ├─ controller/
│  │  │  └─ ClipController.java
│  │  ├─ service/
│  │  │  ├─ ClipService.java
│  │  │  ├─ AiAnalyzeService.java
│  │  │  ├─ UrlNormalizeService.java
│  │  │  └─ ClipSearchService.java
│  │  ├─ repository/
│  │  │  └─ ClipRepository.java
│  │  ├─ entity/
│  │  │  └─ WebClipEntity.java
│  │  ├─ dto/
│  │  │  ├─ AnalyzeClipRequest.java
│  │  │  ├─ AnalyzeClipResponse.java
│  │  │  ├─ CreateClipRequest.java
│  │  │  ├─ UpdateClipRequest.java
│  │  │  ├─ ClipDetailResponse.java
│  │  │  └─ ClipQueryRequest.java
│  │  └─ mapper/
│  │     └─ ClipMapper.java
│  └─ ai/
│     ├─ AiClient.java
│     ├─ OpenAiCompatibleClient.java
│     └─ model/
│        ├─ ChatRequest.java
│        └─ ChatResponse.java
├─ src/main/resources/
│  ├─ application.yml
│  └─ db/migration/
│     └─ V1__create_web_clip.sql
└─ pom.xml
```

---

## 14. 后端接口设计

### 14.1 分析网页

```http
POST /api/clips/analyze
Content-Type: application/json
```

请求：

```json
{
  "snapshot": {
    "url": "https://example.com",
    "canonicalUrl": "https://example.com",
    "title": "Example",
    "description": "Example website",
    "domain": "example.com",
    "selectedText": "",
    "mainText": "网页正文",
    "language": "zh-CN",
    "collectedAt": "2026-07-16T12:00:00Z"
  },
  "note": "这个网站的交互很有意思"
}
```

响应：

```json
{
  "summary": "一个以创意交互为核心的网站",
  "interestingPoints": [
    "无需复杂学习即可开始体验",
    "交互过程具有较强探索感"
  ],
  "inspiration": [
    "可以借鉴其低学习成本的引导方式",
    "适合作为桌宠互动设计参考"
  ],
  "tags": [
    "创意网站",
    "交互设计",
    "产品灵感"
  ],
  "category": "设计灵感",
  "confidence": 0.91
}
```

### 14.2 保存收藏

```http
POST /api/clips
```

### 14.3 查询收藏

```http
GET /api/clips
```

查询参数：

```text
keyword
tag
category
domain
page
size
sort
```

### 14.4 查看详情

```http
GET /api/clips/{id}
```

### 14.5 修改收藏

```http
PUT /api/clips/{id}
```

### 14.6 删除收藏

```http
DELETE /api/clips/{id}
```

### 14.7 针对收藏继续提问

后续版本：

```http
POST /api/clips/{id}/chat
```

---

## 15. Java DTO 建议

### 15.1 AnalyzeClipRequest

```java
public record AnalyzeClipRequest(
        @NotNull PageSnapshotRequest snapshot,
        @Size(max = 2000) String note
) {
}
```

### 15.2 PageSnapshotRequest

```java
public record PageSnapshotRequest(
        @NotBlank String url,
        String canonicalUrl,
        @NotBlank String title,
        String description,
        @NotBlank String domain,
        String favicon,
        String selectedText,
        String mainText,
        String author,
        String publishedAt,
        String language,
        String collectedAt
) {
}
```

### 15.3 AnalyzeClipResponse

```java
public record AnalyzeClipResponse(
        String summary,
        List<String> interestingPoints,
        List<String> inspiration,
        List<String> tags,
        String category,
        BigDecimal confidence
) {
}
```

---

## 16. 数据库设计

### 16.1 web_clip 表

```sql
create table web_clip (
    id                  bigserial primary key,
    user_id             bigint not null,

    url                 text not null,
    canonical_url       text,
    normalized_url      text not null,
    domain              varchar(255) not null,

    title               text not null,
    description         text,
    favicon_url         text,

    summary             text,
    interesting_points  jsonb not null default '[]'::jsonb,
    inspiration         jsonb not null default '[]'::jsonb,
    tags                jsonb not null default '[]'::jsonb,
    category            varchar(100),

    user_note           text,
    selected_text       text,
    extracted_text      text,

    content_hash        varchar(64),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create unique index uk_web_clip_user_normalized_url
    on web_clip(user_id, normalized_url);

create index idx_web_clip_user_created_at
    on web_clip(user_id, created_at desc);

create index idx_web_clip_domain
    on web_clip(domain);

create index idx_web_clip_category
    on web_clip(category);

create index idx_web_clip_tags_gin
    on web_clip using gin(tags);
```

### 16.2 第一版搜索能力

第一版只需要：

- 标题模糊搜索
- 域名搜索
- 标签筛选
- 分类筛选
- 用户备注搜索
- 时间排序

暂时不需要向量数据库。

---

## 17. URL 标准化

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

```java
public interface UrlNormalizeService {

    String normalize(
            String url,
            String canonicalUrl
    );
}
```

---

## 18. 重复收藏处理

保存时按以下顺序判断：

```text
1. normalized_url 是否已经存在
2. canonical_url 是否已经存在
3. content_hash 是否重复
```

发现重复时不要直接报错。

建议返回：

```json
{
  "duplicate": true,
  "existingClipId": 123,
  "message": "该网页已收藏，可更新备注或重新分析"
}
```

前端提示用户：

```text
这个网站之前已经收藏过。

[打开原收藏]
[更新本次备注]
[重新分析]
```

---

## 19. AI 提示词

### 19.1 System Prompt

```text
你是一个“有趣网站收藏整理助手”。

你的任务是根据用户提供的网页快照，整理这个网站值得收藏的原因，并输出结构化结果。

要求：

1. 只能依据输入内容，不得虚构网页功能。
2. 如果网页信息不足，应明确体现“信息不足”。
3. 一句话介绍不超过50个汉字。
4. 标签输出3至6个。
5. “好玩的地方”关注用户为什么值得收藏。
6. “值得借鉴”关注产品、交互、视觉、内容和创意。
7. 不要复述大段网页原文。
8. 不要输出Markdown。
9. 只输出符合约定结构的JSON。
10. confidence 为0到1之间的小数。
```

### 19.2 User Prompt 模板

```text
请整理下面的网页快照。

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

### 19.3 输出 JSON

```json
{
  "summary": "一句话介绍",
  "interestingPoints": [
    "好玩的地方1",
    "好玩的地方2"
  ],
  "inspiration": [
    "值得借鉴的设计或功能1",
    "值得借鉴的设计或功能2"
  ],
  "tags": [
    "标签1",
    "标签2",
    "标签3"
  ],
  "category": "网站分类",
  "confidence": 0.85
}
```

---

## 20. AI 输出校验

后端不能直接信任模型返回。

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
summary：最多 100 字
interestingPoints：最多 5 条
inspiration：最多 5 条
tags：3 至 6 条
category：最多 50 字
```

---

## 21. API Key 安全要求

禁止：

```text
在浏览器插件代码中保存模型 API Key
在前端请求中直接调用模型供应商
把密钥写入 Git 仓库
把密钥写进打包产物
```

正确方式：

```text
插件
→ Spring Boot
→ AI 服务
```

Spring Boot 使用环境变量：

```yaml
ai:
  base-url: ${AI_BASE_URL}
  api-key: ${AI_API_KEY}
  model: ${AI_MODEL}
```

---

## 22. 本地存储设计

插件端使用 `browser.storage.local` 保存：

```ts
export interface ExtensionSettings {
  apiBaseUrl: string;
  accessToken?: string;
  maxContentLength: number;
  includeSelectedText: boolean;
  autoExtractContent: boolean;
}
```

可以保存：

- 后端地址
- 登录 Token
- 用户设置
- 尚未提交的备注草稿
- 最近一次分析结果

不要保存：

- 模型 API Key
- 密码
- 大量网页正文
- 长期敏感信息

---

## 23. 错误处理

插件端至少处理：

```text
无法获取当前标签页
浏览器内部页面不支持采集
页面脚本无法注入
正文为空
请求后端失败
后端超时
AI 返回格式错误
保存失败
重复收藏
登录失效
```

统一错误类型：

```ts
export type ErrorCode =
  | 'UNSUPPORTED_PAGE'
  | 'PAGE_EXTRACT_FAILED'
  | 'EMPTY_CONTENT'
  | 'NETWORK_ERROR'
  | 'UNAUTHORIZED'
  | 'AI_ANALYZE_FAILED'
  | 'INVALID_AI_RESPONSE'
  | 'DUPLICATE_CLIP'
  | 'SAVE_FAILED';
```

---

## 24. 隐私设计

插件界面需要明确说明：

```text
插件只会在用户主动点击“读取并整理当前网页”时读取页面内容。
默认不会读取输入框、密码、Cookie 或本地存储。
```

建议增加开关：

```text
[x] 读取页面主要正文
[x] 包含当前选中文字
[ ] 附加当前页面截图
```

截图默认关闭。

---

## 25. 分阶段实施计划

### V0：纯本地版

目标：验证交互是否舒服。

功能：

- 点击图标打开 Side Panel
- 获取当前网页标题、URL、favicon
- 用户填写备注
- 保存到 `browser.storage.local`
- 展示本地收藏列表
- 删除收藏

暂不需要：

- 后端
- 数据库
- AI

验收标准：

```text
用户可以在任意普通网页中打开插件，
填写备注并完成本地收藏。
```

### V1：AI 整理版

功能：

- Spring Boot 后端
- PostgreSQL
- 网页正文抽取
- AI 自动摘要
- AI 自动标签
- AI 生成“好玩的地方”
- AI 生成“值得借鉴”
- 数据库存储
- 收藏查询
- 重复收藏检测

验收标准：

```text
用户点击一次分析，
可以获得结构化结果，
修改后成功保存到数据库。
```

### V2：网页对话版

功能：

- 针对当前网页提问
- 针对已收藏网页提问
- 对话引用原网页内容
- 对话历史
- 收藏详情页

验收标准：

```text
用户可以针对某个收藏持续提问，
并得到基于网页内容的回答。
```

### V3：智能藏宝库

功能：

- 相似网站推荐
- 语义搜索
- 自动专题
- 每周回顾
- 随机发现
- 收藏关系图谱
- Markdown 导出
- 第三方同步

---

## 26. 第一阶段任务拆分

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

- 定义本地收藏模型
- 保存到 `browser.storage.local`
- 展示收藏列表
- 删除收藏
- 防止 URL 重复保存

### 任务 5：初始化 Spring Boot

- Java 21
- Spring Boot 3.x
- PostgreSQL
- Flyway
- Validation
- 全局异常处理
- CORS 配置

### 任务 6：实现分析接口

- 定义 DTO
- 定义 AI Client
- 实现提示词模板
- 实现 JSON 解析和校验
- 返回 AnalyzeClipResponse

### 任务 7：实现收藏 CRUD

- 创建收藏
- 查询收藏
- 查看详情
- 修改收藏
- 删除收藏
- URL 标准化
- 重复收藏检测

### 任务 8：插件接入后端

- API Client
- Loading 状态
- 错误提示
- 编辑 AI 结果
- 保存收藏
- 列表查询

### 任务 9：补充测试

- URL 标准化测试
- AI 输出解析测试
- ClipService 测试
- 页面抽取函数测试
- 插件端基本交互测试

---

## 27. 第一版完成定义

第一版完成时，应满足：

- [ ] Chrome 和 Edge 可以加载插件
- [ ] 点击插件图标打开右侧栏
- [ ] 可以读取当前网页标题、URL、favicon
- [ ] 可以获取用户选中文字
- [ ] 可以抽取主要正文
- [ ] 可以填写用户备注
- [ ] 可以调用后端 AI 分析
- [ ] AI 返回结构化 JSON
- [ ] 用户可以修改分析结果
- [ ] 可以保存到 PostgreSQL
- [ ] 可以查询收藏列表
- [ ] 可以删除收藏
- [ ] 可以处理重复 URL
- [ ] 浏览器内部页面有友好提示
- [ ] 后端异常有清晰错误信息
- [ ] 模型 API Key 不出现在插件中

---

## 28. Claude Code 项目执行提示词

下面这段可以直接交给 Claude Code。

```text
你是一名高级全栈工程师，请帮助我实现一个“网站藏宝库”浏览器插件项目。

技术栈：

插件端：
- WXT
- React
- TypeScript
- Chrome Manifest V3
- Chrome Side Panel API

后端：
- Java 21
- Spring Boot 3.x
- PostgreSQL
- Flyway
- Spring Validation
- Spring Data JPA

项目目标：

用户浏览网页时，点击浏览器插件图标，右侧打开 Side Panel。
用户可以读取当前网页，填写备注，调用后端 AI 自动生成网站摘要、好玩的地方、值得借鉴的内容、标签和分类，确认后保存到个人收藏库。

请严格按照仓库中的《网站藏宝库浏览器插件：产品与技术实现方案》实施。

开发要求：

1. 先阅读完整方案，再开始编码。
2. 不要一次性实现所有功能。
3. 按阶段拆分任务，每完成一个阶段就执行构建和测试。
4. 优先完成 V0 纯本地版本，再实现 V1 后端和 AI。
5. 不要引入未要求的复杂框架。
6. 不要在插件端保存模型 API Key。
7. 使用 activeTab 和 scripting 读取当前网页。
8. 不要默认申请 <all_urls>。
9. 页面采集不得读取密码框、Cookie、LocalStorage 和输入框内容。
10. 所有 TypeScript 开启严格模式。
11. Java 代码保持清晰分层。
12. 所有外部输入必须校验。
13. AI 输出必须进行 JSON 解析和字段校验。
14. 数据库变更通过 Flyway 管理。
15. 每个阶段完成后更新 README 中的进度和启动方式。

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

## 29. 推荐仓库结构

可以采用 Monorepo：

```text
web-treasure/
├─ docs/
│  └─ implementation-plan.md
├─ extension/
│  └─ WXT 插件工程
├─ server/
│  └─ Spring Boot 工程
├─ docker/
│  └─ docker-compose.yml
├─ .env.example
├─ .gitignore
└─ README.md
```

---

## 30. 本地开发环境

建议准备：

```text
Node.js 22
pnpm
Java 21
Maven 3.9+
PostgreSQL 16+
Chrome 或 Edge
```

Docker Compose 示例：

```yaml
services:
  postgres:
    image: postgres:16
    container_name: web-treasure-postgres
    environment:
      POSTGRES_DB: web_treasure
      POSTGRES_USER: treasure
      POSTGRES_PASSWORD: treasure
    ports:
      - "5432:5432"
    volumes:
      - web_treasure_data:/var/lib/postgresql/data

volumes:
  web_treasure_data:
```

---

## 31. 后续可扩展方向

当收藏数据积累后，可以增加：

### 31.1 语义搜索

例如：

```text
找出我收藏过的桌宠相关网站
找几个适合摸鱼的小游戏
找出视觉交互很有意思的网站
```

### 31.2 每周回顾

自动生成：

```text
本周收藏了 12 个网站
其中 5 个属于 AI 工具
3 个属于设计灵感
最值得重新访问的是……
```

### 31.3 自动专题

例如：

```text
桌宠设计灵感
有趣的小游戏
小红书风格设计参考
AI 工作流工具
适合消磨时间的网站
```

### 31.4 相似网站发现

基于：

- 标签
- 摘要
- 正文向量
- 用户备注
- 域名类型
- 用户打开频率

### 31.5 使用 AgentScope-Java 的时机

等出现以下复杂需求时再考虑引入：

- 自动研究当前网页
- 自动寻找相关网站
- 多步骤比较多个网站
- 自动建立专题
- 自动定期回顾
- 多工具协同
- 长任务执行
- 人工确认节点

第一版不需要。

---

## 32. 结论

最合适的落地路径是：

```text
V0：浏览器侧边栏 + 本地收藏
V1：Spring Boot + PostgreSQL + AI 整理
V2：网页对话
V3：语义搜索、相似推荐和自动专题
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