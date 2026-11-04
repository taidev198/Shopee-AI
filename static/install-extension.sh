#!/bin/bash
# MarketLens: tải và giải nén tiện ích Chrome, rồi mở sẵn trang cài đặt.
# Dùng:  curl -fsSL https://<trang-web>/static/install-extension.sh | bash -s -- https://<trang-web>
set -e
SITE="${1:-https://shopee-ai.onrender.com}"
DEST="$HOME/MarketLens-Extension"
TMP="$(mktemp -d)"
echo "Đang tải tiện ích từ $SITE ..."
curl -fsSL "$SITE/static/marketlens-chrome-extension.zip" -o "$TMP/ext.zip"
rm -rf "$DEST"; mkdir -p "$DEST"
unzip -q "$TMP/ext.zip" -d "$TMP/out"
cp -R "$TMP/out/browser-extension/." "$DEST/"
rm -rf "$TMP"
echo "Đã giải nén vào: $DEST"
if command -v pbcopy >/dev/null; then printf '%s' "$DEST" | pbcopy; echo "(Đã sao chép đường dẫn vào clipboard)"; fi
if [ "$(uname)" = "Darwin" ]; then
  open -a "Google Chrome" "chrome://extensions" 2>/dev/null || true
  open "$DEST" 2>/dev/null || true
fi
cat <<MSG

Còn 3 bước trong Chrome (chỉ làm một lần):
  1. Bật "Chế độ dành cho nhà phát triển" (góc trên bên phải).
  2. Bấm "Tải tiện ích đã giải nén".
  3. Chọn thư mục: $DEST   (nhấn Cmd+Shift+G rồi dán đường dẫn)
Sau đó tải lại trang MarketLens.
MSG
