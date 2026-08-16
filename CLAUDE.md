# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

综合训练馆订课系统：微信小程序（学员端/教练端/管理后台）+ Node.js 后端 + SQLite。全部原生 JS，零 npm 依赖。项目文档、commit message、会话语言均为中文。

**开发前必读**（按优先级）：`CONVENTIONS.md`（与 AI 协作的契约，强制规矩）、`TECH-STACK.md`（后端架构）、`ENVIRONMENTS.md`（4 环境规范）、`BUG-LEDGER.md`（缺陷台账）、`BUGS-INBOX.md`（bug 收件箱）、`DESIGNS-INBOX.md`（设计需求收件箱）、`DEV-BACKLOG.md`（开发任务清单）、`DATA-MODEL.md`、`DESIGN-SYSTEM.md`（改样式前必读）、`TODO.md`（状态机：`[ ]` 未开始 / `[~]` 进行中 / `[x]` 完成，P0/P1/P2 优先级）。

## 三阶段工作流（design → dev → bug）

**design（技能 `design-system`）**：用户输入 `design：需求` → `capture-design.js` 钩子自动登记到 `DESIGNS-INBOX.md`（编号 #Dn）→ 追问澄清细节 → 写设计文档（界面设计 + 程序架构）→ 与用户确认界面和架构 → 确认后把任务写入 `DEV-BACKLOG.md`。**确认前不写业务代码**。

**dev（技能 `dev-system`）**：用户说"开始dev" → 按 `DEV-BACKLOG.md` 任务逐条实现 → 每步测试（node --check + minitest 干净库）→ 完成标 [x] → git commit（引用 `DESIGN #Dn`，不 push）。

**bug（技能 `bug-system`）**：

- 用户输入 `bug：描述` → `.claude/hooks/capture-bug.js`（UserPromptSubmit 钩子）自动登记到 `BUGS-INBOX.md`；描述不清先追问，禁止瞎修；**只登记不修复**——必须等用户说"修bug/开始修"才动手（2026-08-15 用户明确要求）
- 用户授意（"修bug"）后：逐条 查根因→修复→测试（node --check + minitest 干净库）→更新 `BUG-LEDGER.md`（五要素）→收件箱标 ✅→git commit（引用 `BUG-LEDGER #N`，不 push）

## 常用命令

```bash
# 后端启动（Node ≥22.5，必须，node:sqlite 内置模块）
cd server && node index.js        # 或 npm start / npm run dev（--watch）；端口 3000
# Windows 一键：双击 server/start-server.bat；公网隧道：start-cpolar-tunnel.bat（域名重启会变）

# 数据初始化（幂等）
node server/seed.js               # 基础数据（课程/场次/配置）
node server/seed-fake-users.js    # 假用户测试数据

# 测试（两种模式）
DB_PATH=/tmp/gym-test-clean.db node minitest/run-tests.js   # 干净库模式：临时库+独立端口+自动清理，首选
node minitest/run-tests.js http://127.0.0.1:3000            # 连已有后端（调试用）
node --test --experimental-test-coverage minitest/coverage.test.js  # 覆盖率探针

# 语法检查（重构/拆分后必做）
node --check server/index.js
```

- **pre-commit hook 强制**（`git config core.hooksPath .githooks`）：commit 自动跑干净库全量测试，红则拒绝提交；绕过仅限故意为之的 `--no-verify`。注意 hook 用 `/tmp/gym-test-clean-$$.db`（进程号后缀，并行会话互不踩）。
- **CI（L2 闸门）**：`.github/workflows/ci.yml`，push/PR 到 master 自动跑测试+覆盖率。
- 验证测试**必须看完整输出 + 退出码**，禁止用 grep 过滤掩盖失败（强制规矩 #6，历史教训）。

## 架构

