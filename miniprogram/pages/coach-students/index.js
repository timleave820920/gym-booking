const api = require('../../utils/api.js');

Page({
  data: {
    course: { name: '', time: '', venue: '' },
    checked: 0,
    unchecked: 0,
    total: 0,
    students: [],
    loading: true,
    offline: false
  },

  onLoad(options) {
    const sessionId = Number(options.session_id || options.id || 0);
    this.setData({ sessionId });
    if (sessionId) {
      this.loadStudents(sessionId);
    } else {
      this.setData({ loading: false, offline: true });
    }
  },

  // 从后端加载场次订课名单
  loadStudents(sessionId) {
    api.getSessionStudents(sessionId).then((res) => {
      const students = (res.students || []).map(s => ({
        id: s.id,
        name: s.student_name || '微信用户',
        meta: s.checkin_at ? `签到 ${s.checkin_at}` : '待签到',
        avatar: s.student_avatar || '/images/2_556.png',
        checked: !!s.checkin_at,
        isNew: !!s.isNewCategory // DESIGN #D11：同类型从未签到过 → 新学员
      }));
      const checked = students.filter(s => s.checked).length;
      this.setData({
        students,
        checked,
        unchecked: students.length - checked,
        total: students.length,
        newCount: res.newCount || 0,
        course: {
          name: res.students[0] ? res.students[0].course_name : '',
          time: res.students[0] ? `${res.students[0].date} ${res.students[0].start_time}-${res.students[0].end_time}` : '',
          venue: res.students[0] ? res.students[0].venue_name : ''
        },
        loading: false,
        offline: false
      });
    }).catch(() => {
      this.setData({ loading: false, offline: true });
    });
  },

});
