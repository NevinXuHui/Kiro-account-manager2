#!/bin/bash

# Kiro Account Manager 启动脚本
# 用于快速启动开发环境

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查 Node.js 是否安装
if ! command -v node &> /dev/null; then
    print_error "Node.js 未安装，请先安装 Node.js"
    exit 1
fi

# 检查 npm 是否安装
if ! command -v npm &> /dev/null; then
    print_error "npm 未安装，请先安装 npm"
    exit 1
fi

# 检查 node_modules 是否存在
if [ ! -d "node_modules" ]; then
    print_warn "依赖未安装，正在安装依赖..."
    npm install --ignore-scripts
    print_info "尝试安装原生依赖..."
    npm run postinstall || print_warn "原生依赖安装失败，但不影响开发模式运行"
else
    # 检查关键依赖是否存在
    if [ ! -f "node_modules/.bin/electron-vite" ]; then
        print_warn "依赖不完整，重新安装..."
        npm install --ignore-scripts
        print_info "尝试安装原生依赖..."
        npm run postinstall || print_warn "原生依赖安装失败，但不影响开发模式运行"
    fi
fi

# 解析命令行参数
MODE="dev"
if [ $# -gt 0 ]; then
    case "$1" in
        dev|start|build|build:mac|build:win|build:linux)
            MODE="$1"
            ;;
        *)
            print_error "未知命令: $1"
            echo "可用命令: dev, start, build, build:mac, build:win, build:linux"
            exit 1
            ;;
    esac
fi

# 清除已运行的 Kiro 进程
print_info "检查并清除已运行的 Kiro 进程..."
KIRO_PIDS=$(ps aux | grep -E "kiro-account-manager|electron.*Kiro" | grep -v grep | awk '{print $2}')
if [ -n "$KIRO_PIDS" ]; then
    print_warn "发现正在运行的 Kiro 进程，正在终止..."
    echo "$KIRO_PIDS" | xargs kill -9 2>/dev/null || true
    sleep 1
    print_info "✓ 已清除所有 Kiro 进程"
else
    print_info "✓ 没有正在运行的 Kiro 进程"
fi

# 检查是否需要虚拟显示
USE_XVFB=false
if [ -z "$DISPLAY" ]; then
    print_warn "未检测到显示环境 (DISPLAY 未设置)"
    if command -v xvfb-run &> /dev/null; then
        print_info "使用 Xvfb 虚拟显示"
        USE_XVFB=true
    else
        print_warn "建议安装 Xvfb: sudo apt-get install xvfb"
        print_warn "或配置 X11 转发: ssh -X user@host"
    fi
fi

# 执行对应命令
print_info "启动模式: $MODE"
case "$MODE" in
    dev)
        print_info "启动开发服务器..."
        if [ "$USE_XVFB" = true ]; then
            xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' npm run dev
        else
            npm run dev
        fi
        ;;
    start)
        print_info "启动预览模式..."
        if [ "$USE_XVFB" = true ]; then
            xvfb-run --auto-servernum --server-args='-screen 0 1920x1080x24' npm run start
        else
            npm run start
        fi
        ;;
    build)
        print_info "开始构建..."
        npm run build
        ;;
    build:mac)
        print_info "构建 macOS 应用..."
        npm run build:mac
        ;;
    build:win)
        print_info "构建 Windows 应用..."
        npm run build:win
        ;;
    build:linux)
        print_info "构建 Linux 应用..."
        npm run build:linux
        ;;
esac
