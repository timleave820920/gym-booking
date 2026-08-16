# 常用开发模式 Common Patterns

## 目录
- [登录流程实现](#登录流程实现)
- [数据绑定模式](#数据绑定模式)
- [事件处理](#事件处理)
- [状态管理](#状态管理)
- [表单处理](#表单处理)
- [列表分页](#列表分页)
- [图片处理](#图片处理)
- [分享转发](#分享转发)
- [页面通信](#页面通信)

---

## 登录流程实现

### App 启动自动登录

```javascript
// app.js
App({
  onLaunch() {
    this.checkLogin()
  },
  async checkLogin() {
    const token = wx.getStorageSync('token')
    if (!token) {
      await this.login()
      return
    }
    // 验证 token 有效性
    try {
      const { request } = require('./utils/request')
      await request({ url: '/auth/verify', method: 'POST' })
    } catch (err) {
      wx.removeStorageSync('token')
      await this.login()
    }
  },
  async login() {
    const { code } = await wx.login()
    const { request } = require('./utils/request')
    const res = await request({
      url: '/auth/wx-login',
      method: 'POST',
      data: { code }
    })
    wx.setStorageSync('token', res.token)
    this.globalData.openid = res.openid
    // 通知等待登录的页面
    if (this._loginCallback) this._loginCallback()
  },
  globalData: { openid: '' }
})
```

### 页面等待登录完成

```javascript
// pages/index/index.js
Page({
  onLoad() {
    const app = getApp()
    if (app.globalData.openid) {
      this.loadData()
    } else {
      app._loginCallback = () => this.loadData()
    }
  }
})
```

---

## 数据绑定模式

### 条件类名绑定

```html
<view class="tab {{ activeTab === 'home' ? 'active' : '' }}">首页</view>
<view class="item {{ item.selected ? 'selected' : '' }} {{ item.disabled ? 'disabled' : '' }}">
```

### 样式绑定

```html
<view style="color: {{ textColor }}; font-size: {{ fontSize }}rpx;">
<view style="height: {{ windowHeight }}px; padding-top: {{ statusBarHeight }}px;">
```

### WXS 计算属性

```html
<wxs module="computed">
module.exports = {
  fullName: function(first, last) {
    return (first || '') + ' ' + (last || '')
  },
  discountPrice: function(price, discount) {
    return (price * discount / 100).toFixed(2)
  }
}
</wxs>

<text>{{ computed.fullName(user.firstName, user.lastName) }}</text>
<text>¥{{ computed.discountPrice(product.price, product.discount) }}</text>
```

---

## 事件处理

### data-* 传递参数

```html
<view
  wx:for="{{ items }}"
  wx:key="id"
  data-id="{{ item.id }}"
  data-index="{{ index }}"
  bindtap="onItemTap"
>
  {{ item.name }}
</view>
```

```javascript
onItemTap(e) {
  const { id, index } = e.currentTarget.dataset
  // ⚠️ 用 e.currentTarget.dataset 而非 e.target.dataset
  // e.target 是触发事件的元素，e.currentTarget 是绑定事件的元素
}
```

### mark 标记（性能更优）

```html
<view wx:for="{{ items }}" wx:key="id" mark:id="{{ item.id }}" bindtap="onTap">
  <text mark:type="name">{{ item.name }}</text>
</view>
```

```javascript
onTap(e) {
  // e.mark 会合并从触发元素到监听元素路径上所有的 mark
  console.log(e.mark.id, e.mark.type)
}
```

### 阻止冒泡

```html
<view bindtap="onParentTap">
  <!-- catchtap 阻止冒泡 -->
  <button catchtap="onButtonTap">不冒泡</button>

  <!-- mut-bind 互斥事件：同一组 mut-bind 只有一个会触发 -->
  <view mut-bind:tap="onA">
    <view mut-bind:tap="onB">只触发 onB</view>
  </view>
</view>
```

---

## 状态管理

### 简单全局状态

```javascript
// app.js
App({
  globalData: {
    userInfo: null,
    cartCount: 0
  },
  updateCartCount(count) {
    this.globalData.cartCount = count
    // 通知已注册的页面
    this._cartListeners.forEach((fn) => fn(count))
  },
  _cartListeners: [],
  onCartChange(fn) { this._cartListeners.push(fn) },
  offCartChange(fn) {
    this._cartListeners = this._cartListeners.filter((f) => f !== fn)
  }
})
```

```javascript
// 页面监听
Page({
  onShow() {
    this._onCartChange = (count) => this.setData({ cartCount: count })
    getApp().onCartChange(this._onCartChange)
  },
  onHide() {
    getApp().offCartChange(this._onCartChange)
  }
})
```

### 事件总线

```javascript
// utils/event-bus.js
const listeners = {}
module.exports = {
  on(event, fn) {
    if (!listeners[event]) listeners[event] = []
    listeners[event].push(fn)
  },
  off(event, fn) {
    if (!listeners[event]) return
    listeners[event] = listeners[event].filter((f) => f !== fn)
  },
  emit(event, data) {
    if (!listeners[event]) return
    listeners[event].forEach((fn) => fn(data))
  }
}
```

---

## 表单处理

### 实时验证

```html
<view class="form">
  <view class="field {{ errors.phone ? 'error' : '' }}">
    <input placeholder="手机号" bindinput="onPhoneInput" value="{{ phone }}" />
    <text wx:if="{{ errors.phone }}" class="error-msg">{{ errors.phone }}</text>
  </view>
  <view class="field {{ errors.code ? 'error' : '' }}">
    <input placeholder="验证码" bindinput="onCodeInput" value="{{ code }}" />
  </view>
  <button type="primary" disabled="{{ !isFormValid }}" bindtap="onSubmit">提交</button>
</view>
```

```javascript
Page({
  data: { phone: '', code: '', errors: {}, isFormValid: false },
  onPhoneInput(e) {
    const phone = e.detail.value
    const errors = { ...this.data.errors }
    if (!/^1\d{10}$/.test(phone)) {
      errors.phone = '请输入正确的手机号'
    } else {
      delete errors.phone
    }
    this.setData({
      phone, errors,
      isFormValid: !errors.phone && !errors.code && phone && this.data.code
    })
  }
})
```

---

## 列表分页

```html
<scroll-view
  scroll-y
  style="height: 100vh;"
  refresher-enabled
  refresher-triggered="{{ isRefreshing }}"
  bindrefresherrefresh="onRefresh"
  bindscrolltolower="onLoadMore"
>
  <view wx:for="{{ items }}" wx:key="id" class="item">{{ item.name }}</view>
  <view wx:if="{{ loading }}" class="loading">加载中...</view>
  <view wx:if="{{ !hasMore && items.length > 0 }}" class="no-more">没有更多了</view>
  <view wx:if="{{ !loading && items.length === 0 }}" class="empty">暂无数据</view>
</scroll-view>
```

```javascript
Page({
  data: {
    items: [], page: 1, pageSize: 20,
    hasMore: true, loading: false, isRefreshing: false
  },
  onLoad() { this.loadData(1) },
  async loadData(page) {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const res = await request({
        url: '/api/items',
        data: { page, size: this.data.pageSize }
      })
      const newItems = page === 1 ? res.list : [...this.data.items, ...res.list]
      this.setData({
        items: newItems,
        page,
        hasMore: res.list.length >= this.data.pageSize
      })
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false, isRefreshing: false })
    }
  },
  onRefresh() {
    this.setData({ isRefreshing: true })
    this.loadData(1)
  },
  onLoadMore() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadData(this.data.page + 1)
    }
  }
})
```

---

## 图片处理

### 懒加载 + 错误处理

```html
<image
  wx:for="{{ images }}"
  wx:key="id"
  src="{{ item.url }}"
  mode="aspectFill"
  lazy-load
  binderror="onImageError"
  data-idx="{{ index }}"
/>
```

```javascript
onImageError(e) {
  const idx = e.currentTarget.dataset.idx
  this.setData({ [`images[${idx}].url`]: '/images/default.png' })
}
```

### CDN 图片尺寸裁剪

```javascript
function getCdnUrl(url, width) {
  if (!url) return '/images/default.png'
  // 阿里云 OSS
  return `${url}?x-oss-process=image/resize,w_${width},m_lfit/format,webp`
  // 腾讯云 COS
  // return `${url}?imageMogr2/thumbnail/${width}x/format/webp`
}
```

---

## 分享转发

```javascript
Page({
  // 分享到聊天
  onShareAppMessage(res) {
    // res.from: 'button'(按钮触发) | 'menu'(右上角菜单)
    // res.target: 触发按钮的组件（from='button' 时有值）
    return {
      title: '分享标题',
      path: `/pages/detail/detail?id=${this.data.id}`,
      imageUrl: '/images/share-cover.png' // 5:4 比例
    }
  },
  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '朋友圈标题',
      query: `id=${this.data.id}`,
      imageUrl: '/images/share-moments.png'
    }
  }
})
```

---

## 页面通信

### EventChannel（navigateTo 专用）

```javascript
// 页面 A → 跳转到页面 B 并传数据
wx.navigateTo({
  url: '/pages/B/B',
  events: { onResult(data) { console.log('B 返回的数据:', data) } },
  success(res) { res.eventChannel.emit('initData', { id: 123 }) }
})

// 页面 B 接收并返回数据
Page({
  onLoad() {
    const channel = this.getOpenerEventChannel()
    channel.on('initData', (data) => { this.setData({ id: data.id }) })
  },
  onConfirm() {
    this.getOpenerEventChannel().emit('onResult', { selected: true })
    wx.navigateBack()
  }
})
```

### getCurrentPages 直接操作

```javascript
// 在当前页面修改上一页的数据（返回前刷新列表）
const pages = getCurrentPages()
const prevPage = pages[pages.length - 2]
if (prevPage) {
  prevPage.setData({ needRefresh: true })
}
wx.navigateBack()
```
