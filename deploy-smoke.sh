#!/bin/sh
# ============================================================
# deploy-smoke.sh — 云托管部署冒烟（部署后必跑）
#
# 用途：区分「新镜像在线 / 旧镜像 / 重建中」三类状态
#   背景（BUG-LEDGER #12/#8）：接口报 404「接口不存在」曾被误判为代码问题，
#   实际根因是云托管 Git 部署自动重建期间访问到旧镜像——新路由尚未上线。
#   此脚本 30 秒即可定案，不再靠人肉 curl 排查。
#
# 用法：bash deploy-smoke.sh [BASE_URL] [重试次数]
#   BASE_URL 默认自动读取 miniprogram/utils/api.js 的 FALLBACK_BASE_URL（单一配置源）
#   本地验证：先起后端，再 bash deploy-smoke.sh http://127.0.0.1:3000
#   重建窗口期：bash deploy-smoke.sh 5   （每 10 秒重试一次，最多 5 次）
#
# 判定原理：
#   ✓ health 200                       = 服务活着
#   ✓ 新路由不带参数返回 400（参数校验） = 路由存在 = 新镜像已上线
#   ✗ 新路由返回 404「接口不存在」       = 旧镜像（等待重建完成）
#   ✗ 连接失败                          = 重建窗口期 / 服务未部署
#
# 新镜像特征补充（BUGS-INBOX #8 / BUG-LEDGER #34 部署排障）：
#   ✓ GET / → 200                      = web 管理网页已打包（cc3362c 前旧镜像 404）
#   ✓ POST /api/courses 无 token → 401 = ADMIN_TOKEN 访问码校验生效（生产必配；
#                                        本地未加载 .env 时为 400 参数校验，提示不判失败）
# ============================================================

# 默认 URL：从 api.js 提取（唯一人工配置源，见 CLAUDE.md 架构段）
BASE_URL="${1:-$(sed -n "s/.*FALLBACK_BASE_URL *= *'\([^']*\)'.*/\1/p" miniprogram/utils/api.js | head -1)}"
RETRIES="${2:-1}"
if [ -z "$BASE_URL" ]; then
  echo "✗ 无法从 miniprogram/utils/api.js 提取 FALLBACK_BASE_URL，请显式传入地址"
  exit 2
fi

# 新路由特征清单：方法|路径|说明（不带参数应返回 400 参数校验）
# coach-assign 已移出：BUG-LEDGER #14 修复后无 token 返回 401（保护生效），在下方 ADMIN 检查区验证
ROUTES='GET|/api/coach/students
GET|/api/coach/notes
GET|/api/coach/settlement'

probe() { # $1=方法 $2=路径 $3=body → 输出 http_code
  if [ -n "$3" ]; then
    curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X "$1" -d "$3" "$BASE_URL$2"
  else
    curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X "$1" "$BASE_URL$2"
  fi
}

attempt() {
  echo "── 探测 $BASE_URL ──"
  code=$(probe GET /api/health)
  if [ "$code" = "200" ]; then
    echo "  ✓ health 200（服务在线）"
  else
    echo "  ✗ health $code（服务不可用：重建窗口期或未部署）"
    return 1
  fi

  new_ok=0
  for r in $ROUTES; do
    m=${r%%|*}
    p=${r#*|}
    code=$(probe "$m" "$p")
    if [ "$code" = "400" ]; then
      echo "  ✓ $m $p → 400 参数校验（路由在线：新镜像）"
    elif [ "$code" = "404" ]; then
      echo "  ✗ $m $p → 404 接口不存在（旧镜像！#12 根因）"
    else
      echo "  ? $m $p → $code（异常状态，待确认）"
    fi
    [ "$code" = "400" ] && new_ok=$((new_ok + 1))
  done

  # 登录落库证据（DESIGN #D2 S5 冒烟）：同一 openid 两次登录，
  # 第一次 201 注册、第二次 200 isNewUser=false = 数据持久化生效
  # （MySQL/CFS 任何持久化路径都通吃；重建后数据仍在 = BUG-LEDGER #25 验收）
  SMOKE_UID="smoke_$(date +%s)"
  c1=$(probe POST /api/auth/login "{\"openid\":\"$SMOKE_UID\"}")
  c2=$(probe POST /api/auth/login "{\"openid\":\"$SMOKE_UID\"}")
  if [ "$c1" = "201" ] && [ "$c2" = "200" ]; then
    echo "  ✓ 登录落库：注册201→复登200（数据持久化正常）"
    new_ok=$((new_ok + 1))
  else
    echo "  ✗ 登录落库异常：首次=$c1 复登=$c2（未持久化或接口异常）"
  fi

  # 管理网页在线（BUGS-INBOX #8：cc3362c 前旧镜像无 web 打包 → / 404）
  wcode=$(probe GET /)
  if [ "$wcode" = "200" ]; then
    echo "  ✓ GET / → 200（管理网页在线）"
    new_ok=$((new_ok + 1))
  else
    echo "  ✗ GET / → $wcode（旧镜像无 web 或异常）"
  fi

  # ADMIN_TOKEN 访问码校验（BUGS-INBOX #8：生产必配；无 token 须 401。
  # 本地未加载 .env 时校验未启用 → 400 参数校验，提示不判失败）
  acode=$(probe POST /api/courses)
  if [ "$acode" = "401" ]; then
    echo "  ✓ POST /api/courses 无 token → 401（访问码校验生效）"
  elif [ "$acode" = "400" ]; then
    echo "  ? POST /api/courses 无 token → 400（ADMIN_TOKEN 未配置/本地未加载 .env，不判失败）"
  else
    echo "  ? POST /api/courses 无 token → $acode（异常状态，待确认）"
  fi
  # coach-assign 保护（BUG-LEDGER #14：修复后无 token 须 401；旧镜像为 400 参数校验 = 未保护）
  cacode=$(probe POST /api/admin/coach-assign)
  if [ "$cacode" = "401" ]; then
    echo "  ✓ POST /api/admin/coach-assign 无 token → 401（#14 保护生效）"
  elif [ "$cacode" = "400" ]; then
    echo "  ✗ POST /api/admin/coach-assign 无 token → 400（#14 未修复的旧镜像！）"
  else
    echo "  ? POST /api/admin/coach-assign 无 token → $cacode（异常状态，待确认）"
  fi
  [ "$new_ok" = "5" ]
}

i=1
while [ "$i" -le "$RETRIES" ]; do
  if attempt; then
    echo ""
    echo "✓✓ 新镜像全部路由在线 —— 可进行真机验证"
    exit 0
  fi
  if [ "$i" -lt "$RETRIES" ]; then
    echo "  （第 $i 次未通过，10 秒后重试…）"
    sleep 10
  fi
  i=$((i + 1))
done

echo ""
echo "✗✗ 冒烟未通过："
echo "   - 若 health 200 但路由 404 → 旧镜像，等待云托管重建完成（BUG-LEDGER #12/#24）"
echo "   - 若 health 失败        → 重建窗口期或服务异常，查云托管控制台日志"
exit 1
