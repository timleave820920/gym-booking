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

## #29 连接池 connection 事件回调对 callback 版 query 用 .catch()——建表永久挂起、容器 CrashLoop（P0 生产不可用）
- **发现**：2026-08-17，DESIGN #D2 S5 生产部署冒烟（push 后服务 health 000 持续 10+ 分钟，控制台日志定位）
- **现象**：MySQL 库建成后容器反复重启，health 000；日志循环打印 `You have tried to call .then(), .catch()... require('mysql2/promise') instead of 'mysql2'` 警告（**无**「seed 失败」、**无**「[mysql] 建表完成」）；建库前（库不存在时）反而能正常抛 `ER_BAD_DB_ERROR` 并打印 seed 失败
- **根因**：`server/db-driver.js` createMysqlPool 的 `pool.on('connection', conn => conn.query("SET time_zone = '+08:00'").catch(() => {}))`——mysql2 promise 池（PromisePool）的 `connection` 事件经 `inheritEvents` 从 corePool 原样转发，**事件参数是 callback 版连接**；callback 版 `conn.query()` 无回调返回 **Query 命令对象**，而 mysql2 定义了 `Query.prototype.catch = Query.prototype.then`（防误用设计）→ `.catch()` 打印警告并 **throw** → throw 发生在池内部事件回调里，打断建连流程 → `corePool.query` 的 done 永不回调 → `await drv.exec(MYSQL_SCHEMA)` **永久挂起** → seed 卡死不退出、不打印任何错误 → 容器被健康检查杀掉反复重启。库不存在时连接创建失败、不触发 `connection` 事件，所以该缺陷在建库前被 `ER_BAD_DB_ERROR` 掩盖
- **修复**：connection 回调改 **callback 风格** `conn.query("SET time_zone = '+08:00'", () => {})`（callback 版连接用 callback 调，无返回对象可 .catch）。会话时区设置仍保留（DEFAULT CURRENT_TIMESTAMP 按北京落库，BUG-LEDGER #28 防回归）
- **回归测试**：run-tests.js 新增 **MYSQL-01~03 源码级静态断言**（本地/CI 无 MySQL 无法真连，断言 db-driver.js：① `require('mysql2/promise')` ② connection 回调为 callback 风格 ③ 无 `.catch(` 残留写法）；全量 153/153 绿
- **防护层**：L3 真机/生产冒烟发现（deploy-smoke.sh health 000 定位）；修复后由 MYSQL-01~03 静态断言兜底（有人改回 promise 风格写法立即红）+ 部署冒烟登录落库证据；**教训：mysql2 promise 池的 `connection` 事件参数是 callback 版连接，对其 query 结果做 promise 操作会命中 Query.catch=then 防误用陷阱；生产部署必须跑 deploy-smoke.sh 并核对日志关键字（建表完成/seed 失败）**

## #28 云托管容器时区 UTC——签到窗口整体差 8 小时，10:30 签不了 11:00 的课（P0 生产功能错位）
- **发现**：2026-08-16 用户真机反馈（BUGS-INBOX #10）：「现在10:30，应该可以签到11:00的课，但显示不行，说时间未到」
- **现象**：真机（云托管生产）在开课前 30 分钟窗口内签到被拒，提示「未到签到时间」；本地 API 测试 146/146 全绿——**本地（Windows 北京时间）发现不了，只有 UTC 环境（云托管/CI）才红**
- **根因**：Dockerfile 基于 `node:22-alpine`，未设置时区 → 容器系统时区 **UTC**；业务代码裸 `new Date().getHours()/getMinutes()/getFullYear()/toLocaleString('sv-SE')` 隐式依赖系统时区 → 北京时间 10:30 = UTC 02:30，后端判定「未到签到时间」。受影响的取时间点：签到窗口（bookings.js）、成就/锻炼统计（achievements.js）、开课提醒（messages.js）、次卡过期/作废/顺延（passes.js）、候补过期自动退款（orders.js）、邀请近 13 天窗口（invite.js）；SQLite `datetime('now','localtime')` 写入与比较同样依赖系统时区
- **修复**（双层）：
  1. **部署层**：Dockerfile 安装 `tzdata` + 固定 `TZ=Asia/Shanghai`（alpine musl 需 tzdata 包，否则 TZ 不生效）——保证 SQLite `localtime` 写入值为北京时间
  2. **代码层**：新建 `server/time.js`（Intl 显式 `Asia/Shanghai`，与系统时区无关）：`todayStr()/nowTimeStr()/nowDateTimeStr()/nowMin()/parseBeijing()/prevDateStr()`；6 个域模块的判定/比较全部改走 time.js；SQL 时间比较由 `datetime('now','localtime')` 改为显式传参 `nowDateTimeStr()`
  3. **测试层**：run-tests.js 新增 TIME-01~04 时区防回归断言（纪元 UTC0 点=北京 8 点等，任意系统时区下确定性成立）；测试脚本自身构造场次/断言月份也改为北京时间口径（原本地时区写法在 UTC 下会红）
  4. 顺带修 DESIGN #D1 任务 1 漏网：`student-my-courses` 课后窗口 `+120`→`+30`（前后端窗口不一致，B3 契约）；agreement 页协议文案「结束后 2 小时」→「30 分钟」；i18n `checkInBefore30` 过期文案（「迟到 15 分钟自动取消」为不存在规则）
