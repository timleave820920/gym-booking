// 协议查看页：完整展示《用户服务协议》《用户隐私保护协议》全文
// 内容与根目录 SERVICE.md / PRIVACY.md 保持一致（2026-08-14）

// 服务协议章节（SERVICE.md v1.0）
const SERVICE_SECTIONS = [
  { id: 's1', type: 'section', title: '一、服务内容' },
  { id: 's1p1', type: 'para', text: '本小程序向您提供：课程浏览、课程预约、订课支付（储值余额/微信支付）、候补排位、签到核销、储值管理、会员体系、消息通知等服务。' },
  { id: 's2', type: 'section', title: '二、账号规则' },
  { id: 's2p1', type: 'para', text: '您通过微信授权登录本小程序，微信 openid 作为您的唯一身份标识。您对使用您的账号进行的全部操作负责，请勿将账号交由他人使用。注册信息应真实合法，不得冒用他人身份。' },
  { id: 's3', type: 'section', title: '三、课程预约规则' },
  { id: 's3l1', type: 'li', text: '完成支付后即视为预约成功，系统生成订课记录' },
  { id: 's3l2', type: 'li', text: '同一课程同一场次仅可预约一次，重复预约将被拒绝' },
  { id: 's3l3', type: 'li', text: '场次满员后不可直接预约，可选择进入候补队列' },
  { id: 's3l4', type: 'li', text: '候补按先到先得（FIFO）排列；有学员退订时最前位自动转正并通知；您可随时退出候补，费用原路退回' },
  { id: 's3l5', type: 'li', text: '课程开始前系统发送开课提醒消息' },
  { id: 's4', type: 'section', title: '四、退订与退款规则' },
  { id: 's4l1', type: 'li', text: '课程开始前可取消订课' },
  { id: 's4l2', type: 'li', text: '退款原路退回：余额支付退至余额，微信支付按微信规则退回' },
  { id: 's4l3', type: 'li', text: '主动退出候补或课程开始未排到空位：系统自动退款' },
  { id: 's4l4', type: 'li', text: '已签到的课程不可退订' },
  { id: 's5', type: 'section', title: '五、储值卡规则' },
  { id: 's5p1', type: 'para', text: '可通过微信支付充值储值余额，充值赠送按场馆当期活动规则执行；储值余额可用于订课支付（会员等级折扣以储值支付为准）；余额退款按场馆相关规定办理；可在「我的」页面随时查询余额与流水。' },
  { id: 's6', type: 'section', title: '六、签到规则' },
  { id: 's6p1', type: 'para', text: '到店后扫描场馆内张贴的签到码完成自助签到。仅限课程开课前 30 分钟至课程结束后 30 分钟内签到。签到成功后累计上课次数、时长等锻炼数据。' },
  { id: 's7', type: 'section', title: '七、会员与能量币' },
  { id: 's7p1', type: 'para', text: '会员等级根据累计锻炼次数等规则评定，不同等级享受不同折扣；签到等行为可获得能量币，可在能量商店兑换奖励。场馆有权根据运营情况调整相关规则，调整后将在小程序内公示。' },
  { id: 's8', type: 'section', title: '八、用户行为规范' },
  { id: 's8l1', type: 'li', text: '不利用本服务从事任何违法违规活动' },
  { id: 's8l2', type: 'li', text: '不恶意占用课程资源（如频繁订课后退订、恶意排队）' },
  { id: 's8l3', type: 'li', text: '不通过任何技术手段干扰本服务正常运行' },
  { id: 's8l4', type: 'li', text: '不利用系统漏洞谋取不正当利益（如重复领取退款、伪造签到）' },
  { id: 's8p1', type: 'para', text: '对违反上述规范的行为，场馆有权采取警告、限制预约、注销账号等措施，并保留追究法律责任的权利。' },
  { id: 's9', type: 'section', title: '九、知识产权' },
  { id: 's9p1', type: 'para', text: '本小程序及其中课程信息、界面设计、文案等知识产权归场馆及相关权利人所有；未经许可不得复制、修改、传播。' },
  { id: 's10', type: 'section', title: '十、免责声明' },
  { id: 's10p1', type: 'para', text: '课程、教练、场馆信息由场馆提供并负责真实性；因不可抗力（自然灾害、政策变化、网络故障等）导致服务中断，场馆不承担相应责任；运动训练存在身体风险，请根据自身健康状况合理选择课程并遵守场馆安全规范。' },
  { id: 's11', type: 'section', title: '十一、协议的变更与终止' },
  { id: 's11p1', type: 'para', text: '场馆有权适时修订本协议，修订后在小程序内公示；您继续使用本服务即视为接受修订后的协议；您可随时停止使用，符合注销条件时可按流程注销账号。' },
  { id: 's12', type: 'section', title: '十二、法律适用与争议解决' },
  { id: 's12p1', type: 'para', text: '本协议的订立、执行、解释均适用中华人民共和国法律；因本协议产生的争议，双方应友好协商解决，协商不成的提交场馆所在地有管辖权的人民法院诉讼解决。' }
];

