# 拾页 (PageTrove)

一款浏览器侧边栏扩展：围绕「当前网页」进行 AI 对话，并把有价值的网页整理、收藏到本地。

## 功能

- **网页对话**：读取当前页面正文，直接向 AI 提问；支持选取页面元素作为上下文，输入框左下角可切换模型
- **历史对话**：会话本地保存，可随时回看、继续
- **收藏网页**：一键「整理」——AI 生成摘要与标签（最多 5 个），确认后收藏；可附收藏理由
- **我的收藏**：关键词 / 标签筛选，支持编辑备注与标签、跳回原网页、针对收藏发起对话
- **多供应商**：DeepSeek / Kimi / 智谱 / 通义千问 / OpenAI / 自定义，均走 OpenAI 兼容接口

## 隐私

- 无后端服务，所有数据（收藏、对话、设置）存于 `browser.storage.local`
- AI 请求由浏览器直连所选供应商，API Key 由用户自行填写、仅保存在本地

## 技术栈

- [WXT](https://wxt.dev/) 0.20 + React 18 + TypeScript
- Ant Design v6
- Chrome MV3 Side Panel（兼容 Edge）

## 开发

```bash
pnpm install        # 安装依赖（postinstall 自动执行 wxt prepare）
pnpm dev            # Chrome 开发模式
pnpm dev:edge       # Edge 开发模式
pnpm compile        # 类型检查
pnpm build          # 生产构建（.output/chrome-mv3）
pnpm zip            # 打包发布 zip
```

首次使用：打开扩展 → 设置页 → 选择供应商（Base URL 与模型自动填好）→ 填入对应 API Key。

## 目录结构

```
├── entrypoints/          # WXT 入口
│   ├── background.ts     # 后台：侧边栏开关等
│   ├── sidepanel/        # 侧边栏主界面（对话/历史/收藏）
│   └── options/          # 设置页
├── components/
│   ├── ChatView.tsx          # AI 对话
│   ├── ChatHistoryView.tsx   # 历史对话列表
│   ├── CurrentPageView.tsx   # 整理并收藏当前网页
│   ├── ClipListView.tsx      # 我的收藏
│   └── AnalyzeResultEditor.tsx # 摘要/标签编辑
├── services/
│   ├── deepseek-client.ts    # AI 客户端（OpenAI 兼容，流式对话 + 结构化整理）
│   ├── page-extractor.ts     # 页面正文提取
│   ├── element-picker.ts     # 页面元素选取
│   ├── clip-store.ts         # 收藏存储
│   ├── chat-store.ts         # 会话存储
│   └── settings-store.ts     # 设置存储（含旧版本迁移）
├── types/                # 类型定义
├── utils/                # 错误信息等
└── public/icon/          # 扩展图标
```