- **回归测试**：① 本地正常时区 150/150 全绿（新增 TIME-01~04）② **`TZ=UTC` 模拟容器时区 150/150 全绿**（证明业务代码在 UTC 容器下判定正确；修复前 UTC 下 CHK-02/04/07 红）③ 覆盖率探针 pass 1 / fail 0（UTC 环境跑）
- **防护层**：L3 真机发现；修复后四层兜底——Dockerfile TZ（部署层）、time.js 强制入口（CONVENTIONS 规矩 #9 + review 检查）、TZ=UTC 全量测试命令（本地可复现容器时区）、TIME-01~04 确定性断言（CI/任何时区下都会红）

## #27 coverage 探针「邀请看板」断言挂在错误响应上——测试假红（P2 测试缺陷）
- **发现**：2026-08-16，开发 DESIGN #D1 任务 11 跑覆盖率探针时发现（非用户反馈）
- **现象**：`node --test --experimental-test-coverage minitest/coverage.test.js` 报 `AssertionError: 邀请看板`，`actual: undefined`；master HEAD 上同样失败（已 stash 验证非新代码引入）
- **根因**：`coverage.test.js` 中 `GET /api/admin/invite-board` 之后被插入的「次卡包探针 / 课程详情字段」请求覆盖了 `r`，`assert.ok(r.data.board, '邀请看板')` 最终挂在 `/api/sessions/1` 响应上（无 board 字段）→ 断言错位假红
- **修复**：把 `assert.ok(r.data.board, '邀请看板')` 移到 `/api/admin/invite-board` 请求后立即断言（响应未被覆盖处），删除错位的旧断言
- **回归测试**：覆盖率探针重跑通过（pass 1 / fail 0）；新增 COACH 探针（设教练/学员/笔记/跟课记录/结算/非法月份）随行入库
- **防护层**：L2（CI/本地探针）发现；修复后由断言紧跟请求的写法兜底——探针中每条响应断言必须紧跟对应请求，禁止隔行复用 `r`

## #26 预约页日期条从周一而非今天开始——过去日期可见且本周跨越到下周时选不中今天（P1 展示缺陷）
- **发现**：2026-08-15，用户要求「预约页面和教练详情页面：以今天为日期开始，过去日期不显示，共显示含今天在内的未来 7 天」（2026-08-16 补登 BUGS-INBOX #7）
- **现象**：学员端预约页日期条显示「周一~周日」整周——今天之前的日期可点（历史日期），且周日跨入下周时今天不在条上（默认选中回退周一）；教练详情页已是「今天起 7 天」正确实现，仅预约页不符
- **根因**：`pages/student-courses/index.js` 的 `buildWeek()` 写死按自然周生成（`monday = today - day + 1`，i=0..6 周一~周日），与教练详情页 `buildWeekDays()`（today+i）不一致；配套 `selectDate`/`onShow` 用「日期数字」匹配（`Number(dataset.date)`），与新格式不兼容
- **修复**：`buildWeek()` 改为 `today + i`（i=0..6）——今天起 7 天含今天，默认选中第一天；日期匹配统一改用 `full`（YYYY-MM-DD）字符串（selectDate/onShow 同步）；星期标签按 `getDay()` 索引（0=周日）生成「周X」，第一天显示「今天」；顺带修正离线 mock 兜底的星期映射（原「日期数-9→周几」只对 9-15 号有效，改为真实 getDay）
- **回归测试**：node --check 语法通过 + 干净库全量 128/128（纯前端改动，后端契约无变化）；页面逻辑自查：默认选中今天、过去日期不再出现
- **防护层**：L0（用户反馈）发现；修复后由「today+i 恒含今天」设计兜底；教练详情页为同类参照实现，后续新增日期条页面以此为准

