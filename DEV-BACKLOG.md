# DEV-BACKLOG.md · 开发任务清单

> 设计确认（design-system 技能）后，把任务写入这里；用户说「开始dev」后按此执行。
> 状态标记：`[ ]` 未开始 ｜ `[~]` 进行中 ｜ `[x]` 已完成
> 每条任务引用设计编号（DESIGN #Dn），commit 时引用（如 `feat: xxx（DESIGN #D1）`）。
> 优先级：P0 必须 ｜ P1 重要 ｜ P2 可选

---

## 进行中

### DESIGN #D14 季卡/年卡（设计文档: 季卡年卡设计方案.md，2026-08-19 确认）

> 季卡/年卡拥有者在有效期内无限次订课（0 元），同一时间只能订一堂课（全部订课时间查重）。
> 口径（用户拍板）：季卡 3 个月/年卡 12 个月价格运营配置（默认 ¥2,980/¥9,880）；查重覆盖全部订课（含普通付费课，候补也查重）；次卡包页新增购买入口；有卡自动用 0 元（无需选择支付方式）；续期顺延（新卡从旧卡到期次日算起）；退订沿用课前 2 小时截止，无次数可退直接释放名额。

- [x] **P0｜1. 数据层** — `unlimited_plans`（type season/year/months/price_fen/active 幂等种子）+ `unlimited_passes`（user_openid/type/order_id/start_at/expires_at/status）双方言建表 + 过期惰性判定（time.js 北京时间）
- [x] **P0｜2. 订单链路** — `GET /api/unlimited/plans` + `POST /api/orders`（order_type='unlimited'）+ payOrder 扩展：支付成功发卡/续期顺延（logOp 留痕）+ `GET /api/unlimited/my`（我的卡/剩余天数）
- [x] **P0｜3. 订课规则** — payOrder 加 unlimited 分支（0 元 pay_source='unlimited'，实付=扣款=退款=0 三一致）+ 订课/候补时间冲突查重（date 相同 + 区间重叠 → 400「该时段已订其他课程」，占用=bookings∪waitlist）+ UNL-01~10 用例
- [x] **P1｜4. 前端** — 次卡包页「无限次卡」分区（季卡/年卡卡片 + 购买 CTA + 我的卡/剩余天数）+ 订课 0 元流程（有卡不出现支付方式选择）+ FRONT 断言
- [x] **P1｜5. 测试** — UNL 用例 + coverage 探针（unlimited 接口）

### DESIGN #D9 吐槽入口（设计文档: 吐槽入口设计方案.md，2026-08-19 确认）

> 学员实名留言吐槽场馆，web 后台收件箱逐条回复（承诺每条必回复），学员站内信 + 页内看到回复闭环。
> 口径（用户拍板）：入口在个人中心（同联系客服菜单组）；实名（后台见昵称头像）；场馆端 web 后台回复；回复通知=站内信+页内展示；收件箱放运营数据 tab 折叠卡（不动 4 tab 顺序）；吐槽历史在吐槽页内展示（不进消息中心）。

- [ ] **P0｜1. 数据层** — `feedbacks` 表（双方言建表：openid/nickname 快照/content/status/reply/replied_at/reply_by/created_at + status 索引）
- [ ] **P0｜2. 接口** — `POST /api/feedback`（实名 openid 服务端取 + 昵称快照 + ≤500 字 + 防连点幂等）+ `GET /api/my-feedbacks`（分页）+ `GET /api/admin/feedbacks`（Admin-Token，未回复优先）+ `POST /api/admin/feedbacks/:id/reply`（回复落库 + status→replied + 写站内信 type=feedback 跳吐槽页 + 已回复幂等）
- [ ] **P1｜3. 学员端** — 个人中心「联系客服」卡片组新增「💬 吐槽」入口 + `pages/feedback/index`（承诺标语 + 500 字留言 + 历史列表：待回复/已回复徽标 + 回复展示）
- [ ] **P1｜4. 后台收件箱** — web 运营数据 tab「💬 吐槽收件箱」折叠卡（未回复优先 + 展开回复框 + 已回复展示 + 待回复统计）+ FRONT 断言防回退
- [ ] **P1｜5. 测试** — FBK-01~07（发/超长/列表/未回复优先/回复闭环/重复回复幂等/未登录 400）+ coverage 探针

