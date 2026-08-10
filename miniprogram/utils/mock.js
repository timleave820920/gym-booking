// ===== 全局 mock 数据 =====

// 课程列表（本周，周一 8/10 至周日 8/16）
const courses = [
  { id: 1, name: 'HIIT 高强度燃脂', category: '燃脂团课', coach: '阿凯', venue: 'A馆',
    start: '10:00', end: '11:00', duration: '60分钟', price: 68, capacity: 20, booked: 12, remaining: 8,
    level: 4, img: '/images/2_193.png', days: [1, 3, 5] },
  { id: 2, name: '流瑜伽 · 舒缓拉伸', category: '瑜伽普拉提', coach: '小满', venue: 'B馆',
    start: '19:30', end: '20:30', duration: '60分钟', price: 68, capacity: 15, booked: 3, remaining: 12,
    level: 2, img: '/images/2_206.png', days: [1, 2, 4, 6] },
  { id: 3, name: '杠铃操 · 全身塑形', category: '力量训练', coach: '大壮', venue: 'A馆',
    start: '08:00', end: '09:00', duration: '60分钟', price: 68, capacity: 20, booked: 15, remaining: 5,
    level: 3, img: '/images/2_237.png', days: [1, 3, 5] },
  { id: 4, name: '动感单车 · 燃脂骑行', category: '燃脂团课', coach: '阿凯', venue: 'C馆',
    start: '12:30', end: '13:30', duration: '60分钟', price: 68, capacity: 25, booked: 23, remaining: 2,
    level: 4, img: '/images/2_247.png', days: [2, 4, 6] },
  { id: 5, name: '空中瑜伽 · 优雅塑形', category: '瑜伽普拉提', coach: '小满', venue: 'B馆',
    start: '15:00', end: '16:00', duration: '60分钟', price: 68, capacity: 15, booked: 5, remaining: 10,
    level: 2, img: '/images/2_257.png', days: [2, 5, 7] },
  { id: 6, name: '核心力量训练', category: '力量训练', coach: '大壮', venue: 'B馆',
    start: '14:30', end: '15:15', duration: '45分钟', price: 58, capacity: 15, booked: 7, remaining: 8,
    level: 3, img: '/images/2_1350.png', days: [3, 6] },
  { id: 7, name: '战绳燃脂挑战', category: '燃脂团课', coach: '阿凯', venue: 'A馆',
    start: '19:00', end: '20:00', duration: '60分钟', price: 68, capacity: 20, booked: 15, remaining: 5,
    level: 5, img: '/images/2_1374.png', days: [4, 7] }
];

// 本周日期（周一 ~ 周日）
const weekDays = [
  { weekday: '周一', date: 10, selected: true },
  { weekday: '周二', date: 11, selected: false },
  { weekday: '周三', date: 12, selected: false },
  { weekday: '周四', date: 13, selected: false },
  { weekday: '周五', date: 14, selected: false },
  { weekday: '周六', date: 15, selected: false },
  { weekday: '周日', date: 16, selected: false }
];

// 我的课程
const myCourses = [
  { id: 1, name: 'HIIT 高强度燃脂训练', coach: '阿凯', venue: 'A馆', date: '今天 8月10日',
    time: '10:00', duration: '60分钟', status: '待上课', statusType: 'pending' },
  { id: 2, name: '流瑜伽 · 舒缓拉伸', coach: '小满', venue: 'B馆', date: '明天 8月11日',
    time: '19:30', duration: '60分钟', status: '即将开课', statusType: 'upcoming' }
];

// 教练端 - 今日课表
const coachSchedule = [
  { id: 1, name: 'HIIT 高强度燃脂', venue: 'A馆', time: '10:00', duration: '60分钟',
    enrolled: 12, capacity: 20, status: '即将开始', statusType: 'green' },
  { id: 2, name: '核心力量训练', venue: 'B馆', time: '14:30', duration: '45分钟',
    enrolled: 8, capacity: 15, status: '报名中', statusType: 'green' },
  { id: 3, name: '战绳燃脂挑战', venue: 'A馆', time: '19:00', duration: '60分钟',
    enrolled: 15, capacity: 20, status: '今晚 19:00', statusType: 'orange' }
];

// 教练端 - 学员名单
const studentRoster = [
  { id: 1, name: '李明轩', meta: '活跃学员', avatar: '/images/2_708.png', checked: true },
  { id: 2, name: '王雨桐', meta: '忠实学员', avatar: '/images/2_715.png', checked: true },
  { id: 3, name: '张子豪', meta: '体验学员', avatar: '/images/2_722.png', checked: false },
  { id: 4, name: '陈晓萌', meta: '活跃学员', avatar: '/images/2_729.png', checked: false }
];