## #25 登录变成"新的号"——云托管容器不持久化致用户数据反复丢失（P0 生产数据安全）
- **发现**：2026-08-16，用户反馈「现在登录就会成为新的号。这是严重的bug」（前一日 P0 待办 WX_SECRET 配置的关联问题）
- **现象**：真机登录提示「注册成功」而非「欢迎回来」，历史订课/会员数据反复消失；云托管库 /api/users 显示 demo_user 为今晨新建空账号（本地库 6 用户、云托管仅 2 且均为新号）
- **根因**：云托管容器文件系统**不持久化**——闲置缩容/推送重建/扩容均创建全新容器，SQLite（server/data/gym.db）数据全部丢失，seed.js 只重建基础数据（A1 策略"重启丢数据可接受"的代价兑现）；另容器内无 server/.env（gitignore 排除）→ WX_SECRET 为空 → code2session 失败 → 微信身份回退公共 demo_user
- **修复**：①Dockerfile 建 `/data` 目录（CFS 挂载点）②新建「云托管持久化与身份配置.md」操作手册：控制台挂载 CFS 到 `/data` + 环境变量 `DB_PATH=/data/gym.db`、`WX_APPID`、`WX_SECRET` ③CLAUDE.md 生产形态段补充持久化必读（代码侧 DB_PATH 环境变量支持早已具备，server/db-core.js:12-14，测试每轮在用）
- **回归测试**：node --check（index/db-core）+ 干净库 128/128；持久化生效验证 = 用户控制台配置后：登录→退出→再登录应「欢迎回来」，推送重建后数据仍在
- **防护层**：L0（用户反馈）发现；修复后由 CFS 挂载兜底（数据跨容器重建保留）+ 文档防呆；WX_SECRET 配置后身份各自独立（code2session 成功路径）

## #24 真机登录弹「登录失败」——云托管 Git 部署自动重建窗口期 callContainer 短暂不可用（瞬态，已自愈）
- **发现**：2026-08-16 上午，用户真机测试登录显示「登录失败」
- **现象**：真机（云托管模式 callContainer）登录弹「登录失败」；本地后端 3000 正常、云托管公网域名直连登录接口 201/200 正常（3 次探测稳定）、project.config.json AppID=正式号 wx0aee5332d4ef20fd 与 .env 一致、云托管环境 ID prod-d0g3mnc4m283b5b36 与服务 gym-server 在运行——排除代码/配置/服务故障
- **根因**：云托管为 **Git 关联部署**：每次 push 触发自动重新构建+发布，重建窗口期（数分钟）callContainer 请求失败。2026-08-15 22:19 推送 80604e8 触发重建，用户次日（8/16）早测试恰撞上窗口期；部署完成后自动恢复（非代码 bug）
- **修复**：`pages/login/index.js` doLogin 失败弹窗从「知道了」改为「重试/取消」双按钮——重试一键重发 wx.login + 登录请求（复用闭包 userProfile/testNick），部署窗口期用户可自助重试，无需退出重进
- **回归测试**：node --check 语法通过 + 干净库全量 128/128（纯前端改动，后端契约无变化）；登录链路真机已确认恢复
- **防护层**：L0（用户反馈）发现；修复后由「失败可重试」兜底。云托管部署窗口期的彻底规避：避免在高峰使用时段 push 触发重建；后续若频繁出现可考虑错峰部署

