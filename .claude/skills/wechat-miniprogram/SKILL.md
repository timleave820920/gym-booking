---
name: wechat-miniprogram
description: "WeChat Mini Program (微信小程序) rapid development guide. Covers native framework (WXML, WXSS, WXS), APIs (wx.request, wx.navigateTo, wx.login, wx.requestPayment), components, cloud development (云开发), and cross-platform tools (Taro, uni-app). Use when building, debugging, or optimizing 微信小程序, or when asked about mini program lifecycle, project structure, custom components, subpackages, or WeChat payment flow."
---

# WeChat Mini Program (微信小程序) Development Guide

Comprehensive reference for building WeChat Mini Programs with native framework, cloud development, and cross-platform tools.

## Quick Navigation

| Topic | Reference File | When to Use |
|-------|---------------|-------------|
| App/Page lifecycle, WXML/WXSS/WXS | [framework-core.md](references/framework-core.md) | Framework fundamentals, template syntax |
| Built-in components | [components.md](references/components.md) | Using view, text, image, form, scroll-view, swiper etc. |
| Network, storage, file system | [api-network-storage.md](references/api-network-storage.md) | wx.request, storage, file operations |
| Navigation, UI feedback | [api-navigation-ui.md](references/api-navigation-ui.md) | Page navigation, toast, modal, loading |
| Device, media, canvas | [api-device-media.md](references/api-device-media.md) | Location, camera, bluetooth, canvas |
| Login, payment, auth | [api-auth-payment.md](references/api-auth-payment.md) | wx.login, wx.requestPayment, authorize |
| Cloud development | [cloud-development.md](references/cloud-development.md) | Cloud functions, database, storage |
| Configuration files | [app-config.md](references/app-config.md) | app.json, page.json, project.config.json |
| Custom components | [custom-components.md](references/custom-components.md) | Component creation, behaviors, slots |
| Common patterns | [common-patterns.md](references/common-patterns.md) | Login flow, state management, pagination |
| Performance & security | [performance-security.md](references/performance-security.md) | Optimization, security, package size |
| Taro framework | [taro-framework.md](references/taro-framework.md) | Cross-platform with React/Vue via Taro |
| Taro: Web→小程序迁移 | [taro-framework.md](references/taro-framework.md#react-web--taro-小程序迁移指南) | React Web 项目迁移到 Taro 小程序 |
| uni-app framework | [uniapp-framework.md](references/uniapp-framework.md) | Cross-platform with Vue via uni-app |

## Standard Project Structure

```
miniprogram/
├── app.js                 # App entry — onLaunch, onShow, onHide, globalData
├── app.json               # Global config — pages, window, tabBar, subpackages
├── app.wxss               # Global styles (rpx units)
├── project.config.json    # DevTools project config — appid, settings
├── sitemap.json           # Search indexing rules
├── pages/
│   ├── index/
│   │   ├── index.js       # Page logic — Page({}) with lifecycle
│   │   ├── index.wxml     # Page template — data binding, wx:if, wx:for
│   │   ├── index.wxss     # Page styles (scoped)
│   │   └── index.json     # Page config — navigationBarTitleText, usingComponents
│   └── logs/
│       ├── logs.js
│       ├── logs.wxml
│       ├── logs.wxss
│       └── logs.json
├── components/            # Custom components
│   └── my-component/
│       ├── my-component.js
│       ├── my-component.wxml
│       ├── my-component.wxss
│       └── my-component.json
├── utils/
│   ├── request.js         # wx.request wrapper with error handling
│   └── util.js            # Common utilities
├── assets/                # Static assets (images, icons)
└── cloudfunctions/        # Cloud functions (if using cloud development)
    └── login/
        ├── index.js
        └── package.json
```

## Scaffolding

Create a new mini program project with best-practice structure:

```bash
python ~/.claude/skills/wechat-miniprogram/scripts/init-miniprogram.py <project-name>
python ~/.claude/skills/wechat-miniprogram/scripts/init-miniprogram.py <project-name> --cloud
```

## Core Concepts

### App Lifecycle

```javascript
App({
  onLaunch(options) {
    // App initialized (once). options.scene = launch scene value
    // Good for: global init, login check, update check
  },
  onShow(options) {
    // App enters foreground. Called after onLaunch and every re-show
  },
  onHide() {
    // App enters background
  },
  onError(msg) {
    // Script error or API call error
    console.error('App error:', msg)
  },
  globalData: {
    userInfo: null
  }
})
```

### Page Lifecycle

```javascript
Page({
  data: {
    items: [],
    loading: false
  },
  onLoad(options) {
    // Page load. options = route query params. Called ONCE.
    // Best place for initial data fetch
    const { id } = options
  },
  onShow() {
    // Page show. Called every time page is displayed (including back navigation)
  },
  onReady() {
    // First render complete. DOM ready for wx.createSelectorQuery
  },
  onHide() {
    // Page hidden (navigateTo to another page)
  },
  onUnload() {
    // Page destroyed (navigateBack or redirectTo). Cleanup here.
  },
  onPullDownRefresh() {
    // Pull-down refresh triggered (requires enablePullDownRefresh in json)
    this.loadData().then(() => wx.stopPullDownRefresh())
  },
  onReachBottom() {
    // Scroll to bottom — load more data
  },
  onShareAppMessage() {
    return { title: 'Share title', path: '/pages/index/index' }
  }
})
```

### Data Binding & setData

```html
<!-- WXML: Data binding with {{ }} -->
<view class="container">
  <text>{{message}}</text>
  <view wx:if="{{showDetail}}">Detail content</view>
  <view wx:for="{{items}}" wx:key="id">
    <text>{{index}}: {{item.name}}</text>
  </view>
</view>
```

```javascript
// JS: Update data with setData (triggers re-render)
Page({
  data: { message: 'Hello', items: [], showDetail: false },
  updateMessage() {
    // IMPORTANT: setData is async, use callback for post-render logic
    this.setData({ message: 'Updated' }, () => {
      // Render complete
    })
  },
  // BEST PRACTICE: Batch updates, minimize setData calls
  loadItems() {
    this.setData({
      items: newItems,
      loading: false,
      hasMore: newItems.length >= PAGE_SIZE
    })
  }
})
```

### Event System

```html
<!-- bindtap: event bubbles. catchtap: stops propagation -->
<button bindtap="handleTap" data-id="{{item.id}}">Tap me</button>
<view catchtap="handleStop">Won't bubble</view>

<!-- Input events -->
<input bindinput="onInput" value="{{inputValue}}" />
```

```javascript
Page({
  handleTap(e) {
    const id = e.currentTarget.dataset.id  // Access data-* attributes
    // e.target = element that triggered event
    // e.currentTarget = element that bindtap is on
  },
  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  }
})
```

## Workflow Decision Tree

**Building a new page?**
→ Use [page template](templates/page-template/) + see [framework-core.md](references/framework-core.md)

**Building a custom component?**
→ Use [component template](templates/component-template/) + see [custom-components.md](references/custom-components.md)

**Adding network requests?**
→ See [api-network-storage.md](references/api-network-storage.md) for wx.request patterns

**Implementing user login?**
→ See [api-auth-payment.md](references/api-auth-payment.md) + [common-patterns.md](references/common-patterns.md) for complete login flow

**Adding WeChat Pay?**
→ See [api-auth-payment.md](references/api-auth-payment.md) for full payment sequence

**Using cloud development?**
→ Use [cloud function template](templates/cloud-function-template/) + see [cloud-development.md](references/cloud-development.md)

**Cross-platform (Taro)?**
→ See [taro-framework.md](references/taro-framework.md) for React/Vue + Taro patterns

**Migrating React Web app to Mini Program?**
→ See [taro-framework.md](references/taro-framework.md) "React Web → Taro 小程序迁移指南" section for monorepo setup, API replacement, plugin handling, and pitfalls checklist

**Cross-platform (uni-app)?**
→ See [uniapp-framework.md](references/uniapp-framework.md) for Vue + uni-app patterns

**Performance issues?**
→ See [performance-security.md](references/performance-security.md) for optimization checklist

## Essential Patterns

### wx.request Wrapper

```javascript
// utils/request.js
function getBaseUrl() {
  // IMPORTANT: Fetch at runtime, never cache at module level
  return getApp().globalData.baseUrl || 'https://api.example.com'
}

function request(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getBaseUrl()}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${wx.getStorageSync('token') || ''}`,
        ...options.header
      },
      timeout: options.timeout || 10000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else if (res.statusCode === 401) {
          // Token expired — trigger re-login
          wx.removeStorageSync('token')
          wx.navigateTo({ url: '/pages/login/login' })
          reject(new Error('Unauthorized'))
        } else {
          reject(new Error(res.data.message || `Request failed: ${res.statusCode}`))
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || 'Network error'))
      }
    })
  })
}

