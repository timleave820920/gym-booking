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
    loadingMore: false,  // 加载中标记
    wxpayEnabled: false  // 微信支付开通状态（B2 2026-08-18：商户号未配置 → 充值不可用）
  },

  onLoad() {
    // 状态栏高度：顶部导航与微信胶囊按钮水平对齐（2026-08-19）
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarH: win.statusBarHeight || 20 });
    this.loadPlans();
    this.loadInfo();
    // B2：查询微信支付开通状态（未开通 → 充值按钮禁用提示）
    api.wxpayStatus().then((res) => {
      this.setData({ wxpayEnabled: !!(res && res.enabled) });
    }).catch(() => {
      this.setData({ wxpayEnabled: false });
    });
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

  // 立即充值 → 下单 → 微信支付（B2 2026-08-18：统一下单 → wx.requestPayment → 轮询回调落库）
  recharge() {
    // 商户号未配置 → 充值不可用（明确提示，不造假支付）
    if (!this.data.wxpayEnabled) {
      wx.showToast({ title: '微信支付暂未开通（商户号配置后开放）', icon: 'none' });
      return;
    }
    if (this._recharging) return;   // 防连点锁
    const plan = this.data.plans.find(p => p.id === this.data.selectedId);
    if (!plan) return;
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    this._recharging = true;
    wx.showLoading({ title: '下单中...' });
    api.createOrder({
      openid,
      sessionId: 0,
      amountFen: plan.amount,
      orderType: 'recharge'
    }).then((res) => {
      this._rechargingOrderId = res.order.id;   // 保存订单 id 供轮询
      wx.showLoading({ title: '支付中...' });
      return api.wxpayCreate({ orderId: res.order.id, openid });
    }).then((res) => {
      const p = res.payParams;
      // 测试支付模式（后端 PAY_MOCK=1）：跳过 requestPayment，走 mock-notify 落库后轮询
      if (res && (res.mock || (p && p.mock))) {
        return api.wxpayMockNotify({ orderId: this._rechargingOrderId, openid }).then(() => true);
      }
      if (!p || !p.package) throw { message: '微信支付参数异常，请重试' };
      return new Promise((resolve, reject) => {
        wx.requestPayment({
          timeStamp: p.timeStamp,
          nonceStr: p.nonceStr,
          package: p.package,
          signType: p.signType || 'RSA',
          paySign: p.paySign,
          success: resolve,
          fail: reject
        });
      });
    }).then(() => {
      // 微信回调异步落库 → 轮询订单至 paid（上限 10 次 × 1.5s）
      this.pollPaid(this._rechargingOrderId);
    }).catch((err) => {
      this._recharging = false;
      wx.hideLoading();
      const msg = (err && err.message) || '支付失败';
      if (msg.indexOf('cancel') >= 0) {
        wx.showToast({ title: '已取消支付', icon: 'none' });
      } else {
        wx.showToast({ title: msg, icon: 'none' });
      }
    });
  },

  // B2：轮询充值订单至 paid → 刷新余额/记录/首充状态
  pollPaid(orderId, tries = 0) {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    api.getMyOrders(openid).then((res) => {
      const order = (res.orders || []).find(o => o.id === orderId);
      if (order && order.status === 'paid') {
        this._recharging = false;
        wx.hideLoading();
        wx.showToast({ title: '充值成功', icon: 'success' });
        this.loadInfo();
      } else if (tries < 10) {
        setTimeout(() => this.pollPaid(orderId, tries + 1), 1500);
      } else {
        this._recharging = false;
        wx.hideLoading();
        wx.showModal({
          title: '支付结果确认中',
          content: '支付已提交，稍后自动到账。可在「充值记录」查看结果。',
          showCancel: false
        });
      }
    }).catch(() => {
      if (tries < 10) {
        setTimeout(() => this.pollPaid(orderId, tries + 1), 1500);
      } else {
        this._recharging = false;
        wx.hideLoading();
        wx.showModal({
          title: '支付结果确认中',
          content: '支付已提交，稍后自动到账。可在「充值记录」查看结果。',
          showCancel: false
        });
      }
    });
  },

  // 返回（统一顶部导航，2026-08-19）
  goBack() {
    wx.navigateBack({ delta: 1 });
  }
});
