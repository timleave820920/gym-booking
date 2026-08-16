# 登录、支付与授权 API Auth & Payment

## 目录
- [登录流程](#登录流程)
- [用户信息](#用户信息)
- [手机号获取](#手机号获取)
- [微信支付](#微信支付)
- [订阅消息](#订阅消息)
- [授权设置](#授权设置)

---

## 登录流程

**这是小程序开发最常问的主题。** 流程如下：

```
┌────────┐      ┌────────┐      ┌─────────────┐
│ 客户端  │      │ 开发者服务器│      │ 微信服务器    │
└───┬────┘      └───┬────┘      └──────┬──────┘
    │ wx.login()    │                   │
    │──────────────>│                   │
    │   code        │                   │
    │<──────────────│                   │
    │               │  jscode2session   │
    │               │──────────────────>│
    │               │  openid+session_key│
    │               │<──────────────────│
    │               │ 生成自定义 token    │
    │  token        │                   │
    │<──────────────│                   │
    │ 存储 token     │                   │
```

### 客户端代码

```javascript
// app.js — 启动时自动登录
App({
  onLaunch() {
    this.autoLogin()
  },
  async autoLogin() {
    // 1. 检查本地 token 是否有效
    const token = wx.getStorageSync('token')
    if (token) {
      try {
        await this.checkToken(token)
        return // token 有效
      } catch (e) {
        wx.removeStorageSync('token')
      }
    }
    // 2. 无 token 或已过期，重新登录
    await this.login()
  },
  async login() {
    try {
      const { code } = await wx.login() // code 有效期 5 分钟
      const res = await new Promise((resolve, reject) => {
        wx.request({
          url: 'https://api.example.com/auth/wx-login',
          method: 'POST',
          data: { code },
          success: (res) => res.statusCode === 200 ? resolve(res.data) : reject(res),
          fail: reject
        })
      })
      wx.setStorageSync('token', res.token)
      this.globalData.openid = res.openid
    } catch (err) {
      console.error('登录失败:', err)
    }
  },
  globalData: { openid: '' }
})
```

### 服务端代码 (Node.js)

```javascript
// POST /auth/wx-login
async function wxLogin(req, res) {
  const { code } = req.body

  // 向微信服务器换取 session
  const wxRes = await fetch(
    `https://api.weixin.qq.com/sns/jscode2session` +
    `?appid=${APPID}&secret=${SECRET}&js_code=${code}&grant_type=authorization_code`
  )
  const { openid, session_key, unionid } = await wxRes.json()

  // ⚠️ session_key 绝对不能发给客户端
  // 存储到服务端 session/数据库
  await saveSession(openid, session_key)

  // 生成自定义 token
  const token = jwt.sign({ openid }, JWT_SECRET, { expiresIn: '7d' })

  res.json({ token, openid })
}
```

**关键安全规则：**
- **永远不要** 把 `session_key` 发给客户端
- **永远不要** 把 `appSecret` 写在客户端代码中
- code 只能使用一次，5 分钟过期

---

## 用户信息

`wx.getUserProfile` 已于 2022 年废弃。当前获取用户信息的方式：

```html
<!-- 头像获取：使用 chooseAvatar 按钮 -->
<button open-type="chooseAvatar" bindchooseavatar="onChooseAvatar">
  <image src="{{ avatarUrl }}" />
</button>

<!-- 昵称获取：使用 type="nickname" 输入框 -->
<input type="nickname" placeholder="请输入昵称" bindchange="onNicknameChange" />
```

```javascript
Page({
  data: {
    avatarUrl: '/images/default-avatar.png',
    nickname: ''
  },
  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl })
    // avatarUrl 是临时路径，需上传到自己的服务器
  },
  onNicknameChange(e) {
    this.setData({ nickname: e.detail.value })
  }
})
```

---

## 手机号获取

```html
<!-- 必须用户主动点击按钮 -->
<button open-type="getPhoneNumber" bindgetphonenumber="onGetPhone">
  获取手机号
</button>
```

```javascript
Page({
  async onGetPhone(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      console.log('用户拒绝授权')
      return
    }
    // e.detail.code — 动态令牌，发给服务端解密
    const res = await request({
      url: '/user/bindPhone',
      method: 'POST',
      data: { code: e.detail.code }
    })
    // 服务端返回手机号
    console.log('手机号:', res.phoneNumber)
  }
})
```

### 服务端解密手机号

```javascript
// POST /user/bindPhone
async function bindPhone(req, res) {
  const { code } = req.body

  // 获取 access_token（建议缓存，有效期 2 小时）
  const tokenRes = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${SECRET}`
  )
  const { access_token } = await tokenRes.json()

  // 用 code 换手机号
  const phoneRes = await fetch(
    `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${access_token}`,
    {
      method: 'POST',
      body: JSON.stringify({ code })
    }
  )
  const { phone_info } = await phoneRes.json()
  // phone_info.phoneNumber = "13800138000"
  // phone_info.purePhoneNumber = "13800138000" (无区号)
  // phone_info.countryCode = "86"

  res.json({ phoneNumber: phone_info.phoneNumber })
}
```

---

## 微信支付

### 完整支付流程

```
┌────────┐      ┌────────┐      ┌─────────────┐
│ 客户端  │      │ 开发者服务器│      │ 微信支付服务器 │
└───┬────┘      └───┬────┘      └──────┬──────┘
    │  创建订单      │                   │
    │──────────────>│                   │
    │               │  统一下单 API      │
    │               │──────────────────>│
    │               │  prepay_id        │
    │               │<──────────────────│
    │  支付参数      │  生成签名          │
    │<──────────────│                   │
    │ wx.requestPayment                 │
    │──────────────────────────────────>│
    │  支付结果       │                   │
    │<──────────────────────────────────│
    │               │  支付回调通知       │
    │               │<──────────────────│
    │  查询订单状态   │                   │
    │──────────────>│                   │
```

### 客户端代码

```javascript
async function pay(orderId) {
  try {
    // 1. 创建订单（服务端返回支付参数）
    const payParams = await request({
      url: '/order/create',
      method: 'POST',
      data: { orderId, amount: 9900 } // 单位：分
    })

    // 2. 调起微信支付
    await new Promise((resolve, reject) => {
      wx.requestPayment({
        timeStamp: payParams.timeStamp,   // 时间戳（字符串）
        nonceStr: payParams.nonceStr,     // 随机字符串
        package: payParams.package,       // 格式：prepay_id=xxx
        signType: payParams.signType,     // RSA 或 MD5
        paySign: payParams.paySign,       // 签名
        success: resolve,
        fail(err) {
          if (err.errMsg.includes('cancel')) {
            console.log('用户取消支付')
          }
          reject(err)
        }
      })
    })

    // 3. 支付成功，查询订单状态
    wx.showToast({ title: '支付成功', icon: 'success' })
  } catch (err) {
    wx.showToast({ title: '支付失败', icon: 'none' })
  }
}
```

### 服务端关键代码 (Node.js)

```javascript
// POST /order/create — 统一下单
async function createOrder(req, res) {
  const { orderId, amount } = req.body
  const openid = req.user.openid

  // 调用微信支付 V3 统一下单
  const result = await fetch('https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': generateAuthHeader(/* ... */) // V3 签名
    },
    body: JSON.stringify({
      appid: APPID,
      mchid: MCH_ID,
      description: '商品描述',
      out_trade_no: orderId,
      notify_url: 'https://api.example.com/pay/callback',
      amount: { total: amount, currency: 'CNY' },
      payer: { openid }
    })
  })
  const { prepay_id } = await result.json()

  // 生成客户端支付参数
  const timeStamp = String(Math.floor(Date.now() / 1000))
  const nonceStr = crypto.randomBytes(16).toString('hex')
  const packageStr = `prepay_id=${prepay_id}`

  // V3 签名
  const message = `${APPID}\n${timeStamp}\n${nonceStr}\n${packageStr}\n`
  const paySign = crypto.createSign('RSA-SHA256')
    .update(message).sign(PRIVATE_KEY, 'base64')

  res.json({
    timeStamp,
    nonceStr,
    package: packageStr,
    signType: 'RSA',
    paySign
  })
}
```

---

## 订阅消息

```javascript
// 请求用户授权订阅
wx.requestSubscribeMessage({
  tmplIds: ['tmpl_id_1', 'tmpl_id_2'], // 模板 ID（后台配置）
  success(res) {
    // res['tmpl_id_1'] = 'accept' | 'reject' | 'ban'
    if (res['tmpl_id_1'] === 'accept') {
      // 用户同意，可以发送此模板消息
    }
  }
})
```

服务端发送订阅消息：
```javascript
await fetch(
  `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`,
  {
    method: 'POST',
    body: JSON.stringify({
      touser: openid,
      template_id: 'tmpl_id_1',
      page: '/pages/order/detail?id=123',
      data: {
        thing1: { value: '商品已发货' },
        time2: { value: '2024-01-15 14:30' }
      }
    })
  }
)
```

---

## 授权设置

```javascript
// 检查授权状态
wx.getSetting({
  success(res) {
    if (res.authSetting['scope.userLocation']) {
      // 已授权定位
    }
  }
})

// 预请求授权（在使用 API 前提前询问）
wx.authorize({
  scope: 'scope.record', // 录音权限
  success() { /* 授权成功 */ },
  fail() {
    // 用户拒绝，引导去设置页开启
    wx.showModal({
      title: '需要录音权限',
      content: '请在设置中开启录音权限',
      success(res) {
        if (res.confirm) wx.openSetting()
      }
    })
  }
})
```

### 常用 scope 值

| scope | 对应 API | 说明 |
|-------|---------|------|
| `scope.userLocation` | wx.getLocation | 精确地理位置 |
| `scope.userLocationBackground` | - | 后台定位 |
| `scope.record` | wx.startRecord | 麦克风 |
| `scope.camera` | camera 组件 | 摄像头 |
| `scope.bluetooth` | wx.openBluetoothAdapter | 蓝牙 |
| `scope.writePhotosAlbum` | wx.saveImageToPhotosAlbum | 保存到相册 |
| `scope.addPhoneContact` | wx.addPhoneContact | 添加通讯录 |
| `scope.addPhoneCalendar` | wx.addPhoneCalendar | 添加日历 |
| `scope.invoiceTitle` | wx.chooseInvoiceTitle | 发票抬头 |
| `scope.invoice` | wx.chooseInvoice | 发票 |
