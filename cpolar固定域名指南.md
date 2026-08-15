# cpolar 固定域名指南（告别随机域名）

> 综合训练馆订课系统 · 网络配置
> 更新日期：2026-08-15

---

## 一、为什么要固定域名

| 问题（免费版） | 影响 |
|---|---|
| 域名**每 24 小时自动刷新** | 朋友测试链接隔天就失效 |
| 重启隧道域名也变 | 每次都要改 api.js + 后台白名单 |
| 域名长且难记 | 分享麻烦 |
| 共享链路不稳定 | 看门狗重启、DNS 解析失败（本项目已遇到）|

**固定域名 = 永久不变的专属地址**，如 `gym-server.cpolar.cn`，配一次永远生效。

---

## 二、前提

- cpolar 账号已注册、已登录（authtoken 已写入 `~/.cpolar/cpolar.yml`）✅ 你的已就绪
- 升级**任意付费套餐**（固定二级子域名是付费功能，约 99 元/年起）

---

## 三、步骤

### 第 1 步：升级套餐

1. 打开 **https://dashboard.cpolar.com** → 登录
2. 找到「套餐」/「升级」→ 选择基础付费套餐（够用即可，最低档即可解锁固定域名）
3. 完成支付（微信/支付宝）

### 第 2 步：预留固定二级子域名

1. 进入 **https://dashboard.cpolar.com/reserved**（预留页面）
2. 选择菜单 **「预留」→「保留二级子域名」**
3. 填写：
   - **地区**：选「China TOP」（大陆节点）
   - **名称**：填你想要的前缀，如 `gym-server`（最终域名 = `gym-server.cpolar.cn`）
   - **描述**：可不填
4. 点「**保留**」→ 列表中会出现一条固定域名记录
   - ⚠️ 名称全局唯一，被占用就换一个（如 `gym-server01`）

### 第 3 步：把隧道改成固定域名

两种方式任选：

**方式 A：cpolar 本地 Web 界面（推荐，图形化）**
1. 浏览器打开 **http://127.0.0.1:9200**（cpolar 本地管理界面，需 cpolar 在跑）
2. 侧边栏 **隧道管理 → 隧道列表** → 找到你的 http 3000 隧道 → 点「编辑」
3. **域名类型**：从「随机域名」改为「**二级子域名**」
4. **Sub Domain**：填第 2 步保留的名称（如 `gym-server`）
5. 点「**更新**」
6. **状态 → 在线隧道列表** → 公网地址变成 `https://gym-server.cpolar.cn` ✅

**方式 B：命令行配置文件（也可）**
编辑 `~/.cpolar/cpolar.yml`：
```yaml
authtoken: NjllOGU5NjMtNjI1NC00OTRhLWE4NjMtNTZlZjlkMzczYTk5
tunnels:
  gym-server:
    proto: http
    addr: "3000"
    hostname: gym-server.cpolar.cn    # 你保留的固定域名
```
然后启动：`cpolar start gym-server`

### 第 4 步：同步到项目（只做一次）

| 位置 | 改什么 |
|---|---|
| `miniprogram/utils/api.js` | `FALLBACK_BASE_URL = 'https://gym-server.cpolar.cn'` |
| 微信后台 request 合法域名 | 加 `https://gym-server.cpolar.cn` |
| 重新编译小程序 | 加载新地址 |

> 之后域名永不变，**再也不用改这两处了**。

### 第 5 步：验证

```bash
curl https://gym-server.cpolar.cn/api/health
# → {"code":200,"status":"ok"} ✅
```

---

## 四、本项目已有配置回顾

| 项 | 值 |
|---|---|
| 当前隧道 | `https://663dad08.r10.vip.cpolar.cn`（随机，会变） |
| api.js 配置源 | `FALLBACK_BASE_URL`（唯一） |
| 本地管理界面 | http://127.0.0.1:9200 |
| authtoken | 已在 `~/.cpolar/cpolar.yml` ✅ |

---

## 五、注意事项

| 注意点 | 说明 |
|---|---|
| 固定域名要**隧道在线**才可访问 | 电脑关机/隧道停，域名打不开（与本地后端绑定）|
| 升级后旧随机域名失效 | 不影响固定域名 |
| HTTPS 默认支持 | 无需自己配证书 |
| 免费版 24h 变域名 | 升级后消失 |
| 付费是按年 | 到期不续费回退免费版（域名会变）|

---

## 六、后续建议（结合上云计划）

> 固定域名是**过渡方案**——如果计划迁微信云托管（见《上云迁移指南》），云托管自带固定 HTTPS 域名，**cpolar 固定域名可以省掉**。

**决策树**：
- 短期（1-3 个月）：**cpolar 固定域名**（99 元/年）→ 稳定让朋友测
- 长期（正式上线）：**微信云托管** → 自带域名，cpolar 可停

---

## 附：cpolar 常用命令

```bash
cpolar version              # 版本
cpolar authtoken <token>    # 登录/换 token
cpolar http 3000            # 临时隧道（随机域名）
cpolar start <name>         # 按配置启动隧道
cpolar start-all            # 启动全部隧道
cpolar status               # 隧道状态
```