## #23 签到测试跨天耦合——23:00 后跑测试 CHK-02/04 必挂（#15 同源坑的第二次变体）
- **发现**：2026-08-15 22:52，pre-commit hook 安全网拦截提交（#17/#18 提交时 CHK-02/04 ❌，127 用例 2 红）
- **现象**：22:50 之后任何时刻跑 run-tests.js，签到链路必挂：`CHK-02 教练核销成功 checkin=undefined`、`CHK-04 重复签到拒绝 msg=课程已结束超过 2 小时，无法签到`；23:20 后全量测试不再全绿
- **根因**：CHK 造数「当前+10 分钟开始、+70 分钟结束」——23:00 后 +70 分钟跨天，`end_time` 变成次日 `00:02` 而 `date` 仍是当天 → 后端 `toMin('00:02')=2`，`nowMin(1372) > 2+120` → 判定「课程已结束超过 2 小时」拒绝签到。与 BUG-LEDGER #15（满员场次写死当晚时段）同源：**测试造数写死相对时间时没考虑跨天**
- **修复**：造「已开课 20 分钟」的场次（start=now-20m、end=now+40m）——now 恒在签到窗口内 `[start-30m, end+2h]`，任何时刻跑都成立；end 跨天（23:20 后）时跳过 CHK-01~04（与 CHK-07 跨天跳过同策略，不红不算失败）
- **回归测试**：修复后 127/127 全绿（22:52 现场验证，end=23:32 未跨天用例实际执行）；跨天分支逻辑上不产生失败用例
- **防护层**：L1 hook（安全网拦截，恰好证明干净库模式的价值）；修复后由「now 恒在窗口内」的造数设计兜底，23:20 后跑测试也不会红

## #22 教练详情页底部「约 TA 的课」按钮冗余——课程条直接可点，固定 CTA 多余（P2 交互精简）
- **发现**：2026-08-15，用户要求「教练详情页面底部的"约 TA 的课"按钮删除」
- **现象**：页面底部 fixed 墨黑大按钮「约 TA 的课」+ 配套提示文字「点课程条可直接预约 · 满员可候补」，与课程条本身可点击预约功能重复
- **根因**：V1 设计稿落地时保留的滚动快捷 CTA；课程条 goDetail 已可直达预约，按钮功能冗余，还占底部 140rpx 留白
- **修复**：`index.wxml` 删除 cp-cta / cp-cta-sub 两行；`index.wxss` 删除 .cp-cta/.cp-cta-sub 样式、.page padding-bottom 140rpx→60rpx；`index.js` 删除死方法 scrollToCourses
- **回归测试**：前端 UI 改动，node --check 语法自检通过 + 全量干净库测试 127/127（无后端契约变化）；L3 真机确认按钮消失、页面不出现底部遮挡
- **防护层**：L0（用户反馈）发现；修复后无残留（死方法已删，grep cp-cta 为空）

## #21 教练详情页课程条右侧信息层次不足——改为三行（黑体大字课程名/中等场馆/席位）（P2 UI 调整）
- **发现**：2026-08-15，用户要求「课程条右侧改为 3 行：第一行黑体大字课程名，第二行普通中等字体场馆，第三行席位」
- **现象**：课程条右侧课程名 28rpx/700、场馆 22rpx、席位 22rpx，字号层次弱；三个 text 为 inline 元素，换行依赖空白折叠，行结构不稳定
- **根因**：V1 简化课程条直接复用旧字号，未按设计层次（大字标题/中等正文）调整；text 未设 display:block
- **修复**：`index.wxss` —— ci-name 升 32rpx/800（黑体大字）且 display:block；ci-sub 升 26rpx/400（普通中等）且 display:block；ci-seat 24rpx display:block，三行结构稳定
- **回归测试**：node --check + 干净库 127/127；L3 真机看三行层次（黑体大字课程名 > 中等场馆 > 席位）
- **防护层**：L0（用户反馈）发现；修复后由 display:block 保证行结构（不再依赖空白折叠）

## #20 教练详情页席位显示「余位/总数」——应为「已预订/总数」（P2 信息展示）
- **发现**：2026-08-15，用户反馈「教练详情页面，席位的展示信息应该是已经预订的席位/总席位」
- **现象**：教练介绍页课程条席位区显示「余位 X/Y」（剩余数），用户期望展示已预约数（如「已约 3/5」）
- **根因**：`pages/coach-profile/index.wxml` 席位区用了 `item.remaining`（余量），语义与需求不符；接口本就有 `booked_count` 字段（SESSION_SELECT 已返回），前端未取
- **修复**：`filterDay` 的 map 里补 `booked: s.booked_count || 0`；wxml 改「已约 {{booked}}/{{capacity}}」，满员（remaining<=0）仍显示红色高亮
- **回归测试**：CPR-02（教练场次接口含 booked_count/capacity/时间字段契约）
- **防护层**：L0（用户反馈）发现；修复后由 CPR-02 字段契约兜底

