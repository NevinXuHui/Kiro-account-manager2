#!/bin/bash

# Kiro Account Manager - Linux 打包脚本
# 用途：自动化构建和打包 Linux 应用程序（deb、AppImage、snap）

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
case $SYSTEM_ARCH in
    x86_64)
        DEFAULT_ARCH="x64"
        ;;
    aarch64)
        DEFAULT_ARCH="arm64"
        ;;
    armv7l)
        DEFAULT_ARCH="armv7l"
        ;;
    *)
        DEFAULT_ARCH="x64"
        log_warn "未识别的架构 $SYSTEM_ARCH，使用默认值: x64"
        ;;
esac

# 解析命令行参数
SKIP_INSTALL=false
SKIP_BUILD=false
ARCH="$DEFAULT_ARCH"
TARGET="all"  # all, deb, appimage, snap

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
        --arch)
            ARCH="$2"
            shift 2
            ;;
        --target)
            TARGET="$2"
            shift 2
            ;;
        --help)
            echo "用法: ./build-linux.sh [选项]"
            echo ""
            echo "选项:"
            echo "  --skip-install     跳过依赖安装"
            echo "  --skip-build       跳过代码构建"
            echo "  --arch <arch>      指定架构: x64, arm64, armv7l (默认: 自动检测)"
            echo "  --target <target>  指定打包目标: all, deb, appimage, snap (默认: all)"
            echo "  --help             显示此帮助信息"
            echo ""
            echo "示例:"
            echo "  ./build-linux.sh                    # 打包所有格式"
            echo "  ./build-linux.sh --target deb       # 仅打包 deb"
            echo "  ./build-linux.sh --skip-install     # 跳过依赖安装"
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
    npm install
else
    log_warn "跳过依赖安装"
fi

# 2. 类型检查
log_info "执行类型检查..."
npm run typecheck

# 3. 构建代码
if [ "$SKIP_BUILD" = false ]; then
    log_info "构建应用代码..."
    npx electron-vite build
else
    log_warn "跳过代码构建"
fi

# 4. 打包应用
log_info "开始打包 Linux 应用 (架构: $ARCH, 目标: $TARGET)..."

BUILD_ARGS=""

# 根据架构添加参数
case $ARCH in
    x64)
        BUILD_ARGS="$BUILD_ARGS --x64"
        ;;
    arm64)
        BUILD_ARGS="$BUILD_ARGS --arm64"
        ;;
    armv7l)
        BUILD_ARGS="$BUILD_ARGS --armv7l"
        ;;
    *)
        log_error "不支持的架构: $ARCH"
        exit 1
        ;;
esac

# 根据目标添加参数
case $TARGET in
    all)
        # 默认打包所有格式（deb, AppImage, snap）
        BUILD_ARGS="--linux$BUILD_ARGS"
        ;;
    deb)
        BUILD_ARGS="--linux deb$BUILD_ARGS"
        ;;
    appimage)
        BUILD_ARGS="--linux AppImage$BUILD_ARGS"
        ;;
    snap)
        BUILD_ARGS="--linux snap$BUILD_ARGS"
        ;;
    *)
        log_error "不支持的目标: $TARGET"
        echo "支持的目标: all, deb, appimage, snap"
        exit 1
        ;;
esac

# 执行打包
npx electron-builder $BUILD_ARGS

# 5. 检查输出
log_info "检查打包输出..."

DIST_DIR="dist"
if [ ! -d "$DIST_DIR" ]; then
    log_error "打包失败：未找到 dist 目录"
    exit 1
fi

# 查找生成的文件
DEB_FILES=$(find "$DIST_DIR" -maxdepth 1 -name "*.deb" -type f 2>/dev/null || true)
APPIMAGE_FILES=$(find "$DIST_DIR" -maxdepth 1 -name "*.AppImage" -type f 2>/dev/null || true)
SNAP_FILES=$(find "$DIST_DIR" -maxdepth 1 -name "*.snap" -type f 2>/dev/null || true)

if [ -z "$DEB_FILES" ] && [ -z "$APPIMAGE_FILES" ] && [ -z "$SNAP_FILES" ]; then
    log_error "打包失败：未找到任何安装包文件"
    exit 1
fi

# 6. 显示结果
log_info "打包完成！"
echo ""
log_info "生成的文件："

if [ -n "$DEB_FILES" ]; then
    echo "$DEB_FILES" | while read -r file; do
        SIZE=$(du -h "$file" | cut -f1)
        echo "  📦 $(basename "$file") ($SIZE)"
        echo "     安装: sudo dpkg -i $(basename "$file")"
    done
fi

if [ -n "$APPIMAGE_FILES" ]; then
    echo "$APPIMAGE_FILES" | while read -r file; do
        SIZE=$(du -h "$file" | cut -f1)
        echo "  📦 $(basename "$file") ($SIZE)"
        echo "     运行: chmod +x $(basename "$file") && ./$(basename "$file")"
    done
fi

if [ -n "$SNAP_FILES" ]; then
    echo "$SNAP_FILES" | while read -r file; do
        SIZE=$(du -h "$file" | cut -f1)
        echo "  📦 $(basename "$file") ($SIZE)"
        echo "     安装: sudo snap install $(basename "$file") --dangerous"
    done
fi

echo ""
log_info "输出目录: $DIST_DIR"

# 7. 显示包信息（仅 deb）
if [ -n "$DEB_FILES" ] && command -v dpkg-deb &> /dev/null; then
    log_info "DEB 包信息："
    echo "$DEB_FILES" | while read -r file; do
        echo ""
        echo "  文件: $(basename "$file")"
        dpkg-deb -I "$file" | grep -E "Package|Version|Architecture|Maintainer|Description" | sed 's/^/  /'
    done
fi

log_info "✅ 所有操作完成"
