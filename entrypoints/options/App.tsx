import { useEffect, useRef, useState } from 'react';
import {
  App as AntApp,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Input,
  Menu,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import {
  ApiOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  RobotOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  DEFAULT_SETTINGS,
  PROVIDERS,
  getModelCapabilities,
  modelCapabilityKey,
  type ExtensionSettings,
} from '@/types/settings';
import { getSettings, saveSettings } from '@/services/settings-store';
import { exportAll, importAll } from '@/services/clip-store';
import { toErrorMessage } from '@/utils/errors';
import { McpSettings } from '@/components/McpSettings';
import { validateMcpServer } from '@/services/mcp-client';

import iconUrl from '/icon/48.png';

const Label = ({ children }: { children: string }) => (
  <Typography.Text strong className="options-section-label">
    {children}
  </Typography.Text>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
  <Typography.Paragraph type="secondary" className="options-hint">
    {children}
  </Typography.Paragraph>
);

export default function App() {
  const { message } = AntApp.useApp();
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [section, setSection] = useState('model');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  const update = (patch: Partial<ExtensionSettings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

  const preset = PROVIDERS.find((p) => p.id === settings.provider);
  const capabilities = getModelCapabilities(settings);

  const updateCurrentModelCapabilities = (
    patch: Partial<typeof capabilities>,
  ) => {
    const key = modelCapabilityKey(settings.provider, settings.model);
    update({
      modelCapabilities: {
        ...settings.modelCapabilities,
        [key]: { ...capabilities, ...patch },
      },
    });
  };

  const handleProviderChange = (id: string) => {
    const next = PROVIDERS.find((p) => p.id === id);
    if (!next) return;
    update({
      provider: id,
      baseUrl: next.baseUrl,
      model: next.models[0] ?? '',
      apiKey: '',
    });
  };

  const handleSave = async () => {
    try {
      settings.mcpServers
        .filter((server) => server.enabled)
        .forEach(validateMcpServer);
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
      const result = await importAll(await file.text());
      message.success(
        `成功导入 ${result.imported} 条，跳过重复 ${result.duplicates} 条，无效数据 ${result.invalid} 条`,
      );
    } catch (e) {
      message.error(toErrorMessage(e));
    }
  };

  const menuItems = [
    { key: 'model', icon: <RobotOutlined />, label: '模型配置' },
    { key: 'mcp', icon: <ApiOutlined />, label: 'MCP 工具' },
    { key: 'data', icon: <DatabaseOutlined />, label: '数据管理' },
  ];

  const modelSection = (
    <>
      <Typography.Title level={5} className="options-section-title">
        模型配置
      </Typography.Title>
      <Label>供应商</Label>
      <Select
        style={{ width: '100%' }}
        value={settings.provider}
        onChange={handleProviderChange}
        options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
      />
      <Hint>
        先选择供应商，Base URL 和模型会自动填好，再填入对应的 API Key。
      </Hint>

      <Label>API Key</Label>
      <Input.Password
        placeholder="sk-…"
        autoComplete="off"
        value={settings.apiKey}
        onChange={(e) => update({ apiKey: e.target.value })}
      />
      <Hint>
        Key 只保存在本机浏览器（browser.storage.local）中，仅用于本插件调用你选择的
        AI 接口，不会同步到云端，也不会出现在导出数据里。建议使用独立的、设置了额度上限的
        Key。
        <br />
        {preset?.keySite && (
          <>
            申请地址：
            <a
              href={`https://${preset.keySite}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {preset.keySite}
            </a>
          </>
        )}
      </Hint>

      <Label>模型</Label>
      <AutoComplete
        style={{ width: '100%' }}
        placeholder="模型名称"
        value={settings.model}
        onChange={(value) => update({ model: value })}
        options={(preset?.models ?? []).map((m) => ({ value: m }))}
      />

      <Label>Base URL</Label>
      <Input
        placeholder="https://…（OpenAI 兼容接口地址）"
        value={settings.baseUrl}
        onChange={(e) => update({ baseUrl: e.target.value })}
      />

      <Label>网页采集</Label>
      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
        <Checkbox
          checked={settings.includeSelectedText}
          onChange={(e) => update({ includeSelectedText: e.target.checked })}
        >
          包含当前选中文字
        </Checkbox>
        <Checkbox
          checked={capabilities.vision}
          disabled={!settings.model.trim()}
          onChange={(e) =>
            updateCurrentModelCapabilities({ vision: e.target.checked })
          }
        >
          当前模型支持图片输入
        </Checkbox>
        <Checkbox
          checked={capabilities.tools}
          disabled={!settings.model.trim()}
          onChange={(e) =>
            updateCurrentModelCapabilities({ tools: e.target.checked })
          }
        >
          当前模型支持工具调用
        </Checkbox>
      </Space>
      <Hint>
        当前能力配置对应“{preset?.label ?? settings.provider} / {settings.model || '未选择模型'}”。
        切换模型后会分别记忆。图片只在你主动截图或选取视觉元素时发送；页面内容不会读取密码、Cookie
        或本地存储。
      </Hint>
    </>
  );

  const mcpSection = (
    <>
      <Typography.Title level={5} className="options-section-title">
        MCP 工具
      </Typography.Title>
      <Label>执行日志</Label>
      <Space style={{ marginBottom: 8 }}>
        <Switch
          checked={settings.mcpVerboseLog}
          onChange={(checked) => update({ mcpVerboseLog: checked })}
        />
        <Typography.Text>
          {settings.mcpVerboseLog ? '详细日志' : '简要日志'}
        </Typography.Text>
      </Space>
      <Hint>
        开启后显示 MCP 工具调用的详细过程，包括工具名称、参数与返回结果；关闭后只显示本次最终执行了 N 个工具。
      </Hint>
      <McpSettings
        value={settings.mcpServers}
        onChange={(mcpServers) => update({ mcpServers })}
      />
      <Hint>
        仅启用的服务和工具会提供给支持工具调用的当前模型。<br />
        Token 与请求头只保存在本机，不包含在收藏导出中。
      </Hint>
    </>
  );

  const dataSection = (
    <>
      <Typography.Title level={5} className="options-section-title">
        数据管理
      </Typography.Title>
      <Hint>
        所有收藏数据只保存在本机浏览器中，建议定期导出备份。
      </Hint>
      <Space style={{ marginTop: 8 }}>
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
    </>
  );

  const sections: Record<string, React.ReactNode> = {
    model: modelSection,
    mcp: mcpSection,
    data: dataSection,
  };

  return (
    <div className="options-page">
      <header className="options-header">
        <img src={iconUrl} alt="拾页" className="options-header-logo" />
        <Typography.Title level={4} style={{ margin: 0 }}>
          拾页 设置
        </Typography.Title>
      </header>

      <div className="options-body">
        <Menu
          className="options-menu"
          mode="inline"
          selectedKeys={[section]}
          onClick={({ key }) => setSection(key)}
          items={menuItems}
        />
        <div className="options-content">
          <Card size="small" className="options-content-card">
            {sections[section]}
          </Card>
          <div className="options-actions">
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => void handleSave()}
            >
              保存设置
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
