---
name: dev-system
description: "本项目开发工作流。当用户说「开始dev」「开始开发」「开始做」时使用。负责：①按 DEV-BACKLOG.md 待开发任务逐条实现 ②每步测试全绿（node --check + 干净库 minitest）③更新 BUG-LEDGER（如发现 bug）④完成标 [x] ⑤git commit（引用 DESIGN #Dn）。设计未确认（DESIGNS-INBOX 无 ✅）时先提醒用户走 design。"
---

# 开发工作流（dev-system）

本项目的设计→实现闭环。文件：`DEV-BACKLOG.md`（任务清单）→ 代码 → 测试 → commit。

触发词：用户说「开始dev」「开始开发」「开始做」。**前提**：任务已在 DEV-BACKLOG.md 且对应设计已确认（DESIGNS-INBOX 标 ✅）；若没有 → 提示用户先走 design-system。

## 一、开工前

1. **Read `DEV-BACKLOG.md`**：确认待开发任务清单 + 对应设计文档
2. **Read 对应设计文档**：界面方案 + 接口清单 + 验收标准
3. 标记首条任务 `[~] 进行中`

## 二、逐条实现

对每条任务：

1. **实现**：只做该任务范围；遵守 `CONVENTIONS.md` 强制规矩（金额分、会员价取整、签到语义 B1-B3、接口契约等）
2. **测试**（必须完整输出+退出码，禁止 grep 掩盖失败，强制规矩 #6）：
   - 改动的 JS：`node --check`
   - 后端改动：`DB_PATH=/tmp/gym-test-clean-$$.db node minitest/run-tests.js`（干净库模式，全绿才过）
   - 新接口：run-tests.js 至少 1 条断言 + coverage.test.js 探针（强制规矩 #4）
   - 前端改动：相关页面语法/逻辑自查；交互类说明需 L3 真机手测
   - 发现 bug → 按 bug-system 流程登记，不顺手带过
3. **完成**：该条标 `[x]`，一行汇报

## 三、提交

1. 全部任务完成 → 全量测试再跑一遍确认全绿
2. `git add` 相关文件 → commit（格式 `feat: 简述（中文）`，引用 `DESIGN #Dn`）
   - pre-commit hook 自动再跑全量测试，红则修
   - **不 push**（除非用户明确要求）
3. 收尾：
   - `DESIGNS-INBOX.md` 对应条目标 `🏁 已交付`
   - DEV-BACKLOG 完成的任务归档到「已完成」区
4. 汇报：列出完成的功能 + 测试结果 + commit 号

## 四、边界

- 只有一条任务时也走完「测试→commit」闭环，不省步骤
- 中途新需求冒出 → 登记到 DESIGNS-INBOX（钩子）或 TODO.md，不在本批偷偷加码
- 涉及钱/订单/签到 → 对照 BUG-LEDGER 教训（#9 钱闭环、#10 签到窗口）
- 设计文档与实现冲突 → 停下问用户，不擅自改设计
