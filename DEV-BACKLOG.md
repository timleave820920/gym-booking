# DEV-BACKLOG.md · 开发任务清单

> 设计确认（design-system 技能）后，把任务写入这里；用户说「开始dev」后按此执行。
> 状态标记：`[ ]` 未开始 ｜ `[~]` 进行中 ｜ `[x]` 已完成
> 每条任务引用设计编号（DESIGN #Dn），commit 时引用（如 `feat: xxx（DESIGN #D1）`）。
> 优先级：P0 必须 ｜ P1 重要 ｜ P2 可选

---

## 进行中

（暂无）

## 待开发

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
- [ ] **P1｜12. E2E 验证** — 本地 + 真机：签到/学员/结算/设教练全链路（代码已就绪待验证：本地 API 层 146/146 已绿；前端页面需开发者工具 + 真机走查）

## 已完成

（设计交付后归档于此，注明完成日期）
