# BUG-LEDGER.md · 缺陷台账

> 每个被发现的真 bug 必须在此登记（强制规矩 #7，见 CONVENTIONS.md）。
> 登记五要素：**现象 / 根因 / 修复 / 回归测试 / 防护层**——缺一不可。
> 目的：bug 教训可检索、可追溯；同类问题再犯时，闸门先红、台账可查。

---

## 台账规则

1. 每个 bug 一条记录，按发现时间倒序（最新在上）。
2. **修复必须配套回归测试**（run-tests.js 或 coverage.test.js 至少一处断言），否则不算闭环。
3. 记录「防护层」：指出该 bug 当时被哪一层抓住（L0 本地手测 / L1 本地 hook / L2 CI 干净库 / L3 真机），以及修复后由哪一层兜底。
4. 修完在 commit message 里引用台账编号（如 `BUG-LEDGER #2`）。

---

## #5 满员场次（status=full）无法排候补——syncSessionStatus 引入的功能回归

- **发现**：2026-08-13，覆盖率探针扩展（走真实链路）时抓出；提交（待补）
- **现象**：真实订课流程中，用户订满后场次被置 `full`，其他用户排候补返回「课程已下线」，**候补功能整体不可用**
- **根因**：bug② 修复引入 `syncSessionStatus` 把满员场次 status 从 `published` 改为 `full`，但 `createOrder` 与 `joinWaitlist` 的状态检查只接受 `published` → 满员场次被误判「已下线」。**旧测试全部用「直接插入 booked_count=满员 + status='published'」的场次（绕过 syncSessionStatus），81 项全绿掩盖了真实链路缺陷**
- **修复**：`server/db/orders.js` 两处状态检查改为接受 `published` 或 `full`（book 分支由 remaining 检查兜底拒绝满员，waitlist 分支由 remaining 检查兜底拒绝有余位）
- **回归测试**：`SEC-04c`（run-tests.js：真实订满→full 后可排候补 201）+ 探针 14 段（真实链路：订满→排位→退订转正→退出退款→过期退款）
- **防护层**：探针扩展前 L1/L2 均测不出（测试构造绕道）；修复后 SEC-04c + 探针 14 双兜底。**教训：测试数据构造（直接插 booked_count）会掩盖真实状态流转路径**

## #4 PUT /api/courses/:id 部分字段更新 500

- **发现**：2026-08-13，覆盖率探针扩展（管理后台段）；提交（待补）
- **现象**：只传部分字段（如 `{name, tags}`）更新课程 → 500 服务器内部错误
- **根因**：`updateCourse` 全字段 UPDATE，未传字段为 `undefined` 传入 node:sqlite → 抛错
- **修复**：`server/db/courses.js` `updateCourse` 先查当前行，未传字段（`??`）沿用原值
- **回归测试**：探针 12 段（PUT 只传 `{name, tags}` 部分字段 → 200）
- **防护层**：探针扩展发现；修复后探针 12 段兜底。管理网页此前发全字段所以未暴露

## #3 coverage 探针自身 6 处 bug（探针创建起从未真正通过）

- **发现**：2026-08-13，L2 CI 首跑（run 31665718847），提交 b63a4b0
- **现象**：覆盖率探针 `minitest/coverage.test.js` 从创建起从未真正通过，但因本地验证用 grep 过滤输出，失败被掩盖约一个月
- **根因**：6 处——缺 `require('node:http')`；clean() 列错（invitations 无 user_openid）；下单接口用错（应走 `/api/orders` 而非 `/api/bookings`）；booking 在支付后才返回；余额支付改 wxpay；invite 字段应为 `inviter`；coin 路径应为 `/api/coin/balance`
- **修复**：逐一修正 6 处后探针真正跑通
- **回归测试**：探针本身即回归（CI 每次跑）；本地跑法 `node --test --experimental-test-coverage minitest/coverage.test.js`
- **防护层**：当时被 grep 掩盖 → L2 才暴露；修复后由 L2 CI + 强制规矩 #6（验证必须看完整输出+退出码）兜底

## #2 场次满员 status 从未更新

- **发现**：2026-08-13，L2 CI 首跑，提交 b63a4b0
- **现象**：场次满员后前端按 status 判断「已满」，但全库没有任何代码把场次置为 `full`，状态永远停留在 `published`
- **根因**：`booked_count` 有 5 处变更点（createBooking / cancelBooking / payOrder×2 / joinWaitlist），全部漏联动 status 字段
- **修复**：新增 `syncSessionStatus(sessionId)`（server/db/courses.js），满员→`full`、退订→`published`，5 处变更点统一调用
- **回归测试**：`SEC-04b`（run-tests.js，本地 hook 77→79 项含此条）+ coverage 探针 04（断言 `session.status === 'full'`）
- **防护层**：当时仅 CI 干净库可复现（本地库历史数据已满员）；修复后 L1 hook + L2 CI 双兜底

## #1 orders.session_id NOT NULL 与充值写 NULL 冲突

- **发现**：2026-08-13，L2 CI 首跑（首轮红灯），提交 cb3a4e3 → b63a4b0 巩固
- **现象**：CI 干净库上充值下单直接 500；本地测试全绿、完全测不出
- **根因**：建表 `orders.session_id INTEGER NOT NULL`，但充值订单无场次，`createOrder` 写 `NULL`（server/db/orders.js）；本地旧表无 NOT NULL 约束（`CREATE TABLE IF NOT EXISTS` 不改已存在表）→ 本地宽松掩盖，CI 全新建表即爆
- **修复**：`session_id` 改可空（`INTEGER`，注释「充值订单无场次」）
- **回归测试**：`MEM-03b`（run-tests.js：充值订单 session_id 必须为 NULL）+ MEM-03/04 充值全链路
- **防护层**：当时仅 L2 CI 干净库可抓（本地永远测不出 schema 差异）；**2026-08-13 已根治**——run-tests.js 支持 `DB_PATH` 干净库模式（pre-commit hook 强制启用），本地 L1 即可抓 schema 类 bug（负向验证：session_id 改回 NOT NULL → 本地立即红）；L2 CI + MEM-03b 双兜底。**教训：schema 改动必须想干净库视角，本地旧表会掩盖**

---

*创建：2026-08-13。随缺陷持续追加。*
