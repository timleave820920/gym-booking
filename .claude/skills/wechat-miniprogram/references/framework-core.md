# 框架核心 Framework Core

## 目录
- [App 生命周期](#app-生命周期)
- [Page 生命周期](#page-生命周期)
- [WXML 模板语法](#wxml-模板语法)
- [WXSS 样式](#wxss-样式)
- [WXS 脚本](#wxs-脚本)
- [路由导航](#路由导航)

---

## App 生命周期

```javascript
App({
  onLaunch(options) {
    // 小程序初始化（全局只触发一次）
    // options.scene: 场景值 (1001=搜索, 1007=单人聊天, 1011=扫码 等)
    // options.query: 启动参数
    // options.path: 启动页面路径
    // 适合做：全局初始化、登录检查、版本更新检查
    const updateManager = wx.getUpdateManager()
    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '更新提示',
        content: '新版本已下载，是否重启？',
        success(res) { if (res.confirm) updateManager.applyUpdate() }
      })
    })
  },
  onShow(options) {
    // 小程序从后台进入前台（每次切回都触发）
    // options 同 onLaunch
  },
  onHide() {
    // 小程序从前台进入后台
  },
  onError(msg) {
    // JS 脚本错误或 API 调用报错
    console.error('App error:', msg)
    // 上报错误日志
  },
  onPageNotFound(res) {
    // 找不到页面（如链接过期）
    // res.path, res.query, res.isEntryPage
    wx.redirectTo({ url: '/pages/404/404' })
  },
  onUnhandledRejection(res) {
    // 未处理的 Promise reject
    console.error('Unhandled rejection:', res.reason)
  },
  globalData: {
    userInfo: null,
    token: ''
  }
})

// 任意页面获取 App 实例
const app = getApp()
console.log(app.globalData.userInfo)
```

**常见陷阱：**
- `onLaunch` 是异步的，页面 `onLoad` 可能在 `onLaunch` 的异步操作完成前执行
- 解决方案：使用回调或 Promise 确保数据就绪

---

## Page 生命周期

```javascript
Page({
  data: {
    items: [],
    loading: false
  },

  // === 生命周期 ===
  onLoad(options) {
    // 页面加载（只调一次）。options = URL 查询参数
    // /pages/detail/detail?id=123 → options.id === '123'
    // 最适合做初始数据加载
  },
  onShow() {
    // 页面显示（每次可见都触发，包括 navigateBack 返回）
    // 不要在这里做初始数据加载（会重复执行）
  },
  onReady() {
    // 页面首次渲染完成（只调一次）
    // 可以操作 DOM: wx.createSelectorQuery()
  },
  onHide() {
    // 页面隐藏（navigateTo 跳走时触发）
    // 页面没有销毁，还在页面栈中
  },
  onUnload() {
    // 页面销毁（navigateBack 返回或 redirectTo 跳走）
    // 必须清理：定时器、WebSocket、事件监听
  },

  // === 页面事件 ===
  onPullDownRefresh() {
    // 下拉刷新（需在 page.json 中设 enablePullDownRefresh: true）
    this.loadData().finally(() => wx.stopPullDownRefresh())
  },
  onReachBottom() {
    // 滚动到底部（触发距离可在 json 中配 onReachBottomDistance，默认 50px）
    if (this.data.hasMore && !this.data.loading) this.loadMore()
  },
  onPageScroll(e) {
    // 页面滚动。e.scrollTop（单位 px）
    // ⚠️ 性能注意：频繁触发，避免在此调 setData
  },
  onShareAppMessage(res) {
    // 转发。res.from = 'button' | 'menu'
    return { title: '分享标题', path: '/pages/index/index?id=1', imageUrl: '/images/share.png' }
  },
  onShareTimeline() {
    // 分享到朋友圈
    return { title: '标题', query: 'id=1', imageUrl: '/images/share.png' }
  },
  onAddToFavorites(res) {
    return { title: '收藏标题', imageUrl: '/images/fav.png', query: 'id=1' }
  },
  onResize(res) {
    // 窗口尺寸变化。res.size = { windowWidth, windowHeight }
  },
  onTabItemTap(item) {
    // 点击当前 tab 时触发。item.index, item.pagePath, item.text
  }
})
```

**执行顺序：** `onLoad` → `onShow` → `onReady`

**常见陷阱：**
- `onShow` 在每次页面可见时都触发，不要做重复加载
- `onPageScroll` 中调 `setData` 会导致卡顿，用 WXS 响应式替代
- 页面栈上限 10 个，超出后 `navigateTo` 会失败

---

## WXML 模板语法

### 数据绑定

```html
<!-- 文本插值 -->
<text>{{ message }}</text>
<text>{{ a + b }}</text>
<text>{{ flag ? '是' : '否' }}</text>

<!-- 属性绑定 -->
<view class="item {{ active ? 'active' : '' }}">
<view style="color: {{ color }}; font-size: {{ size }}px;">
<image src="{{ imageUrl }}" />

<!-- 布尔属性 -->
<input disabled="{{ isDisabled }}" />
<!-- ⚠️ 注意：disabled="false" 仍为 true（字符串），必须用 disabled="{{ false }}" -->
```

### 条件渲染

```html
<!-- wx:if / wx:elif / wx:else -->
<view wx:if="{{ status === 'loading' }}">加载中...</view>
<view wx:elif="{{ status === 'error' }}">加载失败</view>
<view wx:else>{{ content }}</view>

<!-- block 不渲染 DOM，只做逻辑分组 -->
<block wx:if="{{ showGroup }}">
  <view>项目1</view>
  <view>项目2</view>
</block>

<!-- hidden 属性（始终渲染，CSS 隐藏）-->
<view hidden="{{ !show }}">我始终在 DOM 中</view>
<!-- wx:if vs hidden: 频繁切换用 hidden，条件少变用 wx:if -->
```

### 列表渲染

```html
<!-- 基础列表 -->
<view wx:for="{{ items }}" wx:key="id">
  {{ index }}: {{ item.name }}
</view>

<!-- 自定义变量名 -->
<view wx:for="{{ items }}" wx:for-index="idx" wx:for-item="product" wx:key="id">
  {{ idx }}: {{ product.name }}
</view>

<!-- wx:key 重要性：必须指定，用于 diff 算法优化 -->
<!-- 值为 item 的某个唯一属性名（不带 item. 前缀），或 *this（item 本身是唯一字符串/数字）-->
<view wx:for="{{ tags }}" wx:key="*this">{{ item }}</view>

<!-- 嵌套列表 -->
<view wx:for="{{ categories }}" wx:key="id" wx:for-item="cat">
  <text>{{ cat.name }}</text>
  <view wx:for="{{ cat.items }}" wx:key="id">{{ item.title }}</view>
</view>
```

### 模板

```html
<!-- 定义模板 -->
<template name="userCard">
  <view class="card">
    <image src="{{ avatar }}" />
    <text>{{ name }}</text>
  </view>
</template>

<!-- 使用模板 -->
<template is="userCard" data="{{ ...userInfo }}" />
<!-- data 使用展开运算符传递对象的所有字段 -->

<!-- 动态模板名 -->
<template is="{{ templateName }}" data="{{ ...data }}" />
```

### import 和 include

```html
<!-- import: 引入模板定义 -->
<import src="templates/card.wxml" />
<template is="card" data="{{ ...item }}" />
<!-- import 有作用域：只引入目标文件的 template，不递归引入 -->

<!-- include: 引入整段代码（除 template 和 wxs 外的所有内容）-->
<include src="components/header.wxml" />
<view>页面内容</view>
<include src="components/footer.wxml" />
```

---

## WXSS 样式

### rpx 单位

```css
/* rpx: responsive pixel，以 750rpx = 屏幕宽度为基准 */
/* iPhone 6: 1rpx = 0.5px, 750rpx = 375px */
/* 设计稿 750px 宽时，1px = 1rpx */

.container {
  width: 750rpx;        /* 满屏宽 */
  padding: 20rpx;
  font-size: 28rpx;     /* 约等于 14px */
  border: 1rpx solid #eee; /* 1rpx 在部分机型可能不显示，建议用 2rpx */
}
```

### 样式导入

```css
/* 使用 @import 导入其他样式文件，路径为相对路径 */
@import "../../common/base.wxss";
@import "./icon.wxss";
```

### 支持的选择器

| 选择器 | 示例 | 说明 |
|--------|------|------|
| 类选择器 | `.class` | 支持 |
| ID 选择器 | `#id` | 支持 |
| 元素选择器 | `view` | 支持 |
| 后代选择器 | `.a .b` | 支持 |
| 子选择器 | `.a > .b` | 支持 |
| 伪类 | `::after`, `::before` | 支持 |
| 群组 | `.a, .b` | 支持 |

**不支持：** 通配符 `*`、属性选择器 `[attr]`、兄弟选择器 `~` `+`

### 全局 vs 页面样式

- `app.wxss` 全局样式，作用于所有页面
- `page.wxss` 页面样式，只作用于当前页面，优先级高于全局
- 组件样式默认隔离（Component 中可配置 `styleIsolation`）

---

## WXS 脚本

WXS (WeiXin Script) 运行在视图层，可直接在 WXML 中调用，不需要 setData。适合做格式化、过滤器等。

### 基础用法

```html
<!-- 内联 WXS -->
<wxs module="utils">
module.exports = {
  formatPrice: function(price) {
    return '¥' + (price / 100).toFixed(2)
  },
  truncate: function(str, len) {
    if (!str) return ''
    return str.length > len ? str.substring(0, len) + '...' : str
  },
  formatTime: function(timestamp) {
    var date = getDate(timestamp)
    var y = date.getFullYear()
    var m = date.getMonth() + 1
    var d = date.getDate()
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d)
  }
}
</wxs>

<text>{{ utils.formatPrice(product.price) }}</text>
<text>{{ utils.truncate(product.desc, 50) }}</text>
<text>{{ utils.formatTime(product.createTime) }}</text>
```

```html
<!-- 外部 WXS 文件 -->
<wxs module="utils" src="../../wxs/utils.wxs" />
```

### WXS 限制

- 不能调用小程序 API（wx.xxx）
- 不能调用 Page/Component 中定义的方法
- 使用 ES5 语法（不支持 ES6+）
- 数据类型：number, string, boolean, object, array, function, date, regexp
- 用 `getDate()` 代替 `new Date()`，用 `getRegExp()` 代替 `new RegExp()`

### WXS 性能优势

WXS 在视图层执行，不需要跨线程通信（JS 逻辑层 → 视图层），适合：
- 格式化过滤器（价格、日期、文本截断）
- 动态计算样式（无需 setData）
- 手势响应（比 JS 层 bindtouchstart 快）

---

## 路由导航

### 导航方法对比

| 方法 | 效果 | 页面栈 | 能否跳 tabBar |
|------|------|--------|--------------|
| `wx.navigateTo` | 保留当前页，新页入栈 | 栈 +1 | 否 |
| `wx.redirectTo` | 关闭当前页，新页替换 | 栈不变 | 否 |
| `wx.switchTab` | 跳转到 tabBar 页面 | 清空非 tab 页 | 是（仅 tab 页） |
| `wx.navigateBack` | 返回上 N 页 | 栈 -N | 否 |
| `wx.reLaunch` | 关闭所有页，打开新页 | 栈清空后 +1 | 是 |

### 用法示例

```javascript
// navigateTo — 最常用，保留当前页
wx.navigateTo({
  url: '/pages/detail/detail?id=123&type=product',
  events: {
    // 监听被打开页面发送的事件
    onResult(data) { console.log('收到返回数据:', data) }
  },
  success(res) {
    // 通过 eventChannel 向被打开页面传送数据
    res.eventChannel.emit('sendData', { item: { id: 123 } })
  }
})

// 被打开页面接收数据
Page({
  onLoad() {
    const eventChannel = this.getOpenerEventChannel()
    eventChannel.on('sendData', (data) => {
      console.log('收到数据:', data.item)
    })
    // 向打开者发送数据
    eventChannel.emit('onResult', { success: true })
  }
})

// redirectTo — 替换当前页（用于不需要返回的场景）
wx.redirectTo({ url: '/pages/result/result' })

// switchTab — 切换到 tab 页（url 不能带参数）
wx.switchTab({ url: '/pages/home/home' })

// navigateBack — 返回
wx.navigateBack({ delta: 1 }) // 返回上一页
wx.navigateBack({ delta: 2 }) // 返回上两页

// reLaunch — 重新打开（清空页面栈）
wx.reLaunch({ url: '/pages/index/index' })
```

### 页面栈

```javascript
// 获取当前页面栈
const pages = getCurrentPages()
const currentPage = pages[pages.length - 1] // 当前页面
const prevPage = pages[pages.length - 2]    // 上一页

// 修改上一页数据（慎用，破坏组件封装）
prevPage.setData({ needRefresh: true })
```

**页面栈上限 10 层。** 超出后 `navigateTo` 失败。解决方案：
- 不需要返回的跳转用 `redirectTo`
- 深层次跳转用 `reLaunch`
- 监控页面栈深度：`getCurrentPages().length`