// 隐私协议章节（PRIVACY.md v1.0）
const PRIVACY_SECTIONS = [
  { id: 'p1', type: 'section', title: '一、我们收集哪些信息' },
  { id: 'p1t1', type: 'para', text: '主动提供：微信昵称（展示身份，可用默认）、微信头像（展示形象，可用默认）、手机号（账号绑定与身份核验，可选，不绑定不影响使用）。' },
  { id: 'p1t2', type: 'para', text: '自动收集：微信 openid（唯一身份标识，无法反查您的微信个人信息）、使用记录（订课/退订/候补/签到/充值）、储值与消费数据、设备与日志信息（安全审计与故障排查）。' },
  { id: 'p1t3', type: 'para', text: '我们不收集：位置信息、通讯录、相册、麦克风、摄像头等敏感权限信息、身份证明、银行卡号等支付敏感信息（支付通过微信支付官方渠道完成）。' },
  { id: 'p2', type: 'section', title: '二、我们如何使用信息' },
  { id: 'p2l1', type: 'li', text: '提供核心服务：登录、课程浏览、订课支付、候补排位、签到核销、储值管理' },
  { id: 'p2l2', type: 'li', text: '账号安全：识别您的身份，防止他人冒用' },
  { id: 'p2l3', type: 'li', text: '运营分析：统计课程参与情况（不涉及个人可识别信息的对外披露）' },
  { id: 'p2l4', type: 'li', text: '客户服务：处理退订、退款、投诉等问题' },
  { id: 'p2p1', type: 'para', text: '我们不会将您的个人信息用于无关用途，不会向任何第三方出售或出租。' },
  { id: 'p3', type: 'section', title: '三、信息的存储与保护' },
  { id: 'p3l1', type: 'li', text: '存储位置：我们部署的服务器（本地开发阶段为本地服务器，正式运营后为云服务）' },
  { id: 'p3l2', type: 'li', text: '所有数据库操作使用参数化查询，防止注入攻击' },
  { id: 'p3l3', type: 'li', text: '关键操作（支付/充值/退款/签到）全程记录日志，可追溯' },
  { id: 'p3l4', type: 'li', text: '密钥（微信 AppSecret、支付密钥）通过环境变量管理，不写入代码库' },
  { id: 'p3l5', type: 'li', text: '仅在提供服务所需期限内保留；您注销账号后依法删除' },
  { id: 'p4', type: 'section', title: '四、信息的共享与披露' },
  { id: 'p4p1', type: 'para', text: '仅在以下情形共享：微信平台（登录 openid、支付，受微信隐私保护政策约束）；法律法规要求（依据法律、诉讼或政府主管机关要求）。除此之外不向任何第三方共享。' },
  { id: 'p5', type: 'section', title: '五、您的权利' },
  { id: 'p5l1', type: 'li', text: '查阅权：小程序内「我的」页面随时查看订课、订单、储值记录' },
  { id: 'p5l2', type: 'li', text: '更正权：小程序内「我的」页面修改昵称、头像' },
  { id: 'p5l3', type: 'li', text: '删除权：联系客服或通过账号注销功能删除个人信息' },
  { id: 'p5l4', type: 'li', text: '撤回同意：在小程序设置中关闭授权' },
  { id: 'p5p1', type: 'para', text: '注销账号：联系场馆工作人员处理，注销后个人信息被删除，储值余额按场馆规定处理。' },
  { id: 'p6', type: 'section', title: '六、未成年人保护' },
  { id: 'p6p1', type: 'para', text: '若您为未成年人，请在监护人指导下使用，并请监护人阅读本协议。' },
  { id: 'p7', type: 'section', title: '七、协议更新' },
  { id: 'p7p1', type: 'para', text: '我们可能适时更新本协议，更新后在小程序内提示；重大变更将显著通知；继续使用本小程序即视为同意更新后的协议。' },
  { id: 'p8', type: 'section', title: '八、联系我们' },
  { id: 'p8p1', type: 'para', text: '如对本协议有任何疑问或需要行使个人信息权利，请通过小程序「我的」→「联系我们」页添加小助理微信咨询，我们将在 15 个工作日内回复。' }
];

Page({
  data: {
    title: '',
    meta: '',
    sections: [],
    showContact: false
  },

  onLoad(options) {
    const type = options.type || 'service';
    if (type === 'privacy') {
      this.setData({
        title: '用户隐私保护协议',
        meta: '生效日期：2026年8月13日',
        sections: PRIVACY_SECTIONS,
        showContact: true
      });
    } else {
      this.setData({
        title: '用户服务协议',
        meta: '生效日期：2026年8月14日 · v1.0',
        sections: SERVICE_SECTIONS,
        showContact: true
      });
    }
    wx.setNavigationBarTitle({ title: type === 'privacy' ? '隐私政策' : '服务协议' });
  }
});
