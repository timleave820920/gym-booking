# 内置组件参考 Components Reference

## 目录
- [容器组件](#容器组件)
- [基础内容](#基础内容)
- [媒体组件](#媒体组件)
- [表单组件](#表单组件)
- [导航组件](#导航组件)
- [地图与画布](#地图与画布)
- [开放能力](#开放能力)

---

## 容器组件

### view

通用容器，类似 HTML `div`。

```html
<view class="container" hover-class="hover" hover-stay-time="400">
  <view>内容</view>
</view>
```

| 属性 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `hover-class` | string | none | 点击态类名，`none` 表示无点击态 |
| `hover-stop-propagation` | boolean | false | 阻止祖先节点点击态 |
| `hover-start-time` | number | 50 | 按住多久后出现点击态（ms） |
| `hover-stay-time` | number | 400 | 松开后点击态保留时间（ms） |

### scroll-view

可滚动视图区域。

```html
<!-- 纵向滚动 -->
<scroll-view
  scroll-y
  style="height: 500rpx;"
  bindscrolltolower="loadMore"
  bindscroll="onScroll"
  refresher-enabled
  bindrefresherrefresh="onRefresh"
  refresher-triggered="{{ isRefreshing }}"
  scroll-into-view="{{ scrollToId }}"
  enhanced
  show-scrollbar="{{ false }}"
>
  <view wx:for="{{ items }}" wx:key="id" id="item-{{ item.id }}">
    {{ item.name }}
  </view>
</scroll-view>
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `scroll-x` | boolean | 横向滚动 |
| `scroll-y` | boolean | 纵向滚动 |
| `upper-threshold` | number | 距顶/左多远触发 scrolltoupper（px，默认 50） |
| `lower-threshold` | number | 距底/右多远触发 scrolltolower（px，默认 50） |
| `scroll-top` | number | 设置纵向滚动条位置 |
| `scroll-into-view` | string | 滚动到某子元素 id |
| `scroll-with-animation` | boolean | 滚动动画 |
| `refresher-enabled` | boolean | 开启自定义下拉刷新 |
| `refresher-triggered` | boolean | 控制刷新状态 |
| `enhanced` | boolean | 增强模式（更多 API） |
| `show-scrollbar` | boolean | 是否显示滚动条 |

**事件：** `bindscrolltoupper`, `bindscrolltolower`, `bindscroll`, `bindrefresherrefresh`, `bindrefresherrestore`

**注意：** 纵向滚动必须设置固定高度。

### swiper + swiper-item

滑块视图容器（轮播图）。

```html
<swiper
  indicator-dots
  autoplay
  interval="3000"
  duration="500"
  circular
  bindchange="onSwiperChange"
>
  <swiper-item wx:for="{{ banners }}" wx:key="id">
    <image src="{{ item.imageUrl }}" mode="aspectFill" />
  </swiper-item>
</swiper>
```

| 属性 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `indicator-dots` | boolean | false | 显示指示点 |
| `indicator-color` | color | rgba(0,0,0,.3) | 指示点颜色 |
| `indicator-active-color` | color | #000 | 当前指示点颜色 |
| `autoplay` | boolean | false | 自动播放 |
| `interval` | number | 5000 | 自动切换间隔（ms） |
| `duration` | number | 500 | 切换动画时长（ms） |
| `circular` | boolean | false | 循环播放 |
| `vertical` | boolean | false | 纵向滑动 |
| `current` | number | 0 | 当前页索引 |

### cover-view / cover-image

覆盖在原生组件（map, video, canvas, camera）上的视图容器。

```html
<video src="{{ videoUrl }}">
  <cover-view class="controls">
    <cover-image src="/images/play.png" />
  </cover-view>
</video>
```

---

## 基础内容

### text

文本组件。

```html
<text selectable>可选中的文本</text>
<text space="nbsp">带空格  的文本</text>
<text decode>{{ '&lt;div&gt;' }}</text>
<text user-select>长按可选</text>
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `selectable` | boolean | 文本可选 (已废弃, 用 user-select) |
| `user-select` | boolean | 文本可选 |
| `space` | string | 显示连续空格: `ensp`/`emsp`/`nbsp` |
| `decode` | boolean | 解码 `&amp;` `&lt;` `&gt;` `&nbsp;` `&apos;` `&quot;` |

**注意：** `<text>` 内只能嵌套 `<text>`，不能嵌套其他组件。

### rich-text

富文本。

```html
<rich-text nodes="{{ htmlContent }}" />
```

nodes 支持 HTML 字符串或节点数组。

### icon

图标。

```html
<icon type="success" size="23" color="#09BB07" />
```

type 值: `success`, `success_no_circle`, `info`, `warn`, `waiting`, `cancel`, `download`, `search`, `clear`

### progress

进度条。

```html
<progress percent="{{ 80 }}" show-info stroke-width="6" activeColor="#1296db" />
```

---

## 媒体组件

### image

图片。**重要组件，mode 属性常见面试题。**

```html
<image
  src="{{ imageUrl }}"
  mode="aspectFill"
  lazy-load
  show-menu-by-longpress
  binderror="onImageError"
  bindload="onImageLoad"
/>
```

| mode | 说明 |
|------|------|
| `scaleToFill` | 默认。拉伸填满，不保持比例 |
| `aspectFit` | 保持比例，完整显示，可能留白 |
| `aspectFill` | 保持比例，裁剪填满（最常用） |
| `widthFix` | 宽度不变，高度自适应（避免布局抖动） |
| `heightFix` | 高度不变，宽度自适应 |
| `top`/`bottom`/`center`/`left`/`right` | 不缩放，只显示对应位置区域 |

| 属性 | 类型 | 说明 |
|------|------|------|
| `lazy-load` | boolean | 懒加载（仅在即将进入视窗时加载） |
| `show-menu-by-longpress` | boolean | 长按显示识别小程序码菜单 |
| `webp` | boolean | 默认不解析 webp（安卓默认支持） |

**事件：** `bindload` (加载完成, e.detail = { width, height }), `binderror` (加载失败)

```javascript
// 图片加载失败时使用默认图
onImageError(e) {
  const idx = e.currentTarget.dataset.idx
  this.setData({ [`items[${idx}].imageUrl`]: '/images/default.png' })
}
```

### video

```html
<video
  src="{{ videoUrl }}"
  poster="{{ posterUrl }}"
  controls
  autoplay="{{ false }}"
  loop="{{ false }}"
  muted="{{ false }}"
  show-fullscreen-btn
  show-play-btn
  enable-progress-gesture
  bindplay="onPlay"
  bindpause="onPause"
  bindended="onEnded"
  binderror="onError"
/>
```

### camera

```html
<camera device-position="back" flash="auto" bindscancode="onScanCode">
  <cover-view class="btn" bindtap="takePhoto">拍照</cover-view>
</camera>
```

---

## 表单组件

### form

```html
<form bindsubmit="onSubmit" bindreset="onReset">
  <input name="username" placeholder="用户名" />
  <textarea name="content" placeholder="内容" />
  <button form-type="submit">提交</button>
  <button form-type="reset">重置</button>
</form>
```

```javascript
onSubmit(e) {
  const { username, content } = e.detail.value
}
```

### input

```html
<input
  type="text"
  value="{{ inputVal }}"
  placeholder="请输入"
  placeholder-style="color: #999;"
  maxlength="20"
  focus="{{ autoFocus }}"
  bindinput="onInput"
  bindfocus="onFocus"
  bindblur="onBlur"
  bindconfirm="onConfirm"
  confirm-type="search"
/>
```

| type | 说明 |
|------|------|
| `text` | 文本键盘 |
| `number` | 数字键盘 |
| `idcard` | 身份证键盘 |
| `digit` | 带小数点数字键盘 |
| `nickname` | 昵称输入（获取微信昵称） |
| `safe-password` | 安全密码输入 |

| confirm-type | 说明 |
|--------------|------|
| `send` | 发送 |
| `search` | 搜索 |
| `next` | 下一个 |
| `go` | 前往 |
| `done` | 完成 |

### button

```html
<button type="primary" size="default" loading="{{ isLoading }}">
  主按钮
</button>
<button type="default" plain>朴素按钮</button>
<button type="warn">警告按钮</button>
<button size="mini">小按钮</button>

<!-- 开放能力按钮 -->
<button open-type="contact">客服</button>
<button open-type="share">分享</button>
<button open-type="getPhoneNumber" bindgetphonenumber="onGetPhone">手机号</button>
<button open-type="launchApp" app-parameter="wechat">打开 APP</button>
<button open-type="openSetting">设置</button>
<button open-type="feedback">反馈</button>
<button open-type="chooseAvatar" bindchooseavatar="onChooseAvatar">头像</button>
```

### picker

```html
<!-- 普通选择器 -->
<picker mode="selector" range="{{ areas }}" bindchange="onAreaChange">
  <view>{{ areas[areaIndex] }}</view>
</picker>

<!-- 多列选择器 -->
<picker mode="multiSelector" range="{{ multiArray }}" bindchange="onChange" bindcolumnchange="onColumnChange">
  <view>{{ selected }}</view>
</picker>

<!-- 时间选择器 -->
<picker mode="time" value="{{ time }}" start="09:00" end="21:00" bindchange="onTimeChange">
  <view>{{ time }}</view>
</picker>

<!-- 日期选择器 -->
<picker mode="date" value="{{ date }}" start="2020-01-01" end="2030-12-31" bindchange="onDateChange">
  <view>{{ date }}</view>
</picker>

<!-- 省市区选择器 -->
<picker mode="region" value="{{ region }}" bindchange="onRegionChange">
  <view>{{ region[0] }} {{ region[1] }} {{ region[2] }}</view>
</picker>
```

### checkbox / radio / switch / slider

```html
<!-- 复选框 -->
<checkbox-group bindchange="onCheckChange">
  <label wx:for="{{ checkItems }}" wx:key="value">
    <checkbox value="{{ item.value }}" checked="{{ item.checked }}" />
    {{ item.label }}
  </label>
</checkbox-group>

<!-- 单选框 -->
<radio-group bindchange="onRadioChange">
  <label wx:for="{{ radioItems }}" wx:key="value">
    <radio value="{{ item.value }}" checked="{{ item.checked }}" />
    {{ item.label }}
  </label>
</radio-group>

<!-- 开关 -->
<switch checked="{{ isOn }}" bindchange="onSwitchChange" color="#1296db" />

<!-- 滑块 -->
<slider value="{{ volume }}" min="0" max="100" step="1" show-value bindchange="onSliderChange" />
```

---

## 导航组件

### navigator

```html
<navigator url="/pages/detail/detail?id=1" open-type="navigate">
  跳转到详情
</navigator>
<navigator url="/pages/index/index" open-type="switchTab">
  切换到首页
</navigator>
<navigator open-type="navigateBack" delta="1">返回</navigator>
```

| open-type | 对应 API |
|-----------|---------|
| `navigate` | wx.navigateTo |
| `redirect` | wx.redirectTo |
| `switchTab` | wx.switchTab |
| `reLaunch` | wx.reLaunch |
| `navigateBack` | wx.navigateBack |

---

## 地图与画布

### map

```html
<map
  longitude="{{ longitude }}"
  latitude="{{ latitude }}"
  scale="16"
  markers="{{ markers }}"
  polyline="{{ polyline }}"
  show-location
  bindmarkertap="onMarkerTap"
  bindregionchange="onRegionChange"
  style="width: 100%; height: 600rpx;"
/>
```

markers 数据格式：
```javascript
markers: [{
  id: 1,
  latitude: 39.9042,
  longitude: 116.4074,
  title: '北京',
  iconPath: '/images/marker.png',
  width: 30,
  height: 30,
  callout: { content: '标记说明', display: 'ALWAYS', borderRadius: 5, padding: 5 }
}]
```

### canvas

```html
<!-- Canvas 2D (推荐) -->
<canvas type="2d" id="myCanvas" style="width: 300px; height: 200px;" />
```

```javascript
onReady() {
  const query = wx.createSelectorQuery()
  query.select('#myCanvas').fields({ node: true, size: true }).exec((res) => {
    const canvas = res[0].node
    const ctx = canvas.getContext('2d')
    canvas.width = res[0].width * wx.getWindowInfo().pixelRatio
    canvas.height = res[0].height * wx.getWindowInfo().pixelRatio
    ctx.scale(wx.getWindowInfo().pixelRatio, wx.getWindowInfo().pixelRatio)

    ctx.fillStyle = '#ff0000'
    ctx.fillRect(10, 10, 100, 50)
    ctx.fillStyle = '#000000'
    ctx.font = '16px sans-serif'
    ctx.fillText('Hello Canvas', 10, 90)
  })
}
```

---

## 开放能力

### web-view

嵌入网页（需配置业务域名）。

```html
<web-view src="https://example.com/h5" bindmessage="onMessage" />
```

**限制：** 会自动铺满整个小程序页面，无法覆盖其他组件。

### open-data

展示微信开放数据（无需授权）。

```html
<!-- 显示群名称（仅在分享到群场景有效） -->
<open-data type="groupName" open-gid="{{ openGid }}" />
```

**注意：** 用户头像和昵称的 open-data 已不再支持，使用 button + chooseAvatar 和 input type="nickname" 替代。
