# 双方言迁移检查清单（SQLite ↔ MySQL）

> 从 BUG-LEDGER #29-#34 连续 6 个 MySQL 部署炸弹中提炼。
> **每次变更 SQL / 建表语句 / 数据库驱动层前，必须逐条对照本清单。**
> 静态断言能拦「已知错误写法」，但首次建表和新业务 SQL 只能靠人工对照。

---

## 一、DDL 建表

| # | 检查项 | 错误示例 | 正确写法 | 来源 |
|---|--------|----------|----------|------|
| D1 | **保留字必须反引号** | `change INT NOT NULL` | `` \`change\` INT NOT NULL `` | #32 |
| D2 | `date` 作列名时加反引号 | `date TEXT NOT NULL` | `` \`date\` TEXT NOT NULL `` | #32 |
| D3 | `role` 作列名时加反引号（MySQL 8.0 保留字） | `role TEXT` | `` \`role\` TEXT `` | #32 |
| D4 | **时间默认值不能用 SQLite 表达式括号** | `VARCHAR(19) DEFAULT (CURRENT_TIMESTAMP)` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | #31 |
| D5 | **索引定义中的保留字列名也要反引号** | `KEY idx(date, status)` | `` KEY idx(\`date\`, status) `` | #32 |

## 二、业务 SQL

| # | 检查项 | 错误示例 | 正确写法 | 来源 |
|---|--------|----------|----------|------|
| S1 | **禁止 `last_insert_rowid()`** | `SELECT ... WHERE id = last_insert_rowid()` | 用 `driver.run()` 返回的 `r.lastInsertRowid` 传参 | #33 |
| S2 | **字符串拼接不能用 `||`**（MySQL 下是 OR） | `date || '_' || start_time` | JS 侧拼接 `` `${date}_${start_time}` `` | #32 |
| S3 | **裸保留字列名必须加反引号** | `WHERE date = ?` | `` WHERE \`date\` = ? `` | #32 |
| S4 | **LIMIT 语法** | SQLite/MySQL 兼容（无需改动） | — | — |

## 三、驱动层 / 连接池

| # | 检查项 | 错误示例 | 正确写法 | 来源 |
|---|--------|----------|----------|------|
| C1 | **mysql2 必须 `dateStrings: true`** | 默认返回 JS Date 对象 | `createPool({ dateStrings: true })` 返回字符串 | #31 |
| C2 | **connection 事件回调用 callback 风格** | `conn.query("SET ...").catch(...)` | `conn.query("SET ...", () => {})` | #29 |
| C3 | **require 路径** | `require('mysql2')` | `require('mysql2/promise')` | #29 |

## 四、进程生命周期

| # | 检查项 | 错误示例 | 正确写法 | 来源 |
|---|--------|----------|----------|------|
| L1 | **模块加载期不能查表** | 顶层 IIFE `db.query(...)` | 函数内 `await driver.ready` 自守门闩 | #30 |
| L2 | **脚本类进程必须显式退出** | `seed.js` 靠事件循环空转退出 | `process.exit(0)` | #34 |
| L3 | **启动链不依赖前一进程退出** | `CMD seed.js && index.js` | `CMD node index.js`（进程内 `await seed.run()`） | #34 |

## 五、测试盲区提醒

| # | 提醒 | 说明 |
|---|------|------|
| T1 | **本地 SQLite 全绿 ≠ MySQL 能用** | 保留字、方言函数、连接池行为全部只在 MySQL 暴露 |
| T2 | **静态断言只拦已知写法** | 新增 SQL 必须人工对照本清单，不能只靠 MYSQL-xx 断言 |
| T3 | **首次建表必须盯启动日志** | 建表完成/seed 失败是关键信号，不能只看 health 200 |
| T4 | **方言审计命令** | `grep -n "last_insert_rowid\|strftime\|datetime.*localtime\|'\\|\\|'" server/db/*.js` |

---

*创建：2026-08-18。来源：BUG-LEDGER #29-#34（MySQL 部署连续 6 弹）。每次新增 SQL 变更时对照。*
