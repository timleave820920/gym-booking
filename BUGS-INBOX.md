# BUGS-INBOX.md · Bug 收集箱

> 输入「bug：xxx」自动登记（UserPromptSubmit 钩子捕获）；描述不清我会追问。
> 状态：⬜ 待确认 ｜ ⏳ 修复中 ｜ ✅ 已修复（登记 BUG-LEDGER #N）
- [x] #59（2026-08-18）用户完成完善画像，点了保存后，弹框恭喜玩家获得能量币。然后玩家画像就不再显示了。→ **用户澄清（2026-08-18）：非 bug，转功能需求——画像卡一次性表单**：用户填写保存后整卡不再出现（已填用户进页也不显示）；用户拍板保留轻量入口（「🎯 资料与生日 ›」菜单行，openProfileEditor 展开编辑，满足 PIPL 更正权）。✅ 已实施：WXML `wx:if="{{profile && (!profileSaved || profileEditing)}}"` + 入口行；JS data 声明 profileEditing + openProfileEditor + saveProfile 成功后收起；saveProfile 兜底 `res.profile || this.data.profile`；FRONT-21b 防回退断言。357/357 绿。
- [x] #58（2026-08-18）后台的四个 tab 顺序：运营数据，课程设定，排课系统，教练分配（当前顺序与要求不符，待批准后修）→ ✅ 已修复（BUG-LEDGER #58：nav 顺序+active 移至运营数据+「排表管理」更名「排课系统」+init 默认 switchTab('board')；FRONT-24 回归，352/352 绿）
- [x] #42（2026-08-17）教练工作台，我的课程页面，课程排序方式：1）当前正在进行的课程；2）未来的课程，越近的越靠前；3）已经结束的课程，越近的越靠前 → ✅ 已修复（BUG-LEDGER #42：session-sort.js 新增 sortCoachSessions 三态排序——进行中→未开始升序→已结束降序；SORT-05~08 回归，186/186 绿）
- [x] #41（2026-08-17，排查 #40 时探测发现）GET /api/users 返回空对象数组——index.js:245 `users.map(toPublicUser)` 中 toPublicUser 为 async 函数，map 未 await → Promise 数组序列化为 `[{},{}...]`（JSON.stringify 对 Promise 输出 {}）。本地 AUTH-05 只断言数组长度所以假绿。→ ✅ 已修复（BUG-LEDGER #41：await Promise.all + AUTH-05b 字段断言防假绿，186/186 绿）
- [x] #40（2026-08-17）通过前端登录页面的教练入口进入，报错"教练档案不存在"。→ ✅ 已修复（BUG-LEDGER #40：① web 管理网页新增「教练分配」tab——GET /api/admin/coaches 列表（含绑定昵称）+ POST /api/admin/coach-unassign 解绑（role 回落 student），均访问码保护；② 生产绑定喻馥雅 demo_3dmuxq→coaches#1；ADMIN-08~13 回归 + coverage 探针 13.6，193/193 绿）
- [x] #39（2026-08-17）签到二维码刷新有什么意义？现在点刷新后二维码未变化。是否考虑去掉刷新二维码的按钮？→ ✅ 已修复（BUG-LEDGER #39：删 WXML 按钮 + refreshCode 方法；FRONT-04 防回退）
- [ ] #41（2026-08-17，排查 #40 时探测发现）GET /api/users 返回空对象数组——index.js:245 `users.map(toPublicUser)` 中 toPublicUser 为 async 函数，map 未 await → Promise 数组序列化为 `[{},{}...]`（JSON.stringify 对 Promise 输出 {}）。本地 AUTH-05 只断言数组长度所以假绿。修复方向：`await Promise.all(users.map(toPublicUser))`
- [x] #40（2026-08-17）通过前端登录页面的教练入口进入，报错"教练档案不存在"。→ ✅ 已修复（BUG-LEDGER #40：见上条）
- [x] #38（2026-08-17）在模拟器中学员端点击签到，第一次不会显示二维码，需要刷新。真机没有这个问题。→ ✅ 已修复（BUG-LEDGER #38：画码引用未定义变量 + canvas 首帧拿不到尺寸直接放弃；改 this.data.checkinCode + paintQr 延迟重试；FRONT-03/04 静态断言，181/181 绿）
- [x] #37（2026-08-17）教练端核销签到码，显示"无法识别的签到码"。→ ✅ 已修复（BUG-LEDGER #37：根因=生产旧镜像未部署（by-code 404 探测确认），代码无需改；push 部署新镜像 + 两端重新编译后生效）
- [x] #11（2026-08-17，用户确认设计后实施）学员端签到码改为随机 5 位纯数字（原为 bookingId 4 位补零，可被推断/撞号；用户反馈看到「字母+数字」为旧版本）→ ✅ 已修复：checkin_code 列（SQLite ALTER + MySQL 幂等补列）+ genCheckinCode 随机 10000-99999（撞号重试 10 次）+ createBooking 生成/getCheckinInfo 返回（老库 lazy 回填）+ 教练端改走 POST /api/checkin/by-code 按码反查核销（复用 checkinBooking 校验：教练角色/窗口/重复签到），前端教练扫码/手动输入、学员二维码同码展示；CHK-08~13 回归（含格式/不存在/重复/非教练拒绝），179/179 绿 + TZ=UTC 全绿 + coverage 探针；连带修复 COIN-04/04b 绝对余额断言改差值（防签到奖励污染）
- [x] #36（2026-08-17）上课页面，所有未上的课，应该按照最近要开始的排在前面，越远离现在的课程越后面。对于已完成的课程，是同样的，刚刚结束的课程排前面，很久以前的课程排后面。→ ✅ 已修复（BUG-LEDGER #36：新增 session-sort.js 纯函数，待上课 date+time 升序/已完成 date+end 降序；SORT-01~04 回归，173/173 绿）
- [x] #35（2026-08-17）新增排课订课后仍显示可预约——详情页/首页缺 onShow 刷新（服务端数据正确，纯前端展示问题）→ ✅ 已修复（BUG-LEDGER #35：详情页 onShow 重拉 loadSession + 首页 onShow 重拉 loadTodayCourses；FRONT-01/02 静态断言防回退）
- [x] #14（2026-08-17）管理访问码保护遗漏 `/api/admin/coach-assign`——#8 修复（065968e）的 ADMIN_PATHS 未包含该路由（仅含 courses/sessions/admin-sessions/admin-invite-board），生产探测：带错 Admin-Token 访问该接口返回 400 参数校验而非 401 = 未受保护。web 管理网页「教练分配」接口可被任何人调用（可绕过访问码改教练分配）。修复方向：把 POST /api/admin/coach-assign 加入 ADMIN_PATHS。**连带发现：生产 ADMIN_TOKEN 环境变量未配置**（受保护路由带错 token 均 400 而非 401），需在云托管控制台配置。✅ 已修复（BUG-LEDGER #14：ADMIN_PATHS 补齐 + ADMIN-06/07 回归；生产 ADMIN_TOKEN 已确认配置——035 部署后无 token 访问 admin 接口 401）
- [ ] #13（2026-08-16）扫码签到后显示"无教练权限"
- [ ] #12（2026-08-16）点击教练模式下"我的学员"，会显示接口不存在；点击"结算"也是一样的报错。→ 已排查：前后端路径完全匹配（api.js ↔ index.js 路由表），本地 150/150 含 COACH 用例全绿——**根因是云托管后端仍为旧镜像**（001e776 之前的代码无 /api/coach/* 新路由），与 #8 同根因（服务端未部署）；**已验证（2026-08-16 上午云端 API 探测）**：070f0ed 重建完成，settlement 200 / students 404 业务拦截 / notes 400 参数校验 / coach-assign 400 参数校验，新路由全部在线——旧镜像根因消除。**待真机最终确认**（#13 真机复核时一并验）