module.exports = { request }
```

### Login Flow Skeleton

```javascript
// Complete WeChat login flow
async function login() {
  try {
    // 1. Get temporary login code (client-side)
    const { code } = await wx.login()

    // 2. Exchange code for session (server-side)
    const res = await request({
      url: '/auth/wx-login',
      method: 'POST',
      data: { code }
    })
    // Server calls: https://api.weixin.qq.com/sns/jscode2session
    // Server returns: custom token (NEVER return session_key to client)

    // 3. Store token
    wx.setStorageSync('token', res.token)

    return res
  } catch (err) {
    console.error('Login failed:', err)
    throw err
  }
}
```

### Custom Component Quick Example

```javascript
// components/product-card/product-card.js
Component({
  properties: {
    product: { type: Object, value: {} },
    showPrice: { type: Boolean, value: true }
  },
  data: {
    formattedPrice: ''
  },
  observers: {
    'product.price'(price) {
      this.setData({ formattedPrice: `¥${(price / 100).toFixed(2)}` })
    }
  },
  methods: {
    onTap() {
      this.triggerEvent('select', { id: this.properties.product.id })
    }
  }
})
```

```html
<!-- components/product-card/product-card.wxml -->
<view class="card" bindtap="onTap">
  <image src="{{product.image}}" mode="aspectFill" lazy-load />
  <text class="name">{{product.name}}</text>
  <text wx:if="{{showPrice}}" class="price">{{formattedPrice}}</text>
