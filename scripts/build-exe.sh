#!/bin/bash
#
# Task 12.2: Mac 可執行檔產生腳本
#
# 此腳本將打包好的 SEA blob 注入 Node.js binary，
# 產生可獨立執行的 Mac 應用程式。
#
# Requirements: 9.1, 9.3, 9.4
# - 使用 postject 將 SEA blob 注入 Node.js binary
# - 處理 macOS 程式碼簽署：移除原簽署後重新 ad-hoc 簽署
# - 驗證執行檔可正常啟動命令列介面
#
# 用法:
#   ./scripts/build-exe.sh [--arch x64|arm64]
#
# 需要先執行:
#   npm run build:bundle
#   npm run build:sea
#

set -e

# 顏色輸出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 預設值
ARCH="${1:-$(uname -m)}"
OUTPUT_DIR="dist"
EXE_NAME="tg-migrate"
BLOB_PATH="${OUTPUT_DIR}/sea-prep.blob"

# 將 arm64 別名標準化
if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
  ARCH="arm64"
fi

echo -e "${GREEN}=== Mac 可執行檔產生腳本 ===${NC}"
echo "目標架構: ${ARCH}"
echo "輸出目錄: ${OUTPUT_DIR}"

# 檢查必要檔案
if [ ! -f "$BLOB_PATH" ]; then
  echo -e "${RED}錯誤: SEA blob 不存在: ${BLOB_PATH}${NC}"
  echo "請先執行: npm run build:sea"
  exit 1
fi

# 檢查 postject 是否已安裝
if ! npx postject --help > /dev/null 2>&1; then
  echo -e "${YELLOW}正在安裝 postject...${NC}"
  npm install --save-dev postject
fi

# 複製 Node.js binary
echo -e "${GREEN}複製 Node.js binary...${NC}"
NODE_PATH="$(which node)"
EXE_PATH="${OUTPUT_DIR}/${EXE_NAME}"

cp "$NODE_PATH" "$EXE_PATH"

# 檢查平台
if [ "$(uname)" = "Darwin" ]; then
  # macOS: 移除原有簽署
  echo -e "${GREEN}移除原有程式碼簽署 (macOS)...${NC}"
  codesign --remove-signature "$EXE_PATH" 2>/dev/null || true
fi

# 使用 postject 注入 SEA blob
echo -e "${GREEN}注入 SEA blob...${NC}"
npx postject "$EXE_PATH" NODE_SEA_BLOB "$BLOB_PATH" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

if [ "$(uname)" = "Darwin" ]; then
  # macOS: 重新簽署 (ad-hoc)
  echo -e "${GREEN}重新簽署執行檔 (ad-hoc)...${NC}"
  codesign --sign - "$EXE_PATH"
fi

# 設定執行權限
chmod +x "$EXE_PATH"

# 驗證執行檔
echo -e "${GREEN}驗證執行檔...${NC}"
if "$EXE_PATH" --help > /dev/null 2>&1; then
  echo -e "${GREEN}驗證成功！${NC}"
else
  echo -e "${YELLOW}警告: 執行檔驗證可能需要額外權限${NC}"
fi

# 顯示結果
EXE_SIZE=$(du -h "$EXE_PATH" | cut -f1)
echo ""
echo -e "${GREEN}=== 建置完成 ===${NC}"
echo "執行檔路徑: ${EXE_PATH}"
echo "檔案大小: ${EXE_SIZE}"
echo ""
echo "使用方式:"
echo "  ${EXE_PATH} --help"
echo "  ${EXE_PATH} migrate --dry-run"
