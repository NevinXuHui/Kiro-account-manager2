#!/bin/bash

# Electron deb 包安装后脚本
# 修复 chrome-sandbox SUID 权限和空格路径问题

APP_NAME="Kiro Account Manager"
APP_DIR_NOSPACE="kiro-account-manager"
OPT_DIR="/opt/${APP_NAME}"
OPT_DIR_NOSPACE="/opt/${APP_DIR_NOSPACE}"

# 1. 修复 chrome-sandbox SUID 权限（Chromium sandbox 需要 root:root + 4755）
if [ -f "${OPT_DIR}/chrome-sandbox" ]; then
  chown root:root "${OPT_DIR}/chrome-sandbox"
  chmod 4755 "${OPT_DIR}/chrome-sandbox"
fi

# 2. 处理安装路径含空格导致 execvp 失败的问题
#    将带空格的目录移动到无空格路径，再创建兼容软链接
if [ -d "${OPT_DIR}" ] && [ ! -L "${OPT_DIR}" ]; then
  # 仅在真实目录（非软链接）时执行迁移
  mv "${OPT_DIR}" "${OPT_DIR_NOSPACE}"
  ln -sf "${OPT_DIR_NOSPACE}" "${OPT_DIR}"

  # 修复迁移后的 chrome-sandbox 权限
  if [ -f "${OPT_DIR_NOSPACE}/chrome-sandbox" ]; then
    chown root:root "${OPT_DIR_NOSPACE}/chrome-sandbox"
    chmod 4755 "${OPT_DIR_NOSPACE}/chrome-sandbox"
  fi

  # 更新可执行文件的 alternatives 链接
  if [ -L "/usr/bin/${APP_DIR_NOSPACE}" ]; then
    ln -sf "${OPT_DIR_NOSPACE}/${APP_DIR_NOSPACE}" "/usr/bin/${APP_DIR_NOSPACE}"
  fi
fi

# 3. 更新桌面数据库和图标缓存（使应用出现在应用菜单中）
if command -v update-desktop-database > /dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi

if command -v gtk-update-icon-cache > /dev/null 2>&1; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true
fi

# 4. 刷新 MIME 类型数据库（支持 kiro:// 协议）
if command -v update-mime-database > /dev/null 2>&1; then
  update-mime-database /usr/share/mime || true
fi
