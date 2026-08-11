/**
 * 能量商店奖品配置（可自行增删改）
 * ============================================================
 * id:     唯一标识（改后旧兑换记录仍保留名称快照）
 * name:   奖品名称
 * cost:   兑换所需能量币
 * type:   physical 实物（到店领取）/ virtual 虚拟权益（自动激活或兑换码）
 * stock:  库存（-1 = 不限）
 * desc:   奖品说明
 * ============================================================
 */

module.exports = [
  {
    id: 'water-bottle',
    name: '定制运动水杯',
    cost: 300,
    type: 'physical',
    stock: 10,
    desc: '到店前台报手机号领取'
  },
  {
    id: 'week-pass',
    name: '周卡（7 天不限次）',
    cost: 800,
    type: 'virtual',
    stock: 99,
    desc: '兑换后自动激活 7 天团课通卡'
  },
  {
    id: 'towel',
    name: '品牌训练毛巾',
    cost: 500,
    type: 'physical',
    stock: 20,
    desc: '到店前台报手机号领取'
  },
  {
    id: 'coach-1v1',
    name: '私教体验课 1 节',
    cost: 1200,
    type: 'virtual',
    stock: 5,
    desc: '兑换后联系客服预约私教体验'
  }
];
