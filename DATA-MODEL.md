# 课程数据结构设计（DATA-MODEL）

> 综合训练馆订课系统 · 课程相关数据模型
> 用途：据此设计数据库表、排课配置工具、后端 API
> 关联现状：`utils/mock.js` 课程字段、`server/db.js`（已存在 users 表）、`admin-create-course` 排课配置页

---

## 0. 核心设计决策：课程模板 与 场次 分离

| 概念 | 表 | 说明 | 例子 |
|---|---|---|---|
| **课程模板** | `courses` | 长期存在的基础课程，含静态信息 | 「HIIT 高强度燃脂」，68 元/60 分钟/4 级 |
| **课程场次** | `course_sessions` | 某一天某时段的一次具体课（=排课实例） | 8月12日 10:00-11:00 @A馆 阿凯，余 8 席 |
| **预约/订单** | `bookings` | 学员对某个场次的预约记录 | 田立预约了 8/12 HIIT，已支付 |

**为什么必须分离**：
1. 一个课程模板按 `days: [1,3,5]` 每周重复 → 一周展开成 3 个场次，各自独立统计报名；
2. 预约/签到/营收/到课率全部挂在场次上，模板只负责"长什么样、多少钱"；
3. 价格、封面、描述改动只影响模板；某天某时段调整只动对应场次，互不污染。

**衍生结论**：所有"一周的课表"= 按 `date` 查询 `course_sessions`；所有"课程列表"= 按 `course_id` 分组去重的 `courses`（带最近场次信息）。

---

## 1. 实体关系总览

```
users ─┬─ 1:1 ─ coaches（教练资料扩展）
       └─ 1:N ─ bookings（预约）
courses ─┬─ 1:N ─ course_sessions（生成场次）
         └─ 1:N ─ schedule_templates（每周重复规则）
venues ─── 1:N ─ course_sessions（排课场地）
coaches ── 1:N ─ course_sessions（带课教练）
course_sessions ── 1:N ─ bookings（被预约）
```

---

## 2. 表结构明细（SQLite DDL）

### 2.1 `courses` 课程模板表

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| id | INTEGER PK | ✅ | 自增主键 | 1 |
| name | TEXT | ✅ | 课程名称 | HIIT 高强度燃脂 |
| category | TEXT | ✅ | 分类（现 4 类） | 燃脂团课 |
| level | INTEGER | ✅ | 难度 1-5 | 4 |
| duration_min | INTEGER | ✅ | 时长（分钟） | 60 |
| price_fen | INTEGER | ✅ | **价格（分）**，展示 ÷100 | 6800 |
| cover | TEXT | ✅ | 封面图 URL | /images/2_193.png |
| description | TEXT | 否 | 课程介绍/注意事项 | 全身燃脂，适合进阶 |
| status | TEXT | ✅ | 上架状态，见 §3 | published |
| created_at / updated_at | TEXT | ✅ | 时间戳 | 2026-08-10 16:00:00 |

```sql
CREATE TABLE IF NOT EXISTS courses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  level        INTEGER DEFAULT 3,
  duration_min INTEGER DEFAULT 60,
  price_fen    INTEGER DEFAULT 6800,
  cover        TEXT DEFAULT '',
  description  TEXT DEFAULT '',
  status       TEXT DEFAULT 'published',
  created_at   TEXT DEFAULT (datetime('now','localtime')),
  updated_at   TEXT DEFAULT (datetime('now','localtime'))
);
```

> **价格存"分"**：整数避免浮点误差（68 元 = 6800 分），支付金额也按分传给微信支付。

### 2.2 `course_sessions` 课程场次表（排课实例）

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| id | INTEGER PK | ✅ | 自增主键 | 101 |
| course_id | INTEGER FK | ✅ | 所属课程模板 | 1 |
| coach_id | INTEGER FK | ✅ | 带课教练（→coaches.id） | 1 |
| venue_id | INTEGER FK | ✅ | 场地（→venues.id） | 1 |
| date | TEXT | ✅ | 上课日期 YYYY-MM-DD | 2026-08-12 |
| start_time | TEXT | ✅ | 开始时间 HH:MM | 10:00 |
| end_time | TEXT | ✅ | 结束时间 HH:MM | 11:00 |
| capacity | INTEGER | ✅ | 容量（默认取场地/模板） | 20 |
| booked_count | INTEGER | ✅ | 已约人数，**余位=capacity-booked_count** | 12 |
| status | TEXT | ✅ | 场次状态，见 §3 | published |
| source | TEXT | ✅ | 来源：manual 手动 / auto 自动刷新 | manual |
| created_at | TEXT | ✅ | 创建时间 | 2026-08-10 16:00:00 |

```sql
CREATE TABLE IF NOT EXISTS course_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id    INTEGER NOT NULL,
  coach_id     INTEGER NOT NULL,
  venue_id     INTEGER NOT NULL,
  date         TEXT NOT NULL,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  capacity     INTEGER DEFAULT 20,
  booked_count INTEGER DEFAULT 0,
  status       TEXT DEFAULT 'published',
  source       TEXT DEFAULT 'manual',
  created_at   TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (course_id) REFERENCES courses(id),
  FOREIGN KEY (coach_id)  REFERENCES coaches(id),
  FOREIGN KEY (venue_id)  REFERENCES venues(id)
);
```

