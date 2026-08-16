# MySQL 持久化迁移设计方案（#25 根治）

> 2026-08-16 立项。用户决策：**B. 迁移环境 MySQL**（微信云托管无 CFS 挂载能力已确认，A 方案备份恢复仅半程，B 为根治）。
> 目标：SQLite → 微信云托管内置 MySQL（Serverless 版），容器无状态化，重建/缩容零数据丢失。

## 一、背景与根因

| 问题 | 根因 |
|---|---|
| 登录变"新的号"（BUG-LEDGER #25） | 云托管容器文件系统**不持久化**——闲置缩容/推送重建/扩容都创建全新容器，`server/data/gym.db` 全丢 |
| 真机"无教练权限"等（#13） | 同为重建后库重置 |
| 旧镜像反复误判（#12/#8） | 重建窗口内访问的是旧容器（与持久化正交，已有冒烟脚本防护） |

**已验证路线**：CFS 文件存储（云托管无挂载入口，弃）、静态资源存储（文件上传服务非 POSIX 挂载，SQLite 无法运行，弃）、环境 MySQL（左侧菜单内置，Serverless 版，同环境容器内网直连 —— ✅ 采纳）。

## 二、方案总览

```
小程序 ── wx.cloud.callContainer ──> 云托管容器（无状态） ── mysql2 ──> 环境内置 MySQL（内网）
                                        │
                                        ├─ server/db-driver.js  ← 新增抽象层，双驱动
                                        │      ├─ SQLite 驱动（node:sqlite 同步包 async）→ 本地/测试/CI
                                        │      └─ MySQL 驱动（mysql2 连接池）→ 生产（DB_DRIVER=mysql）
                                        ├─ db/*.js + index.js（async 化，313 处调用点）
                                        └─ seed.js（容器启动建库 → MySQL 建表 + 基础数据）
```

核心思想：**业务代码不感知数据库**——所有 DB 访问走 `db-driver.js` 统一接口（`get/all/run/tx`），方言差异收敛在 db-driver + db-core 两层。SQLite 驱动保留干净库测试模式（150 用例零外部依赖），MySQL 驱动服务生产。

## 三、技术决策

### D1 双驱动抽象层（db-driver.js）—— 采纳
- **理由**：本地测试/CI 无需起 MySQL；干净库测试模式（临时库+seed+独立端口）原样保留；方言差异隔离在两处（建表、时间函数），业务 SQL 尽量写双方言兼容语法
- **接口**（全部 async）：
  - `get(sql, params)` → 首行对象 | undefined（SQLite `get` / MySQL `rows[0]`）
  - `all(sql, params)` → 行数组
  - `run(sql, params)` → `{ changes, lastInsertRowid }`（SQLite `changes/lastInsertRowid` ↔ MySQL `affectedRows/insertId`）
  - `exec(sql)` → 多条语句（仅建表/seed 用；MySQL 逐条执行，规避 multipleStatements）
  - `tx(async fn)` → 事务（SQLite `BEGIN/COMMIT/ROLLBACK` 语句；MySQL `connection.beginTransaction()`）
- **驱动选择**：`process.env.DB_DRIVER === 'mysql'` → mysql2 连接池（`MYSQL_ADDRESS`/`MYSQL_USERNAME`/`MYSQL_PASSWORD` 解析 host:port，库名 `gym`）；默认 SQLite（DB_PATH 现有逻辑不变）
- 惰性初始化 + 只初始化一次（与现有 db-core 风格一致）

### D2 驱动：mysql2 —— 采纳
- Node 官方推荐 MySQL 驱动，promise API 原生，纯 JS（无编译依赖），活跃维护
- **首次引入 npm 依赖**：项目哲学从「零 npm 依赖」→「生产依赖仅 mysql2」。Dockerfile 加 `npm install mysql2`（构建期联网，构建速度影响 <1 分钟）

### D3 时间处理：不依赖数据库时间函数
- 现有 89 处 SQL 内 `datetime()/date()/time()`：`datetime('now','localtime')` 类 → 业务层 `time.js` 传参（**符合规矩 #9**，且与 MySQL `NOW()` 时区无关）
- 唯一真难点：`orders.js:543-545` 候补过期判定 `datetime(s.date || ' ' || s.start_time, '-60/-120 minutes')` → 改业务层计算后传参比较（`nowDateTimeStr()` vs 计算出的过期时刻字符串比较，字符串格式 `YYYY-MM-DD HH:MM` 两库可比）
- 收益：SQL 双方言可共用一套模板，方言点只剩建表

### D4 建表：双方言双份
- `db-core.js` 现有 SQLite 建表保留（本地/测试）；新增 MySQL 版建表（18 张表全量一次建齐，**无 ALTER 兼容段**——新库无需旧库升级逻辑）
- 方言映射：`AUTOINCREMENT`→`AUTO_INCREMENT`；`TEXT PRIMARY KEY` 兼容（MySQL 需指定长度 `VARCHAR(64)`，openid/booking_no 等长度已确认 ≤64）；`REAL`→`DOUBLE`；布尔 → `TINYINT(1)` 0/1；默认值 `datetime('now','localtime')` → 列默认 NULL + 业务层赋值（MySQL 默认值不能是表达式）
- 时间列统一存 `VARCHAR(19)`（`YYYY-MM-DD HH:MM:SS` 字符串），与 SQLite TEXT 行为一致，字符串比较即时间比较

