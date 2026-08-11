// 排课配置：选择课程类型、教练、时间，发布到云端
Page({
  data: {
    // 课程类型
    types: ['燃脂团课', '力量训练', '瑜伽普拉提', '骑行有氧'],
    selectedType: 0,
    // 教练
    coaches: ['阿凯', '小满', '大壮'],
    selectedCoach: 0,
    // 场地
    venues: ['A馆', 'B馆', 'C馆', 'D馆'],
    selectedVenue: 0,
    // 日期（未来 7 天）
    dates: [],
    selectedDate: 0,
    // 时段
    startTime: '10:00',
    endTime: '11:00',
    // 容量
    capacity: 20,
    // 刷新设置
    refreshWeekday: 1, // 0=周一 ... 6=周日
    refreshTime: '00:00',
    refreshDesc: '每周一 00:00 更新本周课表',
    // 本周课表预览
    preview: []
  },

  onLoad() {
    // 生成未来 7 天日期（从 8月17日 周一 起）
    const dates = [];
    const base = new Date(2026, 7, 17); // 2026-08-17 周一
    const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    for (let i = 0; i < 7; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      dates.push({
        label: `${weekdays[i]} ${d.getDate()}日`,
        full: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      });
    }
    this.setData({
      dates,
      preview: [
        { day: '周一 08:00', name: '杠铃操 · 大壮 · A馆', color: '#E5FFC9', text: '#3D9970' },
        { day: '周一 10:00', name: 'HIIT 高强度燃脂 · 阿凯 · A馆', color: '#DCD8FF', text: '#5B57EB' },
        { day: '周二 15:00', name: '空中瑜伽 · 小满 · B馆', color: '#FFF0D6', text: '#D97706' }
      ]
    });
  },

  // 选择类型
  pickType(e) {
    this.setData({ selectedType: Number(e.currentTarget.dataset.idx) });
  },
  // 选择教练
  pickCoach(e) {
    this.setData({ selectedCoach: Number(e.currentTarget.dataset.idx) });
  },
  // 选择场地
  pickVenue(e) {
    this.setData({ selectedVenue: Number(e.currentTarget.dataset.idx) });
  },
  // 选择日期
  pickDate(e) {
    this.setData({ selectedDate: Number(e.currentTarget.dataset.idx) });
  },
  // 开始时间
  onStartTime(e) {
    this.setData({ startTime: e.detail.value });
  },
  // 结束时间
  onEndTime(e) {
    this.setData({ endTime: e.detail.value });
  },
  // 容量
  onCapacity(e) {
    this.setData({ capacity: e.detail.value });
  },

  // 修改刷新设置
  openRefreshSetting() {
    wx.showActionSheet({
      itemList: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
      success: (res) => {
        const weekday = res.tapIndex;
        this.setData({
          refreshWeekday: weekday,
          refreshDesc: `每周${['一','二','三','四','五','六','日'][weekday]} ${this.data.refreshTime} 更新本周课表`
        });
      }
    });
  },
  onRefreshTime(e) {
    this.setData({
      refreshTime: e.detail.value,
      refreshDesc: `每周${['一','二','三','四','五','六','日'][this.data.refreshWeekday]} ${e.detail.value} 更新本周课表`
    });
  },

  // 发布课表到云端
  publish() {
    const { types, selectedType, coaches, selectedCoach, venues, selectedVenue, dates, selectedDate, startTime, endTime, capacity } = this.data;
    const course = {
      type: types[selectedType],
      coach: coaches[selectedCoach],
      venue: venues[selectedVenue],
      date: dates[selectedDate].full,
      time: `${startTime}-${endTime}`,
      capacity
    };
    wx.showLoading({ title: '发布中...' });
    setTimeout(() => {
      wx.hideLoading();
      wx.showModal({
        title: '发布成功',
        content: `课程「${course.type}」已推送到云端\n${course.date} ${course.time} · ${course.coach} · ${course.venue}`,
        showCancel: false,
        confirmText: '完成',
        success: () => {
          // 回到排课管理
          wx.redirectTo({ url: '/pages/admin-schedule/index' });
        }
      });
    }, 1000);
  },

  // 退出后台
  // 后台导航跳转
  navTo(e) {
    const url = e.currentTarget.dataset.url;
    wx.redirectTo({ url });
  },

  // 退出登录，返回登录页
  exitToStudent() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('userInfo');
    wx.reLaunch({ url: '/pages/login/index' });
  }
});
