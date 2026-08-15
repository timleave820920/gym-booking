# 后端技术栈文档

> 综合训练馆订课系统 · 后端
> 更新日期：2026-08-15

---

## 一、总体架构

```
┌─────────────────────────────────────────────────┐
│  前端小程序 (miniprogram/)                       │
│  - 原生微信小程序框架 (WXML/WXSS/JS)             │
│  - wx.request 调用后端 REST API                  │
│  - 地址唯一配置源：api.js FALLBACK_BASE_URL      │
└──────────────────┬──────────────────────────────┘
                   │ HTTP (JSON)
                   ▼
┌─────────────────────────────────────────────────┐
│  后端服务 (server/)                              │
│  - Node.js 原生 http 模块（无 Express 依赖）      │
│  - 手写 REST 路由分发（if-else 分支）             │
│  - 业务分层：index.js(路由) → db.js(聚合)        │
│    → db-core.js(SQLite) + db/xxx.js(领域模块)    │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  数据层                                          │
│  - SQLite（node:sqlite 内置模块，同步 API）       │
│  - 单文件库 server/data/gym.db                   │
│  - WAL 模式 + 外键约束 + timeout=5000            │
└─────────────────────────────────────────────────┘
```

## 二、核心技术栈一览

| 层次 | 技术 | 版本/说明 |
|---|---|---|
| **运行时** | Node.js | ≥22.5.0（使用内置 `node:sqlite`，旧版本无此模块） |
| **语言** | 纯 JavaScript（CommonJS） | 无 TypeScript |
| **HTTP 服务** | Node 原生 `node:http` / `node:https` | **无 Express/Koa 等框架**，手写路由分发 |
| **数据库** | SQLite（`node:sqlite` 内置模块） | 同步 API `DatabaseSync`，非第三方 better-sqlite3 |
| **登录鉴权** | 微信 jscode2session | 通过 `node:https` 调微信接口换 openid；`server/.env` 存 AppSecret |
| **配置文件** | 自研 `.env` 加载器 | 启动时读取 `server/.env`，不覆盖已有环境变量 |
| **日志** | 自研 `logger.js` | 关键操作日志落盘 `server/logs/` |
| **测试** | 自研脚本 `minitest/run-tests.js` | 无测试框架（无 jest/mocha），HTTP 断言 + 直接 SQL 验证 |
| **数据库初始化** | 自研 `seed.js` / `seed-fake-users.js` | 幂等重建基础数据 + 假用户 |
| **云函数** | `cloudfunctions/`（login/users） | 预留微信云开发能力，当前未启用 |

## 三、目录结构

```
server/
├── index.js              # 入口：HTTP 服务 + 路由分发 + 登录/健康检查
├── db.js                 # 数据层聚合入口（导出所有领域模块）
├── db-core.js            # SQLite 连接 + 建表（18 张表）+ 通用查询
├── logger.js             # 操作日志
├── member-config.js      # 会员等级/折扣配置
├── energy-config.js      # 能量币规则配置
├── shop-items.js         # 能量商店奖品配置
├── seed.js               # 基础数据初始化（幂等）
├── seed-fake-users.js    # 假用户测试数据
├── .env                  # WX_APPID / WX_SECRET（gitignore，不入库）
├── start-server.bat      # Windows 一键启动后端
├── start-cpolar-tunnel.bat # cpolar 公网隧道启动
└── db/                   # 业务领域模块（按域拆分）
    ├── users.js          # 用户
    ├── courses.js        # 课程/场次/教练/场馆
    ├── bookings.js       # 订课
    ├── waitlist.js       # 候补排位（或在 orders.js）
    ├── orders.js         # 订单/支付
    ├── passes.js         # 次卡包
    ├── members.js        # 会员等级/储值/充值
    ├── coin.js           # 能量币
    ├── invite.js         # 邀请奖励
    ├── messages.js       # 站内信
    └── achievements.js   # 成就系统
```

## 四、数据库设计

- **引擎**：SQLite，单文件 `server/data/gym.db`（DB_PATH 可覆盖）
- **模式**：WAL（允许并发读写）、`foreign_keys = ON`、`timeout = 5000`（多进程写等待锁）
- **表数量**：18 张
- **核心表**：

