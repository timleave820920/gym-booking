#!/usr/bin/env python3
"""微信小程序项目脚手架 — WeChat Mini Program Project Scaffolding

用法:
    python init-miniprogram.py <project-name> [--cloud]

参数:
    project-name    项目名称（会创建同名目录）
    --cloud         启用云开发（添加 cloudfunctions 目录）

示例:
    python init-miniprogram.py my-shop
    python init-miniprogram.py my-shop --cloud
"""

import argparse
import json
import sys
from pathlib import Path


def create_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"  + {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="微信小程序项目脚手架")
    parser.add_argument("name", help="项目名称")
    parser.add_argument("--cloud", action="store_true", help="启用云开发")
    args = parser.parse_args()

    root = Path.cwd() / args.name
    if root.exists():
        print(f"错误: 目录 '{args.name}' 已存在")
        sys.exit(1)

    print(f"正在创建项目: {args.name}")
    if args.cloud:
        print("  云开发: 已启用")

    mini_root = root / "miniprogram" if args.cloud else root

    # ── app.js ──
    create_file(
        mini_root / "app.js",
        """App({
  onLaunch() {
    // 登录
    this.checkLogin()
  },

  async checkLogin() {
    const token = wx.getStorageSync('token')
    if (!token) {
      await this.login()
    }
  },

  async login() {
    try {
      const { code } = await wx.login()
      const { request } = require('./utils/request')
      const res = await request({
        url: '/auth/wx-login',
        method: 'POST',
        data: { code }
      })
      wx.setStorageSync('token', res.token)
      this.globalData.openid = res.openid
      if (this._loginCallback) this._loginCallback()
    } catch (err) {
      console.error('登录失败:', err)
    }
  },

  globalData: {
    openid: ''
  }
})
""",
    )

    # ── app.json ──
    app_config = {
        "pages": ["pages/index/index", "pages/mine/mine"],
        "window": {
            "navigationBarBackgroundColor": "#ffffff",
            "navigationBarTitleText": args.name,
            "navigationBarTextStyle": "black",
            "backgroundColor": "#f5f5f5",
        },
        "tabBar": {
            "color": "#999999",
            "selectedColor": "#1296db",
            "backgroundColor": "#ffffff",
            "list": [
                {
                    "pagePath": "pages/index/index",
                    "text": "首页",
                    "iconPath": "images/tab/home.png",
                    "selectedIconPath": "images/tab/home-active.png",
                },
                {
                    "pagePath": "pages/mine/mine",
                    "text": "我的",
                    "iconPath": "images/tab/mine.png",
                    "selectedIconPath": "images/tab/mine-active.png",
                },
            ],
        },
        "style": "v2",
        "sitemapLocation": "sitemap.json",
        "lazyCodeLoading": "requiredComponents",
    }
    create_file(mini_root / "app.json", json.dumps(app_config, ensure_ascii=False, indent=2))

    # ── app.wxss ──
    create_file(
        mini_root / "app.wxss",
        """/* 全局样式 */
page {
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 28rpx;
  color: #333;
  background-color: #f5f5f5;
  box-sizing: border-box;
}

.container {
  padding: 20rpx;
}
""",
    )

    # ── sitemap.json ──
    create_file(
        mini_root / "sitemap.json",
        json.dumps({"rules": [{"action": "allow", "page": "*"}]}, indent=2),
    )

    # ── utils/request.js ──
    create_file(
        mini_root / "utils/request.js",
        """const BASE_URL = 'https://api.example.com'

function request(options) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token')
    wx.request({
      url: BASE_URL + options.url,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'content-type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
        ...options.header
      },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data)
        } else if (res.statusCode === 401) {
          wx.removeStorageSync('token')
          wx.reLaunch({ url: '/pages/index/index' })
          reject(new Error('登录过期'))
        } else {
          reject(new Error(res.data?.message || `请求失败: ${res.statusCode}`))
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'))
      }
    })
  })
}

module.exports = { request }
""",
    )

    # ── utils/util.js ──
    create_file(
        mini_root / "utils/util.js",
        """/**
 * 格式化时间
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const second = date.getSeconds()

  return (
    [year, month, day].map(formatNumber).join('/') +
    ' ' +
    [hour, minute, second].map(formatNumber).join(':')
  )
}

function formatNumber(n) {
  n = n.toString()
  return n[1] ? n : '0' + n
}

module.exports = { formatTime }
""",
    )

    # ── pages/index ──
    create_file(
        mini_root / "pages/index/index.js",
        """const { request } = require('../../utils/request')

Page({
  data: {
    items: [],
    loading: false
  },

  onLoad() {
    this.loadData()
  },

  async loadData() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const res = await request({ url: '/api/items' })
      this.setData({ items: res.list || [] })
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onPullDownRefresh() {
    this.loadData().then(() => wx.stopPullDownRefresh())
  }
})
""",
    )

    create_file(
        mini_root / "pages/index/index.wxml",
        """<view class="container">
  <view wx:for="{{ items }}" wx:key="id" class="item" bindtap="onItemTap" data-id="{{ item.id }}">
    <text>{{ item.name }}</text>
  </view>
  <view wx:if="{{ loading }}" class="loading">加载中...</view>
  <view wx:if="{{ !loading && items.length === 0 }}" class="empty">暂无数据</view>
</view>
""",
    )

    create_file(
        mini_root / "pages/index/index.wxss",
        """.container {
  padding: 20rpx;
}

.item {
  padding: 24rpx;
  margin-bottom: 16rpx;
  background: #fff;
  border-radius: 12rpx;
}

.loading, .empty {
  text-align: center;
  color: #999;
  padding: 40rpx;
}
""",
    )

    create_file(
        mini_root / "pages/index/index.json",
        json.dumps({"navigationBarTitleText": "首页", "enablePullDownRefresh": True}, indent=2),
    )

    # ── pages/mine ──
    create_file(
        mini_root / "pages/mine/mine.js",
        """Page({
  data: {
    userInfo: null
  },

  onShow() {
    const app = getApp()
    if (app.globalData.openid) {
      this.loadUserInfo()
    }
  },

  async loadUserInfo() {
    // 加载用户信息
  },

  onChooseAvatar(e) {
    this.setData({ 'userInfo.avatar': e.detail.avatarUrl })
  }
})
""",
    )

    create_file(
        mini_root / "pages/mine/mine.wxml",
        """<view class="container">
  <view class="user-section">
    <button class="avatar-btn" open-type="chooseAvatar" bindchooseavatar="onChooseAvatar">
      <image class="avatar" src="{{ userInfo.avatar || '/images/default-avatar.png' }}" />
    </button>
    <text class="nickname">{{ userInfo.nickname || '点击登录' }}</text>
  </view>
</view>
""",
    )

    create_file(
        mini_root / "pages/mine/mine.wxss",
        """.user-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60rpx 0;
  background: #fff;
  border-radius: 12rpx;
  margin: 20rpx;
}

.avatar-btn {
  background: none;
  padding: 0;
  margin: 0;
  line-height: 1;
}

.avatar-btn::after {
  border: none;
}

.avatar {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
}

.nickname {
  margin-top: 16rpx;
  font-size: 32rpx;
  color: #333;
}
""",
    )

    create_file(
        mini_root / "pages/mine/mine.json",
        json.dumps({"navigationBarTitleText": "我的"}, indent=2),
    )

    # ── images placeholder ──
    create_file(mini_root / "images" / ".gitkeep", "")
    create_file(mini_root / "images" / "tab" / ".gitkeep", "")

    # ── project.config.json ──
    project_config = {
        "description": args.name,
        "packOptions": {"ignore": [], "include": []},
        "setting": {
            "bundle": False,
            "userConfirmedBundleSwitch": False,
            "urlCheck": True,
            "scopeDataCheck": False,
            "coverView": True,
            "es6": True,
            "postcss": True,
            "compileHotReLoad": False,
            "lazyloadPlaceholderEnable": False,
            "preloadBackgroundData": False,
            "minified": True,
            "autoAudits": False,
            "uglifyFileName": False,
            "uploadWithSourceMap": True,
            "enhance": True,
            "showShadowRootInWxmlPanel": True,
            "packNpmManually": False,
            "packNpmRelationList": [],
            "minifyWXSS": True,
            "disableUseStrict": False,
            "ignoreUploadUnusedFiles": True,
        },
        "compileType": "miniprogram",
        "condition": {},
        "editorSetting": {"tabIndent": "insertSpaces", "tabSize": 2},
    }
    if args.cloud:
        project_config["cloudfunctionRoot"] = "cloudfunctions/"
        project_config["miniprogramRoot"] = "miniprogram/"

    create_file(root / "project.config.json", json.dumps(project_config, ensure_ascii=False, indent=2))

    # ── Cloud development files ──
    if args.cloud:
        # login 云函数
        create_file(
            root / "cloudfunctions" / "login" / "index.js",
            """const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  // 查找或创建用户
  const { data } = await db.collection('users').where({ _openid: OPENID }).get()

  if (data.length === 0) {
    await db.collection('users').add({
      data: {
        _openid: OPENID,
        createdAt: db.serverDate(),
        nickname: '',
        avatar: ''
      }
    })
  }

  return { openid: OPENID, isNew: data.length === 0 }
}
""",
        )
        create_file(
            root / "cloudfunctions" / "login" / "package.json",
            json.dumps(
                {
                    "name": "login",
                    "version": "1.0.0",
                    "main": "index.js",
                    "dependencies": {"wx-server-sdk": "~2.6.3"},
                },
                indent=2,
            ),
        )

    # ── .gitignore ──
    create_file(
        root / ".gitignore",
        """node_modules/
miniprogram_npm/
.DS_Store
*.swp
""",
    )

    print(f"\n项目 '{args.name}' 创建成功!")
    print(f"目录: {root}")
    print("\n下一步:")
    print("  1. 用微信开发者工具打开该目录")
    print("  2. 填写 AppID（或使用测试号）")
    print(f"  3. 修改 {'miniprogram/' if args.cloud else ''}utils/request.js 中的 BASE_URL")
    if args.cloud:
        print("  4. 在云开发控制台创建环境，更新 app.js 中的 env ID")


if __name__ == "__main__":
    main()