</view>
```

## Cross-Platform Selection Guide

| Factor | Native | Taro | uni-app |
|--------|--------|------|---------|
| Performance | Best | Good (runtime overhead) | Good |
| Learning curve | WeChat-specific | React/Vue familiar | Vue familiar |
| Multi-platform | WeChat only | WeChat + Alipay + H5 + RN | WeChat + Alipay + H5 + App |
| Ecosystem | WeChat official | npm + Taro plugins | DCloud marketplace |
| TypeScript | Partial | Full support | Full support |
| Team expertise | Need WXML/WXSS | React/Vue devs | Vue devs |
| Recommended for | WeChat-only apps, max perf | Multi-platform, React team | Multi-platform, Vue team |

## Best Practices Top 10

1. **Minimize setData** — Batch updates, send only changed fields, avoid large data in setData
2. **Lazy load images** — Use `lazy-load` on `<image>`, CDN with size params, WebP format
3. **Main package < 2MB** — Use subpackages for large apps, independent subpackages for tab pages
4. **Preload data in onLoad** — Not onShow (onShow fires on every back navigation)
5. **Use WXS for view computation** — Filters and formatting run in view thread, no setData needed
6. **Never trust client data** — Validate all input server-side, never send session_key to client
7. **HTTPS only** — All wx.request must use HTTPS, configure domain whitelist in backend
8. **Proper error handling** — Wrap all async operations in try/catch, show user-friendly error messages
9. **Page stack limit = 10** — Use wx.redirectTo or wx.reLaunch to avoid stack overflow
10. **Component isolation** — Use custom components to encapsulate reusable UI, keep pages thin

## Templates

| Template | Path | Description |
|----------|------|-------------|
| Page | `templates/page-template/` | Standard page with lifecycle hooks, data binding, events |
| Component | `templates/component-template/` | Custom component with properties, observers, events |
| Cloud Function | `templates/cloud-function-template/` | Cloud function with database access, error handling |
