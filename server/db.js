/**
 * 数据库层聚合入口
 * 连接/建表：db-core.js；按域拆分：db/users.js、db/coin.js、db/members.js、db/invite.js、db/courses.js、db/messages.js、db/orders.js、db/bookings.js
 * 说明：db 内跨域函数通过下方解构保持可见（bookings→orders 单向依赖）
 * 2026-08-18 P0 清理：移除 17 个未用 re-export（内部模块直接互引，不走聚合层）
 */
const { db, driver, courseCols } = require('./db-core');
const { findUserByOpenid, createUser, touchLogin, updateProfile, countUsers, listUsers, deleteUserById, deleteUserByOpenid, clearUsers, getUserProfile, updateUserProfile } = require('./db/users');
const { todayCoinsEarned, getCoinInfo, listCoinLogs, listShopItems, exchangeCoinItem, listMyExchanges } = require('./db/coin');
const { getMemberLevel, refundOrderMoney, calcRechargeBonus, listRecharges, listUnreadBalanceLogs, markBalanceLogsRead, RECHARGE_PLANS } = require('./db/members');
const { listInvitationDetails, inviteBoardStats, bindInvitation, getInviteStats } = require('./db/invite');
const { listCoaches, getCoachById, listVenues, listCourses, replaceRules, createCourse, updateCourse, deleteCourse, publishSessions, listSessionsByDateForUser, listSessionsByCoach, listSessionsByRange, cancelSession, updateSessionCapacity, getSessionById, listBookedUsersWithInfo, setCourseCoachBio } = require('./db/courses');
const { sendMessage, listMessages, unreadMessageCount, markMessageRead, markAllMessagesRead, listSessionsStartingSoon, listBookedUsersBySession } = require('./db/messages');
const { listPassPackages, getUserPass, getUserPassForDate, getUserPassInfo, expireOverduePasses } = require('./db/passes');
const { syncAchievements, REWARD_COINS } = require('./db/achievements');
const { genOrderNo, createOrder, payOrder, listOrdersByUser, getRevenueStats, promoteFromWaitlist, joinWaitlist, cancelWaitlist, listWaitlistByUser, refundExpiredWaitlist } = require('./db/orders');
const { createBooking, listBookingsByUser, getCheckinInfo, listBookingsBySession, checkinBooking, checkinByCode, cancelBooking, countBookingsByUser, countFinishedWorkouts, countUpcomingBookings, attendanceStats } = require('./db/bookings');
const { findCoachByOpenid, listCoachStudents, listStudentLessons, getCoachNote, upsertCoachNote, getCoachSettlement, assignCoach, listCoachesWithBind, unassignCoach, setUserRole, updateCoachProfile, deleteCoach } = require('./db/coach');
const { addAdminLog, listAdminLogs } = require('./db/admin-log');
const { getDashboard } = require('./db/dashboard');
const { queryUsersAnalysis, getTimeline, groupMessage } = require('./db/users-analysis');
const { batchTrack, eventsAnalysis } = require('./db/events');


module.exports = {

  db,
  driver,
  findUserByOpenid,
  createUser,
  touchLogin,
  updateProfile,
  countUsers,
  listUsers,
  listInvitationDetails,
  inviteBoardStats,
  deleteUserById,
  deleteUserByOpenid,
  clearUsers,
  // 课程相关
  listCoaches,
  getCoachById,
  listVenues,
  listCourses,
  setCourseCoachBio,
  replaceRules,
  createCourse,
  updateCourse,
  deleteCourse,
  publishSessions,
  // 场次查询
  listSessionsByDateForUser,
  listSessionsByCoach,
  listSessionsByRange,
  cancelSession,
  updateSessionCapacity,
  getSessionById,
  listBookedUsersWithInfo,
  sendMessage,
  listMessages,
  unreadMessageCount,
  markMessageRead,
  markAllMessagesRead,
  listSessionsStartingSoon,
  listBookedUsersBySession,
  // 订课
  createBooking,
  listBookingsByUser,
  cancelBooking,
  countBookingsByUser,
  countFinishedWorkouts,
  countUpcomingBookings,
  attendanceStats,
  // 签到
  getCheckinInfo,
  checkinBooking,
  checkinByCode,        // 按 5 位码核销（BUGS-INBOX #11）
  listBookingsBySession,
  // 候补排位
  joinWaitlist,
  cancelWaitlist,
  listWaitlistByUser,
  refundExpiredWaitlist,
  // 订单
  createOrder,
  payOrder,
  listOrdersByUser,
  // 营收统计
  getRevenueStats,
  // 会员体系
  getMemberLevel,
  refundOrderMoney,
  calcRechargeBonus,
  RECHARGE_PLANS,
  listRecharges,
  bindInvitation,
  getInviteStats,
  listUnreadBalanceLogs,
  markBalanceLogsRead,
  // 能量币
  getCoinInfo,
  listCoinLogs,
  listShopItems,
  exchangeCoinItem,
  listMyExchanges,
  // 次卡包
  listPassPackages,
  getUserPass,
  getUserPassForDate,
  getUserPassInfo,
  expireOverduePasses,
  // 成就
  syncAchievements,
  REWARD_COINS,
  // 教练工作台（DESIGN #D1）
  findCoachByOpenid,
  listCoachStudents,
  listStudentLessons,
  getCoachNote,
  upsertCoachNote,
  getCoachSettlement,
  assignCoach,
  listCoachesWithBind,
  unassignCoach,
  setUserRole,
  updateCoachProfile,
  deleteCoach,
  // 管理操作日志（B3 2026-08-18）
  addAdminLog,
  listAdminLogs,
  // 运营 Dashboard（DESIGN #D4）
  getDashboard,
  // 用户分析（DESIGN #D4-3）
  queryUsersAnalysis,
  getTimeline,
  groupMessage,
  // 浏览埋点（DESIGN #D5）
  batchTrack,
  eventsAnalysis,
  // 社交画像（DESIGN #D5）
  getUserProfile,
  updateUserProfile
};
