# Claude 插件/技能安装指南（以微信小程序技能为例）

> 更新日期：2026-08-15
> 适用：Claude Code CLI（本项目实测版本 2.1.220）

---

## 一、背景：为什么直接装会失败

`/plugin install wechat-miniprogram@asdyych/wechat-miniprogram-skill` 失败的根因（两次）：

1. **命令粘贴错误**：把 `marketplace add` 和 `install` 两条命令贴在同一行，源字符串被拼坏
   （`marketplace add asdyych/wechat-miniprogram-skill /plugin install wechat-miniprogram`）。
   **教训：一条提示符只贴一条命令。**
2. **仓库格式不匹配（根本原因）**：GitHub 上存在两类仓库，安装方式完全不同：

| 格式 | 特征 | 能否 `/plugin install` |
|---|---|---|
| **插件 marketplace** | 仓库含 `.claude-plugin/marketplace.json` | ✅ 能 |
| **旧式技能仓库** | 根目录 `SKILL.md`（+ 可选 `plugins.json`），无 `.claude-plugin/` | ❌ 不能，需手动装 |

`asdyych/wechat-miniprogram-skill` 是**旧式技能仓库**（根目录 `SKILL.md` + `plugins.json`，
引用放在 `references/`，模板在 `templates/`）。`/plugin marketplace add` 会报
「Marketplace file not found」；`/plugin install` 会报「Plugin not found in marketplace」。
这类仓库的官方安装位置是 **skills 目录**，只能手动复制。

---

## 二、安装到本项目文件夹（项目级作用域）

目标目录：`<项目根>/.claude/skills/wechat-miniprogram/`（目录名必须等于 SKILL.md frontmatter 的 `name` 字段）。

### 方式一：gh tarball 下载（本机已验证，推荐）

本机 `git clone` github.com 直连会被 reset（见第五节），但 `gh api`（走 api.github.com）可用：

```bash
cd <项目根>
mkdir -p .claude/skills/wechat-miniprogram
gh api repos/asdyych/wechat-miniprogram-skill/tarball/master \
  > /tmp/wmp-skill.tar.gz
tar -xzf /tmp/wmp-skill.tar.gz --strip-components=1 -C .claude/skills/wechat-miniprogram
rm /tmp/wmp-skill.tar.gz
```

### 方式二：git clone（GitHub 网络正常时）

```bash
cd <项目根>
git clone --depth 1 https://github.com/asdyych/wechat-miniprogram-skill \
  .claude/skills/wechat-miniprogram
```

### 方式三：复制本机已装的用户级技能（离线可用）

2026-08-15 已装过用户级副本，直接拷贝到项目内即可：

```bash
cp -r ~/.claude/skills/wechat-miniprogram <项目根>/.claude/skills/
```

### 验证

1. 运行 `/reload-plugins`（或重启会话）
2. `/plugin list`（或技能列表）中应出现 `wechat-miniprogram`
3. 会话中直接问「微信小程序 X 怎么做」或让 Claude 用该技能，确认加载正常

---

## 三、作用域说明

| 作用域 | 位置 | 生效范围 | 备注 |
|---|---|---|---|
| **用户级** | `~/.claude/skills/`（即 `C:\Users\<用户>\.claude\skills\`） | 所有项目 | 2026-08-15 已安装 ✓ |
| **项目级** | `<项目根>/.claude/skills/` | 仅当前项目 | 本文档教的就是这个；可随 git 共享给团队 |

> 两个作用域同名技能可共存，项目级优先。装了项目级副本后，项目内 AI 会话无需依赖用户级安装。

---

## 四、正规插件 marketplace 的安装方式（对照）

如果将来遇到**正规 marketplace 仓库**（含 `.claude-plugin/marketplace.json`，如本项目已装的 `Owl-Listener/designer-skills`）：

```
/plugin marketplace add <owner>/<repo>      # 注册 marketplace
/plugin install <name>@<marketplace>        # 安装插件（如 /plugin install ui-design）
```

等价 CLI：`claude plugin marketplace add <owner>/<repo>` → `claude plugin install <name>@<owner>/<repo>`
（`--scope project` 可装到项目级）。

## 五、卸载

- 项目级：`rm -rf <项目根>/.claude/skills/wechat-miniprogram`
- 用户级：`rm -rf ~/.claude/skills/wechat-miniprogram`
- marketplace：`/plugin marketplace remove <name>`

## 六、本机网络注意事项

- `git clone https://github.com/...` 直连 **connection reset**（与 git 仓库历史重建的已知网络问题一致）
- `gh api`（api.github.com）**可用**，故推荐方式一；等网络恢复后方式二同样成立
- 仓库更新：重新下载 tarball 覆盖解压即可（旧式技能无内置更新机制）
