App({
  globalData: {
    userInfo: {
      name: '小陈同学',
      avatar: '/images/2_556.png',
      totalClasses: 32,
      totalHours: '28.5h',
      totalCalories: '12,480',
      streak: 12
    },
    // 当前选中的课程（从列表/详情进入支付时传递）
    currentCourse: null
  },
  onLaunch() {}
})
