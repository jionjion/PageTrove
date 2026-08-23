import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { emitDataChanged, onDataChanged } from '@/services/data-events';

describe('data events', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('单个监听器抛错不会阻断其余监听器或广播', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = vi.fn(() => {
      throw new Error('listener failed');
    });
    const healthy = vi.fn();
    const offBroken = onDataChanged('clips', broken);
    const offHealthy = onDataChanged('clips', healthy);

    expect(() => emitDataChanged('clips')).not.toThrow();
    expect(broken).toHaveBeenCalled();
    expect(healthy).toHaveBeenCalledTimes(broken.mock.calls.length);

    offBroken();
    offHealthy();
  });
});
