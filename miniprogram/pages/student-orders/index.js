const app = getApp();
const api = require('../../utils/api.js');

const STATUS_MAP = {
  pending: { text: '待支付', cls: 'st-pending' },
  paid: { text: '已支付', cls: 'st-paid' },
  cancelled: { text: '已取消', cls: 'st-cancelled' },
  refunded: { text: '已退款', cls: 'st-refunded' }
};

Page({
  data: {
    orders: [],
    loading: true
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
      const orders = (res.orders || []).map(o => {
        const st = STATUS_MAP[o.status] || { text: o.status, cls: 'st-pending' };
        return {
          id: o.id,
          orderNo: o.order_no,
          name: o.course_name,
          coach: o.coach_name,
          venue: o.venue_name,
          date: o.date,
          time: `${o.start_time}-${o.end_time}`,
          price: (o.amount_fen / 100).toFixed(0),
          type: o.order_type === 'waitlist' ? '排位' : '订课',
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
