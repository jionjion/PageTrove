import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  requestModelList,
  type ModelListEntry,
} from '@/services/ai/openai-compatible-provider';
import type { ModelCapabilities } from '@/types/settings';
import { toErrorMessage } from '@/utils/errors';

interface Options {
  provider: string;
  baseUrl: string;
  apiKey: string;
  /** 拉取成功后回调；用于把能力提示并入已配置的模型。 */
  onModelsLoaded?: (entries: ModelListEntry[], provider: string) => void;
}

export interface ProviderModelList {
  models: string[];
  /** 在线模型列表中的能力提示（按模型 id）；仅在尚未手动配置能力时使用。 */
  capabilityHints: Record<string, ModelCapabilities>;
  /** capabilityHints 所属的供应商；切换供应商后为 undefined。 */
  capabilityProvider?: string;
  loading: boolean;
  error?: string;
  /** 向当前供应商查询最新模型列表；Key 或地址为空时跳过。 */
  refresh: () => Promise<void>;
}

const MODEL_LIST_TIMEOUT_MS = 15_000;
const EMPTY_ENTRIES: ModelListEntry[] = [];

interface Snapshot {
  signature: string;
  provider: string;
  entries: ModelListEntry[];
}

interface RequestState {
  signature: string;
  loading: boolean;
  error?: string;
}

/**
 * 按需拉取供应商模型列表（打开下拉框、填完 Key 时触发）。
 * 结果只保留在内存中展示；能力提示由设置页决定是否并入配置。
 */
export function useProviderModels({
  provider,
  baseUrl,
  apiKey,
  onModelsLoaded,
}: Options): ProviderModelList {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [request, setRequest] = useState<RequestState>();
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const onModelsLoadedRef = useRef(onModelsLoaded);

  useEffect(() => {
    onModelsLoadedRef.current = onModelsLoaded;
  }, [onModelsLoaded]);

  // 供应商、地址或 Key 变化后，旧列表和旧请求状态立即失效（渲染期同步判断）。
  const credentialSignature = `${provider.trim()}\n${baseUrl.trim()}\n${apiKey.trim()}`;
  const validSnapshot =
    snapshot?.signature === credentialSignature ? snapshot : undefined;
  const validRequest = request?.signature === credentialSignature ? request : undefined;
  const entries = validSnapshot?.entries ?? EMPTY_ENTRIES;

  // 切换凭据时中止仍在进行的旧请求；无需清空 state，渲染期已完成失效判断。
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [credentialSignature],
  );

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
    setRequest({ signature: credentialSignature, loading: true });

    try {
      const nextEntries = await requestModelList(
        { baseUrl: trimmedBaseUrl, apiKey: trimmedKey },
        MODEL_LIST_TIMEOUT_MS,
        controller.signal,
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      setSnapshot({
        signature: credentialSignature,
        provider,
        entries: nextEntries,
      });
      setRequest(undefined);
      onModelsLoadedRef.current?.(nextEntries, provider);
    } catch (caught) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setSnapshot(undefined);
      setRequest({
        signature: credentialSignature,
        loading: false,
        error: toErrorMessage(caught),
      });
    } finally {
      if (mountedRef.current && controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, [apiKey, baseUrl, credentialSignature, provider]);

  const models = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const capabilityHints = useMemo(
    () =>
      Object.fromEntries(
        entries.map((entry) => [entry.id, entry.capabilities]),
      ) as Record<string, ModelCapabilities>,
    [entries],
  );

  return {
    models,
    capabilityHints,
    capabilityProvider: validSnapshot?.provider,
    loading: validRequest?.loading ?? false,
    error: validRequest?.error,
    refresh,
  };
}
