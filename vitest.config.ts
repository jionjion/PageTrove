import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    // 重型 antd + jsdom 异步用例在并行满负载时需要更多余量,避免偶发超时抖动
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
