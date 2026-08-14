const app = getApp();
const api = require('../../utils/api.js');
const i18n = require('../../utils/i18n.js');

Page({
  data: {
    agreed: false,         // 协议勾选（微信审核要求：禁止默认勾选，须用户主动同意）
    loggingIn: false,
    lang: 'zh',              // 当前语言
    t: i18n.t(),             // 语言字典
    userCount: 0,            // 当前注册用户数
    nickInput: '',           // 昵称输入（测试账号快捷登录）
    matchedTest: null,        // 匹配到的测试账号
    showPrivacy: false,      // 隐私协议弹窗（首次启动）
    privacyOk: false         // 隐私授权状态（官方 wx.getPrivacySetting）
  },

  // 隐私授权检查：返回 Promise，resolve(true)=已授权可继续；resolve(false)=需用户先同意（弹窗已出）
  // 修复 2026-08-14：异步检测不再用同步返回值卡死登录——未同意时弹窗并让用户同意后重试
  requirePrivacy() {
    return new Promise((resolve) => {
      if (this.data.privacyOk || wx.getStorageSync('privacy_agreed')) {
        resolve(true);
        return;
      }
      if (!wx.getPrivacySetting) {
        // 低版本基础库：无法检测，直接放行（隐私接口由微信兜底拦截）
        resolve(true);
        return;
      }
      wx.getPrivacySetting({
        success: (res) => {
          if (res.privacyAuthorized) {
            this.setData({ privacyOk: true });
            resolve(true);
          } else if (res.needAuthorization) {
            // 需要授权：弹窗，用户同意后（agreePrivacy）再手动点登录
            this.setData({ showPrivacy: true, _pendingLogin: true });
            resolve(false);
          } else {
            // 无需授权（开发者工具未配置指引等）→ 放行
            this.setData({ privacyOk: true });
            resolve(true);
          }
        },
        fail: () => {
          // 检测失败：放行（避免卡死登录）
          this.setData({ privacyOk: true });
          resolve(true);
        }
      });
    });
  },

  onLoad() {
    this.setData({
      lang: i18n.getLang() || 'zh',
      t: i18n.t(),
      // 协议勾选状态持久化：用户首次勾选后记住（'1'=已勾选；'0'或空=未勾选）
      agreed: wx.getStorageSync('agreed_terms') === '1'
    });
    this.loadUserCount();
    // 隐私协议检测（微信 2023.9 起强制：官方 wx.getPrivacySetting）
    this.requirePrivacy().then((ok) => {
      if (!ok) this.setData({ showPrivacy: true });
    });
  },

  // ===== 隐私协议 =====
  // 同意隐私协议：官方授权组件回调（open-type="agreePrivacyAuthorization" 触发）
  agreePrivacy() {
    wx.setStorageSync('privacy_agreed', '1');
    this.setData({ showPrivacy: false, privacyOk: true });
    // 同意后若有挂起的登录意图 → 自动继续
    if (this.data._pendingLogin) {
      this.setData({ _pendingLogin: false });
      this.login();
    }
  },

  // 拒绝隐私协议：回到首页提示
  rejectPrivacy() {
    this.setData({ showPrivacy: false });
    wx.showToast({ title: '需要同意隐私协议后才能使用', icon: 'none' });
  },

  // 查看隐私协议全文（跳转协议页，可完整阅读）
  viewPrivacy() {
    wx.navigateTo({ url: '/pages/agreement/index?type=privacy' });
  },

  // 查看服务协议全文（跳转协议页，可完整阅读）
  viewService() {
    wx.navigateTo({ url: '/pages/agreement/index?type=service' });
  },

  // 测试账号表：昵称 → 角色（与后端 demo_ 账号一一对应）
  TEST_ACCOUNTS: { '喻馥雅': 'coach', '蚂蚁': 'student', '艳子': 'student' },

  onNickInput(e) {
    const nick = String(e.detail.value || '').trim();
    const role = this.TEST_ACCOUNTS[nick] || null;
    this.setData({
      nickInput: e.detail.value,
      matchedTest: role ? { nick, role } : null
    });
  },

  // 测试账号快捷登录（喻馥雅=教练 / 蚂蚁·艳子=学员）
  nickLogin() {
    const mt = this.data.matchedTest;
    if (!mt) return;
    if (!this.checkAgree()) return;
    const nick = mt.nick;
    wx.showModal({
      title: '测试账号登录',
      content: `将以「${nick}」${mt.role === 'coach' ? '（教练）' : '（学员）'}身份登录，确认？`,
      confirmText: '确认',
      success: (r) => {
        if (r.confirm) {
          this.doLogin({ name: nick, avatar: '/images/2_556.png' }, nick);
        }
      }
    });
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
    const next = !this.data.agreed;
    this.setData({ agreed: next });
    // 持久化勾选状态（用户主动勾选后记住，下次进入免重复勾选）
    wx.setStorageSync('agreed_terms', next ? '1' : '0');
  },

  // ===== 演示身份快捷登录（不写数据库，直接进入对应端）=====
  async quickLogin(e) {
    if (!this.checkAgree()) return;         // 协议未勾选 → 拦截（与正式登录一致）
    const ok = await this.requirePrivacy(); // 隐私未同意 → 弹窗拦截
    if (!ok) {
      wx.showToast({ title: '请先同意隐私协议', icon: 'none' });
      return;
    }
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
  async login() {
    if (!this.checkAgree()) return;
    const ok = await this.requirePrivacy();   // 异步检测：未同意则弹窗并中断，同意后需再点
    if (!ok) {
      wx.showToast({ title: '请先同意隐私协议', icon: 'none' });
      return;
    }
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
  async phoneLogin(e) {
    if (!this.checkAgree()) return;
    const ok = await this.requirePrivacy();   // 异步检测：未同意则弹窗并中断
    if (!ok) {
      wx.showToast({ title: '请先同意隐私协议', icon: 'none' });
      return;
    }
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
  // 昵称 → openid（与后端测试账号一致的 djb2 哈希）
  hashNick(nick) {
    let h = 5381;
    for (let i = 0; i < nick.length; i++) h = ((h * 33) ^ nick.charCodeAt(i)) >>> 0;
    return 'demo_' + h.toString(36);
  },

  doLogin(userProfile, testNick) {
    wx.login({
      success: (res) => {
        const code = res.code || '';

        // 演示阶段：
        //  - 输入昵称匹配测试账号（喻馥雅/蚂蚁/艳子）→ 用该账号登录（testNick 传入）
        //  - 微信一键登录 / 手机号登录 → 统一「田立」demo_user
        // ⚠️ 正式上线：接入 jscode2session 用真实 openid 替换本段
        const nick = String((testNick || userProfile.name) || '').trim();
        const openid = testNick ? this.hashNick(testNick) : 'demo_user';
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
            // 教练账号（如「喻馥雅」）→ 绑定教练档案 id=1（教练端课表按 coach_id 加载）
            coach_id: (user.role === 'coach') ? 1 : undefined,
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
            // 登录完成 → 按角色分流：教练进教练端课表，学员进预约页
            if (userInfo.role === 'coach') {
              wx.redirectTo({ url: '/pages/coach-schedule/index' });
            } else {
              wx.switchTab({ url: '/pages/student-courses/index' });
            }
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

  // 邀请追踪：从分享卡片捕获的邀请人（pending_inviter）绑定邀请关系（防刷由后端校验；失败不阻断登录）
  bindInvite(openid) {
    const code = String(wx.getStorageSync('pending_inviter') || '').trim();
    if (!code) return;
    const api = require('../../utils/api.js');
    api.bindInvite({ inviter: code, invitee: openid }).then(() => {
      wx.removeStorageSync('pending_inviter');
      wx.showToast({ title: '邀请关系绑定成功', icon: 'none' });
    }).catch((err) => {
      console.warn('[invite] 绑定失败', err && err.message);
    });
  },

  noop() {}
});