### DESIGN #D11 新学员标记（设计文档: 新学员标记设计方案.md，2026-08-19 确认）

> 教练课程学员名单标注新学员（定义：第一次上该课程类型——同 category 签到过才算上过 B1，非新用户维度）。
> 口径（用户拍板）：签到过才算上过；名单徽标「新」绿色小标签 + 顶部「新学员 N 人」统计；仅正式订课学员（候补不标）。

- [ ] **P0｜1. 后端** — `GET /api/sessions/:id/students` 每学员附加 `isNewCategory`（同 category 签到历史判定）+ 响应 `newCount` + NEW-01~06 用例（无签到→新/有同类型签到→老/不同类型签到不影响/已订未上→新/候补不标/newCount 口径）
- [ ] **P0｜2. 前端** — 教练端名单页（coach-students）：「新」绿色圆角小徽标（仅正式订课学员）+ 顶部统计「学员名单（N 人 · 新学员 M 人）」
- [ ] **P1｜3. 防回退** — FRONT 断言（徽标 + 统计文案）+ coverage 探针（isNewCategory）



## 已完成

> D1~D6 全部交付（2026-08-18 归档；D1-12 真机 E2E 待最终确认后标 [x]）。

### DESIGN #D6 运营小助理·日运营报告（设计文档: 运营小助理设计方案.md，2026-08-18 确认）

> 基于 #D4 Dashboard 数据自动生成日运营报告：关键数据+趋势+对用户/排课的明确行动建议；后台随时可查历史。
> 口径：规则引擎（无 LLM，确定性可测）；惰性生成（每日首访生成+手动重新生成）；建议全量列出；中文运营口吻。

- [x] **P1｜1. 报告引擎 + 接口** — `server/db/report.js`（getDailyReport(date)：读 #D4 dashboard 聚合 → 一句话总结 + 12 条规则引擎（触发条件/建议文案/依据数据）+ 7 天趋势连续升降检测 → 落 `daily_reports` 表（date PK 幂等））+ `GET /api/admin/reports?date=`（ADMIN_PATHS）+ REP 用例（生成/幂等/历史/无数据占位/401/重新生成/规则触发断言）+ coverage 探针（2026-08-18 完成，351/351 + UTC 全绿 + 探针全绿）
- [x] **P1｜2. 前端报告展示** — web 运营数据 tab 顶部「📋 运营日报」折叠卡：日期选择器（默认今日）+「重新生成」+ 一句话总结大字 + 关键数据网格 + 趋势区 + 行动建议列表（严重度红/黄/绿）+ FRONT 断言防回退（2026-08-18 完成，FRONT-23）

### DESIGN #D5 浏览埋点 + 用户画像（设计文档: 浏览埋点与用户画像设计方案.md，2026-08-18 确认）

> 捕捉「看了没订」的意图 + 收集性别/生日画像。本期只做采集与分析看板，推荐引擎下期（#D6）。
> 口径：P0 三事件（首页曝光/详情浏览含停留时长/搜索词）；画像=用户自填（微信不提供真实性别年龄）；激励=填单送 20 能量币 + 生日月首订 8 折；关闭个性化开关后续做。

