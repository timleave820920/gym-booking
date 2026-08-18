/**
 * 国际化语言文件（i18n）
 * 综合训练馆订课系统
 *
 * 所有页面文字统一从这里获取，支持中英文切换。
 * 使用方式：页面 JS 中 const i18n = require('../../utils/i18n.js')
 *          onLoad 时 this.setData({ t: i18n.t() })  // t 为当前语言字典
 *          WXML 中用 {{t.xxx}} 引用
 *
 * 新增语言：在 LANGUAGES 中加 key，在 zh/en 中补充对应翻译。
 */
const STORAGE_KEY = 'app_language';

// 当前语言（默认中文）
let currentLang = 'zh';

// 语言选项
const LANGUAGES = {
  zh: { label: '中文', flag: '中' },
  en: { label: 'English', flag: 'EN' }
};

// 从缓存恢复语言偏好
function loadLang() {
  const saved = wx.getStorageSync(STORAGE_KEY);
  if (saved && LANGUAGES[saved]) {
    currentLang = saved;
  }
  return currentLang;
}

// 切换语言
function setLang(lang) {
  if (!LANGUAGES[lang]) return false;
  currentLang = lang;
  wx.setStorageSync(STORAGE_KEY, lang);
  return true;
}

// 获取当前语言字典（WXML 绑定用）
// DICT 结构为 { key: { zh: '...', en: '...' } }，这里按语言重组
function t() {
  const lang = currentLang === 'en' ? 'en' : 'zh';
  const result = {};
  for (const key in DICT) {
    result[key] = DICT[key][lang] !== undefined ? DICT[key][lang] : DICT[key].zh;
  }
  return result;
}

// 获取当前语言代码
function getLang() {
  return currentLang;
}

// 获取语言选项（登录页切换按钮用）
function getLanguages() {
  return LANGUAGES;
}

/**
 * 中英文词典
 * 约定：key 用语义化驼峰命名；{{var}} 为占位符（模板字符串）
 */
