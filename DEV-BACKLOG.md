# DEV-BACKLOG.md · 开发任务清单

> 设计确认（design-system 技能）后，把任务写入这里；用户说「开始dev」后按此执行。
> 状态标记：`[ ]` 未开始 ｜ `[~]` 进行中 ｜ `[x]` 已完成
> 每条任务引用设计编号（DESIGN #Dn），commit 时引用（如 `feat: xxx（DESIGN #D1）`）。
> 优先级：P0 必须 ｜ P1 重要 ｜ P2 可选

---

## 进行中

（暂无）

## 待开发

### DESIGN #D4 运营数据展示（设计文档: 运营数据展示设计方案.md，2026-08-18 确认）

> 每日 Dashboard（7 核心指标 + 4 组补充）+ 个人行为分析（RMF 分层/偏好标签/群体钻取个体）。
> 口径：行为留存 / 退订截止确认收入 / 储值两轨 / web 管理页新 tab「运营数据」（替换邀请看板）/ 沉睡双档位（14 天预警+30 天重沉睡）。

- [x] **P1｜1. Dashboard 聚合接口 + 测试** — `GET /api/admin/dashboard?date=`（访问码保护并入 ADMIN_PATHS）：当日 7 核心指标 + 趋势（7/30 天）+ 4 组折叠卡数据（退订率/候补转正/空置损失/新客漏斗/沉睡双档位/课程热度 TOP5/时段/教练/能量币/消息阅读/会员分布/次卡动销）；确认/未确认收入口径（签到 or 过退订截止）；ADMIN-DASH 用例 + coverage 探针（2026-08-18 完成，287/287 + UTC 全绿）
- [x] **P1｜2. Dashboard 前端（web 运营数据 tab）** — courses.html tab「邀请看板」→「运营数据」：7 KPI 卡（环比）+ 趋势图（原生 canvas）+ 4 组折叠卡 + 响应式；FRONT 断言防回退（2026-08-18 完成，288/288 全绿；原邀请看板保留为折叠区）
- [x] **P1｜3. 用户分析：分层 + 清单 + 钻取** — `GET /api/admin/users-analysis`：RMF 分层筛选（近度/频次/金额/沉睡档位/搜索）+ 分页 + CSV 导出（复用 B3 导出模式）；清单点用户 → 行为时间线 + 标签卡；群组选中 → 站内信触达（2026-08-18 完成，304/304 + UTC 全绿；偏好标签筛选留待 #D4-4）
- [ ] **P2｜4. 偏好标签 + 画像展示** — 用户偏好标签计算（课程/教练/时段/场馆/支付习惯/行为特质）与展示（标签云/个体标签卡）

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

## 已完成

（设计交付后归档于此，注明完成日期）
