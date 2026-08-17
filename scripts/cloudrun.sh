#!/bin/sh
# ============================================================
# scripts/cloudrun.sh — 微信云托管运维封装（基于腾讯云 tccli tcbr）
#
# 依赖：tccli 已安装（pip install tccli）且已配置 API 密钥
#   tccli configure --secretId <ID> --secretKey <KEY> --region ap-shanghai
#   （腾讯云控制台 → 访问管理 CAM → API 密钥管理 → 新建密钥）
#
# 用途：不再从云托管控制台人肉复制粘贴日志——构建/部署输出、
#       版本状态、旧版本清理全部走命令行，输出直接可读可转发。
#
# 用法：
#   scripts/cloudrun.sh records              # 最近部署记录（拿 RunId）
#   scripts/cloudrun.sh logs <RunId>         # 拉取该次部署的进程日志（= 控制台启动日志）
#   scripts/cloudrun.sh task <RunId>         # 部署任务状态（构建中/成功/失败）
#   scripts/cloudrun.sh versions             # 版本列表（清理旧版本前先查）
#   scripts/cloudrun.sh delete <版本名>...    # 删除旧版本（如 gym-server-030 gym-server-032）
#   scripts/cloudrun.sh smoke [BASE_URL]     # 部署冒烟（deploy-smoke.sh 封装）
# ============================================================

TC="$(command -v tccli 2>/dev/null || ls "$HOME/AppData/Local/Python"/*/Scripts/tccli.exe 2>/dev/null | head -1)"
ENV_ID="${CLOUDRUN_ENV_ID:-prod-d0g3mnc4m283b5b36}"

[ -n "$TC" ] || { echo "✗ tccli 未找到（pip install tccli）"; exit 2; }
cmd="$1"; shift 2>/dev/null || true

case "$cmd" in
  records)
    "$TC" tcbr DescribeCloudRunDeployRecord --EnvId "$ENV_ID" --ServerName gym-server "$@" 2>&1
    ;;
  logs)
    [ -n "$1" ] || { echo "用法: scripts/cloudrun.sh logs <RunId>"; exit 2; }
    "$TC" tcbr DescribeCloudRunProcessLog --EnvId "$ENV_ID" --RunId "$1" 2>&1
    ;;
  task)
    [ -n "$1" ] || { echo "用法: scripts/cloudrun.sh task <RunId>"; exit 2; }
    "$TC" tcbr DescribeServerManageTask --EnvId "$ENV_ID" "$@" 2>&1
    ;;
  versions)
    "$TC" tcbr DescribeCloudRunServerDetail --EnvId "$ENV_ID" --ServerName gym-server "$@" 2>&1
    ;;
  delete)
    # 用法: scripts/cloudrun.sh delete <版本名>...  （如 gym-server-029 gym-server-030）
    # 仅删版本+镜像，绝不删服务（IsDeleteServer=false）
    [ -n "$1" ] || { echo "用法: scripts/cloudrun.sh delete <版本名>..."; exit 2; }
    svc="gym-server"
    arr="["
    first=1
    for v in "$@"; do
      [ "$first" = "1" ] || arr="$arr,"
      arr="$arr{\"EnvId\":\"$ENV_ID\",\"ServerName\":\"$svc\",\"VersionName\":\"$v\"}"
      first=0
    done
    arr="$arr]"
    "$TC" tcbr DeleteCloudRunVersions --EnvId "$ENV_ID" --IsDeleteServer false --IsDeleteImage true --SimpleVersions "$arr" 2>&1
    ;;
  smoke)
    shift; bash "$(dirname "$0")/../deploy-smoke.sh" "$@" 2>&1
    ;;
  *)
    echo "用法: scripts/cloudrun.sh {records|logs <RunId>|task <RunId>|versions|delete <版本>...|smoke [URL]}"
    exit 2
    ;;
esac
