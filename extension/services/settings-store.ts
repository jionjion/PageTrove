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
