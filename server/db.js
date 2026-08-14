/**
 * 数据库层聚合入口
 * 连接/建表：db-core.js；按域拆分：db/users.js、db/coin.js、db/members.js、db/invite.js、db/courses.js、db/messages.js、db/orders.js、db/bookings.js
 * 说明：db 内跨域函数通过下方解构保持可见（bookings→orders 单向依赖）
 */
const { db, courseCols } = require('./db-core');
const { findUserByOpenid, createUser, touchLogin, updateProfile, countUsers, listUsers, deleteUserById, deleteUserByOpenid, clearUsers } = require('./db/users');
const { todayCoinsEarned, addCoins, getCoinInfo, listCoinLogs, listShopItems, exchangeCoinItem, listMyExchanges, checkLevelUpReward, rewardInviterCoins } = require('./db/coin');
const { getMemberLevel, addBalance, refundOrderMoney, hasRechargedPlan, calcRechargeBonus, applyRecharge, listRecharges, listUnreadBalanceLogs, markBalanceLogsRead, RECHARGE_PLANS } = require('./db/members');
const { listInvitationDetails, inviteBoardStats, bindInvitation, rewardInviter, getInviteStats } = require('./db/invite');
const { listCoaches, listVenues, listCourses, getRules, replaceRules, createCourse, updateCourse, deleteCourse, publishSessions, listSessionsByDate, listSessionsByCoach, listSessionsByRange, cancelSession, updateSessionCapacity, listSessionsByDateForUser, getSessionById } = require('./db/courses');
const { sendMessage, broadcastMessage, listMessages, unreadMessageCount, markMessageRead, markAllMessagesRead, listSessionsStartingSoon, listBookedUsersBySession } = require('./db/messages');
const { listPassPackages, getUserPass, getUserPassInfo, applyPassPurchase, consumePass, refundPass, expireOverduePasses } = require('./db/passes');
const { genOrderNo, createOrder, payOrder, listOrdersByUser, getOrderByNo, getRevenueStats, promoteFromWaitlist, joinWaitlist, cancelWaitlist, listWaitlistByUser, refundExpiredWaitlist } = require('./db/orders');
const { createBooking, listBookingsByUser, getCheckinInfo, listBookingsBySession, checkinBooking, cancelBooking, countBookingsByUser, countFinishedWorkouts, countUpcomingBookings } = require('./db/bookings');

// 导出兼容（历史保留）
const ENERGY_CONFIG = require('./energy-config.js');

module.exports = {

  db,
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
  getUserPassInfo,
  applyPassPurchase,
  consumePass,
  refundPass,
  expireOverduePasses
};
