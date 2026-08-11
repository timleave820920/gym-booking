const app = getApp();
const api = require('../../utils/api.js');

const STATUS_MAP = {
  pending: { text: '待支付', cls: 'st-pending' },
  paid: { text: '已支付', cls: 'st-paid' },
  cancelled: { text: '已取消', cls: 'st-cancelled' },
  refunded: { text: '已退款', cls: 'st-refunded' }
};
// 订单类型文案
const TYPE_TEXT = { book: '订课', waitlist: '排位', recharge: '充值' };

Page({
  data: {
    orders: [],
    loading: true,
    type: 'all',          // all / course / recharge
    title: '我的订单',
    emptyText: '暂无订单',
    emptySub: '订课后这里会显示每一笔支付记录'
  },

  onLoad(options) {
    const type = options.type || 'all';
    const cfg = {
      all: { title: '我的订单', emptyText: '暂无订单', emptySub: '订课后这里会显示每一笔支付记录' },
      course: { title: '我的课程', emptyText: '暂无购买记录', emptySub: '购买过的课程都会显示在这里' },
      recharge: { title: '我的订单', emptyText: '暂无充值记录', emptySub: '充值记录会显示在这里' }
    }[type] || { title: '我的订单', emptyText: '暂无订单', emptySub: '' };
    this.setData({ type, ...cfg });
  },

  onShow() {
    this.loadOrders();
  },

  loadOrders() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      this.setData({ orders: [], loading: false });
      return;
    }
    api.getMyOrders(openid).then((res) => {
      let list = res.orders || [];
      // 按类型筛选：course=购买过的课程（订课+排位），recharge=充值记录
      if (this.data.type === 'course') {
        list = list.filter(o => o.order_type === 'book' || o.order_type === 'waitlist');
      } else if (this.data.type === 'recharge') {
        list = list.filter(o => o.order_type === 'recharge');
      }
      const orders = list.map(o => {
        const st = STATUS_MAP[o.status] || { text: o.status, cls: 'st-pending' };
        const isRecharge = o.order_type === 'recharge';
        return {
          id: o.id,
          orderNo: o.order_no,
          name: isRecharge ? '储值充值' : (o.course_name || '课程'),
          coach: o.coach_name,
          venue: o.venue_name,
          // 充值记录无场次信息：日期取支付时间
          date: isRecharge ? (o.paid_at || o.created_at || '').slice(0, 10) : o.date,
          time: isRecharge ? '' : `${o.start_time}-${o.end_time}`,
          price: (o.amount_fen / 100).toFixed(0),
          type: TYPE_TEXT[o.order_type] || o.order_type,
          isRecharge,
          status: o.status,
          statusText: st.text,
          statusCls: st.cls,
          payMethod: o.pay_method === 'wxpay' ? '微信支付' : '余额支付',
          payTime: o.paid_at,
          refundTime: o.refunded_at,
          createdTime: o.created_at
        };
      });
      this.setData({ orders, loading: false });
    }).catch(() => {
      this.setData({ orders: [], loading: false });
    });
  }
});