- [x] **P1｜1. 埋点后端** — `course_events` 表（双方言建表，索引 openid+event_type+created_at）+ `POST /api/track/batch`（event_type 白名单、批量上限 50、未登录丢弃、失败不阻塞主流程）+ TRK 用例 + coverage 探针（2026-08-18 完成，a4d75f4）
- [x] **P1｜2. 前端埋点** — `utils/track.js`（本地队列攒批、防抖 5s/10 条/onHide flush、session_id 会话标识）+ 首页/课程详情/搜索三页接入 + FRONT 断言防回退（2026-08-18 完成，06ed35b）
- [x] **P1｜3. 画像收集** — `users` 表加 gender/birthday 列（双方言）+ `GET/PUT /api/me/profile` + 学员端「我的」页画像卡片（引导+编辑+清空）+ 填单送 20 能量币（logOp 留痕，防重复领取）+ PROF 用例（2026-08-18 完成，c40eee6，顺带修双层 readBody 挂起 BUG-LEDGER #59）
- [x] **P2｜4. 生日月 8 折权益** — 生日当天站内信推送祝福 + 生日月内首笔 paid 订课订单自动 8 折（amountFen×0.8 向下取整，logOp 留痕，与会员价取整口径一致）+ BDAY 用例（2026-08-18 完成，3d70d2e）
- [x] **P2｜5. 浏览分析看板** — `GET /api/admin/events-analysis`（浏览→订课漏斗、意图人群清单=近 7 天浏览≥2 次未订、搜索词 TOP+无结果词、浏览 vs 订课热度对比）+ web 运营数据 tab 新增折叠卡 + users-analysis 筛选扩展（gender/age_range/birthday_month）+ CSV 画像列 + EVT 用例（2026-08-18 完成，4cbd666；画像筛选补漏 EVT-02~05 当日完成）

### DESIGN #D4 运营数据展示（设计文档: 运营数据展示设计方案.md，2026-08-18 确认）

> 每日 Dashboard（7 核心指标 + 4 组补充）+ 个人行为分析（RMF 分层/偏好标签/群体钻取个体）。
> 口径：行为留存 / 退订截止确认收入 / 储值两轨 / web 管理页新 tab「运营数据」（替换邀请看板）/ 沉睡双档位（14 天预警+30 天重沉睡）。

- [x] **P1｜1. Dashboard 聚合接口 + 测试** — `GET /api/admin/dashboard?date=`（访问码保护并入 ADMIN_PATHS）：当日 7 核心指标 + 趋势（7/30 天）+ 4 组折叠卡数据（退订率/候补转正/空置损失/新客漏斗/沉睡双档位/课程热度 TOP5/时段/教练/能量币/消息阅读/会员分布/次卡动销）；确认/未确认收入口径（签到 or 过退订截止）；ADMIN-DASH 用例 + coverage 探针（2026-08-18 完成，287/287 + UTC 全绿）
- [x] **P1｜2. Dashboard 前端（web 运营数据 tab）** — courses.html tab「邀请看板」→「运营数据」：7 KPI 卡（环比）+ 趋势图（原生 canvas）+ 4 组折叠卡 + 响应式；FRONT 断言防回退（2026-08-18 完成，288/288 全绿；原邀请看板保留为折叠区）
- [x] **P1｜3. 用户分析：分层 + 清单 + 钻取** — `GET /api/admin/users-analysis`：RMF 分层筛选（近度/频次/金额/沉睡档位/搜索）+ 分页 + CSV 导出（复用 B3 导出模式）；清单点用户 → 行为时间线 + 标签卡；群组选中 → 站内信触达（2026-08-18 完成，304/304 + UTC 全绿；偏好标签筛选留待 #D4-4）
- [x] **P2｜4. 偏好标签 + 画像展示** — 用户偏好标签计算（课程/教练/时段/场馆/支付习惯/行为特质）与展示（标签云/个体标签卡）（2026-08-18 完成，307/307 + UTC 全绿）

### DESIGN #D3 排位人数可视化（设计文档: 排位人数可视化设计方案.md，2026-08-18 确认）

> 候补是付费排位（转正或退款），人数直接决定「要不要付钱排队」。现状：详情接口有 waitlisted_by_me 无人数，前端满员只显示斜条/状态位无人数。

