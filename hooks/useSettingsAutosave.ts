import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveSettings } from '@/services/settings-store';
import {
  buildSettingsSavePlan,
  settingsSaveSignature,
  type McpSettingsIssue,
} from '@/services/settings-autosave';
import type { ExtensionSettings } from '@/types/settings';
import { toErrorMessage } from '@/utils/errors';

export type SettingsAutoSaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: Date }
  | { state: 'error'; message: string };

interface Options {
  settings: ExtensionSettings;
  hydrated: boolean;
  delay?: number;
  /** 测试注入；默认真实保存。 */
  save?: (patch: Partial<ExtensionSettings>) => Promise<ExtensionSettings>;
}

interface Result {
  status: SettingsAutoSaveStatus;
  /** 当前无法持久化的 MCP 服务（保存时暂缓 mcpServers）。 */
  mcpIssues: McpSettingsIssue[];
  /** 立即保存并等待完成；返回是否已与最新设置一致。 */
  flush: () => Promise<boolean>;
  /** 备份恢复等外部写入后，采纳新设置作为基线。 */
  adoptStoredSettings: (settings: ExtensionSettings) => void;
}

export function useSettingsAutosave({
  settings,
  hydrated,
  delay = 500,
  save = saveSettings,
}: Options): Result {
  const [status, setStatus] = useState<SettingsAutoSaveStatus>({ state: 'idle' });

  const latestSettingsRef = useRef(settings);
  const baselineSignatureRef = useRef<string | null>(null);
  const lastSavedAtRef = useRef<Date | undefined>(undefined);
  const workerRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;
  const delayRef = useRef(delay);
  delayRef.current = delay;

  const updateStatus = useCallback((next: SettingsAutoSaveStatus) => {
    if (mountedRef.current) setStatus(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  /**
   * 串行保存到最新设置：
   * 保存期间的新修改在完成后被再次比较并继续保存，因此不会出现旧值覆盖新值。
   */
  const persistLatest = useCallback(async (): Promise<void> => {
    clearTimer();
    if (workerRef.current) return workerRef.current;

    const worker = (async () => {
      for (;;) {
        const plan = buildSettingsSavePlan(latestSettingsRef.current);
        const signature = settingsSaveSignature(plan);
        if (signature === baselineSignatureRef.current) {
          if (lastSavedAtRef.current) {
            updateStatus({ state: 'saved', at: lastSavedAtRef.current });
          }
          return;
        }

        updateStatus({ state: 'saving' });
        try {
          await saveRef.current(plan.patch);
        } catch (error) {
          updateStatus({ state: 'error', message: toErrorMessage(error) });
          return;
        }
        baselineSignatureRef.current = signature;
        lastSavedAtRef.current = new Date();
      }
    })();

    workerRef.current = worker;
    try {
      await worker;
    } finally {
      workerRef.current = null;
    }
  }, [clearTimer, updateStatus]);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer();
    if (workerRef.current) {
      await workerRef.current.catch(() => undefined);
    }

    const latestSignature = settingsSaveSignature(
      buildSettingsSavePlan(latestSettingsRef.current),
    );
    if (latestSignature !== baselineSignatureRef.current) {
      await persistLatest();
    } else if (workerRef.current) {
      await workerRef.current.catch(() => undefined);
    }

    return (
      settingsSaveSignature(buildSettingsSavePlan(latestSettingsRef.current)) ===
      baselineSignatureRef.current
    );
  }, [clearTimer, persistLatest]);

  const adoptStoredSettings = useCallback(
    (next: ExtensionSettings) => {
      clearTimer();
      latestSettingsRef.current = next;
      baselineSignatureRef.current = settingsSaveSignature(buildSettingsSavePlan(next));
      lastSavedAtRef.current = undefined;
      updateStatus({ state: 'idle' });
    },
    [clearTimer, updateStatus],
  );

  // 每次设置变化后防抖保存；hydration 完成且已建立基线前绝不写入默认值。
  useEffect(() => {
    latestSettingsRef.current = settings;
    if (!hydrated || baselineSignatureRef.current === null) return;

    const signature = settingsSaveSignature(buildSettingsSavePlan(settings));
    if (signature === baselineSignatureRef.current && !workerRef.current) {
      return;
    }

    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      void persistLatest();
    }, delayRef.current);
  }, [settings, hydrated, clearTimer, persistLatest]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  // 关闭/隐藏页面前的兜底；正常保存仍依赖上面的防抖。
  useEffect(() => {
    const flushPending = () => {
      if (baselineSignatureRef.current === null) return;
      const latestSignature = settingsSaveSignature(
        buildSettingsSavePlan(latestSettingsRef.current),
      );
      if (latestSignature === baselineSignatureRef.current) return;
      void persistLatest();
    };
    const onVisibilityChange = () => {
      if (document.hidden) flushPending();
    };
    window.addEventListener('pagehide', flushPending);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [persistLatest]);

  const mcpIssues = useMemo(
    () => buildSettingsSavePlan(settings).invalidMcpServers,
    [settings],
  );

  return { status, mcpIssues, flush, adoptStoredSettings };
}
