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

## #58 后台四个 tab 顺序与要求不符——应为 运营数据/课程设定/排课系统/教练分配，且默认打开「运营数据」（BUGS-INBOX #58）

- **现象**：管理后台（web/courses.html）tab 顺序为 课程设定/排表管理/运营数据/教练分配，默认打开「课程设定」；用户要求：**运营数据，课程设定，排课系统，教练分配** + 默认打开「运营数据」（2026-08-18 用户报）。
- **根因**：tab 顺序即静态 HTML nav 声明顺序，`active` 默认在课程设定；「排表管理」命名与用户预期「排课系统」不符；页面加载无默认打开运营数据的逻辑（运营数据 tab 靠手动点击才 loadDashboard）。
- **修复**：① nav 顺序调整 + active 移至 tab-board；②「排表管理」→「排课系统」；③ panel 初始可见性改 panel-board（panel-set 加 hidden）；④ init() 末尾 `switchTab('board')` 默认打开并联动加载 loadDashboard/loadReport。
- **回归测试**：FRONT-24 静态断言（tab 顺序/命名/默认 active/init 调 switchTab('board')）；本地 352/352 + TZ=UTC 全绿。
- **防护层**：L1 本地 hook（FRONT-24 随全量跑）。兜底思路：管理页 tab 顺序与默认页是用户可见契约，用静态断言锁定 HTML 声明顺序与 init 行为，防后续误调顺序。

## #61 退订 500：MAX(booked_count-1, 0) 是 SQLite 标量扩展——MySQL 只认单参数聚合 MAX，退订恢复余位直接语法报错（CI test-mysql WTL-06 根因）

- **现象**：CI test-mysql job（MySQL 8 service 跑全量）WTL-06 退订转正失败——退订接口 500、promoted 缺失；PASS-08 退订退次同样 500。本地 SQLite 全量全绿（SQLite 支持标量 `MAX(a,b)`），方言差异只在 MySQL 暴露（2026-08-18 CI 排障发现）。
- **根因**：`UPDATE course_sessions SET booked_count = MAX(booked_count - 1, 0)`——双参标量形式是 SQLite 扩展，**MySQL 的 MAX 只接受单参数（聚合函数），此写法在 MySQL 直接语法报错** → 退订/退出候补恢复余位 500。SQLite 侧多年全绿掩盖了方言点（此前 MySQL 真机未跑过该分支或未退订）。
- **修复**：改 `CASE WHEN booked_count > 0 THEN booked_count - 1 ELSE 0 END`——双方言 100% 兼容。注意**无公共双参取大函数**：SQLite 是 `max(a,b)`、MySQL 是 `GREATEST(a,b)`，两者互不通（GREATEST 在 SQLite 报 no such function，实测 node:sqlite 3.53）。
- **回归测试**：WTL-06 系列 + PASS-08/08b/08c/08d（退订转正/退次/重订金额）在 CI test-mysql 全量验证；本地 SQLite 352/352 + TZ=UTC 全绿。
- **防护层**：CI test-mysql 全量（MySQL 是生产方言，任何红都是真实缺陷）。兜底思路：**写业务 SQL 先问「MySQL 支持吗」**——SQLite 特有标量函数（max/min 双参等）在 MySQL 是语法错误而非行为差异，一律用 CASE WHEN 等双方言兼容语法。

## #60 MySQL 事务被拆散——exec('BEGIN') 在连接池随机连接上执行，事务连接悬空污染池（CI test-mysql 全红主根因）

- **现象**：CI test-mysql job（MySQL 8 service，DB_DRIVER=mysql 跑全量）从出生起从未绿过：ADMIN-28b 500、WTL-06 退订转正失败、DASH-03 500、TypeError 级联崩溃、随后 10 分钟挂到 CI 超时。后端 stderr 被 run-tests `stdio:'ignore'` 丢弃，无法判断 500 是业务错还是连接池问题（2026-08-18 首次跑全量即发现）。
- **根因**（双层）：
  1. **MysqlDriver.exec 事务拆散**：`exec('BEGIN'/'COMMIT'/'ROLLBACK')` 在 `pool.query()`（随机连接）上执行，事务内语句全走 `pool.execute()`（又是随机连接）——BEGIN 后的语句各自自动提交、COMMIT 落在无事务连接上（no-op），**开启事务的那条连接悬空在池里**，被后续请求随机复用（事务残留/锁等待），且事务内「读自己写」的语义完全失效。调用点：bookings.js checkinBooking/cancelBooking、coach.js assignCoach。订课主链路用 driver.tx()（正确单连接实现）所以订课测试绿——差异即证据。
  2. **run-tests 主进程不退出**：main().catch 只设 process.exitCode，MySQL 模式 require 的 mysql2 连接池句柄阻塞进程结束 → 失败后挂到 CI 10 分钟超时。
- **修复**：
  1. **MysqlDriver 事务连接管理**：新增 `_txConn`——exec('BEGIN') 从池 getConnection + beginTransaction 绑定专用连接，期间 get/all/run/exec 经 `_target()` 复用该连接，COMMIT/ROLLBACK 提交/回滚后 release 归还；beginExclusive/getExclusive(FOR UPDATE) 走同一通道（#57b 并发防重用语义保持）；事务内重复 BEGIN 幂等，单连接包装（tx() 内）no-op。
  2. **run-tests 落盘与退出**：后端 spawn stdio 改日志文件（启动失败/测试失败打印尾部，[server error] 可见）；main().catch 改 `process.exit(2)` 强制退出。
- **回归测试**：SQLite 352/352 + TZ=UTC 352/352 全绿（驱动行为对 SQLite 零变化）；CI test-mysql job 重新全量（此前必红，本次须绿）。
- **防护层**：CI test-mysql 全量（MySQL 方言即生产方言，任何红都是真实缺陷）；run-tests 失败自动带后端日志尾部。兜底思路：**驱动层事务必须单连接承载**——BEGIN/COMMIT 与事务内语句同一连接是事务语义的前提，连接池随机分配只适用于无状态单语句；对事务 API 的测试必须在两种驱动下都真实跑过（本次 SQLite 全绿 + MySQL 全红 = 驱动方言测试缺口）。

## #59 PUT /api/me/profile 挂起——路由层 readBody 消费流 end 后 handler 内二次 readBody，监听永不触发（DEV #D5-3 自发现）

- **现象**：填写画像接口 PUT /api/me/profile 客户端请求永远无响应（curl -m 15 超时；测试套件 PROF-04 卡死整轮跑不完）。GET /api/me/profile、login（POST+readBody）、coach/notes（PUT+readBody）全部正常——仅该路由挂（2026-08-18 dev #D5-3 测试中发现）。
- **根因**：**双层 readBody**。路由条目 `f: async(q, r) => { const body = await readBody(q); await handleUpdateMyProfile(q, r, body); }` 已消费请求流并触发 `end`；handler 内部第一行又 `const body = await readBody(req)`——**流的 end 事件已被第一层消费，第二次注册的 `req.on('end')` 永不触发** → Promise 永不 resolve → 挂起。其他 PUT handler（coach/notes 等）模式是路由层读 body 后传参，handler 不自读，故不受影响。
- **修复**：`handleUpdateMyProfile(req, res, body)` 改收路由层传入的 body，删除 handler 内二次 readBody；注释标明「双层 readBody 会挂起」防再犯。
- **回归测试**：PROF-04~10（PUT 画像全套：非法性别/生日 400、首填 +20 币、落库、流水留痕、生日月标记、重复不发币）——此前整轮卡死在 PROF-04，修复后 329/329 全绿。
- **防护层**：L1 本地 hook（run-tests 全量，PUT 套件卡住即整轮红）。兜底思路：**readBody 是流消费操作，同一请求只允许读一次**——路由层读 body 后必须传参给 handler，禁止 handler 内再读；新增 PUT 路由时对照既有 handler 签名（`(req, res, body)`）。

