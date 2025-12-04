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

# ========================================
# 打包成 zip 供分發
# ========================================
echo ""
echo -e "${GREEN}=== 打包分發版本 ===${NC}"

RELEASE_DIR="${OUTPUT_DIR}/release"
ZIP_NAME="tg-migrate-mac.zip"

# 建立 release 目錄
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# 複製執行檔
cp "$EXE_PATH" "$RELEASE_DIR/"

# 產生 README.txt
cat > "$RELEASE_DIR/README.txt" << 'EOF'
Telegram 訊息遷移工具
====================

首次執行前，請在終端機執行以下指令移除隔離屬性（macOS）：

  xattr -cr ./tg-migrate

================================================================================
可用指令
================================================================================

1. 查看說明
   ./tg-migrate --help

2. 列出所有對話（取得 Dialog ID）
   ./tg-migrate list                    # 列出所有對話
   ./tg-migrate list --type private     # 只列出私聊
   ./tg-migrate list --type group       # 只列出群組
   ./tg-migrate list --type supergroup  # 只列出超級群組

3. 執行遷移
   ./tg-migrate migrate                 # 遷移所有對話（預設指令）
   ./tg-migrate migrate --dialog <ID>   # 只遷移指定的對話
   ./tg-migrate migrate --dry-run       # 預覽模式（不實際遷移）
   ./tg-migrate migrate --from 2024-01-01 --to 2024-12-31  # 日期範圍過濾

4. 查看遷移狀態
   ./tg-migrate status                  # 顯示目前的遷移進度與對話清單

5. 重置遷移進度（重新遷移）
   ./tg-migrate reset --dialog <ID>     # 重置指定對話，下次執行會重新遷移
   ./tg-migrate reset --dialog 123,456  # 重置多個對話（用逗號分隔）
   ./tg-migrate reset --all             # 重置所有對話（需確認）
   ./tg-migrate reset --all --force     # 重置所有對話（跳過確認）

6. 匯出/匯入進度
   ./tg-migrate export backup.json      # 匯出進度到檔案
   ./tg-migrate import backup.json      # 從檔案匯入進度

7. 清除資料
   ./tg-migrate clean                   # 清除所有本機資料（session、進度檔案）
   ./tg-migrate clean --force           # 跳過確認提示

================================================================================
全域選項
================================================================================

  -c, --config <path>    設定檔路徑（預設：./config.json）
  -p, --progress <path>  進度檔路徑（預設：./migration-progress.json）
  -v, --verbose          顯示詳細日誌（DEBUG 等級）
  -q, --quiet            安靜模式（只顯示錯誤）

================================================================================
環境變數設定（可選）
================================================================================

  TG_API_ID          Telegram API ID
  TG_API_HASH        Telegram API Hash
  TG_PHONE_A         來源帳號電話號碼（含國碼，如 +886912345678）
  TG_TARGET_USER_B   目標帳號使用者名稱（如 @username）

若未設定環境變數，程式會在執行時提示輸入。

================================================================================
斷點續傳與重新遷移
================================================================================

遷移過程中隨時可按 Ctrl+C 中斷，進度會自動保存。
下次執行相同指令時會從中斷點繼續，不會重複遷移已處理的訊息。

若需要重新遷移某個對話：
1. 執行 ./tg-migrate status 查看對話 ID
2. 執行 ./tg-migrate reset --dialog <ID> 重置該對話
3. 重新執行 ./tg-migrate migrate

================================================================================
注意事項
================================================================================

- 遷移會為每個來源對話建立一個新的群組
- 目標帳號會被邀請加入這些群組
- 每日群組建立有上限（預設 50 個），達到上限後會自動暫停
- FloodWait 限流時程式會自動等待或暫停

EOF

# 壓縮
cd "$OUTPUT_DIR"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" release/
cd - > /dev/null

ZIP_SIZE=$(du -h "${OUTPUT_DIR}/${ZIP_NAME}" | cut -f1)
echo -e "${GREEN}分發檔案: ${OUTPUT_DIR}/${ZIP_NAME}${NC}"
echo "壓縮檔大小: ${ZIP_SIZE}"
