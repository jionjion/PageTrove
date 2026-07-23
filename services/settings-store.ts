import { browser } from 'wxt/browser';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
} from '@/types/settings';

const SETTINGS_KEY = 'settings';

/** 旧版本使用的字段名（迁移用） */
interface LegacySettings {
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as
    | (Partial<ExtensionSettings> & LegacySettings)
    | undefined;

  const merged: ExtensionSettings = { ...DEFAULT_SETTINGS, ...stored };
  merged.modelCapabilities =
    stored?.modelCapabilities &&
    typeof stored.modelCapabilities === 'object' &&
    !Array.isArray(stored.modelCapabilities)
      ? Object.fromEntries(
          Object.entries(stored.modelCapabilities)
            .filter(
              ([, capabilities]) =>
                typeof capabilities === 'object' && capabilities !== null,
            )
            .map(([key, capabilities]) => {
              const value = capabilities as unknown as Record<string, unknown>;
              return [
                key,
                { vision: value.vision === true, tools: value.tools === true },
              ];
            }),
        )
      : {};
  merged.mcpServers = Array.isArray(stored?.mcpServers)
    ? stored.mcpServers
        .filter(
          (server) =>
            server &&
            typeof server.id === 'string' &&
            typeof server.name === 'string' &&
            typeof server.url === 'string',
        )
        .map((server) => ({
          ...server,
          transport:
            server.transport === 'streamable-http' || server.transport === 'sse'
              ? server.transport
              : 'streamable-http',
          enabled: server.enabled !== false,
          disabledTools: Array.isArray(server.disabledTools)
            ? server.disabledTools.filter(
                (name): name is string => typeof name === 'string',
              )
            : [],
        }))
    : [];
  // 兼容旧版 deepseek* 字段
  if (!stored?.apiKey && stored?.deepseekApiKey) {
    merged.apiKey = stored.deepseekApiKey;
  }
  if (!stored?.baseUrl && stored?.deepseekBaseUrl) {
    merged.baseUrl = stored.deepseekBaseUrl;
  }
  return merged;
}

export async function saveSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
