import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  manifest: {
    name: '拾页',
    description: '记录、整理和回顾有趣的网站',
    version: '0.1.0',

    permissions: ['activeTab', 'scripting', 'storage', 'tabs', 'sidePanel'],

    // <all_urls>：剪藏插件需要在用户点击"读取"时向任意页面注入采集脚本。
    // activeTab 只覆盖"点击扩展图标那一刻"的标签页，侧边栏内的按钮点击不会授予它。
    host_permissions: ['<all_urls>', 'https://api.deepseek.com/*'],

    action: {
      default_title: '打开网站藏宝库',
      default_icon: {
        16: '/icon/16.png',
        32: '/icon/32.png',
        48: '/icon/48.png',
        128: '/icon/128.png',
      },
    },
  },
});