const DICT = {
  // ===== 通用 =====
  gymName: { zh: '综合训练馆', en: 'Gym Center' },
  brandSlogan: { zh: '挥洒汗水，遇见更好的自己', en: 'Sweat it out, meet a better you' },
  roleStudent: { zh: '学员', en: 'Student' },
  roleAdmin: { zh: '管理员', en: 'Admin' },
  search: { zh: '搜索', en: 'Search' },
  settings: { zh: '设置', en: 'Settings' },
  exit: { zh: '退出', en: 'Exit' },
  logout: { zh: '退出登录', en: 'Log Out' },
  view: { zh: '查看', en: 'View' },
  viewAll: { zh: '查看全部', en: 'View All' },
  delete: { zh: '删除', en: 'Delete' },
  confirm: { zh: '确认', en: 'Confirm' },
  cancel: { zh: '取消', en: 'Cancel' },
  share: { zh: '分享', en: 'Share' },
  total: { zh: '共', en: 'Total' },
  people: { zh: '人', en: 'people' },

  // ===== 登录页 =====
  wxLogin: { zh: '微信一键登录', en: 'WeChat Login' },
  wxLoggingIn: { zh: '登录中...', en: 'Logging in...' },
  phoneLogin: { zh: '手机号快捷登录', en: 'Phone Quick Login' },
  or: { zh: '或', en: 'or' },
  agreeText: { zh: '我已阅读并同意《用户协议》和《隐私政策》', en: 'I have read and agree to the User Agreement & Privacy Policy' },
  loginAsStudent: { zh: '登录即代表同意以学员身份使用本服务', en: 'By logging in you agree to use this service as a student' },
  firstLoginHint: { zh: '首次登录将引导完善微信头像与昵称', en: 'First login will guide you to set avatar & nickname' },
  completeProfile: { zh: '完善资料', en: 'Complete Profile' },
  profileSub: { zh: '点击使用微信昵称，一键填写真实名字', en: 'Tap to use your WeChat nickname for one-tap fill' },
  chooseAvatarHint1: { zh: '点击上方圆圈选择微信头像', en: 'Tap the circle above to choose your WeChat avatar' },
  chooseAvatarHint2: { zh: '已授权时自动使用微信头像', en: 'Your WeChat avatar is used automatically when authorized' },
  nickname: { zh: '昵称', en: 'Nickname' },
  nicknamePh: { zh: '点击输入，键盘上方可一键使用微信昵称', en: 'Type here, or tap "Use WeChat Nickname" above the keyboard' },
  finishEnter: { zh: '完成，进入训练馆', en: 'Finish & Enter' },
  registerSuccess: { zh: '注册成功', en: 'Registered' },
  welcomeBack: { zh: '欢迎回来', en: 'Welcome Back' },
  loginSuccess: { zh: '登录成功', en: 'Login Success' },

  // ===== 学员端首页 =====
  morningGreeting: { zh: '早上好，{{name}}', en: 'Good morning, {{name}}' },
  greetingMorning: { zh: '早上好', en: 'Good morning' },
  greetingNoon: { zh: '中午好', en: 'Good noon' },
  greetingAfternoon: { zh: '下午好', en: 'Good afternoon' },
  greetingEvening: { zh: '晚上好', en: 'Good evening' },
  greetingLate: { zh: '夜深了', en: 'It\'s late' },
  todayDate: { zh: '今日 8月10日', en: 'Today Aug 10' },
  hotCourses: { zh: '热门课程', en: 'Hot Courses' },
  todayCourses: { zh: '今日课程', en: "Today's Classes" },
  noTodayCourse: { zh: '今日暂无课程', en: 'No classes today' },
  ended: { zh: '结束', en: 'Ended' },
  ongoing: { zh: '进行', en: 'In Progress' },
  waitlisted: { zh: '已排', en: 'Waitlisted' },
  hotTop5: { zh: '热门课程 TOP5', en: 'Hot Courses TOP5' },
  summerPromo: { zh: '夏日燃脂季', en: 'Summer Fat-Burn Season' },
  promoSub: { zh: '全场团课 5 折起，立即开练', en: 'All group classes up to 50% off, start now' },
  grabCourse: { zh: '去抢课', en: 'Grab Now' },
  thisWeekSchedule: { zh: '本周课表预览', en: 'This Week Preview' },
  thisWeekRecords: { zh: '本周锻炼记录', en: 'This Week Records' },
  viewSchedule: { zh: '查看课表', en: 'View Schedule' },
  daysStreak: { zh: '已连续坚持 {{streak}} 天', en: '{{streak}}-day streak' },
  firstClassRemind: { zh: '10:00 第一节课 · 记得提前到场', en: 'First class at 10:00 · Arrive early' },

  // ===== 课程列表/详情 =====
  allCourses: { zh: '全部课程', en: 'All Courses' },
  searchCourseHint: { zh: '搜索课程 / 教练 / 场地', en: 'Search course / coach / venue' },
  tryOtherDate: { zh: '试试选择其他日期', en: 'Try another date' },
  noScheduleToday: { zh: '当天暂无排课', en: 'No classes scheduled' },
  remainingSeats: { zh: '余 {{remaining}} 席', en: '{{remaining}} left' },
  coachPrefix: { zh: '教练', en: 'Coach' },
  courseType: { zh: '课程类型', en: 'Course Type' },
  courseTime: { zh: '课程时段', en: 'Course Time' },
  venue: { zh: '场地', en: 'Venue' },
  instructor: { zh: '授课教练', en: 'Instructor' },
  intensity: { zh: '强度', en: 'Intensity' },
  duration: { zh: '时长', en: 'Duration' },
  capacityRemain: { zh: '剩余 / 上限', en: 'Left / Cap' },
  bookNow: { zh: '立即预订', en: 'Book Now' },
  bookClass: { zh: '约课', en: 'Book' },
  singlePrice: { zh: '单次 ¥{{price}} · 约课后直接支付', en: '¥{{price}}/class · pay after booking' },
  priceIncludes: { zh: '含课程费用', en: 'Course fee included' },
  seatsTight: { zh: '席位紧张，仅剩 {{remaining}} 席，先约先得', en: 'Only {{remaining}} seats left, first come first served' },
  confirmPay: { zh: '确认支付', en: 'Confirm & Pay' },
  payAmount: { zh: '需支付金额（元）', en: 'Amount (CNY)' },
  payMethod: { zh: '选择支付方式', en: 'Payment Method' },
  unsubscribe: { zh: '退订', en: 'Unsubscribe' },

  // ===== 我的课程/成就/签到 =====
  myCourses: { zh: '我的课程', en: 'My Courses' },
  myAchievements: { zh: '我的成就', en: 'My Achievements' },
  achievementBadges: { zh: '成就徽章', en: 'Achievement Badges' },
  noCoursesDone: { zh: '还没有完成的课程', en: 'No finished courses yet' },
  toBeStarted: { zh: '待上课', en: 'Upcoming' },
  completed: { zh: '已完成', en: 'Completed' },
  checkedIn: { zh: '已签到', en: 'Checked In' },
  notChecked: { zh: '未签到', en: 'Not Checked' },
  checkIn: { zh: '签到', en: 'Check In' },
  manualCheckIn: { zh: '手动签到', en: 'Manual Check-in' },
  scanCheckIn: { zh: '扫码签到', en: 'Scan to Check In' },
  scanHint: { zh: '出示二维码给前台扫码签到', en: 'Show QR code to front desk to check in' },
  checkInBefore30: { zh: '开课前 30 分钟起可签到，课程结束后 30 分钟内可补签', en: 'Check-in opens 30 min before class and closes 30 min after class ends' },
  checkedCount: { zh: '已签到 {{checked}}/{{total}}', en: 'Checked {{checked}}/{{total}}' },
  refreshCode: { zh: '刷新签到码', en: 'Refresh Code' },
  codeValid10min: { zh: '签到码 10 分钟内有效', en: 'Code valid for 10 minutes' },
  streakRecord: { zh: '4 次 · 达标', en: '4 times · Target Met' },
  beatMonthRecord: { zh: '刷新本月最长记录，继续保持！', en: 'New monthly record, keep going!' },
  daysStreakNum: { zh: '已连续坚持 {{streak}} 天', en: '{{streak}}-day streak' },

  // ===== 个人中心 =====
  profile: { zh: '个人中心', en: 'Profile' },
  fromAlbum: { zh: '从相册选择', en: 'Choose from Album' },

  // ===== 教练端 =====
  coachMorning: { zh: '{{name}}教练，早上好', en: 'Good morning, Coach {{name}}' },
  todayClasses: { zh: '今天有 3 节课 · 20 名学员', en: '3 classes today · 20 students' },
  todaySchedule: { zh: '今日 {{count}} 节排课', en: '{{count}} classes today' },
  myStudents: { zh: '我的学员', en: 'My Students' },
  searchCoachHint: { zh: '搜索教练姓名 / 专长', en: 'Search coach name / specialty' },
  addCoach: { zh: '添加教练', en: 'Add Coach' },
  coachStudentsHint: { zh: '教练 · {{name}}', en: 'Coach · {{name}}' },

  // ===== 后台 =====
  adminBrand: { zh: '训练馆管家', en: 'Gym Manager' },
  adminDashboard: { zh: '数据仪表盘', en: 'Dashboard' },
  scheduleManage: { zh: '排课管理', en: 'Schedule' },
  scheduleConfig: { zh: '排课配置', en: 'Schedule Setup' },
  venueManage: { zh: '场地管理', en: 'Venues' },
  studentManage: { zh: '学员管理', en: 'Students' },
  coachManage: { zh: '教练管理', en: 'Coaches' },
  revenueStat: { zh: '营收统计', en: 'Revenue' },
  dbManage: { zh: '数据库', en: 'Database' },
  dbManageTitle: { zh: '数据库管理', en: 'Database Management' },
  totalUsers: { zh: '注册用户', en: 'Registered Users' },
  userList: { zh: '用户列表', en: 'User List' },
  addStudent: { zh: '添加学员', en: 'Add Student' },
  searchStudentHint: { zh: '搜索学员姓名 / 手机号', en: 'Search name / phone' },
  allStudents: { zh: '全部学员', en: 'All Students' },
  studentStatus: { zh: '学员状态', en: 'Status' },
  loginCount: { zh: '登录次数', en: 'Logins' },
  registerTime: { zh: '注册于 {{time}}', en: 'Registered {{time}}' },
  noStudents: { zh: '暂无注册学员', en: 'No registered students' },
  autoRegisterHint: { zh: '学员首次登录后会自动注册到数据库', en: 'Students auto-register on first login' },
  dangerOps: { zh: '危险操作', en: 'Danger Zone' },
  dangerDesc: { zh: '以下操作不可恢复，请谨慎使用', en: 'These actions are irreversible, use with care' },
  clearAllUsers: { zh: '一键清空所有用户', en: 'Clear All Users' },
  deleteUser: { zh: '删除用户', en: 'Delete User' },
  dbConnected: { zh: '已连接', en: 'Connected' },
  dbDisconnected: { zh: '未连接', en: 'Disconnected' },
  dbStatusConnected: { zh: '已连接数据库 · 共 {{count}} 名注册学员', en: 'Connected · {{count}} registered students' },
  dbStatusDisconnected: { zh: '数据库未连接，请确认后端服务已启动', en: 'DB not connected, check server is running' },
  loadingFromDb: { zh: '正在从数据库加载...', en: 'Loading from database...' },
  location: { zh: '位置', en: 'Location' },
  dbPath: { zh: 'server/data/gym.db', en: 'server/data/gym.db' },

  // ===== 后台排课/场地/营收 =====
  publishSchedule: { zh: '发布课表', en: 'Publish Schedule' },
  publishHint: { zh: '发布后，学员端与教练端将同步更新为最新课表', en: 'Students & coaches will sync the latest schedule' },
  publishToCloud: { zh: '发布到云端', en: 'Publish to Cloud' },
  configSchedule: { zh: '配置排课', en: 'Configure Schedule' },
  configFutureCourses: { zh: '配置未来课程', en: 'Configure Upcoming Classes' },
  courseDate: { zh: '开课日期', en: 'Class Date' },
  addVenue: { zh: '新增场地', en: 'Add Venue' },
  venueCapacity: { zh: '场地 / 容量', en: 'Venue / Capacity' },
  manageVenues: { zh: '管理场地', en: 'Manage Venues' },
  capacityCount: { zh: '容量 {{cap}} 人', en: 'Capacity {{cap}}' },
  revenueTrend: { zh: '营收趋势', en: 'Revenue Trend' },
  revenueSource: { zh: '收入来源分布', en: 'Revenue Breakdown' },
  monthlyRevenue: { zh: '月度营收（万元）', en: 'Monthly Revenue (10k)' },
  last7d: { zh: '近7天', en: '7D' },
  last30d: { zh: '近30天', en: '30D' },
  thisMonth: { zh: '本月', en: 'This Month' },
  thisQuarter: { zh: '本季', en: 'This Quarter' },
  thisYear: { zh: '全年', en: 'Year' },
  totalEnrolled: { zh: '总报名', en: 'Total Enrolled' },
  totalRevenue: { zh: '营收', en: 'Revenue' },
  refreshTime: { zh: '修改刷新时间', en: 'Change Refresh Time' },
  scanForCoach: { zh: '请将学员的签到码对准扫描框', en: 'Align student check-in code with scanner' },

  // ===== 学员端课程卡片 =====
  courseCardMeta: { zh: '{{time}}-{{end}} · 余 {{remaining}} 席', en: '{{time}}-{{end}} · {{remaining}} left' },
  coachNameMeta: { zh: '教练 · {{coach}}', en: 'Coach · {{coach}}' },
  coachVenueMeta: { zh: '教练 · {{coach}} · {{venue}}', en: 'Coach · {{coach}} · {{venue}}' },
  seatsLeftMeta: { zh: '教练 · {{coach}} · 余 {{remaining}} 席', en: 'Coach · {{coach}} · {{remaining}} left' },
  courseMetaFull: { zh: '{{time}}-{{end}} · 余 {{remaining}} 席', en: '{{time}}-{{end}} · {{remaining}} left' },
  enrolledMeta: { zh: '{{venue}} · 已报名 {{enrolled}}/{{capacity}}', en: '{{venue}} · Enrolled {{enrolled}}/{{capacity}}' },
  todayTag: { zh: '今天', en: 'Today' },
  timeRangeSeats: { zh: '{{start}}-{{end}} · {{remaining}}/{{capacity}}', en: '{{start}}-{{end}} · {{remaining}}/{{capacity}}' },
  bookPrice: { zh: '¥{{price}} 约课', en: '¥{{price}} Book' },
  waitlistBtn: { zh: '排位', en: 'Waitlist' },
  waitlistSub: { zh: '已满 · 可付费排队，有人退订自动转正', en: 'Full · Queue up, auto-promoted when someone cancels' },
  waitlistSuccess: { zh: '排位成功', en: 'Waitlisted' },
  waitlistQueued: { zh: '候补中', en: 'In Queue' },
  waitlistPromoted: { zh: '已转正', en: 'Promoted' },
  waitlistRefunded: { zh: '已退款', en: 'Refunded' },
  waitlistCancelled: { zh: '已退出', en: 'Cancelled' },
  exitWaitlist: { zh: '退出候补', en: 'Leave Queue' },
  descTitle: { zh: '课程介绍', en: 'About' },
  descUpcoming: { zh: '本课程为高效团体训练课，融合力量、心肺与核心训练，教练全程指导。名额有限，报名从速，开课前 30 分钟可入馆热身。', en: 'A high-intensity group workout blending strength, cardio and core. Coached throughout. Limited seats - book now, warm up 30 min before class.' },
  descOngoing: { zh: '本课程正在进行中！请提前到达场馆，跟随教练完成训练。中途加入请注意热身充分，听从教练口令。', en: 'This class is in progress! Arrive on time and follow the coach. Warm up properly if joining late.' },
  descEnded: { zh: '本场课程已结束。感谢参与！训练后记得拉伸放松，补充水分。可在「我的 - 成就与记录」查看训练数据。', en: 'This class has ended. Thanks for joining! Stretch and hydrate after training. View your workout records in Profile > Achievements.' },
  bookImmediate: { zh: '立即预订', en: 'Book Now' },
  bookedLabel: { zh: '已预订', en: 'Booked' },
  sessionTimeLabel: { zh: '本场时间', en: 'Session Time' }
};

module.exports = {
  STORAGE_KEY,
  LANGUAGES,
  loadLang,
  setLang,
  getLang,
  getLanguages,
  t
};
