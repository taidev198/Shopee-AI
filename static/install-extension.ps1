# MarketLens: tải và giải nén tiện ích Chrome (Windows), rồi mở sẵn trang cài đặt.
# Dùng:  $s='https://<trang-web>'; irm "$s/static/install-extension.ps1" | iex
param([string]$Site = $(if ($s) { $s } else { 'https://shopee-ai.onrender.com' }))
$dest = Join-Path $env:USERPROFILE 'MarketLens-Extension'
$tmp = Join-Path $env:TEMP ('ml-ext-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
Write-Host "Đang tải tiện ích từ $Site ..."
Invoke-WebRequest "$Site/static/marketlens-chrome-extension.zip" -OutFile "$tmp\ext.zip"
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Expand-Archive "$tmp\ext.zip" -DestinationPath "$tmp\out"
Copy-Item "$tmp\out\browser-extension" $dest -Recurse
Remove-Item $tmp -Recurse -Force
Set-Clipboard $dest
Write-Host "Đã giải nén vào: $dest (đường dẫn đã được sao chép)"
Start-Process chrome 'chrome://extensions'
Start-Process explorer $dest
Write-Host "Trong Chrome: bật Chế độ nhà phát triển > Tải tiện ích đã giải nén > chọn thư mục trên. Sau đó tải lại trang MarketLens."
