# 综合训练馆订课系统 · 测试用例文档

> 版本：v1.0 ｜ 日期：2026-08-11 ｜ 测试范围：后端 API（28 接口）+ 核心业务链路
> 执行方式：自动化（`minitest/run-tests.js`）｜ 测试环境：本地后端 http://127.0.0.1:3000
> 优先级：P0 核心链路 / P1 重要功能 / P2 边界与安全

---

## 0. 测试约定

- 测试数据使用独立 openid（`uid_test_*` 前缀），与真实数据隔离
- 每轮测试自动创建/清理测试数据，不污染生产库
- 断言方式：HTTP 状态码 + 业务 code + 关键字段

---

## 1. 系统健康（SYS）

| ID | 名称 | 优先级 | 前置 | 步骤 | 预期结果 |
|---|---|---|---|---|---|
| SYS-01 | 健康检查 | P0 | 后端启动 | GET /api/health | 200，`code:200, status:ok` |
| SYS-02 | 下拉元数据 | P1 | 无 | GET /api/meta | 200，含 coaches/venues 等下拉数据 |

## 2. 账号与登录（AUTH）

| ID | 名称 | 优先级 | 前置 | 步骤 | 预期结果 |
|---|---|---|---|---|---|
| AUTH-01 | 注册新用户 | P0 | 无 | POST /api/auth/login `{openid:"uid_test_1", nickname:"测试一号"}` | 201，返回用户含 openid |
| AUTH-02 | 重复登录（幂等） | P0 | AUTH-01 | 同参数再调 | 200，登录成功，login_count 递增 |
| AUTH-03 | 缺 openid 注册 | P1 | 无 | POST /api/auth/login `{}` | 400，`缺少 openid` |
| AUTH-04 | 更新资料 | P1 | AUTH-01 | POST /api/auth/profile `{openid, nickname:"新名", avatar:"url"}` | 200，资料已更新 |
| AUTH-05 | 用户列表 | P1 | AUTH-01 | GET /api/users | 200，列表含测试用户 |
| AUTH-06 | 用户统计 | P1 | 无 | GET /api/users/stats | 200，含 totalUsers |
| AUTH-07 | 删除单用户 | P2 | AUTH-01 | DELETE /api/users?openid=uid_test_1 | 200，已删除 |
| AUTH-08 | 删除不存在用户 | P2 | 无 | DELETE /api/users?openid=uid_nonexist | 404，用户不存在 |
| AUTH-09 | 清空用户（危险操作） | P2 | 测试用户 | DELETE /api/users/clear | 200，返回 removed 数量 |

## 3. 课程与排课（CRS）

| ID | 名称 | 优先级 | 前置 | 步骤 | 预期结果 |
|---|---|---|---|---|---|
| CRS-01 | 课程列表 | P1 | 种子数据 | GET /api/courses | 200，含课程（Hyrox 等） |
| CRS-02 | 创建课程缺参 | P1 | 无 | POST /api/courses `{}` | 400，`课程名称与分类必填` |
| CRS-03 | 发布课表 | P0 | 有排课规则 | POST /api/courses/:id/publish | 200，created≥0 |
| CRS-04a | 发布课表缺日期 | P2 | 无 | POST /api/courses/9999/publish `{}` | 400，`请选择发布起止日期` |
| CRS-04b | 发布不存在的课 | P2 | 无 | POST /api/courses/9999/publish 带日期 | 404，`课程不存在` |

## 4. 场次查询（SES）

| ID | 名称 | 优先级 | 前置 | 步骤 | 预期结果 |
|---|---|---|---|---|---|
| SES-01 | 按日期查场次 | P0 | 种子数据 | GET /api/sessions?date=2026-08-11 | 200，sessions 数组，含剩余席位 |
| SES-02 | 缺日期参数 | P1 | 无 | GET /api/sessions | 400，`缺少 date` |
| SES-03 | 场次详情 | P0 | 场次存在 | GET /api/sessions/1 | 200，含课程/教练/场地 |
| SES-04 | 带 openid 标记已订 | P1 | 用户已订该场次 | GET /api/sessions/1?openid=xxx | booked_by_me=true |
| SES-05 | 场次详情不存在 | P2 | 无 | GET /api/sessions/9999 | 404 |

## 5. 订课链路（ORD，订单化）

