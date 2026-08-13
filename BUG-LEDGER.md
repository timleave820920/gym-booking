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

## #9 候补排位余额支付不扣款却能退款（P0 资金漏洞）+ 支付页默认方式/价格联动

- **发现**：2026-08-13，L3 真机手测 RT-5.1（用户反馈「余额支付显示余额不足、默认微信支付、切余额价格不变」）
- **现象（P0）**：候补排位用余额支付——后端**不校验余额、不扣款**，但退出候补/过期退款时 `refundOrderMoney` 按订单金额**退钱** → 0 余额可排位、退出凭空得钱（刷钱漏洞）。前端默认微信支付 + 切余额不显示会员价（原设计候补不享折扣，前后端一致但不符合产品需求）
- **根因**：`payOrder` 余额预校验与扣款只对 `book` 分支；waitlist 分支只 INSERT 不扣款；退款却按订单退。产品决策变更：候补余额支付应享会员价（田立拍板 2026-08-13）
- **修复**：①后端：余额预校验扩展到 waitlist + waitlist 分支按会员价 `addBalance(-payFen)` + 订单金额落实付 ②前端：默认余额支付（余额充足时）+ 切换支付方式价格联动（余额=会员价 78 / 微信=原价 80）
- **回归测试**：`WTL-02b`（0 余额候补 balance 支付被拒）+ `MEM-13/13b/13c`（候补扣会员价 6600 分、退出退款、余额恢复）+ `WTL-04a-pay`（顺带补上原未断言的支付步骤）
- **防护层**：L3 真机手测发现（前端拦截了 0 余额才没酿成实际损失——**前端兜住了后端漏洞**）；修复后 3 组断言兜底。**教训：任何「先支付后退款」的资金闭环必须扣款与退款对称；新校验逻辑改动后要检查所有未断言支付步骤的测试**

## #8 充值套餐展示全为首充 30%——前端漏拼 openid（展示与实际到账不一致）

- **发现**：2026-08-13，L3 真机手测 RT-4.1（用户：已复充账号仍显示首充 30%）
- **现象**：充值页所有套餐显示「首充送 30%」；但实际充值到账按复充 10%（金额正确）——**展示与实际不一致，用户会误以为多得 20%**
- **根因**：`api.getMemberPlans()`（api.js）不接受参数、不拼 openid → 请求 `/api/member/plans`（无 openid）→ 后端按首充展示。调用方（member-recharge 页）其实传了 openid，接口层丢了
- **修复**：`getMemberPlans(openid)` 支持 openid 参数并拼到 URL
- **回归测试**：`MEM-02c`（run-tests.js：带 openid 的 500 档显示复充 isFirst=false、bonus=50 元）
- **防护层**：L3 真机手测发现；修复后 MEM-02c 兜底。**教训：展示层与交易层同一规则（首充/复充）必须共用同一数据源，接口参数要端到端核对**

## #7 满员场次（status=full）从列表消失——展示层与状态流转不同步

- **发现**：2026-08-13，L3 真机手测 RT-2.2（用户发现 12:30 满员场次不可见）
- **现象**：课订满后（status 变 full）**学员端预约列表不再显示该场次**——用户看不到满员课、无法进入候补；教练端同理
- **根因**：`listSessionsByDate`/`listSessionsByCoach` 过滤 `status='published'`；bug② 修复引入 `syncSessionStatus` 置 full 后，真实满员场次被列表过滤。与 #5 同源（状态流转与展示/入口未同步），测试用「硬编码 published 满员场次」掩盖
- **修复**：列表查询改 `status IN ('published','full')`（draft/cancelled 仍隐藏）
- **回归测试**：`SEC-04d`（run-tests.js：订满后场次在当日列表可见且 status=full）
- **防护层**：L3 真机手测发现；修复后 SEC-04d + 探针 04 双兜底。**教训：状态机改动要检查所有读取该状态的查询/展示层**

## #6 真机预览永远连不上后端——net-config.json 被 gitignore 过滤没打进包

- **发现**：2026-08-13，L3 真机手测 RT-1
- **现象**：手机真机预览/调试登录永远报「无法连接本地后端」；但手机浏览器能直接访问后端（网络通）；模拟器一切正常
- **根因**：`miniprogram/utils/net-config.json`（局域网 IP 配置）在 `.gitignore` 里 → **微信开发者工具默认过滤 gitignore 文件、不打进预览包** → 真机上 `require('./net-config.json')` 失败 → 回退 `http://127.0.0.1:3000`（手机自己）→ `ERR_CONNECTION_REFUSED`。**模拟器正常是因为模拟器的 127.0.0.1=电脑本机，回退值恰好可用，掩盖了问题**
- **修复**：①从 `.gitignore` 移除该文件（工具即可打包），改用 `.git/info/exclude` 本地忽略（git 干净、不随仓库污染）②`.gitignore` 加注释说明此坑 ③api.js require 失败时 console.warn 提示 ④api.js 请求失败打印真实 errMsg（排查不再盲猜）⑤api.js 加 `FALLBACK_BASE_URL` 写死兜底 IP（提交 3df626a / 1151d81，真机实测通过）
- **回归测试**：无法自动化（真机项），归入 RELEASE-GATE RT-1.1（真机登录必测）
- **防护层**：L3 真机手测发现；修复后靠 GLOSSARY 环境坑速查 + .gitignore 注释防复发。**教训：真机与模拟器环境差异（127.0.0.1 语义不同）会掩盖网络配置问题；排查先看请求真实打到哪个地址**

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
