import {useEffect, useRef, useState} from 'react';
import {App as AntApp, AutoComplete, Button, Checkbox, Input, Menu, Modal, Select, Space, Switch, Typography,} from 'antd';
import {ApiOutlined, CloudDownloadOutlined, CloudUploadOutlined, DatabaseOutlined, DownloadOutlined, RobotOutlined, UserOutlined,} from '@ant-design/icons';
import {DEFAULT_SETTINGS, type ExtensionSettings, getModelCapabilities, modelCapabilityKey, PROVIDERS,} from '@/types/settings';
import {getSettings, saveSettings} from '@/services/settings-store';
import {getClipsByIds, queryClips} from '@/services/clip-store';
import {downloadClipsArchive} from '@/services/obsidian-export';
import {exportBackup, importBackup, previewBackup, type BackupPreview, type ImportStrategy} from '@/services/backup';
import {toErrorMessage} from '@/utils/errors';
import {McpSettings} from '@/components/McpSettings';
import {DataStatsPanel} from '@/components/DataStatsPanel';
import {validateMcpServer} from '@/services/mcp-client';

import iconUrl from '/icon/48.png';

const Label = ({ children, style }: { children: string; style?: React.CSSProperties }) => (
  <Typography.Text strong className="options-section-label" style={style}>
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
  const [section, setSection] = useState('profile');

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

  const [obsidianIncludeContent, setObsidianIncludeContent] = useState(true);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);
  const [backupFile, setBackupFile] = useState<ArrayBuffer | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);

  const handleObsidianExport = async () => {
    try {
      const index = await queryClips();
      if (index.length === 0) {
        message.warning('没有可导出的收藏');
        return;
      }
      const clips = await getClipsByIds(index.map((entry) => entry.id));
      downloadClipsArchive(clips, { includeContent: obsidianIncludeContent });
    } catch (e) {
      message.error(toErrorMessage(e) || '生成 Obsidian 文件失败');
    }
  };

  const handleBackupExport = async () => {
    try {
      await exportBackup();
      message.success('备份文件已下载');
    } catch (e) {
      message.error(toErrorMessage(e));
    }
  };

  const handleBackupFileSelect = async (file: File) => {
    try {
      setBackupLoading(true);
      const buffer = await file.arrayBuffer();
      const preview = await previewBackup(buffer);
      setBackupFile(buffer);
      setBackupPreview(preview);
    } catch (e) {
      message.error(toErrorMessage(e));
    } finally {
      setBackupLoading(false);
    }
  };

  const handleBackupImport = async (strategy: ImportStrategy) => {
    if (!backupFile) return;
    try {
      setBackupLoading(true);
      const result = await importBackup(backupFile, strategy);
      const parts: string[] = [];
      if (result.clips.imported > 0) parts.push(`收藏 ${result.clips.imported} 条`);
      if (result.chats.imported > 0) parts.push(`会话 ${result.chats.imported} 条`);
      if (result.settingsRestored) parts.push('设置已恢复');
      if (parts.length > 0) {
        message.success(`恢复成功：${parts.join('，')}`);
      } else {
        message.info('没有需要恢复的新数据');
      }
    } catch (e) {
      message.error(toErrorMessage(e));
    } finally {
      setBackupLoading(false);
      setBackupPreview(null);
      setBackupFile(null);
    }
  };

  const menuItems = [
    { key: 'profile', icon: <UserOutlined />, label: '个人中心' },
    { key: 'model', icon: <RobotOutlined />, label: '模型配置' },
    { key: 'mcp', icon: <ApiOutlined />, label: 'MCP 工具' },
    { key: 'data', icon: <DatabaseOutlined />, label: '数据管理' },
  ];

  const profileSection = (
    <>
      <Typography.Title level={5} className="options-section-title">
        个人中心
      </Typography.Title>
      <DataStatsPanel />
      <Hint>
        所有收藏数据只保存在本机浏览器中，建议前往“数据管理”定期导出备份。
      </Hint>
    </>
  );

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
            当前能力配置对应“{preset?.label ?? settings.provider} / {settings.model || '未选择模型'}”；切换模型后会分别记忆。<br/>
            图片只在你主动截图或选取视觉元素时发送；页面内容不会读取密码、Cookie 或本地存储。
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
        <Typography.Text>
              {settings.mcpVerboseLog ? '详细日志' : '简要日志'}
        </Typography.Text>
        <Switch
          checked={settings.mcpVerboseLog}
          onChange={(checked) => update({ mcpVerboseLog: checked })}
        />
      </Space>
      <Hint>
        开启后显示 MCP 工具调用的详细过程，包括工具名称、参数与返回结果；关闭后只显示本次最终执行了 N 个工具。
      </Hint>
      <Label>MCP 服务</Label>
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
      <Label>备份与恢复</Label>
      <Space style={{ marginTop: 4 }}>
        <Button
          icon={<CloudDownloadOutlined />}
          onClick={() => void handleBackupExport()}
        >
          导出备份
        </Button>
        <Button
          icon={<CloudUploadOutlined />}
          loading={backupLoading}
          onClick={() => backupInputRef.current?.click()}
        >
          从备份恢复
        </Button>
      </Space>
      <input
        ref={backupInputRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleBackupFileSelect(file);
          e.target.value = '';
        }}
      />
      <Hint>
        所有数据只保存在本机浏览器中，建议定期备份。<br/>
        备份包含全部收藏、聊天记录和设置（不含 API Key）。
      </Hint>


      <Label style={{ marginTop: 20 }}>导出为 Obsidian</Label>
      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
        <Checkbox
          checked={obsidianIncludeContent}
          onChange={(e) => setObsidianIncludeContent(e.target.checked)}
        >
          包含采集正文
        </Checkbox>
        <div>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => void handleObsidianExport()}
          >
            导出为 Obsidian ZIP
          </Button>
        </div>
      </Space>
      <Hint>
        生成 Obsidian 兼容的 Markdown 文件（含索引），完全在本机生成。
      </Hint>

      <Modal
        title="确认恢复备份"
        open={backupPreview !== null}
        onCancel={() => { setBackupPreview(null); setBackupFile(null); }}
        footer={[
          <Button key="cancel" onClick={() => { setBackupPreview(null); setBackupFile(null); }}>
            取消
          </Button>,
          <Button
            key="merge"
            type="primary"
            loading={backupLoading}
            onClick={() => void handleBackupImport('merge')}
          >
            合并导入
          </Button>,
          <Button
            key="overwrite"
            danger
            loading={backupLoading}
            onClick={() => void handleBackupImport('overwrite')}
          >
            覆盖恢复
          </Button>,
        ]}
      >
        {backupPreview && (
          <Space direction="vertical" size={4}>
            <Typography.Text>
              备份时间：{new Date(backupPreview.manifest.exportedAt).toLocaleString()}
            </Typography.Text>
            <Typography.Text>收藏：{backupPreview.clipCount} 条（冲突 {backupPreview.clipConflicts} 条）</Typography.Text>
            <Typography.Text>会话：{backupPreview.chatCount} 条（冲突 {backupPreview.chatConflicts} 条）</Typography.Text>
            {backupPreview.hasSettings && <Typography.Text>包含设置配置</Typography.Text>}
            <Typography.Text type="secondary" style={{ marginTop: 8 }}>
              合并：保留现有数据，仅添加新内容；覆盖：清空现有数据后写入备份。
            </Typography.Text>
          </Space>
        )}
      </Modal>
    </>
  );

  const sections: Record<string, React.ReactNode> = {
    profile: profileSection,
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
          style={{ borderInlineEnd: 'none', background: 'transparent' }}
          selectedKeys={[section]}
          onClick={({ key }) => setSection(key)}
          items={menuItems}
        />
        <div className="options-content">
          <div className="options-content-card">{sections[section]}</div>
          <div className="options-actions">
            <Button
              type="primary"
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
