# 综合训练馆订课系统 — 微信小程序（第一版）

## 快速开始

1. 打开**微信开发者工具** → 导入项目
2. 选择项目目录：`综合训练馆订课系统`（已含 `project.config.json`）
3. AppID 使用测试号（`touristappid`）即可预览，无需注册
4. 编译后即可看到学员端首页，底部为胶囊 TabBar

> 数据全部为内置 mock（`utils/mock.js`），无需后端即可浏览全部页面。

## 页面结构（17 页）

### 学员端 App（8 页，375×812 设计稿）
| 页面 | 路径 | 说明 |
|---|---|---|
| 首页 | `pages/student-home` | 问候 + 搜索 + 活动 Banner + 热门课程 |
| 课程列表 | `pages/student-courses` | **周日期选择条**（周一~周日）+ 课程卡片（含价格） |
| 课程详情 | `pages/student-course-detail` | 大图头部 + 剩余席位（8/20）+ 立即预订 |
| 支付 | `pages/student-pay` | 课程信息 + 金额卡 + 支付方式 → 支付成功 |
| 我的课程 | `pages/student-my-courses` | 待上课/已完成切换 + 退订/签到 |
| 签到 | `pages/student-checkin` | 二维码签到页 |
| 成就记录 | `pages/student-achievements` | 数据卡组 + 连续打卡 + 周记录 + 徽章 |
| 个人中心 | `pages/student-profile` | 用户卡 + 菜单（无会员卡） |

### 教练端 App（3 页）
| 页面 | 路径 | 说明 |
|---|---|---|
| 今日课表 | `pages/coach-schedule` | 概览卡 + 课程列表（深色紫色渐变风格） |
| 学员名单 | `pages/coach-students` | 签到统计 + 学员列表（可点击切换签到状态） |
| 扫码签到 | `pages/coach-scan` | 深色扫描界面 + 扫描线动画 + 手动签到/相册 |

### 管理后台 Web（6 页，1440×900 设计稿）
| 页面 | 路径 | 说明 |
|---|---|---|
| 数据仪表盘 | `pages/admin-dashboard` | 4 统计卡 + 营收折线图 + 热门课程 TOP5 |
| 排课管理 | `pages/admin-schedule` | 周视图日历 + 课程块 |
| 场地管理 | `pages/admin-venues` | 场地卡片网格 |
| 学员管理 | `pages/admin-students` | 表格（学员状态列） |
| 教练管理 | `pages/admin-coaches` | 教练卡片 |
| 营收统计 | `pages/admin-revenue` | 统计卡 + 柱状图 + 收入来源环形图 |

## 交互逻辑

- **订课链路**：课程列表（选日期）→ 详情（看剩余席位）→ 立即预订 → **直接支付**（已跳过确认订单页）
- **日期过滤**：`filterByDate` 按 `days` 字段（1=周一…7=周日）过滤当天课程
- **支付模拟**：确认支付后 1.2s 弹出成功提示，跳转「我的课程」
- **签到模拟**：教练端学员列表点击可切换签到状态
- **TabBar**：官方自定义 tabBar（`custom-tab-bar/`），胶囊样式还原设计稿

## 技术要点

- 语言：原生 JavaScript，无 npm 依赖
- 样式：原生 WXSS，使用设计稿品牌色（奶油底 #F9F4DF / 青柠 #B9FF66 / 电光紫 #5B57EB）
- 图片素材：导出自设计稿，存放于 `images/`（课程封面、教练/学员头像、场地图、二维码）
- 图标：SVG data-URI 内联，无额外图标库

## 后续可迭代

- 接入真实后端（`utils/mock.js` 替换为 `wx.request` 封装）
- 登录授权（`wx.login` + openid）
- 微信支付（`wx.requestPayment`）
- 扫码签到（`wx.scanCode`）
- 后台页面在真机上为移动端排版，可后续拆分为独立 H5 管理端