## #19 教练详情页显示已过去/进行中的课程——status 判断是死代码（P1 展示缺陷）
- **发现**：2026-08-15，用户反馈「教练详情页面，对于时间已经过去，包括已经在进行中的课程，是不应该显示出来的」
- **现象**：教练介绍页「TA 的课程」列表里，今天已结束的课程、正在进行中的课程仍然显示并可点进详情
- **根因**：`pages/coach-profile/index.js` 的 `filterDay` 用 `s.status !== 'ongoing' && s.status !== 'ended'` 判断——但**数据库 `course_sessions.status` 只有 published/full/cancelled，永远不会是 ongoing/ended**，该判断永远为真，是死代码；项目已有统一时间状态工具 `utils/course-status.js`（getSessionStatus 按日期+起止时间判定 upcoming/ongoing/ended），其他页面（student-activity/student-courses）都在用，唯独教练详情页没接
- **修复**：`coach-profile/index.js` require course-status，`filterDay` 先按 `getSessionStatus(...) === 'upcoming'` 过滤，已过去（含进行中）的课程不再渲染；顺带删除死字段 canBook
- **回归测试**：CPR-03/04/05（course-status 三态判定：结束→ended、进行中→ongoing、未开始→upcoming）+ CPR-06（模拟 filterDay：进行中/已结束被过滤，仅剩未开始满员课）
- **防护层**：L0（用户反馈）发现；修复后由统一状态工具兜底 + CPR-06 模拟过滤回归（再有人用 s.status 判断会因与 course-status 判定不一致而挂测试）

## #18 「使用微信头像」拿不到当前微信头像——开发者工具模拟限制（P1 体验问题，非代码缺陷）
- **发现**：2026-08-15，用户测试 #17 修复时反馈「使用微信头像应该能获取到当前微信头像，但没有获取到」
- **现象**：点击「使用微信头像」后得不到自己真实的微信头像（开发者工具中得到的是默认灰色模拟头像）
- **根因**：**开发者工具（platform='devtools'）是模拟环境，没有用户真实微信头像数据**，chooseAvatar 弹窗里的「使用微信头像」只能返回工具内置的默认灰色头像——这是平台限制，非代码问题。真机上行为：选「使用微信头像」返回 `thirdwx.qlogo.cn` 临时链接（已由后端 avatarDownload 下载转存，2026-08-15 已验证）；若该头像被上传入库会**污染真实头像数据**
- **修复**：`chooseWechatAvatar()` 加 devtools 平台检测——工具内点「使用微信头像」直接 toast 提示「请用真机预览测试」并中止，防止灰色模拟头像入库；另补 `wx.chooseAvatar` 不存在（基础库 <2.21.2）时的明确提示；失败路径 console.error 留痕
- **回归测试**：L3 真机手测（真机预览 → 使用微信头像 → 应返回真实微信头像）；开发者工具内验证提示文案（不再弹选择器）
- **防护层**：L0（用户反馈）发现；修复后由 devtools 平台检测兜底（模拟头像不再可能入库）+ L3 真机验证

