export default defineBackground(() => {
  // 点击扩展图标时打开侧边栏
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error('设置侧边栏失败：', error);
    });
});