| 表 | 用途 |
|---|---|
| `users` | 用户（openid 唯一） |
| `courses` / `course_sessions` / `coaches` / `venues` | 课程体系 |
| `schedule_templates` | 排课模板（自动生成场次） |
| `bookings` | 订课记录 |
| `waitlist` | 候补排位 |
| `orders` | 订单（pending/paid/refunded） |
| `user_passes` / `class_packages` | 次卡包（次数包） |
| `member_recharges` / `balance_logs` | 储值余额 |
| `coin_logs` / `coin_exchanges` | 能量币 |
| `invitations` | 邀请奖励 |
| `messages` | 站内信 |
| `user_achievements` | 成就 |

## 五、API 设计

- **风格**：REST 风格，JSON 请求/响应
- **路由方式**：手写 if-else 分支分发（`server/index.js`，172 处相关处理）
- **统一响应**：`sendJson(res, status, { code, message, ...data })`
- **核心接口**：

```
POST /api/auth/login        注册/登录（code2session 换 openid）
POST /api/auth/profile      更新资料
POST /api/orders            下单（创建待支付订单）
POST /api/orders/:id/pay    支付回写（次卡优先 / 储值 / 微信模拟）
GET  /api/orders            我的订单
POST /api/bookings          订课
DELETE /api/bookings/:id    退订
POST /api/waitlist          候补
GET  /api/health            健康检查
```

## 六、关键设计决策

| 决策 | 说明 |
|---|---|
| **零第三方依赖** | 只用 Node 内置模块（http/sqlite/https/fs），部署免 npm install |
| **SQLite 而非 MySQL** | 单机部署、数据量小、免运维；WAL 支持并发 |
| **次卡优先支付** | 后端 `payOrder` 强制：有可用次卡 → `effMethod='pass'`（金额 0），不可跳过 |
| **事务保护** | 支付/订课/候补在 `BEGIN...COMMIT` 内，异常回滚 |
| **幂等防重** | 下单查 pending 订单 + 支付查 booked 记录 + 前端防连点锁（BUG-LEDGER #13） |
| **openid 身份** | 正式小程序 + `.env` AppSecret → 每用户独立 openid（2026-08-15 起） |
| **日志** | 关键资金操作（支付/退款/扣次）写操作日志 |

## 七、测试体系

- **脚本**：`minitest/run-tests.js`（无框架，原生断言）
- **两种模式**：
  - 干净库模式：`DB_PATH=xxx node minitest/run-tests.js`（自管临时库 + 独立端口后端）
  - 连已有后端：`node minitest/run-tests.js http://127.0.0.1:3000`
- **规模**：120+ 用例，覆盖注册/订课/候补/次卡/储值/能量币/邀请/消息全链路
- **金标准**：提交前 hook 跑全量，全绿才放行

## 八、部署形态

| 项 | 现状 |
|---|---|
| **本地开发** | `server/start-server.bat`（node index.js，端口 3000） |
| **公网访问** | cpolar 免费隧道（`server/start-cpolar-tunnel.bat`），随机域名 |
| **前端地址** | `miniprogram/utils/api.js` 的 `FALLBACK_BASE_URL`（唯一配置源） |
| **云开发** | `cloudfunctions/` 已预留（login/users），未启用 |
| **正式上线** | 待接入：固定域名隧道 / 云托管 / HTTPS 域名校验 |

## 九、环境变量

| 变量 | 说明 | 来源 |
|---|---|---|
| `WX_APPID` | 微信小程序 AppID（正式号 wx0aee5332d4ef20fd） | `server/.env` |
| `WX_SECRET` | AppSecret（登录换 openid 用） | `server/.env`（gitignore） |
| `PORT` | 服务端口（默认 3000） | 环境变量 |
| `DB_PATH` | 数据库文件路径（测试隔离用） | 环境变量 |
| `WX_APPID/SECRET` 兜底 | `server/index.js` 内硬编码正式 AppID | 代码 |

## 十、已知风险与待办

| 风险 | 说明 | 建议 |
|---|---|---|
| **SQLite 多进程写锁** | 测试脚本直连 + 后端进程同写一库会 readonly/locked | 已加 timeout=5000 缓解；测试尽量用干净库模式 |
| **cpolar 免费隧道域名会变** | 重启后域名变化，需同步 api.js + 后台合法域名 | 升级固定域名或接云托管 |
| **git 仓库历史分叉** | 本地重建根提交与远程历史未合并 | 网络恢复后 fetch → reset --mixed → 重提 |
| **手写路由分支多** | 172 处 if-else，维护成本高 | 后续可路由表化（已列入代码质量提升计划） |
