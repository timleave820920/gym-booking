const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    balance: '0.00',
    plans: [],
    selectedId: 2,       // 默认选中间档（1500）
    recharges: [],
    pageSize: 10,        // 每页条数
    offset: 0,           // 当前已加载条数（下一页偏移）
    hasMore: true,       // 是否还有更早记录
    loadingMore: false   // 加载中标记
  },

  onLoad() {
    this.loadPlans();
    this.loadInfo();
  },

  onShow() {
    this.loadPlans();   // 充值后刷新首充状态
    this.loadInfo();
  },

  // 上拉触底 → 加载更早 10 笔
  onReachBottom() {
    this.loadRecharges(false);
  },

  loadPlans() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    // 带 openid：后端按首充/复充状态返回赠送金额
    api.getMemberPlans(openid).then((res) => {
      const plans = (res.plans || []).map(p => {
        // 百分比从配置读取（firstBonusRate / repeatBonusRate），不写死
        const firstPct = Math.round((p.firstBonusRate || 0) * 100);
        const repeatPct = Math.round((p.repeatBonusRate || 0) * 100);
        return {
          ...p,
          // 标签：未首充 →「首充送30%」；已充过 →「送10%」
          tag: p.isFirst ? `首充送${firstPct}%` : `送${repeatPct}%`,
          // 赠送行文案（百分比已在标签展示，这里只显示金额）
          bonusText: `送¥${p.bonusYuan}`
        };
      });
      this.setData({ plans });
      // 默认选中未首充的中间档；若中间档已充过则选最大档
      if (plans.length) {
        const mid = plans.find(p => p.id === 2);
        const max = plans[plans.length - 1];
        const target = (mid && !mid.isFirst) ? mid : (max && !max.isFirst ? max : plans[0]);
        if (target) this.setData({ selectedId: target.id });
      }
    }).catch(() => {});
  },

  loadInfo() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    api.getMemberLevel(openid).then((res) => {
      this.setData({ balance: (res.level.balanceFen / 100).toFixed(2) });
    }).catch(() => {});
    this.loadRecharges(true);
  },

  // 加载充值记录（reset=true 重新拉第一页；false 追加更早一页）
  loadRecharges(reset) {
    if (this.data.loadingMore) return;
    if (!reset && !this.data.hasMore) return;   // 已全部加载完
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    const offset = reset ? 0 : this.data.offset;
    this.setData({ loadingMore: true });
    api.getMyRecharges(openid, offset, this.data.pageSize).then((res) => {
      const newList = (res.recharges || []).map(r => ({
        // 有趣的记录描述：首充能量补给 / 复充能量补给（隐藏内部单号）
        title: r.is_first ? '⚡ 首充能量补给' : '⚡ 复充能量补给',
        sub: `充¥${(r.amount_fen / 100).toFixed(0)} 送¥${(r.bonus_fen / 100).toFixed(0)}`,
        total: ((r.amount_fen + r.bonus_fen) / 100).toFixed(0),
        time: r.created_at
      }));
      const list = reset ? newList : this.data.recharges.concat(newList);
      this.setData({
        recharges: list,
        offset: offset + newList.length,
        hasMore: !!res.hasMore && newList.length >= this.data.pageSize,
        loadingMore: false
      });
    }).catch(() => {
      this.setData({ loadingMore: false });
    });
  },

  selectPlan(e) {
    this.setData({ selectedId: Number(e.currentTarget.dataset.id) });
  },

  // 立即充值 → 下单 → 支付回写（复用订单流程）
  recharge() {
    const plan = this.data.plans.find(p => p.id === this.data.selectedId);
    if (!plan) return;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '下单中...' });
    api.createOrder({
      openid,
      sessionId: 0,
      amountFen: plan.amount,
      orderType: 'recharge'
    }).then((res) => {
      wx.showLoading({ title: '支付中...' });
      setTimeout(() => {
        api.payOrder(res.order.id, { openid, payMethod: 'wxpay' }).then(() => {
          wx.hideLoading();
          wx.showToast({ title: '充值成功', icon: 'success' });
          this.loadInfo();
        }).catch((err) => {
          wx.hideLoading();
          wx.showToast({ title: err.message || '支付失败', icon: 'none' });
        });
      }, 800);
    }).catch((err) => {
      wx.hideLoading();
      wx.showToast({ title: err.message || '下单失败', icon: 'none' });
    });
  }
});
