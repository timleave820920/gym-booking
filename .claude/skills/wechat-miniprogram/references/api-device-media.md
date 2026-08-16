# 设备与媒体 API Device & Media

## 目录
- [系统信息](#系统信息)
- [地理位置](#地理位置)
- [图片与媒体](#图片与媒体)
- [音频](#音频)
- [剪贴板与屏幕](#剪贴板与屏幕)
- [蓝牙](#蓝牙)
- [Canvas 画布](#canvas-画布)

---

## 系统信息

```javascript
// 推荐：分拆 API（新版）
const windowInfo = wx.getWindowInfo()
// windowInfo.windowWidth, windowInfo.windowHeight
// windowInfo.screenWidth, windowInfo.screenHeight
// windowInfo.statusBarHeight
// windowInfo.safeArea = { top, bottom, left, right, width, height }
// windowInfo.pixelRatio

const deviceInfo = wx.getDeviceInfo()
// deviceInfo.brand, deviceInfo.model, deviceInfo.system, deviceInfo.platform

const appBaseInfo = wx.getAppBaseInfo()
// appBaseInfo.SDKVersion, appBaseInfo.language, appBaseInfo.version, appBaseInfo.theme

// 旧版（仍可用，返回合并信息）
const sysInfo = wx.getSystemInfoSync()
// 包含以上所有字段
```

### 安全区域适配

```javascript
const { safeArea, windowHeight } = wx.getWindowInfo()
// 底部安全距离（如 iPhone X 底部圆角）
const bottomSafe = windowHeight - safeArea.bottom
```

```css
/* CSS 适配 */
.footer {
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
}
```

---

## 地理位置

```javascript
// 获取当前位置（需要 app.json 中声明权限）
wx.getLocation({
  type: 'gcj02',  // wgs84 | gcj02（国内推荐 gcj02）
  altitude: false,
  isHighAccuracy: false,
  success(res) {
    // res.latitude, res.longitude
    // res.speed, res.accuracy, res.altitude
  },
  fail(err) {
    if (err.errMsg.includes('deny') || err.errMsg.includes('auth')) {
      // 用户拒绝授权，引导去设置
      wx.showModal({
        title: '需要位置权限',
        success(r) { if (r.confirm) wx.openSetting() }
      })
    }
  }
})

// 地图选点
wx.chooseLocation({
  latitude: 39.9042,
  longitude: 116.4074,
  success(res) {
    // res.name, res.address, res.latitude, res.longitude
  }
})

// 打开内置地图查看位置
wx.openLocation({
  latitude: 39.9042,
  longitude: 116.4074,
  scale: 18,
  name: '北京天安门',
  address: '北京市东城区'
})
```

**app.json 权限声明：**
```json
{
  "permission": {
    "scope.userLocation": { "desc": "你的位置信息将用于定位附近门店" }
  },
  "requiredPrivateInfos": ["getLocation", "chooseLocation"]
}
```

---

## 图片与媒体

```javascript
// 选择图片/视频（推荐 chooseMedia）
wx.chooseMedia({
  count: 9,
  mediaType: ['image', 'video'],  // 或单选 ['image']
  sourceType: ['album', 'camera'],
  maxDuration: 30,                // 视频最长秒数
  camera: 'back',                 // 默认摄像头
  success(res) {
    // res.tempFiles = [{ tempFilePath, size, duration, height, width, thumbTempFilePath }]
    const images = res.tempFiles.map((f) => f.tempFilePath)
  }
})

// 预览图片（全屏）
wx.previewImage({
  urls: ['url1', 'url2', 'url3'],
  current: 'url2'  // 当前显示哪张
})

// 压缩图片
wx.compressImage({
  src: tempFilePath,
  quality: 80,  // 0-100
  success(res) { /* res.tempFilePath */ }
})

// 保存到相册（需要 scope.writePhotosAlbum 权限）
wx.saveImageToPhotosAlbum({
  filePath: tempFilePath,
  success() { wx.showToast({ title: '已保存' }) }
})
```

---

## 音频

```javascript
const audio = wx.createInnerAudioContext()
audio.src = 'https://example.com/music.mp3'
audio.startTime = 0
audio.autoplay = false
audio.loop = false

audio.play()
audio.pause()
audio.stop()
audio.seek(30) // 跳到 30 秒

audio.onPlay(() => { console.log('开始播放') })
audio.onPause(() => {})
audio.onStop(() => {})
audio.onEnded(() => {})
audio.onError((err) => { console.error(err.errCode, err.errMsg) })
audio.onTimeUpdate(() => {
  console.log('当前时间:', audio.currentTime, '总时长:', audio.duration)
})

// 销毁（在 onUnload 中调用）
audio.destroy()
```

---

## 剪贴板与屏幕

```javascript
// 剪贴板
wx.setClipboardData({
  data: '要复制的文本',
  success() { /* 默认会弹 Toast */ }
})
wx.getClipboardData({
  success(res) { console.log(res.data) }
})

// 屏幕亮度
wx.setScreenBrightness({ value: 0.8 })  // 0-1
wx.getScreenBrightness({ success(res) { /* res.value */ } })

// 保持屏幕常亮
wx.setKeepScreenOn({ keepScreenOn: true })

// 振动
wx.vibrateShort({ type: 'heavy' })  // heavy | medium | light
wx.vibrateLong()                    // 长振动 400ms
```

---

## 蓝牙

```javascript
// 初始化蓝牙
wx.openBluetoothAdapter({
  success() {
    // 开始搜索设备
    wx.startBluetoothDevicesDiscovery({
      services: ['FEE0'],  // 过滤特定服务 UUID
      success() {
        wx.onBluetoothDeviceFound((res) => {
          const device = res.devices[0]
          // device.name, device.deviceId, device.RSSI
        })
      }
    })
  }
})

// 连接设备
wx.createBLEConnection({
  deviceId: 'xxx',
  success() {
    wx.getBLEDeviceServices({ deviceId: 'xxx', success(res) { /* res.services */ } })
  }
})

// 读写特征值
wx.readBLECharacteristicValue({ deviceId, serviceId, characteristicId })
wx.writeBLECharacteristicValue({ deviceId, serviceId, characteristicId, value: arrayBuffer })

// 清理
wx.stopBluetoothDevicesDiscovery()
wx.closeBLEConnection({ deviceId: 'xxx' })
wx.closeBluetoothAdapter()
```

---

## Canvas 画布

### Canvas 2D API（推荐）

```html
<canvas type="2d" id="myCanvas" style="width: 300px; height: 200px;" />
```

```javascript
onReady() {
  const query = wx.createSelectorQuery()
  query.select('#myCanvas').fields({ node: true, size: true }).exec((res) => {
    const canvas = res[0].node
    const ctx = canvas.getContext('2d')
    const dpr = wx.getWindowInfo().pixelRatio
    canvas.width = res[0].width * dpr
    canvas.height = res[0].height * dpr
    ctx.scale(dpr, dpr)

    // 绘制矩形
    ctx.fillStyle = '#1296db'
    ctx.fillRect(10, 10, 100, 60)

    // 绘制文本
    ctx.fillStyle = '#333'
    ctx.font = '16px sans-serif'
    ctx.fillText('Hello Canvas', 10, 100)

    // 绘制图片
    const img = canvas.createImage()
    img.onload = () => {
      ctx.drawImage(img, 120, 10, 80, 80)
    }
    img.src = '/images/logo.png'

    // 渐变
    const gradient = ctx.createLinearGradient(0, 0, 200, 0)
    gradient.addColorStop(0, '#ff0000')
    gradient.addColorStop(1, '#0000ff')
    ctx.fillStyle = gradient
    ctx.fillRect(10, 120, 200, 30)
  })
}
```

### 导出图片

```javascript
wx.canvasToTempFilePath({
  canvas,       // Canvas 2D 实例
  x: 0, y: 0,
  width: 300, height: 200,
  destWidth: 600, destHeight: 400,  // 输出分辨率
  fileType: 'png',
  quality: 1,
  success(res) {
    // res.tempFilePath — 可用于保存或分享
    wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath })
  }
})
```
