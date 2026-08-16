# WeChat Mini Program Skill for Claude Code

微信小程序开发技能包，用于 Claude Code。

## 安装

```bash
/plugin marketplace add asdyych/wechat-miniprogram-skill
/plugin install wechat-miniprogram@asdyych/wechat-miniprogram-skill
```

## 功能

- **原生框架** - WXML, WXSS, WXS 完整参考
- **API 文档** - 网络请求、存储、设备、媒体、支付
- **云开发** - 云函数、数据库、云存储
- **跨平台** - Taro, uni-app 框架指南
- **项目模板** - 页面、组件、云函数脚手架

## 包含内容

```
├── SKILL.md                 # 主技能文件
├── references/              # 参考文档
│   ├── api-auth-payment.md     # 登录与支付
│   ├── api-device-media.md     # 设备与媒体
│   ├── api-navigation-ui.md    # 导航与 UI
│   ├── api-network-storage.md  # 网络与存储
│   ├── app-config.md           # 配置文件
│   ├── cloud-development.md    # 云开发
│   ├── common-patterns.md      # 常用模式
│   ├── components.md           # 内置组件
│   ├── custom-components.md    # 自定义组件
│   ├── framework-core.md       # 框架核心
│   ├── performance-security.md # 性能与安全
│   ├── taro-framework.md       # Taro 框架
│   └── uniapp-framework.md     # uni-app 框架
├── scripts/
│   └── init-miniprogram.py  # 项目初始化脚本
└── templates/               # 代码模板
    ├── cloud-function-template/
    ├── component-template/
    └── page-template/
```

## 触发词

- 微信小程序
- wechat miniprogram
- mini program lifecycle
- WXML / WXSS / WXS
- wx.request / wx.login
- 云开发 / 云函数
- Taro / uni-app

## 使用示例

```
> 帮我创建一个微信小程序的登录流程

> 如何在小程序中使用云函数

> Taro 和 uni-app 有什么区别
```

## License

MIT
