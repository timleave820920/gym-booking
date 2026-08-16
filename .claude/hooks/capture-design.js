#!/usr/bin/env node
/**
 * capture-design.js — UserPromptSubmit 钩子脚本
 * 用户输入以 "design:" 或 "design：" 开头时，自动把内容追加到项目根目录 DESIGNS-INBOX.md。
 * 只在匹配时写入；重复描述去重；文件不存在自动创建。
 * 用法（钩子标准输入为 JSON，含 prompt 字段）：
 *   echo '{"prompt":"design：xxx"}' | node .claude/hooks/capture-design.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const INBOX = path.join(PROJECT_ROOT, 'DESIGNS-INBOX.md');

const HEADER = [
  '# DESIGNS-INBOX.md · 设计需求收集箱',
  '',
  '> 输入「design：xxx」自动登记（UserPromptSubmit 钩子捕获）；需求不清我会追问。',
  '> 状态：⬜ 待澄清 ｜ 📐 设计中 ｜ ✅ 已确认（写入 DEV-BACKLOG.md）｜ 🏁 已交付',
  ''
].join('\n');

function main() {
  let input = '';
  try { input = fs.readFileSync(0, 'utf8'); } catch (e) { return; }
  let prompt = '';
  try { prompt = (JSON.parse(input).prompt || '').trim(); } catch (e) { return; }
  // 只处理 design: / design： 开头的消息
  if (!/^design\s*[:：]/i.test(prompt)) return;

  const desc = prompt.replace(/^design\s*[:：]\s*/i, '').trim();

  let content = '';
  try { content = fs.readFileSync(INBOX, 'utf8'); } catch (e) { /* 文件不存在 → 新建 */ }
  if (!content.trim()) content = HEADER;

  // 去重：同描述已登记则跳过（防止会话重发/钩子重跑）
  if (desc && content.includes(desc)) return;

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const count = (content.match(/^- \[ \] #D\d+/gm) || []).length;
  const line = `- [ ] #D${count + 1}（${dateStr}）${desc || '（描述为空，待澄清）'}`;

  // 新条目插到头部（倒序）
  const body = content.startsWith(HEADER) ? content.slice(HEADER.length) : content;
  fs.writeFileSync(INBOX, HEADER + line + '\n' + body, 'utf8');
}

main();
