// 设备适配：状态栏高度、右上角胶囊位置、安全区，统一在这里算。
//
// 为什么需要这个模块：
//   1. 胶囊按钮（右上角「···」和关闭）各机型尺寸/位置不同，导航条高度不能写死 44px；
//   2. 自定义导航右侧要给胶囊留位，写死 190rpx 在小屏不够、大屏又留太多；
//   3. wx.getSystemInfoSync 已废弃，getWindowInfo 取不到时要有降级链。
//
// 只算一次并缓存：小程序窗口尺寸在 resizable:false 下不会变。
let cache = null;

function readWindow() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const w = wx.getWindowInfo();
      if (w && w.windowWidth) return w;
    }
  } catch (e) { /* 低版本基础库没有该 API */ }
  try {
    if (typeof wx.getSystemInfoSync === 'function') {
      const s = wx.getSystemInfoSync();
      if (s && s.windowWidth) return s;
    }
  } catch (e) { /* 取不到就用默认值 */ }
  return {};
}

function readMenuRect() {
  try {
    if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
      const r = wx.getMenuButtonBoundingClientRect();
      // 部分机型在首页未渲染完时返回全 0，视为无效
      if (r && r.height > 0 && r.top > 0 && r.left > 0) return r;
    }
  } catch (e) { /* 兜底用默认导航高度 */ }
  return null;
}

function layout() {
  if (cache) return cache;

  const w = readWindow();
  const menu = readMenuRect();

  const windowWidth = Number(w.windowWidth) || 375;
  const windowHeight = Number(w.windowHeight) || 667;
  const statusBarHeight = Number(w.statusBarHeight) || 20;

  // 导航条高度 = 胶囊上下留白对称，保证标题与胶囊垂直居中对齐
  let navBarHeight = 44;
  // 右侧需要给胶囊让出的宽度（px）：从胶囊左边缘到屏幕右边
  let capsuleRight = Math.round(windowWidth * 0.26);
  let capsuleWidth = 87;

  if (menu) {
    navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
    capsuleRight = Math.max(16, Math.round(windowWidth - menu.left));
    capsuleWidth = Math.round(menu.width);
  }

  // 导航条过高会挤占内容，过低标题会贴边
  navBarHeight = Math.min(60, Math.max(40, Math.round(navBarHeight)));

  const safeArea = w.safeArea || null;
  const safeBottom = safeArea && typeof safeArea.bottom === 'number'
    ? Math.max(0, Math.round(windowHeight - safeArea.bottom))
    : 0;

  cache = {
    windowWidth: windowWidth,
    windowHeight: windowHeight,
    statusBarHeight: Math.round(statusBarHeight),
    navBarHeight: navBarHeight,
    capsuleRight: capsuleRight,
    capsuleWidth: capsuleWidth,
    // 内容右侧留白 = 胶囊占位 + 视觉间隙
    navPadRight: capsuleRight + 8,
    // 顶部总高度（状态栏 + 导航条），用于sticky/margin 计算
    headerHeight: Math.round(statusBarHeight) + navBarHeight,
    safeBottom: safeBottom,
    // 断点：小屏（iPhone SE 320）与大屏（PC 拉伸 / 折叠屏展开）
    isNarrow: windowWidth <= 340,
    isWide: windowWidth >= 600
  };
  return cache;
}

/** rpx 转 px，给少数必须用 px 的场景（canvas、动画位移） */
function rpx2px(rpx) {
  return (layout().windowWidth / 750) * rpx;
}

module.exports = {
  layout: layout,
  rpx2px: rpx2px,
  // 测试用：清掉缓存重新测量
  reset: function () { cache = null; }
};