> **不单独存 remaining**：余位永远由 `capacity - booked_count` 计算，避免双写不一致。
> 建议建联合索引：`(date, status)` 用于按天查课表、`(course_id, date)` 用于课程详情找场次。

### 2.3 `bookings` 预约表（订单）

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| id | INTEGER PK | ✅ | 自增主键 | 501 |
| booking_no | TEXT | ✅ | 订单号（展示用） | BK20260812001 |
| user_openid | TEXT FK | ✅ | 学员（→users.openid） | uid_xxx |
| session_id | INTEGER FK | ✅ | 场次（→course_sessions.id） | 101 |
| amount_fen | INTEGER | ✅ | 实付金额（分），下单时快照 | 6800 |
| status | TEXT | ✅ | 预约状态，见 §3 | booked |
| pay_status | TEXT | ✅ | 支付状态，见 §3 | paid |
| checkin_at | TEXT | 否 | 签到时间（未签到为 NULL） | 2026-08-12 09:58:00 |
| cancel_reason | TEXT | 否 | 退订原因（后台可填） | 行程冲突 |
| created_at | TEXT | ✅ | 下单时间 | 2026-08-10 16:05:00 |

```sql
CREATE TABLE IF NOT EXISTS bookings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_no    TEXT UNIQUE NOT NULL,
  user_openid   TEXT NOT NULL,
  session_id    INTEGER NOT NULL,
  amount_fen    INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'booked',
  pay_status    TEXT DEFAULT 'unpaid',
  checkin_at    TEXT,
  cancel_reason TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_openid) REFERENCES users(openid),
  FOREIGN KEY (session_id)  REFERENCES course_sessions(id)
);
```

> 唯一约束 `(user_openid, session_id)` 防止重复预约。
> 退订/退款用状态流转而非物理删除（`status=cancelled`），保留统计完整性。

### 2.4 `coaches` 教练资料表

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| id | INTEGER PK | ✅ | 自增主键 | 1 |
| user_openid | TEXT FK | 否 | 关联 users（role=coach 时） | uid_xxx |
| name | TEXT | ✅ | 姓名（演示期独立字段） | 阿凯 |
| avatar | TEXT | 否 | 头像 | /images/2_1468.png |
| skills | TEXT | ✅ | 擅长（逗号分隔） | HIIT,战绳,核心 |
| rating | REAL | ✅ | 评分 0-5 | 4.9 |
| status | TEXT | ✅ | active 在职 / leave 休假 | active |

```sql
CREATE TABLE IF NOT EXISTS coaches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_openid TEXT,
  name        TEXT NOT NULL,
  avatar      TEXT DEFAULT '',
  skills      TEXT DEFAULT '',
  rating      REAL DEFAULT 5.0,
  status      TEXT DEFAULT 'active'
);
```

> 简化为独立表（贴近现有 mock `adminCoaches`）；后续接真实账号可改为与 users 一对一。

### 2.5 `venues` 场地表

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| id | INTEGER PK | ✅ | 自增主键 | 1 |
| name | TEXT | ✅ | 场地名 | A 馆 · 综合训练区 |
| location | TEXT | 否 | 位置描述 | 一楼东侧 |
| capacity | INTEGER | ✅ | 默认容量（排课时可覆盖） | 20 |
| status | TEXT | ✅ | active 可用 / disabled 停用 | active |

```sql
CREATE TABLE IF NOT EXISTS venues (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  location TEXT DEFAULT '',
  capacity INTEGER DEFAULT 20,
  status   TEXT DEFAULT 'active'
);
```

### 2.6 `schedule_templates` 排课模板表（每周重复规则）

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| id | INTEGER PK | ✅ | 自增主键 | 1 |
| course_id | INTEGER FK | ✅ | 课程模板 | 1 |
| weekday | INTEGER | ✅ | 每周几 1=周一…7=周日 | 1 |
| start_time / end_time | TEXT | ✅ | 时段 | 10:00 / 11:00 |
| venue_id | INTEGER FK | ✅ | 场地 | 1 |
| coach_id | INTEGER FK | ✅ | 教练 | 1 |
| capacity | INTEGER | ✅ | 容量 | 20 |

```sql
CREATE TABLE IF NOT EXISTS schedule_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL,
  weekday    INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  venue_id   INTEGER NOT NULL,
  coach_id   INTEGER NOT NULL,
  capacity   INTEGER DEFAULT 20,
  FOREIGN KEY (course_id) REFERENCES courses(id)
);
```

> 对应现有 mock `days: [1,3,5]` + `refresh` 设置：`days` → 三条 `schedule_templates`；
> "每周自动刷新" = 定时任务按模板展开生成下周 `course_sessions`（source='auto'）。

---

## 3. 状态枚举（统一英文小写存储，前端映射中文）

