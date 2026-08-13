# CONVENTIONS.md · 项目开发约定

> 本文件是「与 AI 协作开发」的契约。**强制规矩由机制保证，不是口头约定**。
> 适用：本项目所有代码改动（含 AI 会话）。

---

## 🚦 强制规矩（机制强制，不可口头跳过）

| # | 规矩 | 强制机制 | 绕过方式 |
|---|---|---|---|
| 1 | **改代码先测、红不提交** | `.githooks/pre-commit`：`git commit` 时自动跑 `minitest/run-tests.js`（81 项，**干净库模式**：全新 schema + seed + 独立端口，不依赖开发后端、不污染开发库），未全绿 → 提交被拒 | 仅 `git commit --no-verify`（故意为之，需确认） |
| 2 | 关键操作必须留痕 | `server/logger.js` 的 `logOp()`：支付/充值/退款/兑换/签到 5 类操作写入 `server/logs/ops.log`（含单号/金额/结果） | 不可绕过（新关键操作须补埋点） |
| 3 | 钱的计算前后端同一规则 | 会员价 = 原价 × 折扣，**向下取整到元**（前端展示与后端扣款同公式） | 不可绕过（改规则须同步改两端 + 测试） |
| 4 | 新接口 = 新测试 + 探针 | 每个新 API 至少 1 条断言进 `run-tests.js`，并加 1 行到 `coverage.test.js` 探针 | 不可绕过（review 检查） |
| 5 | **断言破坏必须告知** | 验证中临时破坏断言 → 必须：① 验证后立即恢复 ② 在会话回复中明确告知（破坏了什么、如何恢复、恢复后的验证结果） | 不可绕过（信任基石） |
| 6 | **验证必须看完整输出+退出码** | 任何测试/脚本验证，禁止用 grep 过滤输出代替退出码判断（L2 教训：探针失败被 grep 掩盖 1 个月） | 不可绕过（review 检查） |
| 7 | **新 bug 必修双保险** | 每个被发现的真 bug：① 加回归测试（run-tests.js 或 coverage.test.js 至少 1 条断言）② 登记 `BUG-LEDGER.md` 五要素（现象/根因/修复/回归测试/防护层）③ commit message 引用台账编号 | 不可绕过（review 检查） |

## 🔒 对用户的承诺（勿忘 · 完成时通知）

| 承诺 | 触发 | 完成时动作 |
|---|---|---|
| **L2 推送验证（CI）** | push 后自动跑测试+覆盖率（TODO.md P1 条目） | 通知用户：已上线 + 报告位置 |
| **L3 发布闸门** | 首次正式发布前，按 DoD 全量打勾 + 真机手测 | 通知用户：闸门清单结果 |
| **里程碑提醒** | 每周日 10:00 自动化任务检查 TODO 进度 | 汇报 L2/L3 状态与下一步 |

> 保证机制：TODO.md 状态机 + 本契约 + 项目 MEMORY.md + 每周自动化检查任务（automation），四重冗余，任何一层被看到都不会忘。

## 📐 结构与命名

- **后端**：路由分发在 `server/index.js`（`handle*` 函数），业务逻辑按域拆分在 `server/db/`（users/coin/members/invite/courses/messages/orders/bookings 八域），连接与建表在 `server/db-core.js`，`server/db.js` 为纯聚合入口；`server/index.js` 用声明式路由表 `API_ROUTES` 分发（字符串精确 + 正则匹配）
- **命名**：函数/变量 camelCase；接口路径 `/api/名词` 小写；测试用例编号 `域-序号`（如 `MEM-12`）
- **金额单位**：库/接口统一 **分（fen）**，前端展示转元；禁止混用

## 🔧 重构/拆分必须遵守（防坑清单，详见 skill: safe-refactor）

1. 拆分前 grep 全部全局常量在**所有区域**的引用（声明归属单独决策，防止"夹带搬走"）
2. 提取用**锚点文本匹配**，不用行号 skip；拆后查重复声明、补回丢失声明
3. 模块互相调用 → `dbMod.xxx` **惰性访问**（函数体内），禁止顶层解构循环依赖
4. 验证三连：`node --check` → 重启 → 全量测试全绿 → 提交（hook 再拦一道）

## ✍️ 提交信息格式

```
类型: 简述（中文，动词开头）
类型 = feat(功能) | fix(修复) | style(样式) | docs(文档) | refactor(重构) | test(测试) | chore(杂项)
示例：fix: 上课页已完成tab空白根因——dataset.idx字符串未转数字
```

## 🔍 错误处理

- 接口响应统一 `{ code, message, ... }`，通过 `sendJson` 输出
- 失败分支：先 `logOp(..., 'fail')` 再返回错误；不允许静默吞错（空 catch 需注释原因）

## 🧪 测试与验证流程（每次改动）

1. `DB_PATH=/tmp/gym-test-clean.db node minitest/run-tests.js`（干净库模式：seed + 独立后端 + 81 项，跑完自动清理；不传 DB_PATH 则连外部后端如 3000，用于调试）
2. 覆盖率：`node --test --experimental-test-coverage minitest/coverage.test.js`
3. 关键交互（支付/签到）改动后，附真机手测（见 DEFINITION-OF-DONE.md）
4. 验证必须看完整输出 + 退出码（强制规矩 #6，grep 过滤会掩盖失败）

## 📄 关联文档

- `DEFINITION-OF-DONE.md` — 消费级验收清单（上线前逐项打勾）
- `BUG-LEDGER.md` — 缺陷台账（每个真 bug 五要素登记 + 回归测试引用）
- `minitest/TESTCASES.md` / `minitest/TEST-REPORT.md` — 测试用例与报告
- `README.md` — 项目总览与启动方式
