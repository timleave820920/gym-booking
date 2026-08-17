/**
 * 快速冒烟测试 —— 干净库启动 → 核心端点 200 → 退出
 * 用法：node minitest/smoke.js
 *
 * 设计目标：
 *   - 3 秒内跑完，pre-commit / CI 均可挂
 *   - 干净内存库（:memory:），零文件残留
 *   - 覆盖核心链路：health / sessions / coach-schedule / meta / member-config / passes
 *   - 抓得住 schema 缺列（如 BUG-LEDGER #47 c.images）和启动崩溃
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const PORT = 13579;  // 非标准端口，避免与开发服务器冲突
const BASE = `http://127.0.0.1:${PORT}`;
const PROJECT_ROOT = path.join(__dirname, '..');

// 冒烟端点清单（GET，期望 200 + code=200）
const SMOKE_ENDPOINTS = [
  '/api/health',
  '/api/meta',
  '/api/users',
  '/api/sessions?date=2026-08-18',
  '/api/coach/schedule?date=2026-08-18&coach_id=1',
  '/api/member/config',
  '/api/passes/packages',
  '/api/coin/config',
];

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: null }); }
      });
    }).on('error', reject);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(PROJECT_ROOT, 'server/index.js')], {
      env: { ...process.env, DB_PATH: ':memory:', PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let started = false;
    const timer = setTimeout(() => {
      if (!started) { child.kill(); reject(new Error('服务器 8 秒内未启动')); }
    }, 8000);
    child.stdout.on('data', (chunk) => {
      if (!started && chunk.toString().includes('后端服务已启动')) {
        started = true;
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk) => {
      // 忽略 stderr 警告（如 ALTER TABLE 幂等 try/catch 的静默输出）
    });
    child.on('exit', (code) => {
      if (!started) { clearTimeout(timer); reject(new Error(`服务器退出 code=${code}`)); }
    });
  });
}

async function run() {
  console.log('🔥 冒烟测试启动（干净内存库）...');
  let server;
  try {
    server = await startServer();
    console.log('✅ 服务器已启动');
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  }

  let passed = 0, failed = 0;
  for (const ep of SMOKE_ENDPOINTS) {
    try {
      const res = await get(BASE + ep);
      if (res.status === 200 && res.data && res.data.code === 200) {
        console.log(`  ✅ ${ep}`);
        passed++;
      } else {
        console.log(`  ❌ ${ep} → ${res.status} ${JSON.stringify(res.data).slice(0, 100)}`);
        failed++;
      }
    } catch (e) {
      console.log(`  ❌ ${ep} → ${e.message}`);
      failed++;
    }
  }

  server.kill();
  console.log(`\n${passed + failed} 项完成：${passed} 通过，${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
