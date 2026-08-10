# 综合训练馆订课系统 — 微信小程序

学员端 + 教练端 + 管理后台全链路小程序，基于 Ardot 设计稿开发，内置 mock 数据，开箱即用。

**Git 仓库**: https://github.com/timleave820920/gym-booking

## 快速开始

1. 打开**微信开发者工具** → 导入项目
2. 选择项目目录：`综合训练馆订课系统`（已含 `project.config.json`）
3. AppID 使用测试号（`touristappid`）即可预览，无需注册
4. 编译后即可看到学员端首页，底部为胶囊 TabBar

> 数据全部为内置 mock（`utils/mock.js`），无需后端即可浏览全部页面。

## 页面结构（19 页）

### 登录页（启动页）
| 页面 | 路径 | 说明 |
|---|---|---|
| 登录 | `pages/login` | 微信一键登录 + 协议勾选 + **演示模式身份选择**（学员/教练/管理员） |

### 学员端 App（8 页，375×812 设计稿）
| 页面 | 路径 | 说明 |
|---|---|---|
| 首页 | `pages/student-home` | 问候 + 搜索 + 活动 Banner + 热门课程（分类栏已隐藏） |
| 课程列表 | `pages/student-courses` | **周日期选择条**（周一~周日，仅本周）+ 课程卡片（含价格） |
| 课程详情 | `pages/student-course-detail` | 大图头部 + 剩余席位（8/20）+ 立即预订（无场次选择） |
| 支付 | `pages/student-pay` | 课程信息 + 金额卡 + 支付方式 → 支付成功（跳过确认订单） |
| 我的课程 | `pages/student-my-courses` | 待上课/已完成切换 + 退订/签到 |
| 签到 | `pages/student-checkin` | 二维码签到页 |
| 成就记录 | `pages/student-achievements` | 数据卡组 + 连续打卡 + 周记录 + 徽章 |
| 个人中心 | `pages/student-profile` | 用户卡 + 菜单（无会员卡）+ **角色入口（演示用）** |

### 教练端 App（3 页）
| 页面 | 路径 | 说明 |
|---|---|---|
| 今日课表 | `pages/coach-schedule` | 当日课表（仅本周）+ 学员名单入口 |
| 学员名单 | `pages/coach-students` | 签到统计 + 学员列表（可点击切换签到状态） |
| 扫码签到 | `pages/coach-scan` | 深色扫描界面 + 扫描线动画 + 手动签到/相册 |

### 管理后台（7 页）
| 页面 | 路径 | 说明 |
|---|---|---|
| 数据仪表盘 | `pages/admin-dashboard` | 4 统计卡 + 营收折线图 + 热门课程 TOP5 |
| 排课管理 | `pages/admin-schedule` | 周视图日历 + 课程块 + **刷新时间设定** |
| 排课配置 | `pages/admin-create-course` | **配置未来课程**（类型/教练/日期/时段/场地/容量）+ **发布到云端** + 刷新设置 |
| 场地管理 | `pages/admin-venues` | 场地卡片网格 |
| 学员管理 | `pages/admin-students` | 表格（学员状态列） |
| 教练管理 | `pages/admin-coaches` | 教练卡片 |
| 营收统计 | `pages/admin-revenue` | 统计卡 + 柱状图 + 收入来源环形图 |

> 后台 7 页顶部均有**横向导航条**（7 个模块互跳，当前页高亮）+ 「退出」按钮回到学员端。

## 交互逻辑

- **登录流程**：微信一键登录（`wx.login` 获取 code）→ 按角色分流：学员进首页 / 教练进课表 / 管理员进后台；个人中心及各端「退出」均可回到登录页
- **订课链路**：课程列表（选日期）→ 详情（看剩余席位）→ 立即预订 → **直接支付**（无确认订单页）
- **日期过滤**：`filterByDate` 按 `days` 字段（1=周一…7=周日）过滤当天课程；学员/教练端**仅显示本周课程**
- **排课配置**：后台配置未来课程 → 发布课表（模拟推送到云端，学员/教练端同步）
- **刷新设定**：排课管理/排课配置页可设定每周几、几点自动更新课表（默认每周一 00:00）
- **支付模拟**：确认支付后 1.2s 弹出成功提示，跳转「我的课程」
- **签到模拟**：教练端学员列表点击可切换签到状态
- **TabBar**：官方自定义 tabBar（`custom-tab-bar/`），胶囊样式还原设计稿

## 技术要点

- 语言：原生 JavaScript，无 npm 依赖
- 样式：原生 WXSS，使用设计稿品牌色（奶油底 #F9F4DF / 青柠 #B9FF66 / 电光紫 #5B57EB / 暖黑 #1A1A23）
- 图片素材：导出自设计稿，存放于 `images/`（课程封面、教练/学员头像、场地图、二维码）
- 图标：SVG data-URI 内联，无额外图标库

## Git 协作

```bash
git add -A
git commit -m "feat: xxx"
git push
```

- 分支：`master`（tracking `origin/master`）
- `.gitignore` 已排除：`.workbuddy/`、预览二维码、`project.private.config.json`、`minitest/`、`node_modules/`
- `.gitattributes` 统一 LF 行尾

## 后续可迭代

- 真实后端接入（`utils/mock.js` 替换为 `wx.request` 封装，登录换 openid）
- 微信支付（`wx.requestPayment`）
- 扫码签到（`wx.scanCode`）
- 手机号快捷登录（`getPhoneNumber`）
- 订单详情、退订确认弹窗
- 后台管理端可拆分为独立 H5