## #57 订课并发超卖（P0 资金/数据安全）——下单宽松快照检查、支付无容量闸门，500 并发下容量 10 的课 256 人支付成功

- **现象**：压测任务（用户要求 500 并发完美应对）第一版脚本断言参数错位全假绿，修复后极端模式暴露：容量 10 的场次，500 并发「下单→支付」后 `booked_count=256`、paid 订单 256 笔——**256 人订上 10 个位置**，真超卖（2026-08-18 压测发现）。
- **根因**（双层）：
  1. **支付无容量闸门**：createOrder 的 `remaining <= 0` 检查是**宽松快照**（下单不占位），支付（payOrder）才真正占位——`INSERT bookings + booked_count+1` 从不复查剩余。并发下单-支付下所有人都通过下单检查 → 支付全部成功 = 超卖。MySQL 生产同代码同漏洞。
  2. **下单 pending 查重竞态**：createOrder 的「查 pending→INSERT」读-判-插非原子（每次 `await driver.get` 都是微任务让出点），500 并发下单同用户可创建多笔 pending 单。
  3. **满员支付拒绝后订单停留 pending**：被闸门拒的用户订单卡 pending → 被「已有待支付订单」拦截，无法转候补也无法重下单（死锁，40 笔残留实证）。
- **修复**：
  1. **原子容量闸门**：三处占位 `UPDATE course_sessions SET booked_count = booked_count + 1 WHERE id = ? AND booked_count < capacity`，`changes===0`（已满员）→ 事务 ROLLBACK（paid 标记/余额扣减/booking 全部撤销）+ 订单标 `cancelled`（不再卡 pending，用户可转候补）。覆盖 payOrder 两分支 + createBooking（教练代订）。
  2. **加锁防重**：driver 新增 `beginExclusive()`（SQLite `BEGIN IMMEDIATE` 立即持写锁 / MySQL `BEGIN`）+ `getExclusive()`（MySQL `FOR UPDATE` 行/间隙锁）——createOrder 的 pending 查重+容量检查+INSERT 整体事务化，并发下单串行化。
  3. **listen backlog=0（SOMAXCONN）**：Windows 下显式 backlog 被 libuv clamp（~511），500 瞬间并发 accept 积压 → ECONNREFUSED；0 = 内核最大队列，Windows/Linux 均生效。
- **回归测试**：SEC-05 四断言（满员支付拒绝/余位不变/余额未扣/订单作废，直连 SQL 造 pending 绕过下单检查模拟并发窗口）；压测 A-01/A-04/A-05（恰 10 人订上、booked_count=10、paid=10）与 B-01/B-02（连点仅 1 单）；WAVE=50 与 WAVE=500 双模式 13/13 全绿；TZ=UTC 全量 268/268。
- **防护层**：L1 本地 hook（run-tests 全量含 SEC-05）+ 压测双模式。兜底思路：**任何「先检查后占位」的两段式业务都必须检查点原子化**（检查与占位在同一条语句/同一把锁内），下单-支付时序跨请求的业务尤其高危；压测断言必须检查参数位置（本次假绿 13 条全因 check 调用 4 参错位——描述字符串被当 ok 恒真）。

## #54 换头像报「微信版本过低」——chooseAvatar 低版本基础库直接阻断，用户无法换头像

- **现象**：个人中心 → 换头像 → 选择微信头像，弹「微信版本过低，无法使用微信头像」——用户卡死，无法换头像（2026-08-18 用户报）。
- **根因**：`student-profile.chooseWechatAvatar` 用 `if (!wx.chooseAvatar)` 检测（`wx.chooseAvatar` 需基础库 ≥2.21.2），低版本（老手机/低版本微信）不满足时**直接 toast 报错 return**——报错路径是死路，没有替代方案。开发工具 libVersion 3.17.1 正常，真机才暴露。
- **修复**：报错路径改为**自动降级相册选图**（`this.chooseLocalImage()`）——低版本仍可换头像，toast 明示「已改用相册选图」；`wx.chooseAvatar` fail 回调（隐私协议未声明/接口异常）同样降级相册，杜绝「点了没反应」。
- **回归测试**：FRONT-14 静态断言（`!wx.chooseAvatar` 分支内必须有 `this.chooseLocalImage()` 降级调用，防回退报错死路）。
- **防护层**：L1 本地 hook（全量随 commit 跑）。兜底思路：能力检测失败路径必须提供**降级方案**而非报错阻断；前端兜底类分支是静态断言重点。

## #53 课程详情页分享按钮无效——open-type="share" 放在 view 上不生效（微信组件能力限制）

- **现象**：课程详情页顶部/标题行两个「分享」按钮点击无任何反应，无法转发给好友（2026-08-18 用户报）。
- **根因**：WXML 里分享按钮是 `<view open-type="share">`——**open-type 是 button 组件的属性**，view 上声明无效（不触发转发）；页面 onShareAppMessage 已定义（title/path/imageUrl 齐全），按钮却不触发。
- **修复**：两处分享入口 `<view>` 改 `<button open-type="share">`（hero-nav 圆钮 `share-round` + 标题行 `share-btn`）；WXSS 补 button 默认样式 reset（`padding/border/line-height` + `::after{border:none}`），视觉与原来一致。顺带：返回/分享图标从深色半透明底白图标统一为浅色底 + 标准深色箭头（#51 同一批）。
- **回归测试**：FRONT-13 静态断言（两处分享必须为 `<button ... open-type="share">`，防回退 view 写法）。
- **防护层**：L1 本地 hook。兜底思路：微信组件专属属性（open-type/form-type 等）只对 button 生效，分享类交互必须 button 承载；静态断言锁定标签名。

## #51 课程详情页顶部后退按钮样式与其他页面不一致——悬浮深色圆钮 vs 全局 back-wrap 箭头