## dev 中发现（压测任务，已修复）

- [x] #57（2026-08-18，压测任务发现，含 3 个子问题）① 订课并发超卖：支付无容量闸门，500 并发下容量 10 的课 256 人支付成功（P0 资金/数据安全）→ ✅ 已修复（BUG-LEDGER #57：原子容量闸门 `booked_count < capacity` 三处占位 + 满员拒绝订单作废防 pending 死锁）；② 下单 pending 查重竞态：读-判-插非原子残留多笔 pending → ✅ 加锁防重（driver beginExclusive/getExclusive：SQLite BEGIN IMMEDIATE / MySQL FOR UPDATE）；③ 压测工具自身 13 条断言参数错位全假绿（check 调用 4 参，描述字符串被当 ok 恒真）→ ✅ 已修复断言参数；回归：SEC-05 四断言 + 压测 A/B 场景双模式 13/13

## 待确认

- [x] #51（2026-08-18）课程详情页面顶部后退按钮样式与「我的课程」页面不一致——要求：课程详情页后退按钮采用「我的课程」页同款样式，且所有其他含后退按钮的页面统一该样式（全局导航返回样式对齐）→ ✅ 已修复（BUG-LEDGER #51：detail 返回钮改白底+标准 icon-back 深色箭头，coach-profile 去「‹」字符统一 icon-back；FRONT-15 回归）
- [x] #52（2026-08-18）课程详情页 + 教练详情页顶部「分享」按钮删除（两页顶部导航多余按钮清理）。**已按 #53 撤销（用户拍板：修好分享而非删除）**。教练详情页顶部现状无分享按钮，无需处理
- [x] #53（2026-08-18）课程详情页「分享」按钮无效——点击无反应，应拉起微信转发（onShareAppMessage 拉起朋友列表选人分享）→ ✅ 已修复（BUG-LEDGER #53：open-type="share" 必须放 button 组件，view 上无效；两处分享入口改 button + 样式 reset；FRONT-13 回归）
- [x] #54（2026-08-18）个人中心「换头像 → 选择微信头像」报「微信版本过低，无法使用微信头像」——chooseAvatar 兼容性问题（基础库 <2.21.2 或隐私接口授权异常；app.json 已声明 requiredPrivateInfos）→ ✅ 已修复（BUG-LEDGER #54：低版本自动降级相册选图，不再报错阻断；FRONT-14 回归）
- [x] #55（2026-08-18）会员等级页：青铜 98 折下面那行「0节课起」改为「任意储值」→ ✅ 已修复（member-level WXML 文案，FRONT-16 回归）
- [x] #56（2026-08-18）会员等级页：合适位置加一句话「任意储值成为会员，多上课程升级会员」→ ✅ 已修复（等级权益标题下加 sec-sub 副标语，FRONT-16 回归）
- [x] #10（2026-08-16）现在10:30，应该可以签到11:00的课，但显示不行，说时间未到。（注：钩子自动登记时编号误作 #2，与 8-15 已修复的 #2 重复，已人工改为 #10）→ ✅ 已修复（BUG-LEDGER #28：云托管容器 UTC 时区致签到窗口差 8 小时；另修 student-my-courses 课后窗口 +120→+30 及过期文案）

