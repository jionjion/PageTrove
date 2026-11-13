import { configure } from '@testing-library/react';

// 重型 antd + jsdom 用例在并行满负载时,默认 1s 的 waitFor/findBy 超时易抖动。
// 放宽异步查询超时(不改变断言语义,真实缺失仍会失败),保证套件稳定。
if (typeof document !== 'undefined') {
  configure({ asyncUtilTimeout: 5000 });
}
