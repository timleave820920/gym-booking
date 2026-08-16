# 性能优化与安全 Performance & Security

## 目录
- [setData 优化](#setdata-优化)
- [图片与资源优化](#图片与资源优化)
- [分包加载](#分包加载)
- [长列表优化](#长列表优化)
- [内存管理](#内存管理)
- [WXS 视图层计算](#wxs-视图层计算)
- [网络优化](#网络优化)
- [安全最佳实践](#安全最佳实践)

---

## setData 优化

setData 是小程序性能的核心瓶颈：逻辑层 → 序列化 → native 桥 → 反序列化 → 渲染层。

### 原则

```javascript
// ❌ 错误：频繁全量 setData
this.setData({ list: this.data.list })  // 整个数组序列化

// ✅ 正确：精确路径更新
this.setData({ 'list[2].name': '新名字' })  // 只传输变更字段

// ❌ 错误：短时间连续 setData
for (let i = 0; i < 100; i++) {
  this.setData({ [`items[${i}].checked`]: true })
}

// ✅ 正确：合并为一次
const updates = {}
for (let i = 0; i < 100; i++) {
  updates[`items[${i}].checked`] = true
}
this.setData(updates)
```

### setData 回调

```javascript
// setData 是异步的，需要在回调中获取更新后的值
this.setData({ count: 10 }, () => {
  // 视图已更新
  console.log('DOM 已更新')
})
```

### 数据量限制

- 单次 setData 数据量不超过 **256KB**（序列化后）
- 后台页面避免 setData（onHide 后停止更新）
- 不参与渲染的数据不放在 data 中

```javascript
Page({
  data: { items: [] },    // 参与渲染
  _cache: {},              // 不参与渲染，直接挂载到 this
  _timer: null,

  onHide() {
    // 后台不更新视图
    this._isHidden = true
  },
  onShow() {
    this._isHidden = false
    if (this._pendingData) {
      this.setData(this._pendingData)
      this._pendingData = null
    }
  }
})
```

---

## 图片与资源优化

### 图片策略

```html
<!-- 懒加载 -->
<image lazy-load src="{{ item.url }}" mode="aspectFill" />

<!-- 根据屏幕宽度请求合适尺寸（CDN 裁剪） -->
<image src="{{ item.url }}?imageView2/2/w/{{ imageWidth }}" mode="widthFix" />
```

```javascript
// 计算合适的图片宽度
const { windowWidth, pixelRatio } = wx.getWindowInfo()
const imageWidth = Math.ceil(windowWidth * pixelRatio / 2)  // 2 列布局
```

### 资源体积

| 类型 | 限制 | 建议 |
|------|------|------|
| 单张图片 | 无硬限制 | < 200KB |
| 本地资源总量 | 计入包体积 | 图片用 CDN |
| tabBar 图标 | 81px × 81px | 40KB 以内 |
| 代码包 | 主包 2MB | 开启分包 |

### 代码体积控制

```json
// project.config.json
{
  "setting": {
    "minified": true,       // 代码压缩
    "es6": true,            // ES6 转 ES5
    "postcss": true,        // postcss 处理
    "uglifyFileName": true  // 文件名混淆
  }
}
```

---

## 分包加载

### 基础分包

```json
// app.json
{
  "pages": ["pages/index/index", "pages/mine/mine"],
  "subpackages": [
    {
      "root": "packageA",
      "name": "shop",
      "pages": ["pages/goods/goods", "pages/order/order"]
    },
    {
      "root": "packageB",
      "pages": ["pages/article/article"]
    }
  ]
}
```

### 独立分包

不依赖主包即可运行，适合活动页、广告页。

```json
{
  "subpackages": [
    {
      "root": "packageC",
      "pages": ["pages/promo/promo"],
      "independent": true
    }
  ]
}
```

**独立分包限制：**
- 不能依赖主包和其他分包
- 不能使用 app.wxss 中的全局样式
- 首次进入时 App 的 onLaunch 会延迟到回到主包

### 分包预下载

```json
{
  "preloadRule": {
    "pages/index/index": {
      "network": "all",
      "packages": ["shop"]
    },
    "pages/mine/mine": {
      "network": "wifi",
      "packages": ["packageB"]
    }
  }
}
```

### 体积限制

| 类型 | 限制 |
|------|------|
| 整个小程序 | 20MB（所有分包之和） |
| 单个主包 | 2MB |
| 单个分包 | 2MB |
| 分包预下载 | 同时下载上限 2MB |

---

## 长列表优化

### 虚拟列表（按需渲染）

```javascript
// 只渲染可视区域内的项
Page({
  data: {
    visibleItems: [],
    startIndex: 0,
    itemHeight: 100  // 每项高度 px
  },
  onScroll(e) {
    const { scrollTop } = e.detail
    const startIndex = Math.floor(scrollTop / this.data.itemHeight)
    const visibleCount = Math.ceil(this._windowHeight / this.data.itemHeight) + 2
    const endIndex = Math.min(startIndex + visibleCount, this._allItems.length)

    if (startIndex !== this.data.startIndex) {
      this.setData({
        startIndex,
        visibleItems: this._allItems.slice(startIndex, endIndex),
        topPadding: startIndex * this.data.itemHeight,
        bottomPadding: (this._allItems.length - endIndex) * this.data.itemHeight
      })
    }
  }
})
```

```html
<scroll-view scroll-y style="height: 100vh;" bindscroll="onScroll">
  <view style="height: {{ topPadding }}px;" />
  <view wx:for="{{ visibleItems }}" wx:key="id" style="height: {{ itemHeight }}px;">
    {{ item.name }}
  </view>
  <view style="height: {{ bottomPadding }}px;" />
</scroll-view>
```

### recycle-view 官方组件

微信官方提供的长列表方案，npm 安装：

```bash
npm install --save miniprogram-recycle-view
```

```json
// page.json
{
  "usingComponents": {
    "recycle-view": "miniprogram-recycle-view/recycle-view",
    "recycle-item": "miniprogram-recycle-view/recycle-item"
  }
}
```

---

## 内存管理

### 常见内存泄漏

```javascript
Page({
  onLoad() {
    // ❌ 定时器未清理
    this._timer = setInterval(() => this.poll(), 5000)
    // ❌ 全局事件未移除
    getApp().onCartChange(this._onCartChange)
  },
  // ✅ 必须在 onUnload 清理
  onUnload() {
    clearInterval(this._timer)
    getApp().offCartChange(this._onCartChange)
  }
})

// 组件同理
Component({
  lifetimes: {
    attached() {
      this._observer = this.createIntersectionObserver()
      this._observer.observe('.target', () => {})
    },
    detached() {
      this._observer.disconnect()
    }
  }
})
```

### 内存监控

```javascript
wx.onMemoryWarning((res) => {
  // res.level: 5(TRIM_MEMORY_RUNNING_MODERATE), 10(TRIM_MEMORY_RUNNING_LOW), 15(TRIM_MEMORY_RUNNING_CRITICAL)
  console.warn('内存不足警告, level:', res.level)
  // 清理缓存、释放大对象
  this._cache = {}
})
```

---

## WXS 视图层计算

WXS 在视图层执行，避免逻辑层通信延迟，适合高频交互。

### 响应手势（最典型场景）

```html
<wxs module="gesture" src="./gesture.wxs" />
<view
  bindtouchstart="{{ gesture.onTouchStart }}"
  bindtouchmove="{{ gesture.onTouchMove }}"
  bindtouchend="{{ gesture.onTouchEnd }}"
  style="transform: translateX({{ offsetX }}px);"
/>
```

```javascript
// gesture.wxs
var startX = 0
var offsetX = 0

module.exports = {
  onTouchStart: function(e, ins) {
    startX = e.touches[0].pageX
  },
  onTouchMove: function(e, ins) {
    var x = e.touches[0].pageX - startX
    ins.selectComponent('.slider').setStyle({ transform: 'translateX(' + x + 'px)' })
  },
  onTouchEnd: function(e, ins) {
    // 回弹或确认
    ins.callMethod('onSwipeEnd', { offset: offsetX })
  }
}
```

### WXS 性能适用场景

| 场景 | 推荐度 | 原因 |
|------|--------|------|
| 手势跟手 | ⭐⭐⭐ | 避免通信延迟，60fps |
| 动态样式计算 | ⭐⭐⭐ | 视图层直接计算 |
| 数据格式化 | ⭐⭐ | 减少逻辑层负担 |
| 复杂业务逻辑 | ❌ | WXS 语法受限 |

---

## 网络优化

```javascript
// 请求合并：多个接口合并为一个
const [user, orders, coupons] = await Promise.all([
  request({ url: '/user/info' }),
  request({ url: '/orders/recent' }),
  request({ url: '/coupons/available' })
])

// 数据预加载：在上一页就开始请求
// pages/list/list.js
onItemTap(e) {
  const id = e.currentTarget.dataset.id
  // 预加载详情数据
  getApp()._preloadData = request({ url: `/items/${id}` })
  wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
}

// pages/detail/detail.js
async onLoad(options) {
  const preload = getApp()._preloadData
  const data = preload ? await preload : await request({ url: `/items/${options.id}` })
  getApp()._preloadData = null
  this.setData({ detail: data })
}
```

---

## 安全最佳实践

### 核心安全规则

1. **不信任客户端数据** — 所有校验在服务端执行
2. **不在前端存储敏感信息** — token 可存，密钥绝不可存
3. **HTTPS 强制** — 所有请求域名必须配置 SSL
4. **code 只能用一次** — wx.login 获取的 code 用后即废

### 接口安全

```javascript
// ✅ 服务端校验 openid（不信任客户端传来的 openid）
// 前端
const { code } = await wx.login()
await request({ url: '/api/bindPhone', data: { code, encryptedData, iv } })

// 后端（Node.js 示例）
app.post('/api/bindPhone', async (req, res) => {
  const { code, encryptedData, iv } = req.body
  // 用 code 换 session_key
  const { openid, session_key } = await getSessionKey(code)
  // 用 session_key 解密手机号
  const phone = decrypt(encryptedData, session_key, iv)
  // 绑定到 openid
})
```

### 敏感数据规范

```javascript
// ❌ 绝不在前端存储
wx.setStorageSync('session_key', sessionKey)  // 危险！
wx.setStorageSync('user_password', password)  // 危险！

// ✅ 只存必要的 token
wx.setStorageSync('token', jwtToken)  // token 有过期时间
```

### 内容安全

```javascript
// 文本内容审核（调用微信内容安全 API）
// 后端调用
const result = await axios.post(
  `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`,
  { content: userInput }
)
if (result.data.errcode === 87014) {
  // 内容违规
}

// 图片内容审核
const result = await axios.post(
  `https://api.weixin.qq.com/wxa/img_sec_check?access_token=${token}`,
  imageBuffer,
  { headers: { 'Content-Type': 'application/octet-stream' } }
)
```

### 常见审核问题

| 问题 | 解决方案 |
|------|----------|
| UGC 内容未审核 | 接入内容安全 API |
| 虚拟支付 | iOS 不能使用微信支付购买虚拟商品 |
| 未配置隐私协议 | app.json 配置 `__usePrivacyCheck__: true` |
| 敏感 API 无权限说明 | 在 permission 中填写用途说明 |
| 分享功能滥用 | 不强制分享才能使用功能 |
