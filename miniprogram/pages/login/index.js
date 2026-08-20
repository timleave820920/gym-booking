const app = getApp();
const api = require('../../utils/api.js');
const i18n = require('../../utils/i18n.js');

Page({
  data: {
    booted: false,           // 页面守卫：已登录用户自动直达时保持 false 不渲染表单（防启动闪屏）
    agreed: false,         // 协议勾选（微信审核要求：禁止默认勾选，须用户主动同意）
    loggingIn: false,
    lang: 'zh',              // 当前语言
    t: i18n.t(),             // 语言字典
    showPrivacy: false,      // 隐私协议弹窗（首次启动）
    privacyOk: false,         // 隐私授权状态（官方 wx.getPrivacySetting）
    // 2026-08-15: 登录后引导设置头像昵称（新用户/昵称为空时）
    showProfileSetup: false,
    avatarPath: '',          // 头像显示路径（选完为临时路径，保存时上传）
    avatarTmpPath: '',       // 新选头像的临时路径
    nickDraft: '',           // 昵称草稿
    savingProfile: false     // 保存中（防连点）
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
    // 2026-08-19: 已完整注册（token+userInfo+openid 齐备）→ 立即直达对应首页，不再展示登录页（防闪屏）
    const ui = wx.getStorageSync('userInfo');
    const openid = (ui && ui.openid) || wx.getStorageSync('openid');
    const token = wx.getStorageSync('token');
    if (ui && openid && token) {
      this.autoEnterImmediate(ui, openid);
      return;
    }
    this.setData({
      booted: true,
      lang: i18n.getLang() || 'zh',
      t: i18n.t(),
      // 协议勾选状态持久化：用户首次勾选后记住（'1'=已勾选；'0'或空=未勾选）
      agreed: wx.getStorageSync('agreed_terms') === '1'
    });
    // 隐私协议检测（微信 2023.9 起强制：官方 wx.getPrivacySetting）
    this.requirePrivacy().then((ok) => {
      if (!ok) this.setData({ showPrivacy: true });
    });
  },

  // 已注册用户启动直达：本地登录态齐备时**先跳转再校验**（不等网络，无登录页闪现）；
  // 后端 checkLogin 兜底：清库后查无此人 → 清本地态回登录页走正常注册
  autoEnterImmediate(ui, openid) {
    // 客户来源（DESIGN #D7）：已登录用户扫码进入（无登录请求）→ 渠道归因兜底
    // last-touch 保护期内刷新；不阻塞跳转（失败静默，下次登录再补）
    this.claimChannelIfPending(openid);
    const role = ui.role || 'student';
    wx.reLaunch({ url: role === 'coach' ? '/pages/coach-home/index' : '/pages/student-courses/index' });
    api.checkLogin(openid).then((res) => {
      if (!res.exists) {
        wx.removeStorageSync('userInfo');
        wx.removeStorageSync('openid');
        wx.removeStorageSync('token');
        wx.reLaunch({ url: '/pages/login/index' });
      }
    }).catch(() => {
      // 网络异常：已进首页，由页面自身失败兜底（不做处理）
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

  onShow() {
    // 2026-08-15: 已注册用户免登录——storage 有登录态且后端确认用户存在 → 直达对应首页
    this.tryAutoEnter();
  },

  // 已登录用户启动直达（预约页/教练课表），不再展示登录页；后端查无此人（清库后）→ 清除本地登录态回登录页
  tryAutoEnter() {
    const ui = wx.getStorageSync('userInfo');
    const openid = (ui && ui.openid) || wx.getStorageSync('openid');
    if (!ui || !openid) return;
    if (this._autoChecking) return;
    this._autoChecking = true;
    api.checkLogin(openid).then((res) => {
      if (res.exists) {
        const role = ui.role || 'student';
        if (role === 'coach') {
          wx.reLaunch({ url: '/pages/coach-home/index' });
        } else {
          wx.reLaunch({ url: '/pages/student-courses/index' });
        }
      } else {
        // 用户已不存在（数据库清空）→ 清本地登录态，走正常注册登录
        wx.removeStorageSync('userInfo');
        wx.removeStorageSync('openid');
        wx.removeStorageSync('token');
      }
    }).catch(() => {
      // 网络异常：不阻断登录页展示（可手动登录）
    }).finally(() => {
      this._autoChecking = false;
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
  // 2026-08-18 B1 合规：code 发后端换真实手机号（企业认证后生效）；未认证/失败
  // 明确提示并引导微信一键登录——不再写假号（历史：本地模拟写 138****2210 已移除）
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
      this.setData({ loggingIn: true });
      api.phoneLogin(detail.code).then((r) => {
        // 拿到真实手机号 → 走统一登录（phone 落库）
        this.finishLogin({
          avatar: '/images/2_556.png',
          name: '微信用户',
          phone: r.phone
        });
      }).catch((err) => {
        this.setData({ loggingIn: false });
        wx.showToast({ title: (err && err.message) || '手机号登录暂未开放', icon: 'none' });
      });
    } else {
      // 拒绝授权 → 引导微信一键登录
      wx.showToast({ title: '请使用微信一键登录', icon: 'none' });
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

  // 登录完成：默认身份不再冒充「田立」（2026-08-15：微信登录昵称留空，由完善资料弹窗引导设置）
  finishLogin(profile) {
    const name = (!profile.name || profile.name === '微信用户' || profile.name === '小陈同学') ? '' : profile.name;
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
        // 2026-08-17 用户指令：正式登录不做任何 demo 兜底——openid 传空，后端只认
        // code 换出的真实 openid（换号失败后端 400 报错，前端弹窗重试，绝不静默变演示账号）；
        // 2026-08-18: 昵称快捷登录/演示身份入口已移除，注册角色一律由后端默认（学员），
        // 教练身份经管理后台「教练分配」绑定后生效
        const code = res.code || '';
        const openid = '';
        wx.setStorageSync('openid', openid);

        // 客户来源（DESIGN #D7）：登录请求携带渠道码（app.js onLaunch 解析 scene/query 存入）
        // 后端 login 归因：首次=first-touch 落库，老用户=last-touch 保护期内刷新
        const channel = String(wx.getStorageSync('pending_channel') || '').trim();
        const batch = String(wx.getStorageSync('pending_channel_batch') || '').trim();

        // 请求后端注册/登录
        api.login({
          code,
          openid,
          nickname: userProfile.name || '',
          avatar: userProfile.avatar || '',
          phone: userProfile.phone || '',
          ...(channel ? { channel, batch } : {})
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
            // 教练账号 → 绑定教练档案 id（后端返回，DESIGN #D1 设教练后按真实档案加载）
            coach_id: (user.role === 'coach') ? (user.coach_id || 1) : undefined,
            totalClasses: user.total_classes || 32,
            totalHours: user.total_hours || '28.5h',
            totalCalories: user.total_calories || '12,480',
            streak: user.streak || 12
          };
          wx.setStorageSync('token', token);
          wx.setStorageSync('userInfo', userInfo);
          // 2026-08-15: 用后端返回的真实 openid 覆盖兜底值（code 换号成功后即微信真实 openid，
          // 修复：原来只存演示兜底值，页面读 storage 的 openid 全变成演示账号）
          wx.setStorageSync('openid', userInfo.openid);
          // 客户来源（DESIGN #D7）：login 已带 channel 归因成功 → 清除待归因渠道（防重复上报）
          wx.removeStorageSync('pending_channel');
          wx.removeStorageSync('pending_channel_batch');
          app.globalData.userInfo = userInfo;
          app.globalData.role = userInfo.role;

          this.setData({ loggingIn: false });

          // 邀请追踪：登录后绑定邀请关系（分享卡片携带或手动填写的邀请码）
          this.bindInvite(userInfo.openid);

          // 2026-08-15: 注册不再强制设置头像昵称——1 次点击完成注册直达首页；
          // 需完善资料的用户在个人中心顶部看到提示（点头像换微信头像/点昵称填微信昵称，可选）
          const name = String(userInfo.name || '').trim();
          // 2026-08-17: 移除演示账号特判（演示账号同样需要完善资料，否则昵称为空不提示）
          const needSetup = isNewUser || (!name || name === '微信用户' || name === '田立');
          if (needSetup) {
            wx.setStorageSync('pendingProfileSetup', 1);
          } else {
            wx.removeStorageSync('pendingProfileSetup');
          }

          // 区分注册/登录提示
          wx.showToast({
            title: isNewUser ? '注册成功' : '欢迎回来',
            icon: 'none'
          });
          setTimeout(() => {
            // 登录完成 → 按角色分流：教练进教练工作台，学员进预约页（DESIGN #D1）
            if (userInfo.role === 'coach') {
              wx.redirectTo({ url: '/pages/coach-home/index' });
            } else {
              wx.switchTab({ url: '/pages/student-courses/index' });
            }
          }, 600);
        }).catch((err) => {
          this.setData({ loggingIn: false });
          // 2026-08-16: 云托管 Git 关联部署自动重建期间（数分钟窗口）callContainer 会短暂失败，
          // 弹窗提供「重试」一键重发登录请求（BUG-LEDGER #24），用户无需退出重进
          wx.showModal({
            title: '登录失败',
            content: err.message || '无法连接服务器',
            confirmText: '重试',
            cancelText: '取消',
            success: (r) => {
              if (r.confirm) this.doLogin(userProfile);
            }
          });
        });
      },
      fail: () => {
        this.setData({ loggingIn: false });
        wx.showToast({ title: '微信登录失败', icon: 'none' });
      }
    });
  },

  // 客户来源（DESIGN #D7）：已登录用户扫码进入 → 渠道归因兜底（last-touch 30 天保护期内刷新）
  // 不阻塞、不打断登录流程；失败静默（下次 login 时后端会再补一次 last-touch）
  claimChannelIfPending(openid) {
    const channel = String(wx.getStorageSync('pending_channel') || '').trim();
    if (!channel || !openid) return;
    const batch = String(wx.getStorageSync('pending_channel_batch') || '').trim();
    api.channelClaim(openid, channel, batch).then(() => {
      wx.removeStorageSync('pending_channel');
      wx.removeStorageSync('pending_channel_batch');
    }).catch((err) => {
      console.warn('[channel] 归因失败（静默）', err && err.message);
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

  // ===== 2026-08-15: 完善资料（头像+昵称，微信官方「头像昵称填写能力」）=====
  onChooseAvatar(e) {
    const path = e.detail.avatarUrl;
    if (!path) return;
    this.setData({ avatarPath: path, avatarTmpPath: path });
  },

  onProfileNick(e) {
    this.setData({ nickDraft: e.detail.value });
  },

  saveProfile() {
    if (this.data.savingProfile) return;
    const nick = String(this.data.nickDraft || '').trim();
    if (!nick) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    const openid = wx.getStorageSync('openid');
    this.setData({ savingProfile: true });
    const avatarPath = this.data.avatarTmpPath || '';
    // 保存昵称 + （选了头像则先上传再一并保存）
    const doSave = (avatarUrl) => {
      const api = require('../../utils/api.js');
      api.updateProfile({ openid, nickname: nick, avatar: avatarUrl || '' }).then((res) => {
        const ui = wx.getStorageSync('userInfo') || {};
        const newUi = {
          ...ui,
          name: nick,
          avatar: avatarUrl || ui.avatar || '/images/2_556.png',
          openid: ui.openid || openid
        };
        wx.setStorageSync('userInfo', newUi);
        wx.setStorageSync('openid', newUi.openid);
        app.globalData.userInfo = newUi;
        this.setData({ savingProfile: false, showProfileSetup: false });
        wx.showToast({ title: '资料已保存', icon: 'success' });
        setTimeout(() => this.afterProfileSaved(newUi), 600);
      }).catch((err) => {
        this.setData({ savingProfile: false });
        wx.showToast({ title: (err && err.message) || '保存失败，请重试', icon: 'none' });
      });
    };
    // 2026-08-15: 微信 chooseAvatar 选「微信头像」时 avatarUrl 是网络 URL（thirdwx.qlogo.cn）——
    // 直接存 URL 会因合法域名校验显示失败（回退默认头像），改为后端下载转存到 /images/
    if (avatarPath) {
      if (/^https?:\/\//.test(avatarPath)) {
        wx.showLoading({ title: '同步头像中...' });
        return api.avatarDownload(avatarPath).then((dl) => {
          wx.hideLoading();
          doSave(dl.path || '');
        }).catch(() => {
          wx.hideLoading();
          doSave('');
        });
      }
      wx.getFileSystemManager().readFile({
        filePath: avatarPath,
        encoding: 'base64',
        success: (r) => {
          const api = require('../../utils/api.js');
          api.uploadImage('avatar_' + Date.now() + '.png', 'data:image/png;base64,' + r.data)
            .then((u) => doSave(u.path || ''))
            .catch(() => doSave(''));
        },
        fail: () => doSave('')
      });
    } else {
      doSave('');
    }
  },

  skipProfile() {
    if (this.data.savingProfile) return;
    this.setData({ showProfileSetup: false });
    const ui = wx.getStorageSync('userInfo') || {};
    wx.showToast({ title: '稍后可再修改资料', icon: 'none' });
    setTimeout(() => this.afterProfileSaved(ui), 500);
  },

  afterProfileSaved(ui) {
    if (ui && ui.role === 'coach') {
      wx.redirectTo({ url: '/pages/coach-schedule/index' });
    } else {
      wx.switchTab({ url: '/pages/student-courses/index' });
    }
  },

  noop() {}
});
