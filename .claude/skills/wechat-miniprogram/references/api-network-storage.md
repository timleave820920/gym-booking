# 网络、存储与文件系统 API Network & Storage

## 目录
- [wx.request 网络请求](#wxrequest-网络请求)
- [文件上传下载](#文件上传下载)
- [WebSocket](#websocket)
- [本地存储](#本地存储)
- [文件系统](#文件系统)
- [常用封装模式](#常用封装模式)

---

## wx.request 网络请求

```javascript
const requestTask = wx.request({
  url: 'https://api.example.com/data',  // 必须 HTTPS（开发环境可关闭校验）
  method: 'GET',                         // GET|POST|PUT|DELETE|HEAD|OPTIONS|TRACE|CONNECT
  data: { page: 1, size: 20 },          // GET 时序列化为 query string
  header: {
    'Content-Type': 'application/json',  // POST 默认 application/json
    'Authorization': 'Bearer xxx'
  },
  dataType: 'json',       // 返回数据自动 JSON.parse（默认 json）
  responseType: 'text',   // text | arraybuffer
  timeout: 10000,         // 超时时间 ms（默认 60000）
  enableCache: false,      // 是否开启 HTTP 缓存
  success(res) {
    // res.data — 响应数据
    // res.statusCode — HTTP 状态码
    // res.header — 响应头
    // res.cookies — 响应 cookies
  },
  fail(err) {
    // err.errMsg — 错误信息
    // 常见：request:fail timeout, request:fail url not in domain list
  },
  complete() {
    // 无论成功失败都执行
  }
})

// 中断请求
requestTask.abort()
```

**关键限制：**
- 并发请求上限：**10 个**
- 必须在小程序后台配置合法域名
- 开发环境可在 DevTools 设置中关闭域名校验

---

## 文件上传下载

### 上传

```javascript
const uploadTask = wx.uploadFile({
  url: 'https://api.example.com/upload',
  filePath: tempFilePath,   // 来自 wx.chooseMedia 等
  name: 'file',             // 后端接收的字段名
  formData: { type: 'avatar' },
  header: { 'Authorization': 'Bearer xxx' },
  success(res) {
    const data = JSON.parse(res.data) // 注意：data 是字符串
  }
})

uploadTask.onProgressUpdate((res) => {
  console.log('上传进度:', res.progress)       // 0-100
  console.log('已上传:', res.totalBytesSent)
  console.log('总大小:', res.totalBytesExpectedToSend)
})

uploadTask.abort() // 中断上传
```

### 下载

```javascript
const downloadTask = wx.downloadFile({
  url: 'https://example.com/file.pdf',
  filePath: `${wx.env.USER_DATA_PATH}/file.pdf`, // 可选，指定存储路径
  success(res) {
    if (res.statusCode === 200) {
      console.log('临时路径:', res.tempFilePath)
      // 或指定路径: res.filePath
    }
  }
})

downloadTask.onProgressUpdate((res) => {
  console.log('下载进度:', res.progress)
})
```

---

## WebSocket

```javascript
const socketTask = wx.connectSocket({
  url: 'wss://api.example.com/ws',
  header: { 'Authorization': 'Bearer xxx' },
  protocols: ['protocol1']
})

socketTask.onOpen(() => {
  console.log('WebSocket 已连接')
  socketTask.send({ data: JSON.stringify({ type: 'ping' }) })
})

socketTask.onMessage((res) => {
  const msg = JSON.parse(res.data)
  console.log('收到消息:', msg)
})

socketTask.onClose((res) => {
  console.log('连接关闭:', res.code, res.reason)
})

socketTask.onError((err) => {
  console.error('WebSocket 错误:', err.errMsg)
})

// 关闭连接
socketTask.close({ code: 1000, reason: 'normal closure' })
```

**限制：** 同时最多 **5 个** WebSocket 连接。

---

## 本地存储

### 同步 API（推荐简单场景）

```javascript
// 写入
wx.setStorageSync('token', 'xxx')
wx.setStorageSync('userInfo', { name: '张三', age: 25 }) // 自动序列化

// 读取
const token = wx.getStorageSync('token')          // 不存在返回 ''
const user = wx.getStorageSync('userInfo')         // 自动反序列化

// 删除
wx.removeStorageSync('token')

// 清空所有
wx.clearStorageSync()

// 存储信息
const info = wx.getStorageInfoSync()
// info.keys — 所有 key 数组
// info.currentSize — 当前占用 KB
// info.limitSize — 上限 KB
```

### 异步 API（大数据推荐）

```javascript
wx.setStorage({
  key: 'largeData',
  data: bigObject,
  encrypt: true,  // 加密存储（安全敏感数据）
  success() {},
  fail(err) {}
})

wx.getStorage({
  key: 'largeData',
  encrypt: true,
  success(res) { console.log(res.data) }
})
```

**限制：**
- 单个 key 最大 **1MB**
- 总存储上限 **10MB**
- 同一微信用户、同一小程序共享存储
- 隔离：不同用户、不同小程序存储互不影响

---

## 文件系统

```javascript
const fs = wx.getFileSystemManager()

// 写入文件
fs.writeFileSync(
  `${wx.env.USER_DATA_PATH}/config.json`,
  JSON.stringify({ theme: 'dark' }),
  'utf8'
)

// 读取文件
const content = fs.readFileSync(`${wx.env.USER_DATA_PATH}/config.json`, 'utf8')
const data = JSON.parse(content)

// 追加写入
fs.appendFileSync(`${wx.env.USER_DATA_PATH}/log.txt`, `${new Date()}: event\n`, 'utf8')

// 创建目录
fs.mkdirSync(`${wx.env.USER_DATA_PATH}/cache`, true) // recursive

// 列出文件
const files = fs.readdirSync(`${wx.env.USER_DATA_PATH}/cache`)

// 文件信息
const stat = fs.statSync(`${wx.env.USER_DATA_PATH}/config.json`)
// stat.size, stat.isFile(), stat.isDirectory()

// 删除文件
fs.unlinkSync(`${wx.env.USER_DATA_PATH}/config.json`)

// 保存临时文件到持久化目录
fs.saveFileSync(tempFilePath, `${wx.env.USER_DATA_PATH}/saved.png`)
```

**路径说明：**
- `wx.env.USER_DATA_PATH` — 用户数据目录（持久化）
- 临时文件路径 — `tmp://` 开头，随时可能被清理
- `store://` — 用户存储文件路径

---

## 常用封装模式

### Promise 封装

```javascript
// utils/request.js
function getBaseUrl() {
  return getApp().globalData.baseUrl || 'https://api.example.com'
}

function request({ url, method = 'GET', data, header = {} }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getBaseUrl()}${url}`,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${wx.getStorageSync('token') || ''}`,
        ...header
      },
      timeout: 10000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else if (res.statusCode === 401) {
          wx.removeStorageSync('token')
          wx.navigateTo({ url: '/pages/login/login' })
          reject(new Error('Unauthorized'))
        } else {
          reject(new Error(res.data.message || `HTTP ${res.statusCode}`))
        }
      },
      fail: (err) => reject(new Error(err.errMsg || 'Network error'))
    })
  })
}

// 重试逻辑
async function requestWithRetry(options, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await request(options)
    } catch (err) {
      if (i === maxRetries) throw err
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
    }
  }
}

module.exports = { request, requestWithRetry }
```

### 缓存策略

```javascript
async function cachedRequest(url, cacheKey, ttl = 300000) {
  const cached = wx.getStorageSync(cacheKey)
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data
  }
  const data = await request({ url })
  wx.setStorageSync(cacheKey, { data, timestamp: Date.now() })
  return data
}
```
