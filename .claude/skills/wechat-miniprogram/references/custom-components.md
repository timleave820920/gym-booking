# 自定义组件 Custom Components

## 目录
- [组件创建](#组件创建)
- [Properties 属性](#properties-属性)
- [Observers 数据监听](#observers-数据监听)
- [生命周期](#生命周期)
- [Behaviors 混入](#behaviors-混入)
- [Relations 组件关系](#relations-组件关系)
- [Slots 插槽](#slots-插槽)
- [组件事件通信](#组件事件通信)
- [外部样式类](#外部样式类)
- [纯数据字段](#纯数据字段)
- [抽象节点](#抽象节点)

---

## 组件创建

### 目录结构

```
components/my-component/
├── my-component.js     # Component({}) 逻辑
├── my-component.wxml   # 模板
├── my-component.wxss   # 样式（默认隔离）
└── my-component.json   # {"component": true}
```

### JSON 配置

```json
{ "component": true, "usingComponents": {} }
```

### 页面中使用

```json
// page.json
{ "usingComponents": { "my-component": "/components/my-component/my-component" } }
```

```html
<my-component title="Hello" bind:itemtap="onItemTap" />
```

---

## Properties 属性

```javascript
Component({
  properties: {
    // 简写
    title: String,
    count: Number,
    show: Boolean,

    // 完整写法
    items: {
      type: Array,
      value: []    // 默认值
    },
    config: {
      type: Object,
      value: {}
    },
    // type 可选: String, Number, Boolean, Object, Array, null(任意类型)
  }
})
```

**注意：** 不要使用 `observer` 属性（已废弃），用 `observers` 替代。

---

## Observers 数据监听

```javascript
Component({
  properties: { price: Number, quantity: Number },
  data: { total: 0, _cache: {} },

  observers: {
    // 单字段监听
    'price'(newPrice) {
      this.setData({ total: newPrice * this.data.quantity })
    },

    // 多字段同时监听
    'price, quantity'(price, quantity) {
      this.setData({ total: price * quantity })
    },

    // 深层监听（对象字段）
    'config.theme'(theme) {
      this.applyTheme(theme)
    },

    // 数组元素监听
    'items[0].name'(name) {
      console.log('第一项名称变了:', name)
    },

    // 通配符（任意子字段变化都触发）
    'config.**'(config) {
      // config 对象任何层级变化都触发
    },

    // 监听所有 setData（慎用）
    '**'() {
      // 任何 data/properties 变化都触发
    }
  }
})
```

**陷阱：** observers 在 setData 后同步触发，不要在 observer 中无条件 setData 同一字段（死循环）。

---

## 生命周期

```javascript
Component({
  lifetimes: {
    created() {
      // 组件实例创建。不能调 setData，不能访问 DOM
    },
    attached() {
      // 进入页面节点树。最常用：初始化数据、发请求
      this.setData({ loading: true })
    },
    ready() {
      // 首次渲染完成。可以操作 DOM
      this.createSelectorQuery().select('.box').boundingClientRect((rect) => {
        // rect.width, rect.height
      }).exec()
    },
    moved() {
      // 在节点树中移动（少用）
    },
    detached() {
      // 从节点树移除。清理：定时器、事件监听
      clearInterval(this._timer)
    },
    error(err) {
      // 组件方法抛出错误
      console.error('Component error:', err)
    }
  },

  // 监听所在页面的生命周期
  pageLifetimes: {
    show() { /* 页面显示 */ },
    hide() { /* 页面隐藏，可暂停动画 */ },
    resize(size) { /* 窗口变化。size = { windowWidth, windowHeight } */ }
  }
})
```

**执行顺序：** `created` → `attached` → `ready`（卸载触发 `detached`）

---

## Behaviors 混入

类似 Vue mixins，提取共享逻辑。

```javascript
// behaviors/pagination.js
module.exports = Behavior({
  properties: {
    pageSize: { type: Number, value: 20 }
  },
  data: {
    currentPage: 1,
    hasMore: true,
    loading: false
  },
  methods: {
    loadNextPage() {
      if (!this.data.hasMore || this.data.loading) return
      this.setData({ loading: true, currentPage: this.data.currentPage + 1 })
    }
  }
})
```

```javascript
// 使用
const pagination = require('../../behaviors/pagination')
Component({
  behaviors: [pagination],
  // 组件的同名属性/方法会覆盖 behavior 的
  // 生命周期不覆盖，按顺序执行：behavior 先，组件后
})
```

### 覆盖规则

| 类型 | 规则 |
|------|------|
| properties | 组件 > behavior（后引入 > 先引入） |
| data | 组件 > behavior |
| methods | 组件 > behavior |
| lifetimes | 全部执行，behavior 先 → 组件后 |
| observers | 全部执行 |

### 内置 Behaviors

```javascript
Component({
  behaviors: [
    'wx://form-field',       // 可作为表单字段（含 name/value）
    'wx://component-export'  // 自定义 selectComponent 返回值
  ]
})
```

---

## Relations 组件关系

定义父子关联，自动发现关联组件。

```javascript
// tabs.js（父）
Component({
  relations: {
    './tab-item': {
      type: 'child',
      linked(target) { this._updateTabs() },
      unlinked(target) { this._updateTabs() }
    }
  },
  methods: {
    _updateTabs() {
      const items = this.getRelationNodes('./tab-item')
      // items 是子组件实例数组，按 WXML 顺序排列
    }
  }
})

// tab-item.js（子）
Component({
  relations: {
    './tabs': { type: 'parent' }
  }
})
```

type 值: `parent`, `child`, `ancestor`, `descendant`

**两个组件必须同时定义 relations 且方向匹配才生效。**

---

## Slots 插槽

### 默认插槽

```html
<!-- 组件模板 -->
<view class="card"><slot /></view>

<!-- 使用 -->
<my-card><text>内容</text></my-card>
```

### 具名插槽

需启用 `multipleSlots`:

```javascript
Component({ options: { multipleSlots: true } })
```

```html
<!-- 组件模板 -->
<view class="card">
  <slot name="header" />
  <slot name="body" />
  <slot name="footer" />
</view>

<!-- 使用 -->
<my-card>
  <view slot="header">标题</view>
  <view slot="body">内容</view>
  <view slot="footer"><button>操作</button></view>
</my-card>
```

---

## 组件事件通信

### 子 → 父：triggerEvent

```javascript
// 子组件
Component({
  methods: {
    onTap() {
      this.triggerEvent('itemtap', { id: 123, name: '商品' }, {
        bubbles: false,     // 是否冒泡
        composed: false,    // 是否穿越组件边界
        capturePhase: false // 是否有捕获阶段
      })
    }
  }
})
```

```html
<!-- 父组件 -->
<child-comp bind:itemtap="onChildTap" />
```

```javascript
// 父组件
Page({
  onChildTap(e) {
    console.log(e.detail) // { id: 123, name: '商品' }
  }
})
```

### 父 → 子：selectComponent

```javascript
// 父组件
Page({
  onReady() {
    const child = this.selectComponent('#child-id')
    child.someMethod()            // 调用子组件方法
    console.log(child.data.count) // 读取子组件数据
  }
})
```

```html
<child-comp id="child-id" />
```

---

## 外部样式类

```javascript
Component({
  externalClasses: ['custom-class', 'title-class']
})
```

```html
<!-- 组件模板 -->
<view class="inner custom-class">
  <text class="title title-class">标题</text>
</view>

<!-- 使用 -->
<my-comp custom-class="big-card" title-class="red-title" />
```

**注意：** 同一节点同时使用内部和外部样式类时优先级不确定，需要时用 `!important`。

---

## 纯数据字段

不参与渲染的数据，提升性能。

```javascript
Component({
  options: {
    pureDataPattern: /^_/ // 以 _ 开头的字段为纯数据
  },
  data: {
    _timer: null,    // 纯数据：不渲染
    _cache: {},      // 纯数据：不渲染
    count: 0         // 普通数据：参与渲染
  }
})
```

纯数据字段的 setData 不触发视图更新，但会触发 observers。

---

## 抽象节点

让使用者在使用组件时决定某个节点的具体实现（泛型组件）。

```json
// selectable-group.json
{
  "component": true,
  "componentGenerics": {
    "selectable": true,
    "item-with-default": { "default": "components/checkbox/checkbox" }
  }
}
```

```html
<!-- selectable-group.wxml -->
<view wx:for="{{ items }}" wx:key="id">
  <selectable selected="{{ item.selected }}" bind:change="onChange" />
</view>

<!-- 使用时指定具体实现 -->
<selectable-group generic:selectable="my-radio" items="{{ items }}" />
<selectable-group generic:selectable="my-checkbox" items="{{ items }}" />
```
