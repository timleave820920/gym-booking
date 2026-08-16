# 导航与 UI 反馈 API Navigation & UI

## 目录
- [页面导航](#页面导航)
- [UI 反馈](#ui-反馈)
- [导航栏](#导航栏)
- [TabBar](#tabbar)
- [滚动与刷新](#滚动与刷新)
- [动画](#动画)

---

## 页面导航

```javascript
// navigateTo — 保留当前页，入栈新页（栈上限 10）
wx.navigateTo({
  url: '/pages/detail/detail?id=123&type=product',
  events: {
    onResult(data) { console.log('接收被打开页面的数据:', data) }
  },
  success(res) {
    res.eventChannel.emit('sendData', { fromParent: true })
  }
})

// redirectTo — 关闭当前页，打开新页（不增加栈）
wx.redirectTo({ url: '/pages/result/result' })

// switchTab — 跳转到 tabBar 页面（关闭所有非 tab 页，url 不能带参数）
wx.switchTab({ url: '/pages/home/home' })

// navigateBack — 返回上 N 页
wx.navigateBack({ delta: 1 })

// reLaunch — 关闭所有页面，打开新页
wx.reLaunch({ url: '/pages/index/index?from=relaunch' })
```

### EventChannel 页面通信

```javascript
// 被打开页面接收/发送数据
Page({
  onLoad() {
    const channel = this.getOpenerEventChannel()
    channel.on('sendData', (data) => { console.log(data) })
    channel.emit('onResult', { success: true })
  }
})
```

---

## UI 反馈

```javascript
// Toast 提示
wx.showToast({ title: '成功', icon: 'success', duration: 1500, mask: true })
wx.showToast({ title: '提示信息', icon: 'none', duration: 2000 })
wx.showToast({ title: '加载中', icon: 'loading' })
wx.hideToast()

// Loading 加载
wx.showLoading({ title: '加载中...', mask: true })
wx.hideLoading()
// ⚠️ showLoading 和 showToast 互斥，调用一个会隐藏另一个

// Modal 模态框
wx.showModal({
  title: '确认删除',
  content: '删除后不可恢复',
  showCancel: true,
  cancelText: '取消',
  confirmText: '删除',
  confirmColor: '#e64340',
  success(res) {
    if (res.confirm) { /* 用户确认 */ }
    else if (res.cancel) { /* 用户取消 */ }
  }
})

// ActionSheet 操作菜单
wx.showActionSheet({
  itemList: ['拍照', '从相册选择', '取消'],
  success(res) {
    console.log('选择了第', res.tapIndex, '项') // 0-based
  },
  fail() { /* 用户取消 */ }
})
```

---

## 导航栏

```javascript
// 设置标题
wx.setNavigationBarTitle({ title: '新标题' })

// 设置颜色
wx.setNavigationBarColor({
  frontColor: '#ffffff',     // 仅支持 '#ffffff' 和 '#000000'
  backgroundColor: '#1296db',
  animation: { duration: 300, timingFunc: 'easeIn' }
})

// 导航栏 loading
wx.showNavigationBarLoading()
wx.hideNavigationBarLoading()
```

---

## TabBar

```javascript
// 修改 tab 项
wx.setTabBarItem({
  index: 0,
  text: '新标题',
  iconPath: '/images/tab/new.png',
  selectedIconPath: '/images/tab/new-active.png'
})

// 红点/徽标
wx.setTabBarBadge({ index: 1, text: '3' })   // 数字徽标
wx.removeTabBarBadge({ index: 1 })
wx.showTabBarRedDot({ index: 2 })              // 红点
wx.hideTabBarRedDot({ index: 2 })

// 显示/隐藏整个 TabBar
wx.showTabBar({ animation: true })
wx.hideTabBar({ animation: true })

// 设置 TabBar 样式
wx.setTabBarStyle({
  color: '#999',
  selectedColor: '#1296db',
  backgroundColor: '#fff',
  borderStyle: 'white'
})
```

---

## 滚动与刷新

```javascript
// 滚动到指定位置
wx.pageScrollTo({
  scrollTop: 0,           // 滚动到顶部
  duration: 300,          // 动画时长 ms
  selector: '#target'     // 或滚动到指定元素
})

// 触发下拉刷新
wx.startPullDownRefresh()

// 停止下拉刷新（在 onPullDownRefresh 处理完后调用）
wx.stopPullDownRefresh()
```

---

## 动画

```javascript
// 创建动画
const animation = wx.createAnimation({
  duration: 400,
  timingFunction: 'ease',
  delay: 0,
  transformOrigin: '50% 50% 0'
})

// 链式调用
animation.opacity(1).translateY(0).step()
this.setData({ animationData: animation.export() })

// 多步动画
animation.translateX(100).step()
animation.rotate(45).step({ duration: 200 })
this.setData({ animationData: animation.export() })
```

```html
<view animation="{{ animationData }}" class="box">动画元素</view>
```

**timingFunction 可选值：** `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `step-start`, `step-end`
