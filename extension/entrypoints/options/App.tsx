import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
} from '@/types/settings';
import { getSettings, saveSettings } from '@/services/settings-store';
import { exportAll, importAll } from '@/services/clip-store';
import { toErrorMessage } from '@/utils/errors';

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  const update = (patch: Partial<ExtensionSettings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

  const handleSave = async () => {
    try {
      await saveSettings(settings);
      setMessage({ type: 'success', text: '设置已保存' });
    } catch (e) {
      setMessage({ type: 'error', text: toErrorMessage(e) });
    }
  };

  const handleExport = async () => {
    try {
      const json = await exportAll();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pagetrove-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessage({ type: 'error', text: toErrorMessage(e) });
    }
  };

  const handleImport = async (file: File) => {
    try {
      const count = await importAll(await file.text());
      setMessage({ type: 'success', text: `成功导入 ${count} 条收藏（已跳过重复项）` });
    } catch (e) {
      setMessage({ type: 'error', text: toErrorMessage(e) });
    }
  };

  return (
    <div className="options-page">
      <h1>拾页 PageTrove 设置</h1>

      <h2>DeepSeek 接口</h2>
      <div className="card">
        <label className="field-label" htmlFor="apiKey">
          API Key
        </label>
        <div className="key-row">
          <input
            id="apiKey"
            type={showKey ? 'text' : 'password'}
            placeholder="sk-…"
            autoComplete="off"
            value={settings.deepseekApiKey}
            onChange={(e) => update({ deepseekApiKey: e.target.value })}
          />
          <button className="btn" onClick={() => setShowKey((v) => !v)}>
            {showKey ? '隐藏' : '显示'}
          </button>
        </div>
        <p className="hint">
          Key 只保存在本机浏览器（browser.storage.local）中，仅用于本插件调用
          DeepSeek，不会同步到云端，也不会出现在导出数据里。建议使用独立的、设置了额度上限的
          Key。申请地址：platform.deepseek.com
        </p>

        <label className="field-label" htmlFor="baseUrl">
          Base URL
        </label>
        <input
          id="baseUrl"
          type="text"
          value={settings.deepseekBaseUrl}
          onChange={(e) => update({ deepseekBaseUrl: e.target.value })}
        />

        <label className="field-label" htmlFor="model">
          模型
        </label>
        <input
          id="model"
          type="text"
          value={settings.model}
          onChange={(e) => update({ model: e.target.value })}
        />
      </div>

      <h2>网页采集</h2>
      <div className="card">
        <label className="field-label" htmlFor="maxLen">
          最大正文长度（字符）
        </label>
        <input
          id="maxLen"
          type="number"
          min={1000}
          max={20000}
          step={1000}
          value={settings.maxContentLength}
          onChange={(e) =>
            update({
              maxContentLength: Math.min(
                20_000,
                Math.max(1_000, Number(e.target.value) || 12_000),
              ),
            })
          }
        />

        <div className="checkbox-row">
          <input
            id="includeSelected"
            type="checkbox"
            checked={settings.includeSelectedText}
            onChange={(e) => update({ includeSelectedText: e.target.checked })}
          />
          <label htmlFor="includeSelected">包含当前选中文字</label>
        </div>

        <p className="hint">
          插件只会在你主动点击"读取并整理当前网页"时读取页面内容，默认不会读取输入框、密码、Cookie
          或本地存储。页面内容只会发送给你自己配置的 DeepSeek 接口。
        </p>
      </div>

      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      <button className="btn primary" onClick={() => void handleSave()}>
        保存设置
      </button>

      <h2>数据管理</h2>
      <div className="card">
        <p className="hint">所有收藏数据只保存在本机浏览器中，建议定期导出备份。</p>
        <div className="btn-row">
          <button className="btn" onClick={() => void handleExport()}>
            导出收藏 JSON
          </button>
          <button className="btn" onClick={() => fileInputRef.current?.click()}>
            导入收藏 JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}