## #17 个人中心点头像不弹选择——wx.chooseAvatar 静默失败 + 无「本地相册」入口（P1 交互缺陷）
- **发现**：2026-08-15，用户反馈「点头像应询问用微信头像或从本地选取，目前似乎不工作」
- **现象**：个人中心点击头像不弹头像选择器（或部分真机/基础库上点了没反应）；且没有「使用微信头像 / 本地相册」的二选一询问流程
- **根因**：`onTapAvatar` 直接调 `wx.chooseAvatar`（要求基础库 ≥2.21.2 + 隐私接口声明 + 隐私协议授权，任一缺失即静默失败），且 `fail` 回调为空——错误被完全吞掉，用户零反馈；相册路径只能依赖官方选择器内部选项，无独立入口
- **修复**（`pages/student-profile/index.js` + `app.json`）：
  1. 点头像先弹 `wx.showActionSheet`（「使用微信头像 / 从本地相册选择」）——ActionSheet 非隐私接口，必然有反馈
  2. 「微信头像」走官方 `wx.chooseAvatar`（返回网络 URL → 后端下载转存）；「本地相册」走 `wx.chooseMedia(sourceType:['album'], sizeType:['compressed'])`（兼容性更广）
  3. 两路 `fail` 均给 toast 反馈（用户 cancel 除外），杜绝「点了没反应」
  4. **隐私机制更正**：`chooseAvatar`/`nickName`/`chooseMedia` **不能**写进 `requiredPrivateInfos`——该字段只支持地理位置类接口（chooseAddress/chooseLocation/choosePoi/getFuzzyLocation/getLocation/onLocationChange/startLocationUpdate/startLocationUpdateBackground），写其他值开发者工具直接报错（版本 2.01.2510290 实测，本仓库 342f836 的错误做法已移除）；相册/头像的隐私声明走小程序管理后台「用户隐私保护指引」（添加「选中的头像或昵称」「选中的照片或视频信息」），基础库 ≥2.32.3 时未同意会先弹隐私弹窗
- **回归测试**：前端纯 UI 链路，minitest（后端 HTTP 测试）无对应通道；`node --check` 语法自检通过 + L3 真机手测（点头像 → 弹二选一 → 两条路径各走一遍 → 头像即时更新）
- **防护层**：L0 手测（用户反馈）发现；修复后由 fail 回调 toast 兜底（不再静默）+ L3 真机手测

## #16 git 仓库灾难性损坏——.git/objects/pack 丢失 + refs 被删（P0 资产风险，修复中）
- **发现**：2026-08-14 22:05，提交被 hook 拦截排查时发现 `git` 报 not a git repository
- **现象**：`.git/refs` 目录整个消失；`.git/objects/pack/*.pack` 丢失（只剩 .idx + multi-pack-index），objects 仅剩 2 个松散对象 → 本地 66e0e79 之后 7 个提交（af69022/8f2c643/fb451d8/4381ded/dd4fa4e/3131859/28b5e05）的对象全部丢失
- **根因**：疑似并行会话在 21:58~22:05 间运行 git gc/pack 被打断（pack 未落盘即中断）+ refs 被清理；`ls .git` 显示 objects/pack 22:05 生成但无 .pack 文件、COMMIT_EDITMSG/index 22:05 被改
- **修复**：进行中——远端 GitHub master=af69022（ls-remote 验证），待 GitHub 网络恢复后：清理损坏 pack 元数据 → `git fetch origin` → 重建 refs/heads/master → 工作区重提为一个新提交（7 个丢失提交内容 + 今日未提交改动）→ push
- **回归测试**：恢复后 git log 完整 + 提交可推送
- **防护层**：L0（发现）；**教训：①git gc/pack 中断会毁仓库，并行会话严禁同时操作 .git；②重要提交应尽快推送远端（本地 objects 不是备份）；③勿在无共同祖先下盲目重建 .git（会与远端历史分裂）**

## #15 测试时间耦合——22:00 后跑测试必挂（WTL-06 转正失败）
- **发现**：2026-08-14 22:05，hook 安全网拦截提交（WTL-06/06b/07 ❌ + PASS-10 连锁崩）
- **现象**：22:00 之后任何时刻跑 run-tests.js，候补转正链路必挂：`WTL-06 promoted=null`、`WTL-06b status=refunded`、`WTL-07 未找到 waiting 记录`
- **根因**：测试满员场次固定为「当天 22:00-23:00」；`refundExpiredWaitlist` 在每次 GET /api/waitlist 时把「开课时间已过」的 waiting 自动标 refunded → 候补队列被误杀 → 转正/退出全挂。22:00 前跑全绿（历史提交都踩在白天/晚上 22 点前），夜间跑必现
- **修复**：run-tests.js 满员场次日期动态化——`const fullDate = (new Date().getHours() >= 21) ? tomorrowStr : todayStr`（21 点后跑测试用明天日期）
- **回归测试**：修复后 121/121 全绿（22:10 现场验证）
- **防护层**：L1 hook（安全网恰好暴露）；**教训：测试造数不能写死当天晚间时段，否则夜间跑测试必挂；测试时间的「未来性」要用动态逻辑保证**