- **现象**：课程详情页顶部返回按钮是悬浮半透明深色圆钮，其他二级页（成就/消息/能量币等）是 `icon-back` 箭头 + 标题的标准样式；教练详情页更是字符箭头「‹」白圆钮（2026-08-18 用户报：统一为同一样式，全局对齐）。
- **根因**：无统一规范——course-detail 因 hero 轮播图采用悬浮圆钮，coach-profile 用 `‹` 字符，其余页 back-wrap，三套样式并存。
- **修复**：① course-detail hero-nav 返回按钮：底改白色半透明（rgba(255,255,255,0.72)）+ 箭头换标准 back-wrap 同款 SVG（36rpx 深色 `#1A1A23`）；② coach-profile `cp-back` 去字符「‹」改 icon-back 箭头；③ 全仓后退按钮收敛为 icon-back 一个视觉语言（图标 SVG 统一 18×18 viewBox）。
- **回归测试**：FRONT-15 静态断言（coach-profile 无「‹」字符、含 icon-back；course-detail 图标已统一）。
- **防护层**：L1 本地 hook。兜底思路：全局 UI 一致性靠统一图标资源（icon-back SVG 单源）而非各页自绘；新页面导航应复用既有类。

---

## #50 time.parseBeijing 缺秒变 Invalid Date——退订/退出候补截止校验全部静默失效（B3 新功能上线即废）

- **现象**：B3「课前 2 小时退订截止」上线后，开课前 1 小时场次的订课仍能成功退订/退出候补（应 400 拒绝）。
- **根因**：`course_sessions.start_time` 存 `HH:MM`（无秒），`isCancelCutoffReached` 用 `time.parseBeijing(\`${date} ${start_time}\`)` 解析——`parseBeijing` 内 `const [h, mi, s] = t.split(':').map(Number)` 对 `'HH:MM'` 得到 `s = NaN`，`Date.UTC(..., NaN)` 产生 Invalid Date，`getTime()` 返回 NaN，`Date.now() >= NaN` 恒为 false → 截止判定永远「未到」，校验形同虚设。start_time 在库里一直是无秒格式，但旧代码没有任何路径用 parseBeijing 解析 start_time，B3 是第一处，一踩即炸。
- **修复**：① `time.parseBeijing` 缺秒容错：`const [h, mi, s = '0'] = t.split(':').map(Number)`（解构默认值，`'HH:MM'` 时秒取 0）；② `isCancelCutoffReached` 双保险：`getTime()` 为 NaN 时返回 true（保守拒绝，拒绝退订比放行安全）。
- **回归测试**：run-tests.js ORD-10（课前 1 小时场次退订 → 400「距离开课不足 2 小时」+ 订课保留）+ WTL-09（课前 1 小时满员场次退出候补 → 400）+ TZ=UTC 全量 260 用例全绿。
- **防护层**：L1 本地 hook（B3 新用例随全量跑）。兜底思路：解析类工具函数对输入格式要容错（缺字段补默认，而非产出 NaN），且「时间判定」类函数对解析失败必须选择保守分支（拒绝而非放行）。

## #49 次卡购买不扣款——applyPassPurchase 只发卡不扣钱（白嫖次卡，资金漏洞）

- **发现**：2026-08-18，B2a 支付预研代码审查（minitest 改造暴露：PASS-02 断言只有发卡无扣款断言，通读 payOrder 次卡分支发现根本无扣款代码）
- **现象**：用户选次卡购买套餐 → 支付成功（订单标 paid）→ 次卡发放 → **余额分文未扣**——等于免费无限买次卡
- **根因**：`payOrder` 次卡分支 `applyPassPurchase` 只做发卡（INSERT/UPDATE user_passes），交易里没有 `addBalance(-payFen)`；而订单标 paid 逻辑对所有 order_type 一视同仁，pass 类型天然漏掉扣款
- **修复**（server/db/orders.js）：①balance 扣款走会员价公式（`floor(原价×折扣/100)*100`，与订课同公式）；②`UPDATE orders SET amount_fen = 实付` 落实付金额（退款严格一致，强制规矩 4）；③预校验：余额不足先拒绝（与订课/候补同款 #9 修复）；④pkg 按**原价**匹配（先按会员价改订单金额再匹配会查不到套餐）
- **回归测试**：PASS-02/03 链路（连买 90000+180000，注入余额 200000 不够→修 400000，扣款是否发生由余额耗尽与否间接证明）+ balance_logs 留痕（测试清理时 FK 约束逼出先删 balance_logs，反证扣款写日志确实发生）
- **防护层**：钱闭环强制规矩（任何支付方式都必须扣款）；`addBalance` 强制 `logOp` 留痕；minitest PASS 区清理补删 balance_logs（FK 约束兜底）

## #48 MySQL 老库幂等补列仅 checkin_code 一处——昨晚新增 12 列只进新库 DDL + SQLite ALTER，生产老表缺列则订课/候补/场次详情全 500

- **发现**：2026-08-18，合并喻馥雅账号后审计昨晚重构（ef865d7）时发现（部署前，未上线即修）
- **现象**：重构新增 courses.images/summary/address/lat/lng、bookings.pay_source/pass_id、waitlist.pay_source/pass_id/expire_mode、orders.pay_source/expire_mode 共 12 列，且业务 SQL 全面引用（courses.js 场次详情 SELECT images/address/lat/lng、orders.js 订/候/退全链路 pay_source/pass_id/expire_mode）；但 **MySQL 老库补列逻辑只有 checkin_code 一处**（db-driver.js ready 门闩）——生产表已存在，`CREATE TABLE IF NOT EXISTS` 不会加列 → 新代码一上线，订课/候补/场次详情/课程编辑全 500
- **根因**：新增列三处同步机制缺失——mysql-schema.js（新库 DDL）与 db-core.js（SQLite ALTER）都改了，MySQL 老库迁移清单（db-driver.js）没同步，只有 checkin_code 单列特例。与 #43/#47 同源：方言建表/迁移三份结构（新库 DDL / SQLite ALTER / MySQL 补列）必须同步维护
- **修复**：db-driver.js 把单列 checkin_code 补丁泛化为表驱动 `MYSQL_ENSURE_COLUMNS` 清单（courses/users/bookings/waitlist/orders 5 表 12+3 列，含 checkin_code 并入），ready 门闩逐表查 information_schema.columns 缺则 ALTER；清单注释标明「新增列三处同步」约定
- **回归测试**：MYSQL-10 静态断言（db-driver.js 须含 images/pay_source(wxpay)/expire_mode 清单项，防"SQLite 加了列 MySQL 忘记补"再演）；干净库 219/219 绿
- **防护层**：L0 代码审计发现（部署前）；修复后 MYSQL-10 + 部署冒烟兜底。**教训：双方言迁移有三份结构（新库 DDL / SQLite ALTER / MySQL 老库补列）——新增列必须三处同步，只改其中两处必然在生产老库埋雷；补列逻辑应表驱动集中（一处清单 + 循环），禁止逐列特例**

---

## #47 CREATE TABLE courses 缺 images/summary/address/lat/lng 列——ALTER TABLE 在建表之前执行，新库静默失败，学员课列表/教练课表全 500

