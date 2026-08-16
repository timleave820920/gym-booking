#!/usr/bin/env node
/**
 * capture-bug.js — UserPromptSubmit 钩子脚本
 * 用户输入以 "bug:" 或 "bug：" 开头时，自动把内容追加到项目根目录 BUGS-INBOX.md。
 * 只在匹配时写入；重复描述去重；文件不存在自动创建。
 * 用法（钩子标准输入为 JSON，含 prompt 字段）：
 *   echo '{"prompt":"bug：xxx"}' | node .claude/hooks/capture-bug.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const INBOX = path.join(PROJECT_ROOT, 'BUGS-INBOX.md');

const HEADER = [
  '# BUGS-INBOX.md · Bug 收集箱',
  '',
  '> 输入「bug：xxx」自动登记（UserPromptSubmit 钩子捕获）；描述不清我会追问。',
  '> 状态：⬜ 待确认 ｜ ⏳ 修复中 ｜ ✅ 已修复（登记 BUG-LEDGER #N）',
  ''
].join('\n');

function main() {
  let input = '';
  try { input = fs.readFileSync(0, 'utf8'); } catch (e) { return; }
  let prompt = '';
  try { prompt = (JSON.parse(input).prompt || '').trim(); } catch (e) { return; }
  // 只处理 bug: / bug： 开头的消息
  if (!/^bug\s*[:：]/i.test(prompt)) return;

  const desc = prompt.replace(/^bug\s*[:：]\s*/i, '').trim();

  let content = '';
  try { content = fs.readFileSync(INBOX, 'utf8'); } catch (e) { /* 文件不存在 → 新建 */ }
  if (!content.trim()) content = HEADER;

  // 去重：同描述已登记则跳过（防止会话重发/钩子重跑）
  if (desc && content.includes(desc)) return;

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // 编号 = 全文全局最大编号 + 1（含已修复的，修复 #10 登记误作 #2 的教训：
  // 旧逻辑数「未完成条目数」，与已修复条目编号撞车）
  const allNums = (content.match(/^- \[[ x]\] #\d+/gm) || []).map(s => Number(s.match(/#(\d+)/)[1]));
  const next = (allNums.length ? Math.max(...allNums) : 0) + 1;
  const line = `- [ ] #${next}（${dateStr}）${desc || '（描述为空，待确认）'}`;

  // 新条目插到头部（倒序，与 BUG-LEDGER 一致）
  const body = content.startsWith(HEADER) ? content.slice(HEADER.length) : content;
  fs.writeFileSync(INBOX, HEADER + line + '\n' + body, 'utf8');
}

main();
