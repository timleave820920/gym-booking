# 配置文件参考 App Config Reference

## 目录
- [app.json 全局配置](#appjson-全局配置)
- [页面 .json 配置](#页面-json-配置)
- [project.config.json](#projectconfigjson)
- [sitemap.json](#sitemapjson)
- [分包配置](#分包配置)

---

## app.json 全局配置

```json
{
  "pages": [
    "pages/index/index",
    "pages/logs/logs"
  ],
  "window": {
    "navigationBarBackgroundColor": "#ffffff",
    "navigationBarTextStyle": "black",
    "navigationBarTitleText": "小程序",
    "navigationStyle": "default",
    "backgroundColor": "#eeeeee",
    "backgroundTextStyle": "light",
    "enablePullDownRefresh": false,
    "onReachBottomDistance": 50
  },
  "tabBar": {
    "color": "#999999",
    "selectedColor": "#1296db",
    "backgroundColor": "#ffffff",
    "borderStyle": "black",
    "position": "bottom",
    "list": [
      {
        "pagePath": "pages/index/index",
        "text": "首页",
        "iconPath": "assets/tab/home.png",
        "selectedIconPath": "assets/tab/home-active.png"
      },
      {
        "pagePath": "pages/mine/mine",
        "text": "我的",
        "iconPath": "assets/tab/mine.png",
        "selectedIconPath": "assets/tab/mine-active.png"
      }
    ]
  },
  "networkTimeout": {
    "request": 10000,
    "downloadFile": 10000,
    "uploadFile": 10000,
    "connectSocket": 10000
  },
  "debug": false,
  "permission": {
    "scope.userLocation": {
      "desc": "你的位置信息将用于定位附近门店"
    }
  },
  "requiredPrivateInfos": ["getLocation", "chooseLocation"],
  "usingComponents": {},
  "sitemapLocation": "sitemap.json",
  "style": "v2",
  "lazyCodeLoading": "requiredComponents",
  "useExtendedLib": {
    "weui": true
  }
}
```

### 关键字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `pages` | string[] | **必填。** 页面路径列表，第一项为首页 |
| `window` | Object | 全局默认窗口样式 |
| `tabBar` | Object | Tab 栏配置（最少 2 个、最多 5 个 tab） |
| `networkTimeout` | Object | 网络超时时间（ms） |
| `subpackages` | Object[] | 分包配置 |
| `preloadRule` | Object | 分包预加载规则 |
| `permission` | Object | 接口权限描述 |
| `requiredPrivateInfos` | string[] | 使用的隐私接口列表 |
| `usingComponents` | Object | 全局自定义组件 |
| `lazyCodeLoading` | string | `"requiredComponents"` 启用按需注入 |

### window 配置

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `navigationBarBackgroundColor` | HexColor | `#000000` | 导航栏背景色 |
| `navigationBarTextStyle` | string | `white` | 导航栏标题颜色（仅 `black`/`white`） |
| `navigationBarTitleText` | string | | 导航栏标题 |
| `navigationStyle` | string | `default` | `custom` 则隐藏默认导航栏 |
| `backgroundColor` | HexColor | `#ffffff` | 窗口背景色（下拉露出区域） |
| `backgroundTextStyle` | string | `dark` | 下拉 loading 样式（`dark`/`light`） |
| `enablePullDownRefresh` | boolean | `false` | 是否全局开启下拉刷新 |
| `onReachBottomDistance` | number | `50` | 触底事件触发距离（px） |

### tabBar 配置

| 属性 | 类型 | 说明 |
|------|------|------|
| `color` | HexColor | tab 文字默认颜色 |
| `selectedColor` | HexColor | tab 文字选中颜色 |
| `backgroundColor` | HexColor | tab 背景色 |
| `borderStyle` | string | tabBar 上边框颜色（`black`/`white`） |
| `position` | string | tabBar 位置（`bottom`/`top`） |
| `custom` | boolean | `true` 为自定义 tabBar |
| `list` | Array | tab 列表（2-5 个） |

list 每项：`pagePath` (必填), `text` (必填), `iconPath`, `selectedIconPath`
图标大小限制：40KB，建议 81px × 81px

---

## 页面 .json 配置

页面配置会覆盖 app.json 中 window 的同名配置。

```json
{
  "navigationBarTitleText": "商品详情",
  "navigationBarBackgroundColor": "#ffffff",
  "navigationBarTextStyle": "black",
  "navigationStyle": "custom",
  "enablePullDownRefresh": true,
  "onReachBottomDistance": 100,
  "backgroundColor": "#f5f5f5",
  "backgroundTextStyle": "dark",
  "disableScroll": false,
  "usingComponents": {
    "product-card": "/components/product-card/product-card",
    "van-button": "@vant/weapp/button/index"
  },
  "componentPlaceholder": {
    "product-card": "view"
  }
}
```

| 属性 | 说明 |
|------|------|
| `disableScroll` | `true` 禁止页面整体滚动 |
| `usingComponents` | 页面级自定义组件声明 |
| `componentPlaceholder` | 组件懒加载时的占位组件 |
| `initialRenderingCache` | `"static"` 开启初始渲染缓存 |

---

## project.config.json

```json
{
  "appid": "wx1234567890abcdef",
  "compileType": "miniprogram",
  "libVersion": "3.3.4",
  "packOptions": {
    "ignore": [
      { "type": "file", "value": ".eslintrc.js" },
      { "type": "folder", "value": "node_modules" }
    ]
  },
  "setting": {
    "es6": true,
    "postcss": true,
    "minified": true,
    "urlCheck": true,
    "enhance": true,
    "coverView": true,
    "autoAudits": false,
    "showShadowRootInWxmlPanel": true,
    "compileHotReLoad": true,
    "useCompilerPlugins": ["typescript", "less"]
  },
  "condition": {}
}
```

**注意：** `project.private.config.json` 用于本地覆盖，加入 `.gitignore` 不提交。

---

## sitemap.json

控制微信搜索对小程序页面的索引。

```json
{
  "desc": "关于本文件的更多信息，请参考文档",
  "rules": [
    {
      "action": "allow",
      "page": "*"
    },
    {
      "action": "disallow",
      "page": "pages/user/*"
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `action` | `allow` 允许索引 / `disallow` 禁止索引 |
| `page` | 页面路径，支持 `*` 通配符 |

---

## 分包配置

### 基础分包

```json
{
  "pages": ["pages/index/index", "pages/logs/logs"],
  "subpackages": [
    {
      "root": "packageA",
      "name": "shop",
      "pages": ["pages/list/list", "pages/detail/detail"]
    },
    {
      "root": "packageB",
      "pages": ["pages/settings/settings"]
    }
  ]
}
```

- 主包 + 分包总计不超过 **20MB**
- 单个分包/主包不超过 **2MB**
- 分包页面路径：`packageA/pages/list/list`

### 独立分包

可独立于主包加载，无需下载主包。

```json
{
  "subpackages": [
    {
      "root": "packageC",
      "pages": ["pages/landing/landing"],
      "independent": true
    }
  ]
}
```

**限制：** 独立分包不能引用主包的资源（JS、组件、wxss）

### 分包预加载

```json
{
  "preloadRule": {
    "pages/index/index": {
      "network": "all",
      "packages": ["shop"]
    },
    "packageA/pages/list/list": {
      "network": "wifi",
      "packages": ["packageB"]
    }
  }
}
```

| 字段 | 说明 |
|------|------|
| key | 触发预加载的页面路径 |
| `network` | `all` (所有网络) / `wifi` (仅 WiFi) |
| `packages` | 要预加载的分包 name 或 root |
