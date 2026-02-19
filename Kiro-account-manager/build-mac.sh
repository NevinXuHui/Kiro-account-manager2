#!/bin/bash

# Kiro Account Manager - macOS 打包脚本
# 用途：自动化构建和打包 macOS 应用程序

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否在 macOS 上运行
if [[ "$OSTYPE" != "darwin"* ]]; then
    log_error "此脚本只能在 macOS 上运行"
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    log_error "未找到 Node.js，请先安装 Node.js"
    exit 1
fi

log_info "Node.js 版本: $(node --version)"
log_info "npm 版本: $(npm --version)"

# 检查是否在项目根目录
if [ ! -f "package.json" ]; then
    log_error "请在项目根目录运行此脚本"
    exit 1
fi

# 自动检测系统架构
SYSTEM_ARCH=$(uname -m)
if [ "$SYSTEM_ARCH" = "arm64" ]; then
    DEFAULT_ARCH="arm64"
else
    DEFAULT_ARCH="x64"
fi

# 解析命令行参数
SKIP_INSTALL=false
SKIP_BUILD=false
SKIP_NATIVE_REBUILD=false
SIGN_APP=false
NOTARIZE_APP=false
ARCH="$DEFAULT_ARCH"  # 默认使用系统架构

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-install)
            SKIP_INSTALL=true
            shift
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-native-rebuild)
            SKIP_NATIVE_REBUILD=true
            shift
            ;;
        --sign)
            SIGN_APP=true
            shift
            ;;
        --notarize)
            NOTARIZE_APP=true
            SIGN_APP=true  # 公证需要先签名
            shift
            ;;
        --arch)
            ARCH="$2"
            shift 2
            ;;
        --help)
            echo "用法: ./build-mac.sh [选项]"
            echo ""
            echo "选项:"
            echo "  --skip-install          跳过依赖安装"
            echo "  --skip-build            跳过代码构建"
            echo "  --skip-native-rebuild   跳过原生依赖重建（解决 Python distutils 问题）"
            echo "  --sign                  签名应用（需要 Apple 开发者证书）"
            echo "  --notarize              公证应用（需要 Apple 开发者账号）"
            echo "  --arch <arch>           指定架构: x64, arm64, universal (默认: 自动检测)"
            echo "  --help                  显示此帮助信息"
            exit 0
            ;;
        *)
            log_error "未知参数: $1"
            echo "使用 --help 查看帮助"
            exit 1
            ;;
    esac
done

# 1. 安装依赖
if [ "$SKIP_INSTALL" = false ]; then
    log_info "安装依赖..."

    # 如果需要跳过原生依赖重建，设置环境变量
    if [ "$SKIP_NATIVE_REBUILD" = true ]; then
        log_warn "跳过原生依赖重建"
        export ELECTRON_SKIP_BINARY_DOWNLOAD=1
        npm install --ignore-scripts
        # 只安装 electron 二进制文件
        npx electron-builder install-app-deps --arch=$ARCH || log_warn "原生依赖重建失败，继续执行..."
    else
        npm install
    fi
else
    log_warn "跳过依赖安装"
fi

# 2. 类型检查
log_info "执行类型检查..."
npm run typecheck

# 3. 构建代码
if [ "$SKIP_BUILD" = false ]; then
    log_info "构建应用代码..."
    npm run build
else
    log_warn "跳过代码构建"
fi

# 4. 配置签名和公证
if [ "$SIGN_APP" = true ]; then
    log_info "启用代码签名"

    # 检查环境变量
    if [ -z "$APPLE_ID" ] || [ -z "$APPLE_ID_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
        log_warn "未设置签名环境变量，将使用 ad-hoc 签名"
        log_warn "需要设置: APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID"
    else
        log_info "使用 Apple ID: $APPLE_ID"
        log_info "使用 Team ID: $APPLE_TEAM_ID"

        # 导出环境变量供 electron-builder 使用
        export APPLE_ID
        export APPLE_ID_PASSWORD
        export APPLE_TEAM_ID
    fi

    if [ "$NOTARIZE_APP" = true ]; then
        log_info "启用公证"
        export NOTARIZE=true
    fi
fi

# 5. 打包应用
log_info "开始打包 macOS 应用 (架构: $ARCH)..."

BUILD_ARGS="--mac"

# 根据架构添加参数
case $ARCH in
    x64)
        BUILD_ARGS="$BUILD_ARGS --x64"
        ;;
    arm64)
        BUILD_ARGS="$BUILD_ARGS --arm64"
        ;;
    universal)
        BUILD_ARGS="$BUILD_ARGS --universal"
        ;;
    *)
        log_error "不支持的架构: $ARCH"
        exit 1
        ;;
esac

# 执行打包
npx electron-builder $BUILD_ARGS

# 6. 检查输出
log_info "检查打包输出..."

DIST_DIR="dist"
if [ ! -d "$DIST_DIR" ]; then
    log_error "打包失败：未找到 dist 目录"
    exit 1
fi

# 查找生成的文件
DMG_FILES=$(find "$DIST_DIR" -name "*.dmg" -type f)
ZIP_FILES=$(find "$DIST_DIR" -name "*.zip" -type f)

if [ -z "$DMG_FILES" ] && [ -z "$ZIP_FILES" ]; then
    log_error "打包失败：未找到 DMG 或 ZIP 文件"
    exit 1
fi

# 7. 显示结果
log_info "打包完成！"
echo ""
log_info "生成的文件："

if [ -n "$DMG_FILES" ]; then
    echo "$DMG_FILES" | while read -r file; do
        SIZE=$(du -h "$file" | cut -f1)
        echo "  📦 $(basename "$file") ($SIZE)"
    done
fi

if [ -n "$ZIP_FILES" ]; then
    echo "$ZIP_FILES" | while read -r file; do
        SIZE=$(du -h "$file" | cut -f1)
        echo "  📦 $(basename "$file") ($SIZE)"
    done
fi

echo ""
log_info "输出目录: $DIST_DIR"

# 8. 签名验证（如果启用了签名）
if [ "$SIGN_APP" = true ] && [ -n "$DMG_FILES" ]; then
    log_info "验证代码签名..."

    # 挂载 DMG 并验证
    DMG_FILE=$(echo "$DMG_FILES" | head -n 1)
    MOUNT_POINT=$(hdiutil attach "$DMG_FILE" | grep Volumes | awk '{print $3}')

    if [ -n "$MOUNT_POINT" ]; then
        APP_PATH=$(find "$MOUNT_POINT" -name "*.app" -type d | head -n 1)

        if [ -n "$APP_PATH" ]; then
            codesign -dv --verbose=4 "$APP_PATH" 2>&1 | grep -E "Authority|TeamIdentifier|Signature"
        fi

        # 卸载 DMG
        hdiutil detach "$MOUNT_POINT" -quiet
    fi
fi

log_info "✅ 所有操作完成"