- **发现**：2026-08-18，P1 工程加固验证阶段，冒烟测试 `/api/sessions` 和 `/api/coach/schedule` 均 500
- **现象**：`SELECT ... c.images AS course_images ...` 报 `no such column: c.images`；学员端课程列表、教练端今日课表两个核心页面完全不可用
- **根因**：`db-core.js` 第 50–54 行 `ALTER TABLE courses ADD COLUMN images/summary/address/lat/lng` 在第 210 行 `CREATE TABLE IF NOT EXISTS courses` **之前**执行——全新数据库上表还不存在，ALTER 被 try/catch 静默吞掉；建表 DDL 未包含这些列，查询必报缺列。旧库（列已被 ALTER 补上）不受影响，仅新库/内存库/CFS 重建后触发。同模式受影响的还有 bookings（缺 pay_source/pass_id）、waitlist（缺 expire_mode/pay_source/pass_id）、orders（缺 pay_source/expire_mode）
- **修复**：将缺失列直接补入对应 CREATE TABLE 定义（courses +5 列、bookings +2 列、waitlist +3 列、orders +2 列）；原有 ALTER TABLE 保留作为旧库迁移（重复执行幂等，列已存在时 try/catch 静默跳过）
- **回归测试**：`minitest/smoke.js` 冒烟测试覆盖 `/api/sessions` + `/api/coach/schedule`，新库启动后 8 端点全 200
- **防护层**：L1 冒烟测试发现；修复后 smoke.js 兆底（新库启动→核心端点 200）。**教训：ALTER TABLE 迁移语句必须放在对应 CREATE TABLE 之后（CREATE 先行新库、ALTER 兆底旧库）；#43 已记录同类教训（方言建表要保证 CREATE TABLE 与迁移 ALTER 同步），本次是同一模式在更多列上的变体**

---

## #46 云托管容器无法调通微信 API——出网网关自签名证书致 code2Session 必挂（登录换号深层根因）

- **发现**：2026-08-17，#45 移除演示账号兜底后换号失败显形；行为探测 5/5 返回 errcode -2（网络错误）；WebShell 直测定位
- **现象**：微信一键登录永远拿不到真实 openid（此前被 demo_user 兜底掩盖）。生产探测：假 code 登录 5/5 报「微信登录校验失败（-2）」；WebShell 内 Node 直连 `api.weixin.qq.com` 报 **`self-signed certificate`**，同环境 `www.baidu.com` 返回 200（出网本身正常）
- **根因**：**微信云托管容器出网经腾讯安全网关，网关用自签名证书重签全部 HTTPS 出站流量** → Node 默认 CA 校验必然失败 → code2Session 的 `https.get` 走 error 分支（-2）→ 真实 openid 永远换不到。本地/CI 直连微信 API 证书正常（本地验证永远测不出）
- **修复**：`WECHAT_API_HOSTS` 白名单（`api.weixin.qq.com` + 未来支付预留 `api.mch.weixin.qq.com`），code2Session 请求 `rejectUnauthorized: !WECHAT_API_HOSTS.has(hostname)`——仅白名单关校验、白名单外保持默认严格校验（用户 2026-08-17 确认正式方案：平台适配非临时 hack，微信云托管生态标准做法）
- **回归测试**：FRONT-08 静态断言（白名单集合 + 按 hostname 条件关校验，防回退到无差别关闭或全局 NODE_TLS_REJECT_UNAUTHORIZED=0）；AUTH-07/07b（换号失败 400 + 不注册）继续兜底；217/217 绿
- **防护层**：L3 真机 + WebShell 实测定位；修复后 FRONT-08 + AUTH-07 双兜底。**教训：容器平台出网可能与单机语义不同（网关重签证书）——「本地 curl 能验证」≠「容器能调通」，平台适配类问题要用容器内同路径实测（WebShell Node 直连）定位；环境差异排查先问「容器里测过吗」**

---

## #45 登录链路演示账号兜底——微信一键登录在换号失败时静默变成演示身份（用户指令：代码中不再出现演示账号 id）

- **发现**：2026-08-17，用户真机复测：删除小程序重扫预览码、微信一键登录，仍登录成演示账号（openid 演示号、昵称田立）；用户明确指令「保证代码中不会再出现 demo_user 的 id」
- **现象**：正式登录（微信一键/手机号）在本该换真实 openid 的场景下拿到演示身份，身份错乱且无任何提示
- **根因**（三层叠加）：
  1. 后端 handleLogin：有 code 时 code2Session 失败（未配置 AppSecret / 网络超时 / 微信返回错误码）→ **静默回退客户端 openid**（前端兜底值恒为演示号）→ 换号失败必成演示账号
  2. 前端 doLogin：正式登录 openid 兜底值写死 `'demo_user'`（田立特例）+ 其余也回退 `'demo_user'`——任何「code 缺失/失败」场景都落到演示账号
  3. 登录页演示身份入口（quickLogin 学员）也写死 `'demo_user'`；seed-fake-users.js VIEWER 也引用之
- **修复**：① 后端「有 code 只信 code」——换号失败返回 400（含微信错误码），**绝不回退客户端 openid**（前端弹窗重试）；② 前端正式登录 openid 兜底改空字符串（无 code 时后端 400 缺 openid，同样显式报错）；昵称快捷登录统一 djb2 哈希 demo_ 账号（无演示特例）；演示身份入口 openid 随机 demo_；③ 活跃代码 demo_user 清零（login/index.js 全部、seed-fake-users.js VIEWER 改 FAKE_VIEWER env 覆盖默认 demo_tianli、server/index.js 注释同步）——历史文档/台账保留原词（真实历史）
- **回归测试**：AUTH-07（假 code 换号失败 → 400「微信登录校验失败」）+ AUTH-07b（客户端 openid 未被静默注册）+ FRONT-07 静态断言（登录页/造数脚本/后端登录处理三文件零 demo_user）；217/217 绿
- **防护层**：L3 真机发现；修复后 AUTH-07/07b 真实断言 + FRONT-07 静态断言 + pre-commit hook 双兜底。**教训：「登录成功但身份是错的」是演示兜底身份类 bug 的典型形态——正式环境登录必须「有 code 只信 code」，任何换号失败都应是显式错误而非静默降级；前端兜底 openid 与后端回退逻辑叠加才酿成用户端无法察觉的身份错乱**

---

## #44 生产清理脚本 clean-prod-users.js 确认环节必挂——confirm 引用 main 局部变量 delUsers

- **发现**：2026-08-17，用户在云托管 WebShell 执行 `--execute` 时暴露（DRY_RUN 正常走完、EXECUTE 死在确认处）
- **现象**：脚本完整打印用户清单/关联数据/教练档案检查后报 `脚本失败: delUsers is not defined`；删除事务未执行、数据零变更（用户在后台确认用户数未减少）
- **根因**：`confirm()` 定义在 `main()` 外，模板字符串 `${delUsers.length}` 引用的是 `main()` 的局部 `const delUsers`——作用域外引用必抛 ReferenceError。DRY_RUN 分支不调 confirm 所以预览正常；EXECUTE 走到确认即挂。属**安全方向失败**（每次都在执行前中止，误删不可能发生），但功能完全不可用
- **修复**：`await confirm(delUsers)` 传参 + `function confirm(delUsers)`；顺带修 `SELECT VERSION() v` 别名在 mysql2 下取不到（改 `AS v` + `connInfo[0].v`，原打印 `MySQL undefined`）
- **回归测试**：OPS-01 静态断言（`function confirm(delUsers)` + `await confirm(delUsers)` 双查，防回退到引用局部变量）；node --check 语法通过
- **防护层**：L3 真机（WebShell）发现；修复后 OPS-01 静态断言 + pre-commit hook 兜底。**教训：main 与工具函数分离时，作用域边界要想清楚——工具函数引用的数据一律参数化传入；「DRY_RUN 正常 ≠ EXECUTE 可用」——两分支都要走一遍**

