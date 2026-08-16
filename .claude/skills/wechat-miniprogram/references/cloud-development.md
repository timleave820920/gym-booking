# 云开发 Cloud Development

## 目录
- [云开发初始化](#云开发初始化)
- [云函数](#云函数)
- [云数据库](#云数据库)
- [云存储](#云存储)
- [云调用（服务端 API）](#云调用)
- [实战模式](#实战模式)

---

## 云开发初始化

### 前端初始化

```javascript
// app.js
App({
  onLaunch() {
    wx.cloud.init({
      env: 'my-env-id',      // 环境 ID（云开发控制台获取）
      traceUser: true         // 记录访问用户信息到云
    })
  }
})
```

### 项目结构

```
miniprogram/              # 小程序代码
├── app.js
├── pages/
└── ...
cloudfunctions/           # 云函数目录
├── login/
│   ├── index.js
│   └── package.json
├── getOrders/
│   ├── index.js
│   └── package.json
└── ...
```

### project.config.json 配置

```json
{
  "cloudfunctionRoot": "cloudfunctions/",
  "miniprogramRoot": "miniprogram/"
}
```

---

## 云函数

### 基本结构

```javascript
// cloudfunctions/myFunction/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })  // 使用当前云环境

exports.main = async (event, context) => {
  // event: 前端传入的参数
  // context: 调用上下文（appId 等）
  const { OPENID, APPID, UNIONID } = cloud.getWXContext()

  return {
    openid: OPENID,
    data: event.data
  }
}
```

```json
// cloudfunctions/myFunction/package.json
{
  "name": "myFunction",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "~2.6.3"
  }
}
```

### 前端调用

```javascript
// 调用云函数
const res = await wx.cloud.callFunction({
  name: 'myFunction',
  data: { action: 'getList', page: 1 }
})
console.log(res.result)  // 云函数返回值

// 错误处理
try {
  const res = await wx.cloud.callFunction({ name: 'myFunction', data: {} })
} catch (err) {
  console.error('云函数调用失败:', err)
  // err.errCode, err.errMsg
}
```

### 定时触发器

```json
// cloudfunctions/dailyTask/config.json
{
  "triggers": [
    {
      "name": "dailyTrigger",
      "type": "timer",
      "config": "0 0 8 * * * *"
    }
  ]
}
```

Cron 格式: `秒 分 时 日 月 周 年`

### 云函数互调

```javascript
// 在云函数内调用另一个云函数
const cloud = require('wx-server-sdk')
cloud.init()

exports.main = async (event) => {
  const res = await cloud.callFunction({
    name: 'otherFunction',
    data: { key: 'value' }
  })
  return res.result
}
```

---

## 云数据库

### 获取数据库引用

```javascript
// 前端
const db = wx.cloud.database()
const collection = db.collection('todos')

// 云函数中
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()
```

### CRUD 操作

```javascript
// 查询单条
const res = await db.collection('todos').doc('doc-id').get()
const todo = res.data

// 查询多条（带条件）
const res = await db.collection('todos')
  .where({ done: false })
  .orderBy('createdAt', 'desc')
  .skip(0)
  .limit(20)
  .field({ title: true, done: true })  // 只返回指定字段
  .get()

// 添加
const res = await db.collection('todos').add({
  data: {
    title: '新任务',
    done: false,
    createdAt: db.serverDate()  // 服务端时间
  }
})
console.log(res._id)  // 新文档 ID

// 更新
await db.collection('todos').doc('doc-id').update({
  data: {
    done: true,
    updatedAt: db.serverDate()
  }
})

// 替换（整个文档）
await db.collection('todos').doc('doc-id').set({
  data: { title: '替换', done: true }
})

// 删除
await db.collection('todos').doc('doc-id').remove()
```

### 查询操作符

```javascript
const _ = db.command

// 比较
.where({ age: _.gt(18) })           // >
.where({ age: _.gte(18) })          // >=
.where({ age: _.lt(60) })           // <
.where({ age: _.lte(60) })          // <=
.where({ age: _.neq(0) })           // !=
.where({ name: _.eq('张三') })       // ==

// 逻辑
.where({ age: _.gt(18).and(_.lt(60)) })   // AND
.where(_.or([{ type: 'A' }, { type: 'B' }]))  // OR
.where({ status: _.not(_.eq('deleted')) })     // NOT

// 数组
.where({ tags: _.elemMatch({ name: 'hot' }) })  // 数组元素匹配
.where({ tags: _.all(['hot', 'new']) })          // 包含所有
.where({ tags: _.size(3) })                      // 数组长度

// 字段存在性
.where({ avatar: _.exists(true) })   // 字段存在

// 正则
.where({ name: db.RegExp({ regexp: '张.*', options: 'i' }) })
// 简写
.where({ name: /^张/i })
```

### 更新操作符

```javascript
const _ = db.command

// 数值操作
.update({ data: { score: _.inc(10) } })    // +10
.update({ data: { count: _.mul(2) } })      // ×2

// 数组操作
.update({ data: {
  tags: _.push('new'),                       // 尾部添加
  tags: _.unshift('first'),                  // 头部添加
  tags: _.pop(),                             // 移除最后一个
  tags: _.shift(),                           // 移除第一个
  tags: _.pull('old'),                       // 移除指定值
  tags: _.addToSet('unique')                 // 添加（去重）
}})

// 删除字段
.update({ data: { tempField: _.remove() } })

// 设置（用于嵌套对象）
.update({ data: { 'address.city': '北京' } })
```

### 聚合查询

```javascript
const $ = db.command.aggregate

const res = await db.collection('orders')
  .aggregate()
  .match({ status: 'paid' })
  .group({
    _id: '$userId',
    totalAmount: $.sum('$amount'),
    count: $.sum(1),
    avgAmount: $.avg('$amount')
  })
  .sort({ totalAmount: -1 })
  .limit(10)
  .end()
```

常用聚合阶段: `match`, `group`, `sort`, `limit`, `skip`, `project`, `unwind`, `lookup`, `addFields`

### 安全规则（权限）

在云控制台或 `database/` 目录下配置：

```json
// database/todos.json（集合权限规则）
{
  "read": "auth.openid == doc._openid",
  "write": "auth.openid == doc._openid",
  "create": true,
  "update": "auth.openid == doc._openid",
  "delete": "auth.openid == doc._openid"
}
```

权限类型简写:

| 规则 | 说明 |
|------|------|
| `true` | 所有人可读/写 |
| `false` | 所有人不可读/写 |
| `"auth.openid == doc._openid"` | 仅创建者 |
| `"auth != null"` | 仅登录用户 |

**重要：** 前端直接操作数据库时，系统会自动将 `_openid` 写入文档（无法伪造）。云函数中操作不受权限规则限制。

### 实时数据推送

```javascript
// 监听集合变化
const watcher = db.collection('messages')
  .where({ roomId: 'room-001' })
  .orderBy('createdAt', 'asc')
  .watch({
    onChange(snapshot) {
      // snapshot.docChanges: 变更文档列表
      // snapshot.docs: 当前查询结果
      // snapshot.type: 'init' | 'update'
      console.log('数据变更:', snapshot.docChanges)
    },
    onError(err) {
      console.error('监听失败:', err)
    }
  })

// 关闭监听（在 onUnload 中调用）
watcher.close()
```

---

## 云存储

```javascript
// 上传文件
const res = await wx.cloud.uploadFile({
  cloudPath: `images/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
  filePath: tempFilePath  // 本地临时文件路径
})
console.log(res.fileID)  // cloud://xxx.jpg

// 下载文件
const res = await wx.cloud.downloadFile({
  fileID: 'cloud://env-id.xxxx/images/photo.jpg'
})
console.log(res.tempFilePath)

// 获取临时链接（用于 image src）
const res = await wx.cloud.getTempFileURL({
  fileList: ['cloud://xxx/a.jpg', 'cloud://xxx/b.jpg']
})
// res.fileList = [{ fileID, tempFileURL, status, errMsg }]

// 删除文件
await wx.cloud.deleteFile({
  fileList: ['cloud://xxx/a.jpg']
})
```

### 云函数中操作存储

```javascript
const cloud = require('wx-server-sdk')
cloud.init()

exports.main = async (event) => {
  // 上传 Buffer
  const result = await cloud.uploadFile({
    cloudPath: 'reports/daily.pdf',
    fileContent: Buffer.from('...')
  })

  // 下载
  const file = await cloud.downloadFile({ fileID: 'cloud://...' })
  const buffer = file.fileContent

  return { fileID: result.fileID }
}
```

---

## 云调用

在云函数中直接调用微信服务端 API，无需 access_token。

```javascript
// cloudfunctions/sendMessage/index.js
const cloud = require('wx-server-sdk')
cloud.init()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()

  // 发送订阅消息（云调用方式）
  const result = await cloud.openapi.subscribeMessage.send({
    touser: OPENID,
    templateId: 'TEMPLATE_ID',
    page: '/pages/order/order',
    data: {
      thing1: { value: '订单已发货' },
      character_string2: { value: 'SF1234567890' }
    }
  })
  return result
}
```

```json
// cloudfunctions/sendMessage/config.json
{
  "permissions": {
    "openapi": ["subscribeMessage.send"]
  }
}
```

### 常用云调用 API

| API | 功能 |
|-----|------|
| `cloud.openapi.subscribeMessage.send` | 发送订阅消息 |
| `cloud.openapi.security.msgSecCheck` | 文本内容安全 |
| `cloud.openapi.security.imgSecCheck` | 图片内容安全 |
| `cloud.openapi.wxacode.getUnlimited` | 生成小程序码 |
| `cloud.openapi.uniformMessage.send` | 统一服务消息 |

---

## 实战模式

### 用户登录 + 数据初始化

```javascript
// cloudfunctions/login/index.js
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()

  // 查找或创建用户
  const { data } = await db.collection('users').where({ _openid: OPENID }).get()

  if (data.length === 0) {
    await db.collection('users').add({
      data: {
        _openid: OPENID,
        createdAt: db.serverDate(),
        nickname: '',
        avatar: ''
      }
    })
  }

  return { openid: OPENID, isNew: data.length === 0 }
}
```

### 分页查询封装

```javascript
// cloudfunctions/getList/index.js
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()
const MAX_LIMIT = 100  // 云函数中单次最多 1000，前端最多 20

exports.main = async (event) => {
  const { collection, where = {}, page = 1, size = 20, orderBy } = event

  const query = db.collection(collection).where(where)

  if (orderBy) {
    query.orderBy(orderBy.field, orderBy.order || 'desc')
  }

  const { data } = await query
    .skip((page - 1) * size)
    .limit(size)
    .get()

  // 获取总数
  const { total } = await db.collection(collection).where(where).count()

  return { list: data, total, page, hasMore: page * size < total }
}
```

### 图片上传 + 内容审核

```javascript
// cloudfunctions/uploadImage/index.js
const cloud = require('wx-server-sdk')
cloud.init()

exports.main = async (event) => {
  const { fileID } = event

  // 下载图片进行审核
  const file = await cloud.downloadFile({ fileID })

  // 图片内容安全检查
  try {
    await cloud.openapi.security.imgSecCheck({
      media: { contentType: 'image/png', value: file.fileContent }
    })
  } catch (err) {
    if (err.errCode === 87014) {
      // 图片违规，删除并返回错误
      await cloud.deleteFile({ fileList: [fileID] })
      return { success: false, error: '图片内容违规' }
    }
    throw err
  }

  return { success: true, fileID }
}
```
