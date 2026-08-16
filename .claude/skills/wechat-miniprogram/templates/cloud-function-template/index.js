const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID, APPID } = cloud.getWXContext()

  try {
    // 云函数逻辑
    const { action, data } = event

    switch (action) {
      case 'get': {
        const res = await db.collection('items').doc(data.id).get()
        return { success: true, data: res.data }
      }
      case 'list': {
        const { page = 1, size = 20 } = data || {}
        const res = await db.collection('items')
          .where({ _openid: OPENID })
          .orderBy('createdAt', 'desc')
          .skip((page - 1) * size)
          .limit(size)
          .get()
        return { success: true, data: res.data }
      }
      case 'create': {
        const res = await db.collection('items').add({
          data: {
            ...data,
            _openid: OPENID,
            createdAt: db.serverDate()
          }
        })
        return { success: true, id: res._id }
      }
      default:
        return { success: false, error: '未知操作' }
    }
  } catch (err) {
    console.error('云函数错误:', err)
    return { success: false, error: err.message }
  }
}