## #14 net-config.json 被并行后端实例覆盖——真机登录报「本地服务器没有启动」（P1 联调阻断）
- **发现**：2026-08-14 21:30，测试号预览包在新微信上登录报「本地服务器没有启动」
- **现象**：公网隧道/后端均 200，但真机连不上；`miniprogram/utils/net-config.json` 内容为 `http://192.168.101.7:3536`（错误：端口无服务、IP 为局域网）
- **根因**：net-config.json 是后端启动时自动写入的运行时产物，被并行后端实例（PORT=3536→3596 换端口启动）覆盖成错误地址；前端 `LOCAL_BASE_URL` 优先读它 → 真机连向不存在的服务。BUG-LEDGER #6 的反面：之前怕它「丢失」，实际更危险的是「被写错」
- **修复**：废弃 net-config.json 作为前端地址源——api.js 删除 require 逻辑，`LOCAL_BASE_URL = FALLBACK_BASE_URL`（唯一人工配置源，局域网/公网切换只改一处）；删除 net-config.json 文件（fb451d8）
- **回归测试**：公网隧道 + 本地双链路 curl 200；前端语法自检
- **防护层**：L3 真机（发现）；**教训：运行时自动写入的配置文件绝不可作为前端配置源，地址必须人工显式配置**

## #13 支付页狂点狂扣费（P0 资金漏洞）——下单/支付双层查重缺失 + 前端无防连点锁
- **发现**：2026-08-13，L3 手测 RT-10.2（田立真机狂点支付按钮）
- **现象**：支付页连点「确认支付」7 次 → **7 笔扣款（7×78=546 元）但只有 1 条订课记录**；场次 booked_count 虚高至 7（实际 1）
- **根因**（三层全失效）：
  1. 前端 `pay()` **无防连点锁**——每次点击都调 createOrder
  2. `createOrder` 查重查 **bookings 表**（支付后才生成）→ 连点下单时 booking 不存在，全部放行，创建 7 个 pending 订单
  3. `payOrder` 幂等只查**订单自身状态**（每个 pending 订单独立，全部通过）；订课分支虽查了「同场次 booking 已存在」但**只防重复生成、不防重复扣款**（扣款在 booking 生成前就已执行）
- **修复**（三层防线）：
  1. 前端 `pay()` 加 `_paying` 防连点锁（请求期间忽略重复点击，结束/失败解锁）
  2. `createOrder` 增加 **pending 订单查重**（同用户同场次已有待支付订单 → 400「请勿重复下单」）
  3. `payOrder` 订课分支事务内增加 **booked 记录查重**（已有 booked → ROLLBACK「请勿重复支付」）
- **回归测试**：ORD-04b（连点第二次下单 201→第二次 400）+ ORD-04c（提示「待支付」）
- **防护层**：run-tests.js 断言（L1 hook 干净库 + L2 CI）；**教训：资金链路的幂等必须「下单时查 pending + 支付时查 booked」双层，单查 bookings 表在支付前是空窗**
- **现场数据修复**：6 笔重复扣款走正规退款通道退回 468 元（余额 10644→11112），booked_count 恢复 1/20，流水留痕


- **发现**：2026-08-13，L3 手测 RT-8（田立发现消息中心只有 1 条「订课成功」，但订了多节课）
- **现象**：真实订课链路（POST /api/orders → payOrder）支付成功后**不发「订课成功」消息**；充值支付同样无「充值到账」消息。仅早期通过 POST /api/bookings（旧接口）产生的 1 条
- **根因**：「订课成功」埋点在 `createBooking()`（bookings.js:64），但真实链路 payOrder 在 orders.js:171-177 **直接内联 SQL 插 booking**，从不调用 createBooking → 埋点被绕过
- **修复**：payOrder 事务成功后（钱已落账）补两处 sendMessage——订课分支发「订课成功」（含课程/时间/实付金额）、充值分支发「充值到账」（含到账+赠送）；dedup_key 防重
- **回归测试**：MSG-01（订课成功站内信）+ MSG-02（充值到账站内信）
- **防护层**：run-tests.js 断言（L1 hook 干净库 + L2 CI）；消息中心点击已改为纯已读不跳转（产品决策同日落地）

## #11 我的页三连问题——能量币入口事件冒泡/消息单条不转已读/会员卡页面冗余

