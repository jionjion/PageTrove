import type { ThemeConfig } from 'antd';

/**
 * 拾页品牌主题:统一的 antd 设计令牌。
 * 色板源自产品主题——墨青/翡翠(阅读与珍藏),青碧→翡翠渐变,鎏金(书签)点缀,
 * 与 style.css 的 :root 令牌、空状态/欢迎页插画同一语言。
 * 两个入口(侧边栏 / 设置页)共用,保证全局一致。
 */
export const brandTheme: ThemeConfig = {
  token: {
    colorPrimary: '#0d9488',
    colorInfo: '#0d9488',
    colorLink: '#0f766e',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorTextBase: '#262626',
    colorBgLayout: '#f7f6f3',
    borderRadius: 8,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  },
  components: {
    Button: {
      borderRadius: 8,
      fontWeight: 500,
      primaryShadow: 'none',
    },
    Card: {
      borderRadiusLG: 10,
    },
    Input: {
      borderRadius: 8,
    },
    Select: {
      borderRadius: 8,
    },
    Cascader: {
      // 侧边栏较窄:列宽取紧凑下限(内容长时 antd 自动撑开),行距收紧
      controlItemWidth: 100,
      dropdownHeight: 220,
      optionPadding: '4px 10px',
      controlItemBgHover: '#f0fdfa',
      optionSelectedBg: '#f0fdfa',
      optionSelectedColor: '#0f766e',
      optionSelectedFontWeight: 500,
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Menu: {
      itemBorderRadius: 8,
      itemSelectedBg: '#f0fdfa',
      itemSelectedColor: '#0f766e',
      itemHoverBg: '#f0fdfa',
    },
    Tooltip: {
      borderRadius: 8,
    },
    Modal: {
      borderRadiusLG: 12,
    },
  },
};