| ID | 名称 | 优先级 | 前置 | 步骤 | 预期结果 |
|---|---|---|---|---|---|
| ORD-01 | 下单（订课） | P0 | 有场次+用户 | POST /api/orders `{openid, sessionId, orderType:"book"}` | 201，订单 status=pending |
| ORD-02 | 支付回写 | P0 | ORD-01 | POST /api/orders/:id/pay | 200，订单→paid，生成 booking，余位-1 |
| ORD-03 | 重复支付幂等 | P1 | ORD-02 | 再次调用 pay | 200，already=true，不重复扣 |
| ORD-04 | 重复下单拒绝 | P1 | ORD-02 | 同场次再下单 | 400，`您已预订` |
| ORD-05 | 满员下单拒绝 | P0 | 满员场次 | orderType:book | 400，`已满员，请候补` |
| ORD-06 | 我的订单列表 | P0 | ORD-02 | GET /api/orders?openid | 200，含 paid 订单 |
| ORD-07 | 退订→订单退款 | P0 | ORD-02 | DELETE /api/bookings/:id + 查订单 | booking cancelled，订单 refunded |
| ORD-08 | 旧接口订课（兼容） | P2 | 有余位场次 | POST /api/bookings | 201 或复用 |
| ORD-09 | 已退订再退订 | P2 | ORD-07 | 再 DELETE | 400，`已退订` |

## 6. 候补排位（WTL）

| ID | 名称 | 优先级 | 前置 | 步骤 | 预期结果 |
|---|---|---|---|---|---|
| WTL-01 | 满员下单（waitlist 类型） | P0 | 满员场次 | POST /api/orders orderType:waitlist | 201，订单 pending |
| WTL-02 | 排位支付 | P0 | WTL-01 | pay | 订单 paid，生成 waitlist waiting |
| WTL-03 | 有余位排位拒绝 | P1 | 有余位场次 | orderType:waitlist | 400，`仍有余位，请直接预订` |
| WTL-04 | 重复排队拒绝 | P1 | WTL-02 | 再下 waitlist 单 | 400，`已在候补队列` |
| WTL-05 | 我的候补列表 | P0 | WTL-02 | GET /api/waitlist?openid | 含 waiting 记录 |
| WTL-06 | 退订触发转正 | P0 | 有人退订同场次 | 订课者退订 | 最早排位者自动转正（booked） |
| WTL-07 | 退出候补退款 | P1 | WTL-02 | DELETE /api/waitlist/:id | wait→cancelled，订单→refunded |
| WTL-08 | 过期自动退款 | P1 | 昨天场次排队 | GET /api/waitlist（触发任务） | wait→refunded |

## 7. 签到考勤（CHK）

| ID | 名称 | 优先级 | 前置 | 步骤 | 预期结果 |
|---|---|---|---|---|---|
| CHK-01 | 凭证信息 | P0 | 有订课 | GET /api/checkin/:bookingId | 200，含课程/时间/场地 |
| CHK-02 | 教练核销成功 | P0 | 今天场次+订课 | POST /api/bookings/:id/checkin（教练 openid） | 200，checkin_at 写入，total_classes+1 |
| CHK-03 | 非教练核销拒绝 | P1 | CHK-02 前置 | 学员 openid 调核销 | 400，`无教练权限` |
| CHK-04 | 重复签到拒绝 | P1 | CHK-02 | 再核销 | 400，`已签到` |
| CHK-05 | 非当天场次拒绝 | P2 | 明天场次订课 | 核销 | 400，`仅支持当天签到` |
| CHK-06 | 场次名单 | P1 | 场次有订课 | GET /api/sessions/:id/students | 200，含学员+签到状态 |

## 8. 营收统计（REV）

| ID | 名称 | 优先级 | 前置 | 步骤 | 预期结果 |
|---|---|---|---|---|---|
| REV-01 | 营收统计 | P0 | 有 paid 订单 | GET /api/revenue | 200，stats 数组 4 项，monthly/sources |
| REV-02 | 退款后营收联动 | P1 | 退订订单 | 退订后再查 revenue | 退款总额增加 |

## 9. 边界与安全（SEC）

| ID | 名称 | 优先级 | 步骤 | 预期结果 |
|---|---|---|---|---|
| SEC-01 | 未登录订课 | P1 | 下单 openid 不存在 | 400，`用户不存在` |
| SEC-02 | 越权退订 | P1 | A 用户退 B 的订课 | 400，`订单不存在` |
| SEC-03 | 无效场次下单 | P2 | sessionId=99999 | 400，`场次不存在` |
| SEC-04 | 超卖防护 | P0 | 并发订满员场次 | 只有一人成功，其余`已满员` |

---

## 用例统计

| 模块 | 用例数 | P0 | P1 | P2 |
|---|---|---|---|---|
| 系统健康 SYS | 2 | 1 | 1 | 0 |
| 账号登录 AUTH | 9 | 2 | 3 | 4 |
| 课程排课 CRS | 4 | 1 | 1 | 2 |
| 场次查询 SES | 5 | 2 | 2 | 1 |
| 订课链路 ORD | 9 | 5 | 3 | 1 |
| 候补排位 WTL | 8 | 3 | 4 | 1 |
| 签到考勤 CHK | 6 | 2 | 3 | 1 |
| 营收统计 REV | 2 | 1 | 1 | 0 |
| 边界安全 SEC | 4 | 1 | 2 | 1 |
| **合计** | **49** | **18** | **20** | **11** |