// 后台 - 仪表盘统计
const adminStats = [
  { label: '注册学员', value: '2,846', trend: '↑ 12.5% 本月', icon: 'users', dark: true },
  { label: '本月课次', value: '1,920', trend: '↑ 8.2% 较上月', icon: 'calendar' },
  { label: '到课率', value: '88.6%', trend: '↑ 3.4% 较上月', icon: 'check' },
  { label: '本月营收', value: '¥ 486,200', trend: '↑ 15.8% 较上月', icon: 'wallet' }
];

// 后台 - 热门课程排行
const hotCourses = [
  { rank: 1, name: 'HIIT 高强度燃脂', pct: 96, color: '#5B57EB' },
  { rank: 2, name: '动感单车 · 燃脂骑行', pct: 82, color: '#3D9970' },
  { rank: 3, name: '空中瑜伽 · 优雅塑形', pct: 71, color: '#D97706' },
  { rank: 4, name: '杠铃操 · 全身塑形', pct: 65, color: '#6B6B76' },
  { rank: 5, name: '流瑜伽 · 舒缓拉伸', pct: 52, color: '#6B6B76' }
];

// 后台 - 场地
const venues = [
  { id: 1, name: 'A 馆 · 综合训练区', capacity: 20, today: 6, img: '/images/2_1350.png' },
  { id: 2, name: 'B 馆 · 瑜伽普拉提室', capacity: 15, today: 4, img: '/images/2_1358.png' },
  { id: 3, name: 'C 馆 · 动感单车房', capacity: 25, today: 5, img: '/images/2_1366.png' },
  { id: 4, name: 'D 馆 · 力量训练区', capacity: 30, today: 8, img: '/images/2_1374.png' }
];

// 后台 - 学员管理
const adminStudents = [
  { id: 1, name: '李明轩', phone: '138****2210', status: '活跃学员', classes: 6, avatar: '/images/2_708.png' },
  { id: 2, name: '王雨桐', phone: '159****8807', status: '忠实学员', classes: 8, avatar: '/images/2_715.png' },
  { id: 3, name: '张子豪', phone: '186****3352', status: '体验学员', classes: 2, avatar: '/images/2_722.png' }
];

// 后台 - 教练管理
const adminCoaches = [
  { id: 1, name: '阿凯', skill: 'HIIT · 战绳 · 核心', stat: '本月 42 节 · 好评 4.9', avatar: '/images/2_1468.png' },
  { id: 2, name: '小满', skill: '瑜伽 · 普拉提 · 拉伸', stat: '本月 36 节 · 好评 4.8', avatar: '/images/2_1474.png' },
  { id: 3, name: '大壮', skill: '杠铃 · 力量 · 体能', stat: '本月 38 节 · 好评 4.7', avatar: '/images/2_1480.png' }
];

// 后台 - 营收
const revenueStats = [
  { label: '本月营收', value: '¥ 486,200', trend: '↑ 15.8% 较上月', dark: true },
  { label: '本月订单', value: '3,842', trend: '↑ 9.1% 较上月' },
  { label: '单次课程收入', value: '¥ 268,400', trend: '占 55.2%' },
  { label: '客单价', value: '¥ 126.5', trend: '↑ 6.2% 较上月' }
];

// 收入来源
const revenueSources = [
  { name: '单次课程', pct: '55.2%', color: '#5B57EB' },
  { name: '私教课程', pct: '28.6%', color: '#B9FF66' },
  { name: '场地租借', pct: '10.4%', color: '#F8D044' },
  { name: '其他', pct: '5.8%', color: '#F8B7B8' }
];

// 月度营收柱状数据
const monthlyRevenue = [
  { month: '1月', value: 102 }, { month: '2月', value: 132 }, { month: '3月', value: 112 },
  { month: '4月', value: 152 }, { month: '5月', value: 172 }, { month: '6月', value: 162 },
  { month: '7月', value: 192 }, { month: '8月', value: 176 }
];

// 成就数据
const achievements = [
  { name: '新人首练', color: '#B9FF66', unlocked: true },
  { name: '燃脂之星', color: '#5B57EB', unlocked: true },
  { name: '连续7天', color: '#F8D044', unlocked: true },
  { name: '力量达人', color: '#F8B7B8', unlocked: false }
];

// 周锻炼记录（周一~周日，0 表示未练，本周已练 4 天）
const weekRecord = [
  { weekday: '一', count: 1, active: true },
  { weekday: '二', count: 0, active: false },
  { weekday: '三', count: 1, active: true },
  { weekday: '四', count: 1, active: true },
  { weekday: '五', count: 0, active: false },
  { weekday: '六', count: 0, active: true, today: true },
  { weekday: '日', count: 0, active: false }
];

module.exports = {
  courses, weekDays, myCourses, coachSchedule, studentRoster,
  adminStats, hotCourses, venues, adminStudents, adminCoaches,
  revenueStats, revenueSources, monthlyRevenue, achievements, weekRecord
};