---

## #43 课程编辑「教练介绍」从未保存 + 教练档案编辑能力缺失（DESIGN #D2 配套）

- **发现**：2026-08-17，实现教练档案编辑时审计发现（前端 courses.html 一直有「教练介绍」字段，服务端丢弃）
- **现象**：管理网页编辑课程填写的「教练介绍」（coach_bio）保存后不生效——handleCreateCourse/handleUpdateCourse 从未写入 coaches.bio；且被设为教练的用户无法编辑自己的档案（名字/头像/技能/简介），前端教练详情/课程详情展示的是种子占位
- **根因**：① 服务端 updateCourse 只更新 courses 表，coach_bio 字段被静默丢弃；② 无教练档案编辑接口——档案只能靠 seed/直连库修改
- **修复**：① db/courses.js 新增 setCourseCoachBio(courseId, bio)——取该课程最近场次的 coach_id 写入 coaches.bio（无场次课程静默跳过），handleCreateCourse/handleUpdateCourse 接入；② db/coach.js 新增 updateCoachProfile(id, {name,avatar,skills,bio})（只更新传入非空字段、name 禁空）+ PUT /api/admin/coaches/:id 路由（入 ADMIN_PATHS 访问码保护）+ listCoachesWithBind 补 avatar/rating/bio 输出；③ web 教练分配 tab 行内「编辑档案」弹层（名字/头像/技能/简介）；④ SQLite coaches 建表补 bio 列（mysql-schema 已有，方言不一致——db-core.js:55 ALTER 因建表顺序先于 coaches 建表而被 try-catch 吞掉，新库缺列）
- **回归测试**：ADMIN-19（无 token 编辑档案 401）+ ADMIN-20/20b（编辑成功+列表反映）+ ADMIN-21（不存在档案 400）+ ADMIN-22（name 空拒绝）+ ADMIN-23/23b（课程 coach_bio → 教练档案 bio 落库）；213/213 绿 + TZ=UTC 绿 + coverage 探针（PUT coaches + 课程保存教练介绍）
- **防护层**：L0 功能审计发现；修复后 ADMIN-19~23b 真实断言 + coverage 探针。**教训：前端表单字段≠后端落库字段，接口契约要双向核对；方言建表要保证 CREATE TABLE 与迁移 ALTER 同步（CREATE 先行新库、ALTER 兜底旧库）**

---

## #42 教练工作台「我的课程」无排序——需进行中最前、未开始越近越前、已结束刚结束在前

- **发现**：2026-08-17，用户明确排序规则要求
- **现象**：教练工作台「我的课程」列表顺序 = 后端返回顺序，进行中的课不置顶，未开始/已结束混排
- **根因**：coach-home `loadSessions` 只 filter+map 未排序；decorateSession 也未输出 status 字段（只有展示文案）
- **修复**：session-sort.js 新增纯函数 `sortCoachSessions`（三态分组：ongoing=0 < upcoming=1 < ended=2；组内按 date+start_time——ended 降序（刚结束在前）、其余升序）；decorateSession 补 `status` 字段；loadSessions 接入
- **回归测试**：SORT-05（进行中最前）+ SORT-06（未开始升序）+ SORT-07（已结束降序）+ SORT-08（coach-home 引用静态断言）；全量 186/186 绿 + TZ=UTC 全绿
- **防护层**：L3 用户需求驱动；修复后 SORT-05~07 真实断言 + SORT-08 防回退。**教训：与 #36 同源——列表排序是展示契约，前端显式排序 + 纯函数模块可测**

---

## #41 GET /api/users 返回空对象数组——async map 未 await（Promise 数组序列化）

- **发现**：2026-08-17，排查 #40（教练档案不存在）时探测生产 API 发现
- **现象**：生产 GET /api/users 返回 `{"users":[{},{},{},{},{}]}`——5 个用户但字段全空；本地测试 AUTH-05 假绿（只断言 Array.isArray）
- **根因**：index.js handleUsers `users.map(toPublicUser)`——toPublicUser 是 async 函数，map 返回 Promise 数组，未 await 就被 sendJson 序列化（JSON.stringify 对 Promise 输出 {}）
- **修复**：`await Promise.all(users.map(toPublicUser))`
- **回归测试**：AUTH-05b 新增字段断言（首个用户 openid/nickname 非空），杜绝"空对象数组"假绿；全量 186/186 绿
- **防护层**：L3 生产探测发现；修复后 AUTH-05b 直接拦截同类回归。**教训：async 函数放进 map 必须 Promise.all；"数组长度断言"无法发现元素为空的回归**

---

## #40 教练入口登录报"教练档案不存在"——coaches.user_openid 从未绑定

- **发现**：2026-08-17，用户反馈（#13 疑似同根因）
- **现象**：登录页选教练入口进入 → 教练工作台「我的学员」报「教练档案不存在」（GET /api/coach/students 404）
- **根因**：生产 coaches 表喻馥雅(id=1)/马春艳(id=2) 的 user_openid 均为 NULL——从未通过 coach-assign 绑定；教练账号登录后 findCoachByOpenid 查不到档案
- **修复**：① 管理页自助化 = web 管理网页新增「教练分配」tab（GET /api/admin/coaches 列表带绑定状态 + POST /api/admin/coach-unassign 解绑回落 role=student，均入 ADMIN_PATHS 访问码保护；bind/unbind 页面操作），管理员不再依赖 API 手动绑；② 数据绑定 = 带 Admin-Token 调 POST /api/admin/coach-assign 把喻馥雅账号（demo_3dmuxq）绑到 coaches#1 → 用户重新登录验证
- **回归测试**：ADMIN-08~13（列表 401/结构/绑定后反映/解绑成功/role 回落/解绑 401，193/193 绿）+ coverage 探针 13.6（列表+解绑+恢复绑定）+ 部署后生产探测（/api/coach/students 不再 404）
- **防护层**：L3 真机发现；防护=管理页自助绑定 + 部署后生产探测判据。**教训：coaches 档案与用户账号是两张表两套数据，部署/迁移不自动绑定；新环境上线后必须做教练绑定初始化**

---

## #39 签到码页「刷新签到码」按钮无实际作用（重画同码，误导用户）

- **发现**：2026-08-17，用户反馈「点刷新后二维码未变化，是否考虑去掉按钮」
- **现象**：签到码页（student-checkin）显示「刷新签到码」按钮，点击只弹「签到码已刷新」toast，二维码内容完全不变（同一张码重画一遍）
- **根因**：`refreshCode()` 仅再次调用 `drawQr(this.data.checkinCode)`——签到码由后端随机生成后固定（BUGS-INBOX #11 设计），不存在"换一张码"；按钮是早期「重画一版更清晰的码」遗留设计，canvas 渲染稳定后无存在价值
- **修复**：删除 WXML 刷新按钮（index.wxml）+ 删除 `refreshCode()` 方法（index.js）
- **回归测试**：FRONT-04 静态断言（`refreshCode` 不得出现在 student-checkin/index.js）
- **防护层**：L3 真机/模拟器发现；修复后 FRONT-04 防回退。**教训：给用户看的按钮必须有可感知的作用；同内容重画不属于"刷新"**

