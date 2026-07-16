import { useEffect, useRef, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Input,
  InputNumber,
  Space,
  Typography,
} from 'antd';
import {
  DownloadOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
} from '@/types/settings';
import { getSettings, saveSettings } from '@/services/settings-store';
import { exportAll, importAll } from '@/services/clip-store';
import { toErrorMessage } from '@/utils/errors';

const Label = ({ children }: { children: string }) => (
  <Typography.Text strong style={{ display: 'block', margin: '10px 0 4px' }}>
    {children}
  </Typography.Text>
);

export default function App() {
  const { message } = AntApp.useApp();
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  const update = (patch: Partial<ExtensionSettings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

  const handleSave = async () => {
    try {
      await saveSettings(settings);
      message.success('设置已保存');
    } catch (e) {
      message.error(toErrorMessage(e));
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
      message.error(toErrorMessage(e));
    }
  };

  const handleImport = async (file: File) => {
    try {
      const count = await importAll(await file.text());
      message.success(`成功导入 ${count} 条收藏（已跳过重复项）`);
    } catch (e) {
      message.error(toErrorMessage(e));
    }
  };

  return (
    <div className="options-page">
      <Typography.Title level={3}>拾页 设置</Typography.Title>

      <Space direction="vertical" size={16} style={{ display: 'flex' }}>
        <Card title="DeepSeek 接口" size="small">
          <Label>API Key</Label>
          <Input.Password
            placeholder="sk-…"
            autoComplete="off"
            value={settings.deepseekApiKey}
            onChange={(e) => update({ deepseekApiKey: e.target.value })}
          />
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
            Key 只保存在本机浏览器（browser.storage.local）中，仅用于本插件调用
            DeepSeek，不会同步到云端，也不会出现在导出数据里。建议使用独立的、设置了额度上限的
            Key。申请地址：platform.deepseek.com
          </Typography.Paragraph>

          <Label>Base URL</Label>
          <Input
            value={settings.deepseekBaseUrl}
            onChange={(e) => update({ deepseekBaseUrl: e.target.value })}
          />

          <Label>模型</Label>
          <Input
            value={settings.model}
            onChange={(e) => update({ model: e.target.value })}
          />
        </Card>

        <Card title="网页采集" size="small">
          <Label>最大正文长度（字符）</Label>
          <InputNumber
            min={1000}
            max={20000}
            step={1000}
            style={{ width: 200 }}
            value={settings.maxContentLength}
            onChange={(value) =>
              update({ maxContentLength: value ?? DEFAULT_SETTINGS.maxContentLength })
            }
          />

          <div style={{ marginTop: 10 }}>
            <Checkbox
              checked={settings.includeSelectedText}
              onChange={(e) => update({ includeSelectedText: e.target.checked })}
            >
              包含当前选中文字
            </Checkbox>
          </div>

          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            插件只会在你主动点击"读取并整理当前网页"时读取页面内容，默认不会读取输入框、密码、Cookie
            或本地存储。页面内容只会发送给你自己配置的 DeepSeek 接口。
          </Typography.Paragraph>
        </Card>

        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={() => void handleSave()}
        >
          保存设置
        </Button>

        <Card title="数据管理" size="small">
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            所有收藏数据只保存在本机浏览器中，建议定期导出备份。
          </Typography.Paragraph>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={() => void handleExport()}>
              导出收藏 JSON
            </Button>
            <Button
              icon={<UploadOutlined />}
              onClick={() => fileInputRef.current?.click()}
            >
              导入收藏 JSON
            </Button>
          </Space>
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
        </Card>
      </Space>
    </div>
  );
}
