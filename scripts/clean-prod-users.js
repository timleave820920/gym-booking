/**
 * 生产用户清理（2026-08-17，用户指令：只保留有真实微信对应的账号）
 *
 * 目标：
 *  1. 删除所有「非真实微信号」的用户（openid 非 o 开头——微信 openid 恒为 o 开头，
 *     演示号 demo_* / 冒烟号 smoke_* / 假用户 fake_* 全部命中），及其全部关联数据
 *  2. 删除马春艳教练档案（coaches#2；无排课规则/场次引用时才能删，有引用则提示改下线）
 *  3. 保留：coaches#1 喻馥雅档案（等真实微信登录后由管理页勾选绑定）
 *
 * 用法（云托管 WebShell 或本机，MYSQL_* 环境变量由控制台注入）：
 *    node scripts/clean-prod-users.js            # DRY_RUN：只打印将删内容，不执行
 *    node scripts/clean-prod-users.js --execute  # 真正执行
 *
 * 幂等：可重复执行（第二次 DRY_RUN 会显示没有可删内容）。
 */
const mysql = require('mysql2/promise');

const EXECUTE = process.argv.includes('--execute');
const KEEP_PREFIX = process.env.KEEP_OPENID_PREFIX || 'o'; // 微信 openid 恒以 o 开头
const DELETE_COACHES = process.env.DELETE_COACHES || '2';  // 马春艳档案 id

// 引用 users.openid 的表（先删子表，再删用户）
const CHILD_TABLES_BY_USER = [
  'bookings', 'orders', 'waitlist', 'coin_logs', 'coin_exchanges',
  'member_recharges', 'balance_logs', 'messages', 'user_passes', 'user_achievements',
];
// 无外键但以 openid 作为文本引用的表（inviter/invitee、coach/student 两个列都要扫）
const TEXT_REF_TABLES = [
  { table: 'invitations', cols: ['inviter', 'invitee'] },
  { table: 'coach_notes', cols: ['coach_openid', 'student_openid'] },
];