- [x] #7（2026-08-16）预约页面和教练详情页面的日期条：应从今天开始显示（含今天）未来 7 天，过去的日期不显示 → ✅ 已修复（BUG-LEDGER #26；教练详情页本已正确，仅预约页修复）
- [x] #8（2026-08-16）后台页面还没有部署到云托管 → ✅ 已修复（2026-08-17，两段）：① 根因 = Dockerfile 漏打包 web/，云托管访问 / 404（已加 COPY web/，commit cc3362c）；② 安全加固 = 管理网页加访问码（ADMIN_TOKEN 环境变量校验 web 专属管理接口，commit 065968e，ADMIN-01~05 + coverage 探针）。**待新镜像上线后真机访问 / 验证**（课程设定/排表/邀请看板/营收统计，弹访问码输入）
- [x] #9（2026-08-16）coverage 探针「邀请看板」断言假红（断言挂在被覆盖的响应上，master 已有）→ ✅ 已修复（BUG-LEDGER #27，dev 过程中发现并修复）

## 已修复

- [x] #6（2026-08-16）登录就会成为新的号（P0 数据安全）→ ✅ 代码+文档就绪（BUG-LEDGER #25），**待用户在云托管控制台挂载 CFS 到 /data + 配置 DB_PATH/WX_APPID/WX_SECRET 后真机验证**
- [x] #5（2026-08-16）登录服务器显示登录失败（真机，云托管模式）→ ✅ 瞬态（Git 部署重建窗口），登录失败弹窗加重试按钮（BUG-LEDGER #24）
- [x] #4（2026-08-15）教练详情页面底部的"约 TA 的课"按钮删除 → ✅ 已修复（BUG-LEDGER #22）
- [x] #3（2026-08-15）教练详情页面，课程条的UI调整一下，左侧是时间不变，右侧改为3行，第一行是黑体大字课程名字，第二行是普通中等字体场馆信息，第三行是席位信息。→ ✅ 已修复（BUG-LEDGER #21）

- [x] #1（2026-08-15）教练详情页面，对于时间已经过去，包括已经在进行中的课程，是不应该显示出来的。→ ✅ 已修复（BUG-LEDGER #19）
- [x] #2（2026-08-15）教练详情页面，席位的展示信息应该是"已经预订的席位/总席位" → ✅ 已修复（BUG-LEDGER #20）