---

## #38 模拟器首次进签到页无二维码，需刷新才有（真机无此问题）

- **发现**：2026-08-17，用户反馈「模拟器中学员端点签到，第一次不显示二维码，刷新后才有；真机没有」
- **现象**：模拟器首次进入签到码页，二维码区空白；手动退出重进（刷新）后二维码出现；真机始终正常
- **根因**（双因叠加）：
  1. `setData` 完成回调里 `this.drawQr(checkinCode)` 引用了**不存在的局部变量**（loadInfo 作用域只有 `this.data.checkinCode`）→ 窗口内未签到时抛 ReferenceError，画码中断；
  2. `drawQr` 用 `wx.createSelectorQuery().boundingClientRect` 取 canvas 尺寸，**首次渲染 canvas 布局未就绪时 rect 为 null → 直接 return 放弃**。模拟器首帧慢更易触发；真机渲染快/时序不同故不现
- **修复**：回调改 `this.drawQr(this.data.checkinCode)`（消除引用错误）；抽 `paintQr(qr, count, attempt)`，rect 拿不到时延迟 120ms 重试最多 3 次，不再直接放弃
- **回归测试**：FRONT-03（画码必须 `this.drawQr(this.data.checkinCode)`，禁裸引用作用域外变量）+ FRONT-04（须有首帧重试入口 `paintQr(qr, qr.getModuleCount(), 0)`）；全量 181/181 绿 + TZ=UTC 全绿
- **防护层**：L3 模拟器发现；修复后 FRONT-03/04 静态断言防回退。**教训：`wx.createSelectorQuery` 的 boundingClientRect 在页面首帧可能拿不到尺寸，画布类渲染必须重试或延后；setData 回调里的自由变量引用极易写错成作用域外名字**

---

## #37 教练端核销签到码显示"无法识别的签到码"（部署过渡期版本不同步）

- **发现**：2026-08-17，用户报告（#11 实施当天）
- **现象**：教练端扫码/手动核销签到码，提示「无法识别的签到码」
- **根因**：生产云托管仍是旧镜像（本地 #11 提交未 push/部署）——`POST /api/checkin/by-code` 探测 404；学员端 getCheckinInfo 不返回 `checkin_code`（新列未建）→ 学员端显示旧 4 位码或空码 → 教练端新版 5 位校验（`isValidCode`）拒绝。前端文案「无法识别的签到码」是**本地格式校验失败**，非接口错误
- **修复**：代码无需改动（本地 181/181 全绿）；push 触发云托管重建部署新镜像（MySQL 建表门闩幂等补 checkin_code 列 + 老订课 lazy 回填），两端小程序重新编译上传
- **回归测试**：CHK-08~13（#11 提交已含）+ deploy-smoke 新镜像特征（by-code 路由 404→非404/400）
- **防护层**：L3 真机发现；防护=已知坑「重建窗口/旧镜像」判据（deploy-smoke 必跑）+ 版本不同步提示。**教训：前端改接口后未部署即真机测试 = 必然版本错配；先部署后端再测前端**

---

## #36 上课页排序反了——待上课最远的排最前，已完成未排序（排序规则缺失）

- **发现**：2026-08-17，用户反馈「上课页面，所有未上的课应最近要开始的排前面；已完成的课刚结束的排前面」
- **现象**：我的课程页「待上课」Tab 列表最远的课排最前（新增排课后每天 13 堂更明显）；「已完成」列表顺序与待上课同向（DESC），恰好符合「刚结束在前」但未显式排序，且两类共用后端单一排序
- **根因**：student-my-courses 的 `loadAll()` 未做前端排序，直接使用后端 `listBookingsByUser` 的 `ORDER BY date DESC, start_time DESC`（此排序为「最新在前」设计，适配已完成列表，不适配待上课）
- **修复**：新增纯函数模块 `miniprogram/utils/session-sort.js`（sortUpcoming：date+start_time 升序，最近先来；sortCompleted：date+end_time 降序，刚结束在前；均 slice 副本不修改原数组），页面 loadAll 待上课（含候补）与已完成各自调用
- **回归测试**：SORT-01（待上课升序断言，含跨天/同日多时段用例）+ SORT-02（不修改原数组）+ SORT-03（已完成降序断言）+ SORT-04（页面引用模块静态断言）；全量 173/173 绿
- **防护层**：L3 真机发现；修复后 SORT-01/03 真实断言（纯函数可直连 require）+ SORT-04 防引用回退。**教训：列表排序是展示契约，前端不能依赖后端排序语义（后端排序为接口内部实现，前端按业务规则显式排序才稳）**

---

## #35 订课后页面仍显示可预约——课程详情页/首页缺 onShow 刷新（纯前端展示问题）

- **发现**：2026-08-17，用户新增排课（10-22 点每小时一堂）后真机订课，订完返回仍显示「立即预订/预约」
- **现象**：学员订课成功（后端 bookings 记录 + booked_count 均正确写入），但从支付页返回课程详情页/首页时，按钮仍显示可预约状态，看起来像没订上；列表页无此问题（onShow 已有刷新）
- **根因**：student-course-detail（详情页）`loadSession` 仅在 `onLoad` 调用，**没有 onShow 刷新**——从支付页 `redirectTo` 返回后 `isBooked` 仍是进入页面时的旧值 false；student-activity（首页）`loadTodayCourses` 同理只在 onLoad 调用。列表页（student-courses）onShow 会重新拉取所以正确。**服务端数据层无问题，是页面生命周期刷新缺失**
- **修复**：详情页 onShow 补 `this._sessionId` 存在时重新 `loadSession(this._sessionId)`（onLoad 记存 sessionId）；首页 onShow 补 `this.loadTodayCourses()`
- **回归测试**：FRONT-01（详情页 onShow 含 loadSession(_sessionId)）+ FRONT-02（首页 onShow 含 loadTodayCourses()）静态断言；全量 169/169 绿
- **防护层**：L3 真机发现；修复后 FRONT-01/02 静态断言兜底（前端页面生命周期刷新缺失易复发——新页面/新状态页加「返回时是否刷新」检查）。**教训：涉及「进入→操作→返回」的页面，操作结果必须在 onShow 重新拉取，不能依赖 onLoad 一次性数据**

---

## #14 管理访问码保护遗漏 coach-assign——任何人都能绕过访问码把任意用户设为教练提权（P1 安全）

