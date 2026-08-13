# CONVENTIONS.md · 项目开发约定

> 本文件是「与 AI 协作开发」的契约。**强制规矩由机制保证，不是口头约定**。
> 适用：本项目所有代码改动（含 AI 会话）。

---

## 🚦 强制规矩（机制强制，不可口头跳过）

| # | 规矩 | 强制机制 | 绕过方式 |
|---|---|---|---|
| 1 | **改代码先测、红不提交** | `.githooks/pre-commit`：`git commit` 时自动跑 `minitest/run-tests.js`（77 项），未全绿 → 提交被拒 | 仅 `git commit --no-verify`（故意为之，需确认） |
| 2 | 关键操作必须留痕 | `server/logger.js` 的 `logOp()`：支付/充值/退款/兑换/签到 5 类操作写入 `server/logs/ops.log`（含单号/金额/结果） | 不可绕过（新关键操作须补埋点） |
| 3 | 钱的计算前后端同一规则 | 会员价 = 原价 × 折扣，**向下取整到元**（前端展示与后端扣款同公式） | 不可绕过（改规则须同步改两端 + 测试） |
| 4 | 新接口 = 新测试 + 探针 | 每个新 API 至少 1 条断言进 `run-tests.js`，并加 1 行到 `coverage.test.js` 探针 | 不可绕过（review 检查） |

## 📐 结构与命名

- **后端**：路由分发在 `server/index.js`（`handle*` 函数），业务逻辑在 `server/db.js`（`db.*` 函数），配置独立文件（`member-config.js`/`energy-config.js`/`shop-items.js`）
- **命名**：函数/变量 camelCase；接口路径 `/api/名词` 小写；测试用例编号 `域-序号`（如 `MEM-12`）
- **金额单位**：库/接口统一 **分（fen）**，前端展示转元；禁止混用

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

1. `node minitest/run-tests.js http://127.0.0.1:3000`（或直接 `git commit` 让 hook 跑）
2. 覆盖率：`node --test --experimental-test-coverage minitest/coverage.test.js`
3. 关键交互（支付/签到）改动后，附真机手测（见 DEFINITION-OF-DONE.md）

## 📄 关联文档

- `DEFINITION-OF-DONE.md` — 消费级验收清单（上线前逐项打勾）
- `minitest/TESTCASES.md` / `minitest/TEST-REPORT.md` — 测试用例与报告
- `README.md` — 项目总览与启动方式