### 场次 status（course_sessions）
| 值 | 含义 | 说明 |
|---|---|---|
| draft | 草稿 | 已配置未发布，学员不可见 |
| published | 已发布 | 学员端可见、可预约 |
| full | 已满员 | booked_count >= capacity，前端禁约 |
| cancelled | 已取消 | 教练请假/后台取消，关联订单需处理 |
| completed | 已完成 | 上课时间已过/已签到结束 |

### 预约 status（bookings）
| 值 | 含义 |
|---|---|
| booked | 已预约（待上课） |
| checked_in | 已签到（上完课） |
| cancelled | 已退订（席位释放，金额按规则退） |

### 支付 pay_status（bookings）
| 值 | 含义 |
|---|---|
| unpaid | 未支付（下单未付款，超时可自动取消） |
| paid | 已支付 |
| refunded | 已退款（退订时） |

---

## 4. 现有 mock 字段 → 新结构映射

| mock.js courses 字段 | 新结构归属 |
|---|---|
| id / name / category / level / img | `courses` 表 |
| price | `courses.price_fen`（×100） |
| duration（"60分钟"） | `courses.duration_min`（60） |
| coach（"阿凯"） | `course_sessions.coach_id` → coaches.name |
| venue（"A馆"） | `course_sessions.venue_id` → venues.name |
| start / end | `course_sessions.start_time / end_time` |
| capacity / booked / remaining | `course_sessions.capacity / booked_count`（remaining 不存） |
| days: [1,3,5] | `schedule_templates` 三条记录 |

---

## 5. 排课配置工具字段设计（对应 admin-create-course 页）

配置一节课需要收集的输入（映射到上面各表）：

| 配置项 | 控件 | 写入的表 |
|---|---|---|
| 课程（选已有模板 或 新建） | 选择器/新建表单 | courses |
| 分类 / 难度 / 时长 / 价格 / 封面 | 表单（新建模板时） | courses |
| 教练 | 下拉（读 coaches） | course_sessions.coach_id |
| 场地 | 下拉（读 venues） | course_sessions.venue_id |
| 日期 | 日期选择（未来 7 天） | course_sessions.date |
| 时段（开始/结束） | 时间选择器 | course_sessions.start/end_time |
| 容量 | 数字输入（默认取场地容量） | course_sessions.capacity |
| 每周重复（周几） | 多选（原 days） | schedule_templates |
| 刷新设置（周几/几点） | 星期 ActionSheet + 时间选择（现有） | 全局设置表 system_settings |

**发布动作** = 校验无冲突（同场地/同教练同日期时段重叠）→ 写入 `course_sessions`（source='manual'）→ 学员/教练端按 date 查询即可见。

---

## 6. 关键业务规则（写接口时遵守）

1. **余位**：不存 remaining，`capacity - booked_count` 计算；
2. **并发抢课**：扣减用原子 SQL，防超卖：
   ```sql
   UPDATE course_sessions SET booked_count = booked_count + 1
   WHERE id = ? AND booked_count < capacity;
   -- 影响行数 = 0 则满员，拒绝下单
   ```
3. **重复预约**：`(user_openid, session_id)` 唯一约束，重复下单直接报"已预约"；
4. **退订释放**：状态置 cancelled 时同步 `booked_count - 1`（同事务）；已支付按退订规则退款；
5. **签到**：`checkin_at` 写入 + status → checked_in；到课率统计 = checked_in / booked；
6. **场次取消**：级联处理该场次全部 bookings（自动退订通知）；
7. **价格快照**：amount_fen 下单时写入，后续调价不影响历史订单。

---

## 7. 建议的 API（后续开发参考）

```
GET  /api/courses?category=&keyword=     课程模板列表（学员端首页/列表）
GET  /api/courses/:id                    课程详情（含最近场次/余位）
GET  /api/sessions?date=&course_id=      场次列表（学员端周课表 / 教练端当日课表）
POST /api/sessions                       发布排课（后台，含冲突校验）
POST /api/sessions/refresh               按模板自动展开下周场次（定时任务）
POST /api/bookings                       预约（原子扣减余位）
DELETE /api/bookings/:id                 退订（释放余位 + 退款）
POST /api/bookings/:id/checkin           签到（教练端扫码）
GET  /api/bookings/my?status=            我的课程（学员端）
GET  /api/admin/stats?type=dashboard|revenue  后台统计（接真实数据）
```

---

## 8. 落地路径建议（对应 TODO.md P0「真实订课链路落库」）

1. 先建表：`server/db.js` 增加 courses / course_sessions / bookings / coaches / venues / schedule_templates（DDL 见 §2），users 表不变；
2. 迁移数据：把 mock.js 的 7 门课 → courses 模板 + 展开 schedule_templates，跑一次刷新生成本周场次；
3. 接接口：学员端列表/详情/我的课程改读真实数据（`utils/api.js` 新增方法）；
4. 后台排课页：publish() 从"模拟推送"改为 POST /api/sessions 真实写库；
5. 支付接入后再补 pay_status 流转与退款。

> 云数据库（微信云开发）结构相同，集合名即表名；SQLite 阶段先本地验证，上线切云时 `booked_count` 原子扣减改用云数据库事务。