- **发现**：2026-08-17，#8 修复（065968e）后审计 ADMIN_PATHS 覆盖范围，生产探测：POST /api/admin/coach-assign 带错 Admin-Token 返回 400 参数校验而非 401 = 未受保护
- **现象**：web 管理网页「教练分配」接口公网裸奔——任何能访问接口的人（无需访问码）可把任意 openid 设为教练 → 获得教练权限（查看学员、签到核销、结算）。#8 的 ADMIN_PATHS 仅覆盖 courses 写/sessions 写/admin 运营读，遗漏该路由
- **根因**：065968e 加访问码保护时 ADMIN_PATHS 按「小程序端不调用、仅管理网页使用」原则人工列清单，漏列 coach-assign（当时未审计全量管理路由）
- **修复**：ADMIN_PATHS 增加 `{ m: 'POST', p: /^\/api\/admin\/coach-assign$/ }`；回归测试 ADMIN-06/07（无 token 401 / 对 token 进参数校验）。**行为变更告知**：小程序 admin-students 页「设教练」共用此接口，保护后需 Admin-Token——管理操作统一走 web 管理网页（#8 架构方向）
- **回归测试**：ADMIN-06（无 token → 401）+ ADMIN-07（对 token → 400 参数校验）；全量 167/167 绿
- **防护层**：L3 生产探测发现（带错 token 返回 400 而非 401 = 未受保护的可判据）；修复后 ADMIN-06/07 + 访问码校验兜底。**教训：加「保护/鉴权」类改动时，必须全量审计管理类路由清单（grep 所有 /api/admin 前缀 + 管理语义路由），不能凭记忆列集合**

---

## #34 seed.js 完成后进程挂起——MySQL 连接池句柄阻塞退出，`node seed.js && node index.js` 卡死在 seed，index.js 永不启动 → 探针 refused 部署回滚（P0 生产不可用）

- **发现**：2026-08-17，MySQL 部署（gym-server-030/032）连续探针失败 `Liveness probe failed: dial tcp ...:3000: connection refused`；启动日志**始终止于 seed 数据汇总、无 index.js 任何输出**（无「后端服务已启动」也无报错）——排除 index.js 崩溃（崩溃会有错误堆栈），定位到 index.js **从未被执行**
- **现象**：容器启动日志完整跑完 seed（`[mysql] 建表完成（20 表）` + 数据汇总）后戛然而止；`&&` 之后的 index.js 无任何日志；探针打 3000 永远 refused（index.js 没监听）→ 部署回滚。SQLite 时代从未出现（本地/CI 全绿）
- **根因**：`seed.js` 成功路径**不显式退出进程**，靠事件循环空转自然退出——**SQLite 模式无异步句柄（DatabaseSync 同步 API）正常退出；MySQL 模式 createMysqlPool() 的连接池是活跃 TCP socket 句柄，事件循环不空 → seed 进程挂起 → `node seed.js && node index.js` 的 `&&` 永远等不到 seed 退出 → index.js 永不启动**。又一个「SQLite 假设」（同步 API 无句柄 → 进程自然退出；MySQL 异步句柄 → 必须显式退出）
- **修复**：`server/seed.js` 成功路径改 `})().then(() => process.exit(0))`（失败路径原有 exit(1) 不变）；显式退出在 SQLite 下行为一致（正常退出码 0）
- **回归测试**：MYSQL-08 静态断言（seed.js 源码须含 `process.exit(0)`，防回退——删掉即部署永久挂死）；全量 163/163 绿（普通 + TZ=UTC）
- **防护层**：L3 生产部署日志发现（启动日志止于 seed = 强信号：`&&` 链后无输出先查前一进程是否挂起）；修复后 MYSQL-08 + 部署冒烟兜底。**教训：MySQL 引入异步句柄后，「脚本类进程自然退出」假设失效——凡启动链路（CMD `seed && index`）中的命令型脚本必须显式退出；排查部署探针失败时，启动日志「止于某处无后续」= 该进程未退出或未启动，不是探针配置问题**
- **加固（2026-08-17 晚，架构级，消除整类启动链风险）**：不再依赖「seed 正常退出」这条细线——`server/seed.js` 重构为导出 `run()`（CLI 分支保留 process.exit），`server/index.js` 启动段在 `driver.ready` 后**进程内 await seed.run()**，Dockerfile CMD 改为 `node index.js`。启动顺序变为：**先 listen 3000（探针窗口内即监听）→ 建表就绪 → 进程内幂等种子**。seed 无论快慢、成败，都不再阻塞 index 启动——探针 refused 的启动链路根因整类消除。配套：MYSQL-09 静态断言（index.js 必须含 `require('./seed').run()`，防回退阻塞式 CMD）+ 本地验证（临时库起服务：横幅「后端服务已启动」先于种子输出）+ `scripts/pack-deploy-zip.ps1`（正斜杠 zip 打包，云托管「上传代码包」绕开 GitHub clone 构建环节——clone 慢/失败是「创建版本任务失败」高频原因，031/033/034 连续构建失败即此，部署时曾回滚旧镜像导致修复不可见）

## #33 业务 SQL 用 SQLite 专属 last_insert_rowid()——MySQL 无此函数，建表成功部署后订课/候补/兑换/发卡全 500（P0 生产不可用，本轮人工方言审计发现，未上线即修）

- **发现**：2026-08-17，#32 修复后部署前方言审计（grep SQLite 方言函数清单）发现——**本轮部署尚未成功，此炸弹若随部署上线，任何一笔订课/候补/兑换/次卡发放都会 500**
- **现象**：8 处 `SELECT ... WHERE id = last_insert_rowid()`（bookings.js×1、coin.js×1、orders.js×5、passes.js×1）。MySQL 无此函数（对应 LAST_INSERT_ID() 是**连接级**变量，mysql2 连接池下 INSERT 与 SELECT 可能跨连接，不可靠）；SQLite 单连接进程内有效所以本地/CI 全绿测不出
- **根因**：INSERT 后取新行 id 用了 SQL 内函数，是 SQLite 单连接假设的产物；驱动 run() 本就返回 `{ changes, lastInsertRowid }`（契约注释第 10 行），业务代码没用
- **修复**：8 处统一改为 `const r = await driver.run(INSERT)` → `WHERE id = ?` 传 `r.lastInsertRowid`（双方言兼容，无跨连接问题）；顺带修复 bookings.js 的预存 bug——复用已退订 booking（UPDATE 分支）后查新 booking 用 `last_insert_rowid()` 会拿到陈旧 rowid，改为复用分支直接用 exists.id
- **回归测试**：MYSQL-07 静态断言（bookings/coin/orders/passes 四文件不得含 last_insert_rowid 字样，防回退）；全量 163/163 绿（普通 + TZ=UTC）
- **防护层**：本轮人工方言审计发现；修复后 MYSQL-07 + 全量回归兜底。**教训：SQLite 单连接假设（last_insert_rowid、BEGIN/COMMIT 手写事务）在 MySQL 连接池下语义不同——方言审计应把「SQLite 专属函数清单」（last_insert_rowid/strftime/datetime/||/julianday…）逐条 grep 业务 SQL**

## #32 MySQL 保留字列名裸用——coin_logs.change / course_sessions.date 建表 ER_PARSE_ERROR，生产建表三连败（P0 生产不可用）