- [x] **P1｜1. 后端三接口加人数字段** — 详情接口 `waitlist_count` + `my_wait_position`（排序与转正 ORDER BY created_at,id 一致，秒级并列 id 破平）；列表接口 GROUP BY 聚合一次查全部场次人数（禁止 N+1）；我的候补列表相关子查询带人数+位置；WTL-05b~07c 七断言 + coverage 探针（2026-08-18 完成，0bbb97e）
- [x] **P1｜2. 前端三处展示** — 详情页按钮下「您前面还有 N 人/当前 N 人排队中」；首页满员按钮显示「N人排队」；我的课程页排位卡「前面还有 N 人 · 当前共 N 人」；onShow 切回即最新；FRONT-17 防回退（2026-08-18 完成，0bbb97e）

### DESIGN #D2 MySQL 持久化迁移（设计文档: MySQL持久化迁移设计方案.md，2026-08-16 确认；#25 根治）

> 微信云托管无 CFS 挂载（已确认弃用），选 B：数据迁环境内置 MySQL（Serverless）。容器无状态化，重建零丢失。改造面：313 处 DB 调用 async 化 + 双方言建表 + 89 处时间函数。

- [x] **P0｜S1. db-driver.js 双驱动抽象层** — 新文件：SqliteDriver（node:sqlite 同步包 async 接口）/ MysqlDriver（mysql2 惰性 require 占位）+ createDriver 工厂（DB_DRIVER 切换）；db-core.js 挂 `driver` 导出（SQLite 模式复用现有 db 实例）；行为零变化，150 全绿（2026-08-16 完成）
- [x] **P0｜S2. 时间函数与方言点收口** — SQL 内 `datetime()/date()/time()` 89 处改 time.js 传参（符合规矩 #9）；orders.js:543-545 候补过期 `datetime(s.date||' '||s.start_time, '-60/-120 min')` 改业务层计算传参；INSERT OR IGNORE×3 / ON CONFLICT×1 → INSERT IGNORE；strftime×3 业务层化；time.js 新增 addMinutes 工具（2026-08-16 完成）
- [x] **P0｜S3. db/*.js async 化** — 11 模块 prepare/get/run → `await driver.*`（tokenizer 级转换脚本 server/migrate-async.js，已删除）；事务走 driver.exec('BEGIN'/'COMMIT')；同步函数保持同步；db-core 导出 driver 供各模块导入
- [x] **P0｜S4. index.js + seed + minitest async 化** — 全部 handle* + API_ROUTES async；db.xxx 聚合调用补 await（known 迭代收敛：转换引入的 await 会把更多函数变 async，4 轮收敛）；顶层种子包 IIFE；handleMemberPlans 改 Promise.all；136 用例全绿 + TZ=UTC 全量通过
- [x] **P0｜S5. MySQL 生产路径落地** — 代码侧（14303c2）+ 生产上线全部完成（2026-08-17）：控制台已开 MySQL + 环境变量 DB_DRIVER=mysql/MYSQL_*/WX_*/ADMIN_TOKEN 全配；035 起部署成功，038 在线 100% 流量；真机登录订课跑通（MySQL 持久化 ✓）；deploy-smoke 8 项全绿。中间踩坑：#30 passes 门闩、#31 DDL 默认值、#32 保留字、#33 last_insert_rowid、#34 seed 挂起探针 refused（已加固：seed 移出启动阻塞位，index 先 listen 后进程内幂等种子）——详见 BUG-LEDGER
- [x] **P1｜S6. 数据迁移 + 文档收尾** — 脚本 scripts/migrate-sqlite-to-mysql.js 已写（dry-run 通过）；**生产无需执行迁移**（容器盘不持久化，旧 SQLite 数据早已清空，MySQL 全新起跑，无存量数据），脚本留作未来导入用；文档收尾完成（2026-08-17）：CLAUDE.md 启动方式/持久化说明更新 + 开发总结-2026-08-17.md 战役复盘 + scripts/cloudrun.sh 运维封装（日志/状态/版本/删除/冒烟）+ scripts/pack-deploy-zip.ps1 部署包打包

