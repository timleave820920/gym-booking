/**
 * 数据库层聚合入口
 * 连接/建表：db-core.js；按域拆分：db/users.js、db/coin.js、db/members.js、db/invite.js、db/courses.js、db/messages.js、db/orders.js、db/bookings.js
 * 说明：db 内跨域函数通过下方解构保持可见（bookings→orders 单向依赖）
 */
const { db, driver, courseCols } = require('./db-core');
const { findUserByOpenid, createUser, touchLogin, updateProfile, countUsers, listUsers, deleteUserById, deleteUserByOpenid, clearUsers } = require('./db/users');
const { todayCoinsEarned, addCoins, getCoinInfo, listCoinLogs, listShopItems, exchangeCoinItem, listMyExchanges, checkLevelUpReward, rewardInviterCoins } = require('./db/coin');
const { getMemberLevel, addBalance, refundOrderMoney, hasRechargedPlan, calcRechargeBonus, applyRecharge, listRecharges, listUnreadBalanceLogs, markBalanceLogsRead, RECHARGE_PLANS } = require('./db/members');
const { listInvitationDetails, inviteBoardStats, bindInvitation, rewardInviter, getInviteStats } = require('./db/invite');
const { listCoaches, getCoachById, listVenues, listCourses, getRules, replaceRules, createCourse, updateCourse, deleteCourse, publishSessions, listSessionsByDate, listSessionsByCoach, listSessionsByRange, cancelSession, updateSessionCapacity, listSessionsByDateForUser, getSessionById, listBookedUsersWithInfo } = require('./db/courses');
const { sendMessage, broadcastMessage, listMessages, unreadMessageCount, markMessageRead, markAllMessagesRead, listSessionsStartingSoon, listBookedUsersBySession } = require('./db/messages');
const { listPassPackages, getUserPass, getUserPassForDate, getUserPassInfo, applyPassPurchase, consumePass, refundPass, expireOverduePasses } = require('./db/passes');
const { syncAchievements, listUserAchievementKeys, REWARD_COINS } = require('./db/achievements');
const { genOrderNo, createOrder, payOrder, listOrdersByUser, getOrderByNo, getRevenueStats, promoteFromWaitlist, joinWaitlist, cancelWaitlist, listWaitlistByUser, refundExpiredWaitlist } = require('./db/orders');
const { createBooking, listBookingsByUser, getCheckinInfo, listBookingsBySession, checkinBooking, checkinByCode, cancelBooking, countBookingsByUser, countFinishedWorkouts, countUpcomingBookings } = require('./db/bookings');
const { findCoachByOpenid, listCoachStudents, listStudentLessons, getCoachNote, upsertCoachNote, getCoachSettlement, assignCoach } = require('./db/coach');

// 导出兼容（历史保留）
const ENERGY_CONFIG = require('./energy-config.js');

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
  getRules,
  replaceRules,
  createCourse,
  updateCourse,
  deleteCourse,
  publishSessions,
  // 场次查询
  listSessionsByDate,
  listSessionsByDateForUser,
  listSessionsByCoach,
  listSessionsByRange,
  cancelSession,
  updateSessionCapacity,
  getSessionById,
  listBookedUsersWithInfo,
  sendMessage,
  broadcastMessage,
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
  getOrderByNo,
  // 营收统计
  getRevenueStats,
  // 会员体系
  getMemberLevel,
  addBalance,
  refundOrderMoney,
  applyRecharge,
  hasRechargedPlan,
  calcRechargeBonus,
  RECHARGE_PLANS,
  listRecharges,
  bindInvitation,
  rewardInviter,
  getInviteStats,
  listUnreadBalanceLogs,
  markBalanceLogsRead,
  // 能量币
  addCoins,
  getCoinInfo,
  listCoinLogs,
  listShopItems,
  exchangeCoinItem,
  listMyExchanges,
  checkLevelUpReward,
  rewardInviterCoins,
  ENERGY_CONFIG,
  // 次卡包
  listPassPackages,
  getUserPass,
  getUserPassForDate,
  getUserPassInfo,
  applyPassPurchase,
  consumePass,
  refundPass,
  expireOverduePasses,
  // 成就
  syncAchievements,
  listUserAchievementKeys,
  REWARD_COINS,
  // 教练工作台（DESIGN #D1）
  findCoachByOpenid,
  listCoachStudents,
  listStudentLessons,
  getCoachNote,
  upsertCoachNote,
  getCoachSettlement,
  assignCoach
};