```
miniprogram/  原生微信小程序（WXML/WXSS/JS，无 npm 依赖，34+ 页）
  ├─ app.json（含 requiredPrivateInfos: ["chooseAvatar","nickName"]，隐私接口声明缺失会导致授权静默失败）
  ├─ pages/   学员端/教练端/管理后台（登录页按角色分流）
  ├─ utils/api.js    ← 唯一地址配置源：FALLBACK_BASE_URL / USE_TCB / TCB_ENV / TCB_BASE_URL
  ├─ utils/i18n.js  中英双语
  └─ custom-tab-bar/ 官方自定义 tabBar

server/   Node 原生 http（无 Express/Koa），手写路由
  ├─ index.js        入口 + 声明式路由表 API_ROUTES（server/index.js:961）+ handle* 函数
  ├─ db.js           数据层聚合入口（纯导出）
  ├─ db-core.js      SQLite 连接（node:sqlite DatabaseSync 同步 API）+ 18 张表建表
  ├─ db/*.js         领域模块：users/courses/bookings/orders(含 waitlist 候补)/passes/members/coin/invite/messages/achievements
  ├─ logger.js       logOp() 关键操作留痕 → logs/ops.log
  ├─ member-config.js / energy-config.js / shop-items.js  配置单源
  ├─ seed.js / seed-fake-users.js
  └─ .env            WX_APPID / WX_SECRET（gitignore，不入库）

cloudfunctions/  预留微信云开发（login/users），当前未启用（USE_CLOUD=false）

minitest/   自研测试（无 jest/mocha）：run-tests.js 原生断言 + HTTP + 直连 SQL 验证；coverage.test.js 探针
web/        设计稿 HTML 原型（不参与小程序构建）
Dockerfile  微信云托管镜像（零 npm install；容器启动先 node seed.js 再 node index.js）
```

**数据流**：小程序 `wx.cloud.callContainer`（云托管模式，`USE_TCB=true`，走微信私有协议无需配置合法域名）或 `wx.request`（本地/cpolar）→ `server/index.js` 路由 → `db/` 领域模块 → SQLite `server/data/gym.db`（WAL + 外键 + timeout=5000）。

**关键约定**：
- **金额单位：库/接口统一分（fen）**，前端展示转元，禁止混用。
- 会员价 = 原价 × 折扣，**向下取整到元**，前后端同公式。
- 模块互相调用用 `dbMod.xxx` 惰性访问（函数体内），禁止顶层解构（循环依赖）。
- 接口统一 `sendJson(res, status, { code, message, ... })`；失败分支先 `logOp(..., 'fail')` 再返回，不静默吞错。
- 测试用例编号 `域-序号`（如 MEM-12）。

## 强制规矩（CONVENTIONS.md 契约，不可跳过）

1. **改代码先测、红不提交**（hook 强制）。
2. **新接口 = 新测试 + coverage 探针**（run-tests.js 至少 1 条断言 + coverage.test.js 1 行）。
3. **新 bug 必修双保险**：回归测试 + 登记 `BUG-LEDGER.md`（现象/根因/修复/回归测试/防护层 五要素）+ commit message 引用台账编号。
4. **支付退款严格对称（钱闭环）**：任何支付方式都必须扣款；退款金额严格等于实付金额；实付=扣款=退款三者一致（BUG-LEDGER #9 教训）。
5. **签到是唯一"实际到课"证明**（B1）：成长指标只统计签到成功的课。签到窗口：开课前 30 分钟～课后 2 小时（后端服务器时钟裁决，前后端双层）。涉及签到/统计/结算的改动必先对照 B1-B3。
6. 钱的计算（支付/充值/退款/兑换/签到）必须走 `logOp()` 留痕。
7. **断言破坏必须告知**：临时破坏断言 → 验证后立即恢复 + 在回复中明确告知。
8. commit 格式：`类型: 简述（中文，动词开头）`，类型 = feat/fix/style/docs/refactor/test/chore。

## 环境与部署

4 个环境（ENVIRONMENTS.md）：① 本地开发（127.0.0.1:3000）② CI（GitHub Actions 干净库）③ 预发布（真机预览）④ 生产（微信云托管，当前形态）。**四环境数据库互相独立，迁移只能走脚本**。