### DESIGN #D1 教练端重构（设计文档: 教练端重构设计方案.md，2026-08-16 确认）

- [x] **P0｜1. 签到窗口统一** — 后端 `bookings.js` LATE_WINDOW 120→30（课后 30 分钟）+ 学员端 student-checkin 窗口/文案同步（+120→+30、「结束后 2 小时」→「30 分钟」）+ 凭证码改纯数字（`GYM-` 前缀去掉，bookingId padStart(4)）+ coach-scan parseCode/文案同步 + CHK 用例调整 + CONVENTIONS B1 更新（2026-08-16 完成）
- [x] **P1｜2. 分成配置单源** — 新建 `coach_config` 表（course_fee_fen 默认 10000、checkin_reward_fen 默认 500）+ `server/coach-config.js` 配置模块（2026-08-16 完成）
- [x] **P1｜3. 我的学员接口** — `GET /api/coach/students?coach_openid`：已签到学员聚合（昵称/头像/最近课程+日期/has_note/total_classes）（2026-08-16 完成）
- [x] **P1｜4. 学员笔记接口** — `coach_notes` 表（UNIQUE(coach_openid, student_openid)）+ `GET/PUT /api/coach/notes`（仅本人，upsert 幂等）（2026-08-16 完成）
- [x] **P1｜5. 结算接口** — `GET /api/coach/settlement?coach_id&month`：月度聚合（本月已结束课次数 × 课时单价 + 签到总数 × 奖励单价）（2026-08-16 完成）
- [x] **P1｜6. 设教练接口** — `POST /api/admin/coach-assign`：校验账号/档案存在、防重复绑定、role=coach + coaches.user_openid 绑定 + logOp 留痕（2026-08-16 完成）
- [x] **P0｜7. coach-home 三 Tab 工作台** — 新建 `pages/coach-home/index`：我的课程 Tab（今天起 7 天日期条 + 课程卡 + 窗口内签到按钮 → 相机扫码/手动纯数字核销，复用 coach-scan 逻辑）（2026-08-16 完成）
- [x] **P1｜8. 学员 Tab** — 列表（头像/昵称/最近课程+日期/📝标记）+ 详情（全部跟课记录 + 笔记编辑）（2026-08-16 完成）
- [x] **P1｜9. 结算 Tab** — 月份切换器（默认本月+历史可查）+ 指标卡（课次/签到人数）+ 金额（课时费/奖励/合计，实时刷新）（2026-08-16 完成）
- [x] **P1｜10. 登录分流 + 后台设教练** — 教练登录跳转 coach-schedule → coach-home；admin-students 每行「设为教练」按钮 + 档案选择弹层（2026-08-16 完成）
- [x] **P1｜11. 新接口测试** — run-tests.js 新用例（COACH-xx 系列）+ coverage.test.js 探针（2026-08-16 完成，146/146 + 探针 pass；顺带修复探针假红 BUG-LEDGER #27）
- [~] **P1｜12. E2E 验证** — 本地 + 真机：签到/学员/结算/设教练全链路。**进度（2026-08-16）**：本地 API 层 150/150 已绿（含 COACH 系列 + TIME 系列）；真机已覆盖：登录/预约/签到码展示/扫码签到（#13 报"无教练权限"——根因系云托管重建后库重置 #25，非代码）、教练端签到窗口（#10/#28 已修）。**云端 API 层已验证（2026-08-16 上午）**：070f0ed 重建已完成，`/api/coach/settlement` 200（40 场次/400 元课时费聚合正确）、`/api/coach/students` 404「教练档案不存在」（demo_user 未绑定教练，属正常业务拦截）、`/api/coach/notes` 400 参数校验、`/api/admin/coach-assign` 400 参数校验——**新路由全部在线，旧镜像根因（#12/#8）已消除**。**待真机最终确认**：教练「我的学员」「结算」Tab（需先 admin-students 设教练绑定 demo_user 后见数据）、admin-students 设教练流程
