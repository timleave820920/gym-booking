const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    user: { name: '微信用户', avatar: '/images/2_556.png' },  // 头像/昵称（会员区第一行）
    member: null,        // 会员卡数据（等级/余额/升级提示）
    coinBalance: 0,
    passInfo: { hasPass: false },   // 次数包信息（剩余次数/过期天数）
    menus: [
      [
        { icon: 'check', name: '我的课程', url: '/pages/student-orders/index?type=course' },
        { icon: 'wallet', name: '我的订单', url: '/pages/student-orders/index?type=recharge' }
      ],
      [
        { icon: 'trophy', name: '成就与记录', url: '/pages/student-achievements/index' },
        { icon: 'bell', name: '消息通知', url: '/pages/student-messages/index', badge: 0 }
      ],
      [
        { icon: 'edit', name: '联系客服', url: '/pages/contact-us/index' }
      ]
    ]
  },

  onLoad() {
    // 加载用户信息（头像/昵称）——会员区第一行展示（2026-08-14 用户要求"我的会员"改为头像+昵称）
    const user = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
    this.setData({
      user: {
        name: user.name || user.nickname || '微信用户',
        avatar: user.avatar || '/images/2_556.png'
      }
    });
  },

  onShow() {
    this.loadBalance();       // 加载余额（无动画）
    this.loadUnread();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
  },

  // 拉取未读消息数 → 消息通知入口角标
  loadUnread() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    api.getUnreadCount(openid).then((res) => {
      const n = res.unread || 0;
      const menus = this.data.menus.map(group =>
        group.map(item => item.name === '消息通知' ? { ...item, badge: n } : item)
      );
      this.setData({ menus });
    }).catch(() => {});
  },

  // 从 desc 提取当前数字（避免重复刷新丢失）
  // 加载会员卡数据（等级/余额/能量币/未读奖励）
  loadBalance() {
    const user = app.globalData.userInfo || {};
    const openid = user.openid || wx.getStorageSync('openid');
    if (!openid) return;
    api.getMemberLevel(openid).then((res) => {
      const lv = res.level;
      const balance = (lv.balanceFen / 100).toFixed(2);
      this.setData({
        member: {
          name: lv.levelName,
          lv: lv.levelLv,
          icon: lv.levelIcon || '🏅',
          balance,
          // 升级提示：仅显示"再上N节课升级X"（2026-08-14 用户要求去掉"会员价折扣"后半句）
          hint: lv.next ? `再上 ${lv.next.min - lv.totalClasses} 节课升级${lv.next.name}` : '已达最高等级'
        },
        coinBalance: lv.coinBalance || 0
      });
    }).catch(() => {});
    // 次数包（次卡）信息：剩余次数 / 过期天数
    api.getMyPass(openid).then((res) => {
      this.setData({ passInfo: res.pass || { hasPass: false } });
    }).catch(() => {
      this.setData({ passInfo: { hasPass: false } });
    });
  },

  // 头像加载失败 → 兜底默认头像
  avatarError() {
    this.setData({ 'user.avatar': '/images/2_556.png' });
  },

  // 更换头像：微信头像 / 本地上传（2026-08-14 用户需求）
  changeAvatar() {
    const openid = (app.globalData.userInfo || {}).openid || wx.getStorageSync('openid');
    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: ['使用微信头像', '从本地上传'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.useWechatAvatar(openid);
        } else if (res.tapIndex === 1) {
          this.uploadLocalAvatar(openid);
        }
      }
    });
  },

  // 方式一：微信头像
  useWechatAvatar(openid) {
    wx.getUserProfile({
      desc: '用于更新头像',
      success: (profileRes) => {
        const avatarUrl = (profileRes.userInfo || {}).avatarUrl;
        if (!avatarUrl) {
          wx.showToast({ title: '获取头像失败', icon: 'none' });
          return;
        }
        this.saveAvatar(avatarUrl, openid);
      },
      fail: () => {
        wx.showToast({ title: '已取消', icon: 'none' });
      }
    });
  },

  // 方式二：本地上传（选图 → base64 → /api/upload → 存 /images/xxx）
  uploadLocalAvatar(openid) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: (readRes) => {
            const ext = (file.tempFilePath.match(/\.(\w+)$/) || [,'png'])[1].toLowerCase();
            const mime = ext === 'jpg' ? 'jpeg' : ext;
            const base64 = `data:image/${mime};base64,${readRes.data}`;
            wx.showLoading({ title: '上传中...' });
            api.uploadImage(`avatar_${Date.now()}.${mime}`, base64).then((up) => {
              wx.hideLoading();
              if (up.path) {
                this.saveAvatar(up.path, openid);
              } else {
                wx.showToast({ title: up.message || '上传失败', icon: 'none' });
              }
            }).catch(() => {
              wx.hideLoading();
              wx.showToast({ title: '上传失败', icon: 'none' });
            });
          },
          fail: () => {
            wx.showToast({ title: '读取图片失败', icon: 'none' });
          }
        });
      },
      fail: () => {
        wx.showToast({ title: '已取消', icon: 'none' });
      }
    });
  },

  // 保存头像：更新全局 + 调后端持久化
  saveAvatar(avatarUrl, openid) {
    // 本地先更新（即时反馈）
    this.setData({ 'user.avatar': avatarUrl });
    if (app.globalData.userInfo) {
      app.globalData.userInfo.avatar = avatarUrl;
      wx.setStorageSync('userInfo', app.globalData.userInfo);
    }
    // 后端持久化
    api.updateProfile({ openid, avatar: avatarUrl }).then(() => {
      wx.showToast({ title: '头像已更新', icon: 'success' });
    }).catch(() => {
      wx.showToast({ title: '更新失败，请重试', icon: 'none' });
    });
  },

  // 会员等级（替代原「电子会员卡」页，产品决策 2026-08-13：去掉我的会员卡页面，直接进等级页）
  goMemberLevel() {
    wx.navigateTo({ url: '/pages/member-level/index' });
  },

  // 去充值
  goRecharge() {
    wx.navigateTo({ url: '/pages/member-recharge/index' });
  },

  // 能量商店
  goCoinShop() {
    wx.navigateTo({ url: '/pages/coin-shop/index' });
  },

  // 次数包：去购买/查看
  goPass() {
    wx.navigateTo({ url: '/pages/passes-buy/index' });
  },

  // 退出登录
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmText: '退出',
      confirmColor: '#E5484D',
      success: (res) => {
        if (res.confirm) {
          app.logout();
          wx.showToast({ title: '已退出', icon: 'none' });
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/login/index' });
          }, 500);
        }
      }
    });
  },

  goMenu(e) {
    const url = e.currentTarget.dataset.url;
    if (url) {
      wx.navigateTo({ url });
    } else {
      wx.showToast({ title: '功能开发中', icon: 'none' });
    }
  },

  goSettings() {
    wx.showToast({ title: '设置开发中', icon: 'none' });
  },

  goHome() { wx.switchTab({ url: '/pages/member-center/index' }); },
  goCourses() { wx.switchTab({ url: '/pages/student-courses/index' }); },
  goMy() { wx.switchTab({ url: '/pages/student-my-courses/index' }); }
});