**地址配置**：后端地址唯一人工配置点 = `miniprogram/utils/api.js` 的 `FALLBACK_BASE_URL`（net-config.json 已废弃，勿用它）。当前为云托管公网域名 `https://gym-server-297498-11-1469244356.sh.run.tcloudbase.com`。真机/公网切换只改这一处 + 重新编译。

**生产形态（2026-08-15 起）**：微信云托管（Docker + `wx.cloud.callContainer`，`USE_TCB=true`）。容器内文件（头像/封面转存到 `/images/`）需通过 `api.toFullUrl()` 拼公网域名才能显示——本地模式返回相对路径，云托管模式拼 `TCB_BASE_URL`。

**⚠️ 云托管持久化（必读，BUG-LEDGER #25）**：容器文件系统不持久化——闲置缩容/推送重建后 SQLite 数据全丢，用户每次登录变"新的号"。**生产数据库必须挂 CFS 到 `/data` + 环境变量 `DB_PATH=/data/gym.db` + 配置 `WX_APPID`/`WX_SECRET`**（容器无 server/.env，gitignore 排除）。操作步骤见「云托管持久化与身份配置.md」；未完成前勿做正式数据迁移。

## 已知坑

- **Node ≥22.5**（node:sqlite），旧版本直接报模块不存在。
- **容器时区（BUG-LEDGER #28，严重）**：云托管容器 `node:22-alpine` 默认 **UTC**，裸 `new Date().getHours()` 等取时间会差 8 小时（签到窗口/次卡/候补过期判定全错位）。Dockerfile 已固定 `TZ=Asia/Shanghai` + 业务代码统一走 `server/time.js`（显式北京时区，双保险）。**新代码取「当前时间」必须用 time.js（CONVENTIONS 规矩 #9）**；本地验证方式：`TZ=UTC DB_PATH=/tmp/gym-test-clean.db node minitest/run-tests.js`（模拟容器时区跑全量，150 用例须全绿）。
- **新增页面报 `WXML file not found: ./pages/xxx/index.wxml`（`__route__ is not defined` 为连锁报错）**：本地文件/注册通常没问题，是开发者工具编译缓存未刷新——工具 → 清缓存 → 全部清除 → 重新编译；仍不行再检查打开的项目目录是否是 miniprogram 所在项目、git 是否已拉到最新（2026-08-16 真机排障）。
- **SQLite 多进程写锁**：测试直连 + 后端进程同写一库会 readonly/locked。测试尽量用干净库模式（DB_PATH 临时库）。
- ~~测试号限制~~（已解除）：project.config.json 已换正式号 AppID `wx0aee5332d4ef20fd`（2026-08-15），可上传发布。
- **cpolar 隧道域名重启会变**，需同步 FALLBACK_BASE_URL + 小程序合法域名（当前已切云托管，此坑仅本地测试时存在）。
- **本地 git 对象库损坏（当前状态）**：本地 `.git` 对象库已损坏（`git status`/`commit` 报 `Could not read cdc354875` 等），**本地 git 命令不可用属预期**。远端历史已接回（master=070f0ed，2026-08-16 push 成功）。当前提交流程：改动在工作区完成后，同步到干净 clone `/tmp/gym-remote`（`cd /tmp/gym-remote && rsync/git 工作区差异`）再 commit+push。根治：用 `/tmp/gym-remote/.git` 替换本地 `.git`（工作区文件保留）或重新 clone。**替换前勿删本地工作区文件。**
- **云托管 push 后重建窗口（BUG-LEDGER #12/#24）**：push 到 master 触发云托管自动重建，重建期间（数分钟）接口 404/登录失败属预期，且**重建完成前访问的是旧镜像**——真机报"接口不存在/旧功能"时先确认重建完成再排查代码（#12「教练学员/结算接口不存在」根因即旧镜像，代码本地 150/150 全绿）。登录失败弹窗已加重试按钮自助重试。
- 支付/订课/候补在 `BEGIN...COMMIT` 事务内，异常回滚；幂等防重（下单查 pending 订单、支付查 booked 记录、前端防连点锁）。
