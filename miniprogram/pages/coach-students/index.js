const mock = require('../../utils/mock.js');

Page({
  data: {
    course: { name: 'HIIT 高强度燃脂', time: '今日 10:00-11:00', venue: 'A馆' },
    checked: 10,
    unchecked: 2,
    total: 12,
    students: []
  },

  onLoad(options) {
    const id = Number(options.id || 1);
    const course = mock.coachSchedule.find(c => c.id === id);
    const base = course ? course.name : 'HIIT 高强度燃脂';
    this.setData({
      course: {
        name: base,
        time: `今日 ${course ? course.time : '10:00'}-${course ? (Number(course.time.split(':')[0]) + 1).toString().padStart(2, '0') + ':' + course.time.split(':')[1] : '11:00'}`,
        venue: course ? course.venue : 'A馆'
      },
      students: mock.studentRoster
    });
  },

  goScan() {
    wx.navigateTo({ url: '/pages/coach-scan/index' });
  },

  toggleCheck(e) {
    const id = e.currentTarget.dataset.id;
    const students = this.data.students.map(s => {
      if (s.id === id) return { ...s, checked: !s.checked };
      return s;
    });
    const checked = students.filter(s => s.checked).length;
    this.setData({
      students,
      checked,
      unchecked: students.length - checked
    });
  }
});