- **发现**：2026-08-17，#31 修复重建后仍 CrashLoop（第二次失败日志 `near 'change INT NOT NULL'`，第三次失败日志 `near 'date'`），用户控制台日志
- **现象**：`node seed.js && node index.js` 启动即挂——MysqlDriver.exec(MYSQL_SCHEMA) 建 coin_logs 表报 `ER_PARSE_ERROR ... near 'change INT NOT NULL'`；改完 change 后 course_sessions 的 `date` 列同样报错。此前本地/CI 全量 162 项全绿（SQLite 不保留这两个词，测试走 SQLite 方言，永远测不出）
- **根因**：`change` 和 `date` 是 **MySQL 保留字**（SQLite 不是）。`server/mysql-schema.js` 从 SQLite DDL 机械转换时只处理了 `desc`，漏了 `change`（coin_logs）和 `date`（course_sessions，含 2 处索引定义）。业务 SQL 里还有 8 处裸 `date`/`change`（无表别名时一样报错）：coin.js×4（SUM/条件/INSERT/SELECT）、courses.js×2（hasTimeConflict WHERE、去重 key SELECT）、coach.js×3（结算月查询）、seed.js×1、orders.js×1。**限定名（s.date）合法无需引号，裸标识符必须反引号**（MySQL 8.0 文档规则）
- **修复**：
  1. 全部裸保留字加反引号：mysql-schema.js `\`change\`` / `\`date\`` ×4（含索引 `KEY idx_sessions_date ( \`date\`, status)`）+ `\`role\``（users 表，MySQL 8.0 保留字，大小写不敏感）；业务 SQL：coin.js 4 处、courses.js 2 处、coach.js 3 处（+role 1 处）、seed.js 1 处、orders.js 1 处、bookings.js 1 处（role）、users.js 1 处（role）、seed-fake-users.js 1 处（role）。**反引号是 SQLite/MySQL 双兼容标识符**（SQLite 文档明确支持），本地测试不破
  2. courses.js 去重 key 从 SQL `date || '_' || ...` 改为 **JS 侧拼接**（`||` 是 SQLite 拼接符、MySQL 下是 OR 布尔运算，方言不可移植，静默错）
- **回归测试**：run-tests.js 新增 **MYSQL-06** 静态断言——提取 MYSQL_SCHEMA 模板字符串正文，断言无裸 `date`/`change`/`role`（正则排除反引号包裹/点限定/函数调用/DATETIME 等词符后缀）；全量 162/162 绿（普通 + TZ=UTC 双模式）
- **防护层**：L3 生产部署冒烟（用户控制台日志）发现；修复后由 MYSQL-06 兜底 schema 层；业务 SQL 层靠本次全量 grep（`\b(date|change)\b` 逐行目检）+ 部署冒烟。**教训：SQLite 宽松的保留字集（几乎全放开）让「本地全绿」对 MySQL 方言零防护——双方言项目的 SQL 变更必须过一遍 MySQL 保留字清单（可维护一份项目内保留字表 + 静态断言），静态断言只拦「已知错误写法」，生产 MySQL 路径首次建表必须盯启动日志**

## #31 MySQL 建表 DDL 用 SQLite 方言——VARCHAR(19) DEFAULT (CURRENT_TIMESTAMP) 非法，生产首次建表 CrashLoop（P0 生产不可用）
- **发现**：2026-08-17，配置 DB_DRIVER=mysql 后的首次重建（push 04aca32 触发），容器启动日志 `seed 失败: ER_PARSE_ERROR ... near '(CURRENT_TIMESTAMP)'`，Back-off restarting
- **现象**：`node seed.js && node index.js` 启动即挂——MysqlDriver.exec(MYSQL_SCHEMA) 建 users 表报 MySQL 语法错误（`VARCHAR(19) NOT NULL DEFAULT (CURRENT_TIMESTAMP)`），容器反复重启（CrashLoop）；此前 10:50 部署包冒烟通过是因为当时生产还在 SQLite 路径，MySQL 建表从未真正执行过
- **根因**：`server/mysql-schema.js` 从 SQLite 版 DDL 机械转换，**19 处** `VARCHAR(19) NOT NULL DEFAULT (CURRENT_TIMESTAMP)` 是 SQLite 表达式默认值写法；MySQL 只允许 TIMESTAMP/DATETIME 列带 CURRENT_TIMESTAMP 默认值，VARCHAR 列报 ER_PARSE_ERROR。本地/CI 全量测试走 SQLite，MySQL 建表路径零覆盖（无本地 MySQL 可连），方言错误直到生产首次建表才暴露
- **修复**：
  1. `mysql-schema.js` 19 处时间默认值列改 `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`（MySQL 原生类型 + 时间默认值；无默认值的可空时间列 checkin_at/paid_at 等保持 VARCHAR(19)，应用层显式写值不受影响）；更新头部注释说明新约定
  2. `db-driver.js` createMysqlPool 加 **`dateStrings: true`**——mysql2 默认把 DATETIME 读成 JS Date 对象，应用层按字符串契约解析（`time.parseBeijing(user.created_at)`、字符串比较），必须让 DATETIME 以 `'YYYY-MM-DD HH:MM:SS'` 字符串返回，行为与 SQLite 一致
- **回归测试**：run-tests.js 新增 **MYSQL-04/05** 静态断言（无 MySQL 无法真连）：④ mysql-schema.js 无 `VARCHAR(\d+)...CURRENT_TIMESTAMP` 残留（单行匹配，防误报）⑤ db-driver.js 含 `dateStrings: true`；全量 161/161 绿（普通 + TZ=UTC 双模式）
- **防护层**：L3 生产部署冒烟（用户控制台日志）发现；修复后由 MYSQL-04/05 静态断言兜底（有人写回 SQLite 方言立即红）+ 部署冒烟登录落库证据；**教训：双方言 DDL 的正确性只能靠真连验证，静态断言只能拦「已知错误写法」——生产 MySQL 路径的首次建表必须盯启动日志（建表完成/seed 失败），不能只看 health**

## #30 passes.js 档位种子模块加载期查表早于 MySQL 异步建表——容器启动 CrashLoop（P0 生产不可用）
- **发现**：2026-08-17，新镜像 022 部署上线即 CrashLoop（2026-08-17 上午）
- **现象**：容器反复重启；seedPackages IIFE 查 class_packages 报 ER_NO_SUCH_TABLE（MySQL 模式），SQLite 模式无感（同步建表）
- **根因**：`server/db/passes.js` 顶部 `seedPackages` IIFE 在**模块加载期**（require('./db') 链路）立即查表；MySQL 模式建表是异步门闩（driver.ready），seed.js 的 `await` 在 require 之后，拦不住模块加载期的查询 → 查表早于建表 → ER_NO_SUCH_TABLE → 崩溃循环
- **修复**：函数内 `await driver.ready` 自守门闩（SQLite 立即返回行为不变）
- **回归测试**：run-tests.js **PASSES-01** 静态断言（passes.js 须 await driver.ready）；干净库 159/159 全绿
- **防护层**：L3 生产启动日志发现；修复后 PASSES-01 兜底；**教训：MySQL 异步建表 + 模块加载期副作用 = 竞态温床，顶层 IIFE 副作用须自守 ready 门闩**

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
- **✅ 已解决**：2026-08-18 用户确认 CFS 已挂载 + 环境变量已配置，容器重建后数据不再丢失

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