- **发现**：2026-08-13，L3 真机手测 RT-8.2/8.4/8.5
- **现象**：①点「我的」页能量币行 → 先进能量商店、紧接着被跳转到「我的会员卡」②消息中心点单条消息不变已读 ③「我的会员卡」页面存在但产品不需要（等级跳转应直达等级页）
- **根因**：①能量币行（`vip-coins`）嵌套在会员卡预览卡片（`vip-preview`）内部，内层 `bindtap` 事件冒泡到外层 `goMemberCard` ②消息页只实现「全部已读」，单条点击无处理（api.markMessageRead 存在但未用）③产品决策：去掉会员卡页，等级入口直达 member-level
- **修复**：①能量币行/奖励条改 `catchtap` 阻止冒泡 ②消息项加 `bindtap` → `markRead`（调已读接口+未读数-1+按需跳转）③移除 member-card 页面（app.json 注销 + 所有跳转改 member-level）
- **回归测试**：前端交互无法自动化（真机项），归入 RELEASE-GATE RT-8；后端消息已读接口已有（coverage 探针 09 段覆盖）
- **防护层**：L3 真机手测发现。**教训：嵌套可点击元素必须用 catchtap 阻断冒泡；「已读」类交互前端实现要完整（单条+批量）**

## #10 签到无时间窗口——注释承诺「开课前30分钟」但代码只查日期（提前数小时可签）

- **发现**：2026-08-13，L3 真机手测 RT-6 后用户追问「如何防提前签到」（实证：20:00 的课 15:37 被签到，提前 4 小时）
- **现象**：签到校验只检查「当天」，未检查时间窗口——任何当天场次（含未开始的）都能提前签到
- **根因**：`checkinBooking` 注释写「开课前 30 分钟至课程结束后 2 小时」，但代码只实现了日期判断，时间窗口从未落地（注释与实现不符）
- **修复**：加时间窗口校验：开课前 30 分钟（EARLY_WINDOW=30）～ 课程结束后 2 小时（LATE_WINDOW=120），窗口外明确拒绝（「未到签到时间，开课前 30 分钟开始可签到」/「课程已结束超过 2 小时，无法签到」）
- **回归测试**：`CHK-07`（未来 2h 场次签到被拒）+ 现有 CHK 段改为动态窗口内场次（原固定 21:00 场次在修复后会因时段被拒，需动态造时）
- **防护层**：用户产品洞察触发（RT-6 后追问）；修复后 CHK-07 兜底。**教训：注释承诺的规则必须与代码一致（注释骗人是隐患）；测试场次时间需动态化，避免依赖固定执行时间**

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

## #14 次卡支付两连坑——候补重复支付 500 / 次卡金额显示 80（P1 资金展示）
- **发现**：2026-08-14，次卡支付功能真机测试（田立）
- **现象**：①候补用次卡支付 → 服务器报错 500，订单卡「支付中」；②订课用次卡支付 → 显示实际扣款 ¥80（应为扣 1 次、金额 0）
- **根因**（两处独立 bug）：
  - **Bug A（500）**：`payOrder` waitlist 分支直接 INSERT，waitlist 表有 `UNIQUE(user_openid, session_id)`——用户对该场次已有记录（退出候补残留 cancelled / 并发）时撞约束 → 抛错 → 事务回滚 → 订单回 pending（显示「支付中」）
  - **Bug B（金额80）**：①后端 book 分支 exists 复用 booking 时不更新 amount_fen（残留旧价 80），订课成功站内信用 booking.amount_fen 报「实付 ¥80」；②前端 confirmPay `paidFen ? ...` 在 0 值时误判缺失 → fallback 课程原价 80
- **修复**：①waitlist 分支改为「先查已有记录，有则 UPDATE 复用」（与 book 分支同逻辑）；②exists 复用同步更新 amount_fen；③前端 `!= null` 判断，0 正确传递
- **回归**：PASS-08c/08d（重订复用 booking 金额 0）+ PASS-10c（重复下单拦截）+ PASS-11c/11d（cancelled 残留重付不 500）共 5 条新断言，116→121 全绿
- **教训**：**金额 0 是有效值，前端判断必须用 `!= null` 不能用 truthy**；**有唯一约束的表，写入前必须查重或改为 UPSERT 语义**
