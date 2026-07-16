export interface ExtensionSettings {
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  model: string;

  maxContentLength: number;
  includeSelectedText: boolean;
  autoExtractContent: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  deepseekApiKey: '',
  deepseekBaseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',

  maxContentLength: 12_000,
  includeSelectedText: true,
  autoExtractContent: true,
};