async function main() {
  const [host, port] = (process.env.MYSQL_ADDRESS || '127.0.0.1:3306').split(':');
  const conn = await mysql.createConnection({
    host, port: Number(port),
    user: process.env.MYSQL_USERNAME || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DB || 'gym',
    multipleStatements: true,
  });
  const [connInfo] = await conn.query('SELECT VERSION() AS v');
  console.log(`连接成功 MySQL ${connInfo[0].v} ｜ 模式: ${EXECUTE ? 'EXECUTE（将真删）' : 'DRY_RUN（只预览）'}`);

  // ===== 1. 用户清单 =====
  const [users] = await conn.query('SELECT openid, nickname, role, created_at, login_count FROM users ORDER BY id');
  console.log(`\n===== 用户清单（${users.length} 人）=====`);
  const delUsers = [], keepUsers = [];
  for (const u of users) {
    const keep = String(u.openid).startsWith(KEEP_PREFIX); // 微信 openid 恒以 o 开头
    (keep ? keepUsers : delUsers).push(u);
    console.log(`  ${keep ? '✅保留' : '🗑删除'}  ${u.openid} ｜ ${u.nickname || '(无昵称)'} ｜ ${u.role} ｜ 登录${u.login_count}`);
  }
  console.log(`保留 ${keepUsers.length} 人，待删 ${delUsers.length} 人`);

  // ===== 2. 逐人统计关联数据（DRY_RUN 也统计）=====
  console.log('\n===== 待删用户的关联数据 =====');
  let totalRows = 0;
  for (const u of delUsers) {
    let n = 0;
    const parts = [];
    for (const t of CHILD_TABLES_BY_USER) {
      const [[{ c }]] = await conn.query(`SELECT COUNT(*) c FROM \`${t}\` WHERE user_openid = ?`, [u.openid]);
      if (c > 0) { n += c; parts.push(`${t}=${c}`); }
    }
    for (const { table, cols } of TEXT_REF_TABLES) {
      const conds = cols.map(c => `\`${c}\` = ?`).join(' OR ');
      const args = cols.flatMap(() => [u.openid]);
      const [[{ c }]] = await conn.query(`SELECT COUNT(*) c FROM \`${table}\` WHERE ${conds}`, args);
      if (c > 0) { n += c; parts.push(`${table}=${c}`); }
    }
    totalRows += n;
    console.log(`  ${u.openid}: ${n} 行${parts.length ? '（' + parts.join(', ') + '）' : '（无关联数据）'}`);
  }

  // ===== 3. 教练档案检查 =====
  console.log('\n===== 教练档案 =====');
  const [[tplRef]] = await conn.query('SELECT COUNT(*) c FROM schedule_templates WHERE coach_id = ?', [DELETE_COACHES]);
  const [[sessRef]] = await conn.query('SELECT COUNT(*) c FROM course_sessions WHERE coach_id = ?', [DELETE_COACHES]);
  const [[coachRow]] = await conn.query('SELECT id, name, user_openid FROM coaches WHERE id = ?', [DELETE_COACHES]);
  if (!coachRow) {
    console.log(`  coaches#${DELETE_COACHES} 不存在（已删过？）`);
  } else {
    console.log(`  coaches#${DELETE_COACHES} = ${coachRow.name}，排课规则引用 ${tplRef.c} 条，场次引用 ${sessRef.c} 条，绑定 ${coachRow.user_openid || '(无)'}`);
    if (tplRef.c > 0 || sessRef.c > 0) {
      console.log(`  ⚠️ 有引用，不能删档案——需先转移排课（建议改为 status='inactive' 下线）`);
    } else {
      console.log(`  ✅ 无引用，可安全删除`);
    }
  }

  if (!EXECUTE) {
    console.log(`\n===== DRY_RUN 结束：待删用户 ${delUsers.length} 人、关联数据 ${totalRows} 行、教练 ${coachRow && !tplRef.c && !sessRef.c ? '可删' : '不可删'} =====`);
    console.log(`确认无误后执行: node scripts/clean-prod-users.js --execute`);
    await conn.end();
    return;
  }

  // ===== 4. 执行删除（事务）=====
  const ok = await confirm(delUsers);
  if (!ok) { console.log('已取消，未执行任何删除'); await conn.end(); return; }

  await conn.beginTransaction();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const u of delUsers) {
      for (const t of CHILD_TABLES_BY_USER) {
        await conn.query(`DELETE FROM \`${t}\` WHERE user_openid = ?`, [u.openid]);
      }
      for (const { table, cols } of TEXT_REF_TABLES) {
        const conds = cols.map(c => `\`${c}\` = ?`).join(' OR ');
        const args = cols.flatMap(() => [u.openid]);
        await conn.query(`DELETE FROM \`${table}\` WHERE ${conds}`, args);
      }
      await conn.query('DELETE FROM users WHERE openid = ?', [u.openid]);
      console.log(`  ✓ 已删除用户 ${u.openid}`);
    }
    // 教练档案（无引用才删；有引用改下线）
    if (coachRow && tplRef.c === 0 && sessRef.c === 0) {
      await conn.query('DELETE FROM coaches WHERE id = ?', [DELETE_COACHES]);
      console.log(`  ✓ 已删除教练档案 ${coachRow.name}（coaches#${DELETE_COACHES}）`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.commit();
    console.log(`\n===== 清理完成：删除 ${delUsers.length} 人、${totalRows} 行关联数据 =====`);
  } catch (e) {
    await conn.rollback();
    await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    console.error('执行失败，已回滚:', e.message);
    process.exitCode = 1;
  }
  await conn.end();
}

/** 交互确认（仅 TTY；非交互直接拒绝，防误删）。delUsers 由 main 传入（原实现引用 main 局部变量，WebShell 下必挂） */
function confirm(delUsers) {
  if (!process.stdin.isTTY) {
    console.log('非交互环境未确认——拒绝执行。如确需执行请显式传入 CONFIRM=1');
    return Promise.resolve(process.env.CONFIRM === '1');
  }
  const readline = require('node:readline').createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    readline.question(`\n⚠️ 以上 ${delUsers.length} 个用户将不可恢复地删除。输入 yes 确认: `, (ans) => {
      readline.close();
      resolve(ans.trim().toLowerCase() === 'yes');
    });
  });
}

main().catch(e => { console.error('脚本失败:', e.message); process.exit(1); });