### D5 方言点收口表
| 位置 | SQLite 写法 | 处理 |
|---|---|---|
| 建表 19 处 AUTOINCREMENT | 主键自增 | 建表双份时翻译 |
| orders.js:543-545 | `datetime(... '-60 minutes')` | 业务层算过期时刻传参 |
| INSERT OR IGNORE ×3 / ON CONFLICT ×1 | 插入防重 | `INSERT IGNORE`（MySQL 同语义） |
| strftime ×3 | 日期格式化 | 业务层 time.js |
| SQL 内 `\|\|` ×1（同上 orders 行） | 字符串拼接 | 随 D3 消失 |
| COALESCE ×14 | 两库兼容 | 不动 |
| LIMIT ? ×3 | 两库兼容（mysql2 预编译支持） | 不动 |

## 四、改造清单（按文件）

| 文件 | 改动 | 量级 |
|---|---|---|
| **server/db-driver.js**（新） | 双驱动抽象层 | ~150 行 |
| **server/db-core.js** | 建表双方言 + 驱动接入 | ~300 行改 |
| **server/db/*.js** ×11 | 259 处 prepare/get/run → driver 接口 + async | 大（分模块提交） |
| **server/index.js** | 54 处调用 + handle* 全 async + 启动初始化 | 大 |
| server/seed.js / seed-fake-users.js | async + MySQL 分支 | 中 |
| server/time.js | 新增 `addMinutesToStr()`（候补过期计算用） | 小 |
| minitest/run-tests.js | 断言 async + dbx 直连验证适配（SQLite 下继续用 dbx） | 中 |
| minitest/coverage.test.js | async 适配 | 小 |
| Dockerfile | `npm install mysql2` + 环境变量模板 | 小 |
| 云托管控制台 | 开通 MySQL + 环境变量（用户操作） | — |
| 迁移脚本（新，一次性） | 本地 SQLite 真实库 → 生产 MySQL（openid 字典序去重、金额分对齐） | ~200 行 |
| 文档 | CLAUDE.md（零依赖→仅 mysql2）、持久化手册改 MySQL 方向、CONVENTIONS（D9 时间规矩已涵盖）、评审文档待办 | 小 |

## 五、测试策略

1. **开发期全量**：`DB_PATH=/tmp/gym-test-clean.db node minitest/run-tests.js`（SQLite 驱动，150 用例全绿）——抽象层接口下 SQLite 路径 100% 覆盖业务逻辑
2. **MySQL 路径验证**（方言风险点集中在 db-driver/db-core 两层）：
   - 部署后 `deploy-smoke.sh` 扩展：登录 → 断言「欢迎回来」（数据落 MySQL 证据）+ 首次注册建号
   - 真机手测清单（DoD）：注册/订课/签到/教练结算走一遍后**推送触发重建** → 再登录验证数据仍在（#25 验收标准）
3. **CI**：保持 SQLite（GitHub Actions 起 MySQL 成本高于收益，方言层已隔离；如后续 MySQL 路径有 bug 复发再评估加 service）

## 六、分阶段计划（每阶段可提交可验证）

| 阶段 | 内容 | 验证 |
|---|---|---|
| **S1** | db-driver.js 抽象层 + db-core 接入 SQLite 驱动（纯重构，行为零变化） | 150 全绿 |
| **S2** | 时间函数改造（89 处）+ 候补过期业务层化 + INSERT IGNORE 等方言点 | 150 全绿 + TZ=UTC 全量 |
| **S3** | db/*.js async 化（按模块 3-4 个提交，每模块改完跑测试） | 逐步全绿 |
| **S4** | index.js + seed + minitest async 化 | 150 全绿 |
| **S5** | MySQL 建表双份落地 + Dockerfile + 控制台开通（用户）+ 环境变量 | 部署 + 冒烟 + 真机 |
| **S6** | 数据迁移脚本 + 生产迁移执行 + 文档收尾 | #25 验收：重建后数据在 |

## 七、风险与缓解

| 风险 | 缓解 |
|---|---|
| MySQL 路径本地无覆盖 → 上线即生产验证 | 方言收敛两层；S5 部署后立即冒烟（登录落库证据）+ 真机重建验证 |
| async 化连锁：漏改一处调用 → 未捕获 promise 错误 | 每模块改完立即跑全量；规则：所有 db 调用必须 await，driver 内错误统一 throw → handle* 外层 catch 返回 500 |
| 事务语义：SQLite BEGIN/COMMIT 与 MySQL 事务边界 | 抽象层 tx() 统一封装，业务代码不再手写 BEGIN/COMMIT |
| 云托管 MySQL Serverless 计费 | 按用量计费，当前量级可忽略；控制台可查费用 |
| 依赖哲学变化 | 仅 mysql2 一个生产依赖（纯 JS），本地/CI 测试路径仍零依赖 |
| 重建窗口旧镜像（#12 教训） | 冒烟脚本照旧；MySQL 数据不随容器走，重建无数据损失窗口 |

## 八、用户控制台操作（S5 前置，可先做）

1. 微信云托管控制台 → 左侧「**MySQL**」→ 开通（输入密码，开通数分钟）
2. 记下：内网地址（IP:3306 格式）、账号密码
3. 云托管控制台 → 服务 gym-server → 服务设置 → 环境变量新增：
   - `DB_DRIVER=mysql`
   - `MYSQL_ADDRESS=<内网IP>:3306`
   - `MYSQL_USERNAME=<root 或新建账号>`
   - `MYSQL_PASSWORD=<密码>`
4. 保存后等 S5 代码部署（环境变量随下次部署生效）

## 九、数据迁移（S6）

- 一次性脚本 `scripts/migrate-sqlite-to-mysql.js`：直连本地 SQLite 读全表 → 按建表顺序写入生产 MySQL（走云托管容器内执行或本地连外网地址，视开通情况定）
- 迁移前清理 seed-fake-users 假数据（有标记字段）；金额/时间格式逐表核对
- 迁移后验证：关键表行数对账 + 抽样用户登录验证
