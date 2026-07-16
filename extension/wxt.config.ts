import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  manifest: {
    name: '拾页 PageTrove',
    description: '记录、整理和回顾有趣的网站',
    version: '0.1.0',

    permissions: ['activeTab', 'scripting', 'storage', 'tabs', 'sidePanel'],

    host_permissions: ['https://api.deepseek.com/*'],

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
