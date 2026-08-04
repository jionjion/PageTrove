import {useState} from 'react';
import {Alert, Button, Checkbox, Input, Popconfirm, Select, Space, Switch, Tag, Typography,} from 'antd';
import {ApiOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined,} from '@ant-design/icons';
import type {McpServerSettings} from '@/types/settings';
import {listMcpTools, type McpConnectionTestResult,} from '@/services/mcp-client';

interface Props {
  value: McpServerSettings[];
  onChange: (servers: McpServerSettings[]) => void;
}

interface TestState {
  loading?: boolean;
  error?: string;
  result?: McpConnectionTestResult;
}

export function McpSettings({value, onChange}: Props) {
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  const updateServer = (id: string, patch: Partial<McpServerSettings>) => {
    onChange(value.map((server) => (server.id === id ? {...server, ...patch} : server)));
  };

  const addServer = () => {
    const server: McpServerSettings = {
      id: crypto.randomUUID(),
      name: `MCP 服务 ${value.length + 1}`,
      url: '',
      transport: 'streamable-http',
      enabled: true,
      disabledTools: [],
    };
    onChange([...value, server]);
  };

  const removeServer = (id: string) => {
    onChange(value.filter((server) => server.id !== id));
    setTestStates((current) => {
      const next = {...current};
      delete next[id];
      return next;
    });
  };

  const testServer = async (server: McpServerSettings) => {
    setTestStates((current) => ({
      ...current,
      [server.id]: {loading: true},
    }));
    try {
      const result = await listMcpTools(server, false);
      setTestStates((current) => ({
        ...current,
        [server.id]: {result},
      }));
    } catch (error) {
      setTestStates((current) => ({
        ...current,
        [server.id]: {
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  const toggleTool = (server: McpServerSettings, toolName: string, enabled: boolean) => {
    const disabled = new Set(server.disabledTools);
    if (enabled) disabled.delete(toolName);
    else disabled.add(toolName);
    updateServer(server.id, {disabledTools: [...disabled]});
  };

  return (
    <Space direction="vertical" size={12} style={{display: 'flex'}}>
      {value.map((server) => {
        const state = testStates[server.id];
        return (
          <div className="mcp-server" key={server.id}>
            <div className="mcp-server-title">
              <ApiOutlined/>
              <Input
                value={server.name}
                placeholder="服务名称"
                onChange={(event) =>
                  updateServer(server.id, {name: event.target.value})
                }
              />
              <Switch
                checked={server.enabled}
                checkedChildren="启用"
                unCheckedChildren="停用"
                onChange={(enabled) => updateServer(server.id, {enabled})}
              />
              <Popconfirm
                title="删除这个 MCP 服务？"
                onConfirm={() => removeServer(server.id)}
              >
                <Button type="text" danger icon={<DeleteOutlined/>}/>
              </Popconfirm>
            </div>

            <Typography.Text strong className="options-section-label">服务地址</Typography.Text>
            <Input
              value={server.url}
              placeholder="https://example.com/mcp"
              onChange={(event) =>
                updateServer(server.id, {url: event.target.value})
              }
            />

            <Typography.Text strong className="options-section-label">传输协议</Typography.Text>
            <Select
              style={{width: '100%'}}
              value={server.transport}
              onChange={(transport) => updateServer(server.id, {transport})}
              options={[
                {value: 'streamable-http', label: 'Streamable HTTP'},
                {value: 'sse', label: 'SSE（旧版）'},
              ]}
            />

            <Typography.Text strong className="options-section-label">
              Bearer Token（可选）
            </Typography.Text>
            <Input.Password
              autoComplete="off"
              value={server.bearerToken}
              placeholder="只保存在本机"
              onChange={(event) =>
                updateServer(server.id, {bearerToken: event.target.value})
              }
            />

            <Typography.Text strong className="options-section-label">
              自定义请求头 JSON（可选）
            </Typography.Text>
            <Input.TextArea
              autoSize={{minRows: 2, maxRows: 5}}
              value={server.headersJson}
              placeholder={'{"X-API-Key":"..."}'}
              onChange={(event) =>
                updateServer(server.id, {headersJson: event.target.value})
              }
            />

            <div className="mcp-test-row">
              <Button
                size="small"
                icon={<ReloadOutlined/>}
                loading={state?.loading}
                disabled={!server.url.trim()}
                onClick={() => void testServer(server)}
              >
                测试连接并读取工具
              </Button>
              {state?.result && (
                <Tag color="success">
                  {state.result.transport === 'streamable-http'
                    ? 'Streamable HTTP'
                    : 'SSE'}
                  {' · '}
                  {state.result.tools.length} 个工具
                </Tag>
              )}
            </div>

            {state?.error && (
              <Alert type="error" showIcon title={state.error}/>
            )}

            {state?.result && (
              <div className="mcp-tool-list">
                {state.result.tools.length === 0 ? (
                  <Typography.Text type="secondary">
                    服务连接成功，但没有声明工具。
                  </Typography.Text>
                ) : (
                  state.result.tools.map((tool) => (
                    <Checkbox
                      key={tool.name}
                      checked={!server.disabledTools.includes(tool.name)}
                      onChange={(event) =>
                        toggleTool(server, tool.name, event.target.checked)
                      }
                    >
                      <span className="mcp-tool-name">{tool.name}</span>
                      {tool.description && (
                        <span className="mcp-tool-description">
                          {tool.description}
                        </span>
                      )}
                    </Checkbox>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      <Button type="dashed" icon={<PlusOutlined/>} block onClick={addServer}>
        添加 MCP 服务
      </Button>
    </Space>
  );
}