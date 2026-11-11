import { useCallback, useEffect, useRef, useState } from 'react';
import { requestModelList } from '@/services/ai/openai-compatible-provider';
import { toErrorMessage } from '@/utils/errors';

interface Options {
  baseUrl: string;
  apiKey: string;
}

export interface ProviderModelList {
  models: string[];
  loading: boolean;
  error?: string;
  /** 向当前供应商查询最新模型列表；Key 或地址为空时跳过。 */
  refresh: () => Promise<void>;
}

const MODEL_LIST_TIMEOUT_MS = 15_000;

/**
 * 按需拉取供应商模型列表（打开下拉框、填完 Key 时触发）。
 * 结果只保留在内存中展示，不写入设置，避免把临时列表当成用户配置。
 */
export function useProviderModels({ baseUrl, apiKey }: Options): ProviderModelList {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // 切换供应商或修改 Key/地址后，旧列表不再可信。
  const credentialSignature = `${baseUrl.trim()}\n${apiKey.trim()}`;
  const signatureRef = useRef(credentialSignature);
  useEffect(() => {
    if (signatureRef.current === credentialSignature) return;
    signatureRef.current = credentialSignature;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setModels([]);
    setError(undefined);
    setLoading(false);
  }, [credentialSignature]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const refresh = useCallback(async () => {
    const trimmedBaseUrl = baseUrl.trim();
    const trimmedKey = apiKey.trim();
    if (!trimmedBaseUrl || !trimmedKey) return;

    // 并发刷新时只保留最后一次请求。
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(undefined);

    try {
      const list = await requestModelList(
        { baseUrl: trimmedBaseUrl, apiKey: trimmedKey },
        MODEL_LIST_TIMEOUT_MS,
        controller.signal,
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      setModels(list);
    } catch (caught) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setModels([]);
      setError(toErrorMessage(caught));
    } finally {
      if (mountedRef.current && controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }, [apiKey, baseUrl]);

  return { models, loading, error, refresh };
}
