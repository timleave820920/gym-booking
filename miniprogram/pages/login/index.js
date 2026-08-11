const app = getApp();
const api = require('../../utils/api.js');
const i18n = require('../../utils/i18n.js');

Page({
  data: {
    agreed: true,          // 默认勾选协议
    loggingIn: false,
    lang: 'zh',              // 当前语言
    t: i18n.t(),             // 语言字典
    userCount: 0,            // 当前注册用户数
    inviterCode: ''          // 邀请码（分享卡片自动带入，可手动修改）
  },

  onLoad() {
    this.setData({
      lang: i18n.getLang() || 'zh',
      t: i18n.t()
    });
    this.loadUserCount();
    // 分享卡片携带的邀请人 → 预填邀请码
    const code = wx.getStorageSync('pending_inviter') || '';
    if (code) this.setData({ inviterCode: code });
  },

  onInviteInput(e) {
    this.setData({ inviterCode: e.detail.value });
  },

  onShow() {
    // 每次回到登录页刷新用户数（清空后立即更新）
    this.loadUserCount();
  },

  // 拉取当前注册用户数
  loadUserCount() {
    api.getUsersStats().then((res) => {
      this.setData({ userCount: res.totalUsers || 0 });
    }).catch(() => {
      this.setData({ userCount: 0 });
    });
  },

  // ===== 语言切换 =====
  switchLang() {
    const next = this.data.lang === 'zh' ? 'en' : 'zh';
    if (app.switchLang(next)) {
      this.setData({ lang: next, t: i18n.t() });
      wx.showToast({ title: next === 'en' ? 'English' : '中文', icon: 'none' });
    }
  },

  // 切换协议勾选
  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  // ===== 演示身份快捷登录（不写数据库，直接进入对应端）=====
  quickLogin(e) {
    const role = e.currentTarget.dataset.role;
    const urls = {
      student: '/pages/student-courses/index',
      coach: '/pages/coach-schedule/index'
    };
    const names = {
      student: '学员',
      coach: '教练'
    };
    const token = 'demo_' + role + '_' + Date.now();
    const userInfo = {
      name: names[role],
      avatar: '/images/2_556.png',
      role: role,
      // 演示阶段统一学员账号（与真微信登录一致，历史数据不丢）
      openid: role === 'student' ? 'demo_user' : 'demo_' + role,
      totalClasses: 32,
      totalHours: '28.5h',
      totalCalories: '12,480',
      streak: 12
    };
    // 同步写入 storage（页面接口按 openid 读取数据）
    wx.setStorageSync('openid', userInfo.openid);
    // 教练演示身份：绑定真实教练档案（喻馥雅 id=1，当前 126 场次全由其带课）
    if (role === 'coach') {
      userInfo.name = '喻馥雅';
      userInfo.avatar = '/images/2_1468.png';
      userInfo.coach_id = 1;
    }
    wx.setStorageSync('token', token);
    wx.setStorageSync('userInfo', userInfo);
    app.globalData.userInfo = userInfo;
    app.globalData.role = role;

    wx.showToast({ title: names[role] + '身份进入', icon: 'none' });
    setTimeout(() => {
      wx.switchTab({
        url: urls[role],
        fail: () => wx.redirectTo({ url: urls[role] })
      });
    }, 400);
  },

  // ===== 一键清空数据库（管理员入口改造）=====
  clearDb() {
    wx.showModal({
      title: '清空数据库',
      content: '将永久删除数据库中的所有用户，且无法恢复！确定继续？',
      confirmText: '清空',
      confirmColor: '#E5484D',
      success: (res) => {
        if (res.confirm) {
          // 二次确认（危险操作）
          wx.showModal({
            title: '再次确认',
            content: '这是不可逆操作，所有用户数据将被清空。是否继续？',
            confirmText: '确认清空',
            confirmColor: '#E5484D',
            success: (res2) => {
              if (res2.confirm) {
                wx.showLoading({ title: '清空中...' });
                api.clearUsers().then((r) => {
                  wx.hideLoading();
                  wx.showToast({ title: r.message || '已清空', icon: 'none' });
                }).catch((err) => {
                  wx.hideLoading();
                  wx.showModal({
                    title: '清空失败',
                    content: err.message || '无法连接服务器',
                    showCancel: false,
                    confirmText: '知道了'
                  });
                });
              }
            }
          });
        }
      }
    });
  },

  // ===== 微信一键登录 =====
  login() {
    if (!this.checkAgree()) return;
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true });

    wx.getUserProfile({
      desc: '用于登录及完善会员资料',
      success: (profileRes) => {
        const wxUser = profileRes.userInfo || {};
        const profile = {
          avatar: wxUser.avatarUrl || '/images/2_556.png',
          name: wxUser.nickName || '微信用户'
        };
        this.finishLogin(profile);
      },
      fail: () => {
        // 拒绝授权 → 演示模式模拟问询
        wx.showModal({
          title: '授权登录',
          content: '是否允许使用微信号/手机号登录本小程序？',
          confirmText: '允许',
          cancelText: '拒绝',
          success: (res) => {
            if (res.confirm) {
              this.finishLogin({ avatar: '/images/2_556.png', name: '微信用户' });
            } else {
              this.setData({ loggingIn: false });
              wx.showToast({ title: '已取消登录', icon: 'none' });
            }
          }
        });
      }
    });
  },

  // ===== 手机号快捷登录 =====
  phoneLogin(e) {
    if (!this.checkAgree()) return;
    if (this.data.loggingIn) return;

    const detail = e.detail || {};
    if (detail.errMsg && detail.errMsg.indexOf('ok') > -1 && detail.code) {
      // 真实环境：code 发给后端换手机号
      this.setData({ loggingIn: true });
      setTimeout(() => {
        this.finishLogin({
          avatar: '/images/2_556.png',
          name: '微信用户',
          phone: '138****2210'
        });
      }, 600);
    } else {
      // 未认证/拒绝 → 演示模式模拟问询
      wx.showModal({
        title: '手机号快捷登录',
        content: '是否允许使用微信绑定的手机号登录本小程序？',
        confirmText: '允许',
        cancelText: '拒绝',
        success: (res) => {
          if (res.confirm) {
            this.setData({ loggingIn: true });
            setTimeout(() => {
              this.finishLogin({
                avatar: '/images/2_556.png',
                name: '微信用户',
                phone: '138****2210'
              });
            }, 600);
          }
        }
      });
    }
  },

  // 协议校验
  checkAgree() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意协议', icon: 'none' });
      return false;
    }
    return true;
  },

  // 登录完成：默认使用「田立」身份直接登录（测试模式，跳过完善资料弹层）
  finishLogin(profile) {
    const name = (!profile.name || profile.name === '微信用户' || profile.name === '小陈同学') ? '田立' : profile.name;
    this.doLogin({
      ...profile,
      name,
      avatar: profile.avatar || '/images/2_556.png'
    });
  },

  // ===== 执行登录（对接后端：首次=注册，再次=登录）=====
  doLogin(userProfile) {
    wx.login({
      success: (res) => {
        const code = res.code || '';

        // 演示阶段：按微信昵称生成稳定 openid
        //  - 「田立」/ 未授权默认 → demo_user（保留现有账号与历史数据）
        //  - 其他昵称（真机预览用真实微信号授权）→ demo_<昵称哈希>，独立测试账号
        // ⚠️ 正式上线：接入 jscode2session 用真实 openid 替换本段
        const nick = String(userProfile.name || '').trim();
        let openid;
        if (!nick || nick === '田立') {
          openid = 'demo_user';
        } else {
          let h = 5381;
          for (let i = 0; i < nick.length; i++) h = ((h * 33) ^ nick.charCodeAt(i)) >>> 0;
          openid = 'demo_' + h.toString(36);
        }
        wx.setStorageSync('openid', openid);

        // 请求后端注册/登录
        api.login({
          code,
          openid,
          nickname: userProfile.name || '',
          avatar: userProfile.avatar || '',
          phone: userProfile.phone || ''
        }).then((res2) => {
          const isNewUser = res2.isNewUser;
          const user = res2.user;

          // 保存登录态
          const token = 'token_' + Date.now();
          const userInfo = {
            name: user.nickname || userProfile.name || '微信用户',
            avatar: user.avatar || userProfile.avatar || '/images/2_556.png',
            phone: user.phone || '',
            openid: user.openid || openid,
            role: user.role || 'student',
            totalClasses: user.total_classes || 32,
            totalHours: user.total_hours || '28.5h',
            totalCalories: user.total_calories || '12,480',
            streak: user.streak || 12
          };
          wx.setStorageSync('token', token);
          wx.setStorageSync('userInfo', userInfo);
          app.globalData.userInfo = userInfo;
          app.globalData.role = userInfo.role;

          this.setData({ loggingIn: false });

          // 邀请追踪：登录后绑定邀请关系（分享卡片携带或手动填写的邀请码）
          this.bindInvite(userInfo.openid);

          // 区分注册/登录提示
          wx.showToast({
            title: isNewUser ? '注册成功' : '欢迎回来',
            icon: 'none'
          });
          setTimeout(() => {
            // 登录完成 → 直接进入课程页（储值奖励庆祝弹框已移除）
            wx.switchTab({ url: '/pages/student-courses/index' });
          }, 600);
        }).catch((err) => {
          this.setData({ loggingIn: false });
          wx.showModal({
            title: '登录失败',
            content: err.message || '无法连接服务器',
            showCancel: false,
            confirmText: '知道了'
          });
        });
      },
      fail: () => {
        this.setData({ loggingIn: false });
        wx.showToast({ title: '微信登录失败', icon: 'none' });
      }
    });
  },

  // 邀请追踪：用邀请码绑定邀请关系（防刷由后端校验；失败不阻断登录）
  bindInvite(openid) {
    const code = String(this.data.inviterCode || '').trim();
    if (!code) return;
    const api = require('../../utils/api.js');
    api.bindInvite({ inviter: code, invitee: openid }).then(() => {
      wx.removeStorageSync('pending_inviter');
      this.setData({ inviterCode: '' });
      wx.showToast({ title: '邀请关系绑定成功', icon: 'none' });
    }).catch((err) => {
      console.warn('[invite] 绑定失败', err && err.message);
    });
  },

  noop() {}
});
