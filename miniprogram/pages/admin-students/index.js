const api = require('../../utils/api.js');

Page({
  data: {
    students: [],
    loading: true,
    totalCount: 0,
    dbConnected: false,
    // 设教练弹层
    assignShow: false,
    assignUser: null,        // 待设为教练的学员
    coachOptions: [],        // 教练档案 [{ id, name, skills }]
    coachNames: [],
    assignCoachIdx: 0,
    assigning: false
  },

  onLoad() {
    this.loadStudents();
  },

  onPullDownRefresh() {
    this.loadStudents(() => wx.stopPullDownRefresh());
  },

  // 从真实数据库加载学员
  loadStudents(callback) {
    this.setData({ loading: true });
    api.getUsers().then((res) => {
      const students = res.users.map(u => ({
        id: u.id,
        openid: u.openid,
        name: u.nickname || '微信用户',
        avatar: u.avatar || '/images/2_556.png',
        phone: u.phone || '未绑定手机号',
        status: this.getStatus(u),
        classes: u.total_classes || 0,
        loginCount: u.login_count || 0,
        createdAt: u.created_at || '',
        lastLogin: u.last_login_at || '',
        role: u.role || 'student'
      }));
      this.setData({
        students,
        totalCount: students.length,
        loading: false,
        dbConnected: true
      });
      if (callback) callback();
    }).catch(() => {
      this.setData({ loading: false, dbConnected: false });
      if (callback) callback();
    });
  },

  // 学员状态：根据角色和登录次数推断
  getStatus(u) {
    if (u.role === 'coach') return { text: '教练', type: 'purple' };
    if (u.role === 'admin') return { text: '管理员', type: 'dark' };
    // 学员：按登录次数划分活跃度
    if (u.login_count >= 5) return { text: '忠实学员', type: 'green' };
    if (u.login_count >= 2) return { text: '活跃学员', type: 'green' };
    return { text: '新学员', type: 'orange' };
  },

  // 头像加载失败 → 回退默认头像
  avatarError(e) {
    const id = e.currentTarget.dataset.id;
    const students = this.data.students.map(s => {
      if (s.id === id) return { ...s, avatar: '/images/2_556.png' };
      return s;
    });
    this.setData({ students });
  },

  nav(e) {
    const page = e.currentTarget.dataset.page;
    const urls = {
      dashboard: '/pages/admin-dashboard/index',
      schedule: '/pages/admin-schedule/index',
      venues: '/pages/admin-venues/index',
      coaches: '/pages/admin-coaches/index',
      revenue: '/pages/admin-revenue/index'
    };
    if (page === 'students') {
      wx.showToast({ title: '当前页', icon: 'none' });
      return;
    }
    wx.redirectTo({ url: urls[page] });
  },

  add() {
    wx.showToast({ title: '添加学员', icon: 'none' });
  },

  edit() {
    wx.showToast({ title: '编辑学员', icon: 'none' });
  },

  // ===== 设教练（DESIGN #D1）=====
  // 打开弹层：加载教练档案列表（/api/meta）
  openAssign(e) {
    const idx = e.currentTarget.dataset.idx;
    const user = this.data.students[idx];
    if (!user || user.role === 'coach' || user.role === 'admin') return;
    this.setData({ assignShow: true, assignUser: user, assignCoachIdx: 0, assigning: false });
    if (this.data.coachOptions.length === 0) {
      api.getMeta().then((res) => {
        const coachOptions = (res.coaches || []).map(c => ({ id: c.id, name: c.name, skills: c.skills || '' }));
        this.setData({
          coachOptions,
          coachNames: coachOptions.map(c => c.skills ? `${c.name}（${c.skills}）` : c.name)
        });
      }).catch(() => {
        wx.showToast({ title: '教练档案加载失败', icon: 'none' });
      });
    }
  },
  closeAssign() {
    this.setData({ assignShow: false });
  },
  onAssignPick(e) {
    this.setData({ assignCoachIdx: Number(e.detail.value || 0) });
  },
  confirmAssign() {
    if (this.data.assigning) return;
    const user = this.data.assignUser;
    const coach = this.data.coachOptions[this.data.assignCoachIdx];
    if (!user || !coach) {
      wx.showToast({ title: '请先选择教练档案', icon: 'none' });
      return;
    }
    this.setData({ assigning: true });
    api.coachAssign(user.openid, coach.id).then(() => {
      wx.showToast({ title: `已将 ${user.name} 设为教练`, icon: 'success' });
      this.setData({ assignShow: false, assigning: false });
      this.loadStudents();
    }).catch((err) => {
      this.setData({ assigning: false });
      wx.showToast({ title: (err && err.message) || '设置失败', icon: 'none' });
    });
  },

  // 后台导航跳转
  navTo(e) {
    const url = e.currentTarget.dataset.url;
    wx.redirectTo({ url });
  },

  // 弹层内部点击不冒泡
  noop() {},

  // 退出登录，返回登录页
  exitToStudent() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('userInfo');
    wx.reLaunch({ url: '/pages/login/index' });
  }
});
