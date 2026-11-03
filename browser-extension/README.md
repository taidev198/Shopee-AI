# Tiện ích Chrome cho nút Quét sản phẩm

Tiện ích này chạy khi bạn bấm **Quét sản phẩm** trên MarketLens. Mỗi lượt mở
một tab Shopee mới bằng Chrome bạn đang sử dụng, đọc tên/giá/thông tin đang hiển
thị từ thẻ sản phẩm, chuyển kết quả về ứng dụng rồi đóng tab đó. Khi bật **Đọc
chi tiết từng sản phẩm** (mặc định), ứng dụng tiếp tục mở lần lượt từng sản phẩm
để đọc mô tả, ảnh, thuộc tính, phân loại, giá hiển thị, đánh giá và tình trạng hàng.
Mỗi trang được đóng sau khi đọc. Mỗi lượt đọc
tối đa 5 trang và 150 sản phẩm; không có dữ liệu sản phẩm mẫu trong tiện ích.

## Cài một lần

1. Trong Chrome thường dùng, mở `chrome://extensions` và bật **Developer mode**.
2. Bấm **Load unpacked** và chọn thư mục `browser-extension` của dự án.
3. Mở hoặc tải lại `http://127.0.0.1:8000` (hoặc `http://localhost:8000`).
4. Chọn chế độ Chrome trên ứng dụng, nhập URL shop rồi bấm **Quét sản phẩm**.

Sau khi sửa mã tiện ích, bấm biểu tượng **Reload** của tiện ích trong
`chrome://extensions` và tải lại trang MarketLens.

Tiện ích chỉ hoạt động trên trang MarketLens ở cổng 8000 và trang Shopee Việt
Nam. Quyền `scripting` phục vụ đọc DOM công khai; không có quyền cookies,
debugger hay truy cập các website khác. Nếu Shopee chuyển tới trang xác minh
hoặc đăng nhập, lượt quét dừng và giữ tab Shopee đó để bạn xử lý thủ công.
Nếu sai shop hoặc rời Shopee, lượt quét dừng với thông báo cụ thể. Đăng nhập thông
thường do Chrome quản lý; tiện ích không đọc hay xuất thông tin đăng nhập.

## Giao tiếp với ứng dụng

Trang gửi qua `window.postMessage(message, window.location.origin)`:

```js
{source: 'marketlens-app', requestId: '<unique id>', action: 'ping'}
{source: 'marketlens-app', requestId: '<unique id>', action: 'collect', url: 'https://shopee.vn/ten_shop'}
{source: 'marketlens-app', requestId: '<unique id>', action: 'detail', url: 'https://shopee.vn/product/<shop_id>/<item_id>'}
{source: 'marketlens-app', requestId: '<unique id>', action: 'discover', query: 'từ khóa sản phẩm', ownShopUrl: 'https://shopee.vn/shop_cua_ban'}
```

Trang lắng nghe thông điệp cùng window, cùng origin:

```js
{source: 'marketlens-extension', requestId: '<same id>', ok: true, result: {pages: [{url, cards: [{href, name, text}]}]}}
{source: 'marketlens-extension', requestId: '<same id>', ok: false, error: '<message>'}
```

`ping` trả `{version, maxPages, maxProducts, details: true, capabilities: {discover: true, categories: true, categoryCatalog: true, verificationPause: true, tabEditRetry: true, categoryCardsV2: true, categoryParallel: 4}, mode: 'chrome_dom'}`.
`detail` trả `{detail: {url, name, description, images, attributes, variants,
categories, price_text, rating_text, review_count_text, sold_text, stock_text}}`.
Mỗi yêu cầu `collect` có giới hạn 150 giây; mỗi `detail` có giới hạn 90 giây.
Mỗi hàng đợi đọc tuần tự từng trang; các hàng đợi ngành hàng có thể chạy song song.
Ứng dụng lưu danh sách trước rồi lưu
ngay từng chi tiết qua `/product-result`; mốc chờ 5 phút được gia hạn sau mỗi
sản phẩm, không giới hạn toàn bộ shop trong một thông điệp dài. Khi dừng hoặc
gặp chặn xác minh, dữ liệu đã lưu vẫn còn; nút **Dừng sau sản phẩm hiện tại**
kết thúc sau trang đang đọc. Giữ trang MarketLens mở trong khi quét.

Giá ở danh sách và giá trên trang chi tiết được giữ riêng vì Shopee có thể hiển
thị giá ưu đãi hoặc khoảng giá khác nhau. Tình trạng hàng là văn bản công khai,
không suy đoán số lượng tồn kho. Tiện ích không bấm mua hoặc thêm vào giỏ hàng,
không tải bình luận hay thông tin người đánh giá.

## Tự tìm đối thủ (1.2.0)

Tab **Đối thủ & thị trường** tạo tối đa ba từ khóa từ sản phẩm thuộc các nhóm
hàng chính của shop. Nút **Tự tìm & phân tích** gửi lần lượt từng từ khóa tới
tiện ích. Mỗi lần `discover` mở trang tìm kiếm Shopee, đọc tối đa sáu sản phẩm
trong vùng kết quả (bỏ quảng cáo), rồi xác minh tối đa ba người bán bằng liên
kết **Xem shop** trên trang sản phẩm. Không đoán tên shop từ ID và không có
danh sách đối thủ cố định trong mã.

Kết quả gồm `{query, candidates: [{url, name, product_url, product_name, query}],
errors, blocked?}`. Mỗi yêu cầu có giới hạn 120 giây. Ứng dụng loại shop mình
và shop trùng, hiển thị từ khóa cùng sản phẩm minh chứng, rồi tự quét shop đầu
tiên. Mặc định chỉ đọc chi tiết mẫu 20 sản phẩm đối thủ để có kết quả sớm; danh
sách shop vẫn được lưu đầy đủ trong giới hạn 150 sản phẩm/lượt. Các shop còn
lại có nút **Quét & so sánh**. Nếu bị chặn xác minh, tiện ích dừng và giữ các
ứng viên đã xác minh; ứng dụng không tiếp tục tự quét lúc đang bị chặn.

Chạy kiểm thử tiện ích với `npm test --prefix browser-extension`.

### Phiên bản 1.3.6 — quét tất cả ngành hàng song song

Nạp lại tiện ích và trang MarketLens sau khi cập nhật. Nút **Quét tất cả ngành hàng** dùng action `categories` đọc danh mục thực tế từ trang chủ, tạo hàng đợi cho từng ngành, dùng `category` đọc từng trang danh sách rồi `detail` mở từng sản phẩm. Chế độ này tiếp tục phân trang đến điểm cuối được hiển thị, không dùng giới hạn 5 trang / 150 sản phẩm của lượt quét shop. Database lưu con trỏ trang và kết quả từng sản phẩm; bấm **Chạy / tiếp tục tất cả** sau khi bị ngắt.

Danh mục chỉ được đọc trong vùng danh mục trang chủ, không lấy link SEO ở chân trang. `categories` trả `{categories, catalog_complete, note?}`; nếu thanh danh mục không xác nhận điểm cuối, ứng dụng giữ danh sách đã đọc và báo chưa đủ, không tự tạo một lượt mang tên quét tất cả. Bộ đọc trang ngành hàng kiểm tra trang đang hiển thị, trạng thái phân trang và thông báo không có kết quả. Mỗi request có thời hạn; tab riêng được đóng sau khi đọc.

Không bổ sung quyền trình duyệt. Chỉ đọc DOM hiển thị, dừng khi cần đăng nhập/xác minh. Phạm vi thu thập là những trang Shopee cho hiển thị trong Chrome, không phải cam kết lấy toàn bộ catalog nội bộ. Giữ MarketLens mở khi chạy; lịch chạy do trang đang mở nhận từ database, service worker không tự lên lịch khi đóng ứng dụng.

### Khi gặp CAPTCHA

Tiện ích giữ nguyên tab Shopee của tác vụ đang bị yêu cầu xác minh và giải phóng lượt quét; không tự bấm CAPTCHA, tải lại hoặc thử liên tục. Hoàn tất xác minh thủ công trong tab đó. Nếu Shopee báo **Please Try Again Later**, chờ đến khi có thể mở sản phẩm bình thường. Sau đó trở lại MarketLens: bấm **Quét tất cả ngành hàng** nếu chưa tạo được hàng đợi, hoặc **Chạy / tiếp tục tất cả** nếu đã có hàng đợi. Sản phẩm đã lưu và con trỏ trang được giữ nguyên. Yêu cầu bị chặn trả `blocked: true, verificationRequired: true`; chỉ tab Shopee do tác vụ tạo mới được giữ, không thay đổi tab có sẵn của người dùng.

### Khi Chrome khóa thao tác tab

Bản 1.3.6 chờ và thử lại việc mở, chuyển hoặc đóng tab khi Chrome trả lỗi `Tabs cannot be edited right now (user may be dragging a tab)`. Chỉ lỗi khóa tab này được thử lại, tối đa 6 giây và trong thời hạn tác vụ; dọn tab thử lại tối đa 2 giây. Nếu Chrome vẫn khóa, hàng đợi tạm dừng với mã `chrome_tabs_busy`; thả tab đang kéo rồi bấm **Chạy / tiếp tục tất cả**. Sản phẩm đang chờ vẫn ở trong hàng đợi, không bị đánh dấu hỏng. Lỗi Shopee yêu cầu CAPTCHA vẫn dừng để xác minh thủ công.

### Bố cục mới và chạy song song

Bản 1.3.6 hỗ trợ các nhóm thẻ sản phẩm trong vùng nội dung chính và các liên kết phân trang công khai cùng ID ngành. Không lấy sản phẩm ở chân trang hoặc banner ngoài danh sách. Nếu trang chưa đọc được sau thời hạn, trả `category_page_timeout` và giữ tab Shopee của tác vụ với `inspectionRequired: true`; đây là yêu cầu kiểm tra trang, tách biệt với yêu cầu xác minh CAPTCHA.

Tối đa 4 yêu cầu `category` / `detail` chạy đồng thời. Một campaign vẫn có thể xếp hàng tới 100 ngành; ngành tiếp theo bắt đầu khi có chỗ trống. Mỗi yêu cầu có tab riêng và chỉ đóng tab do nó tạo. Đọc danh mục trang chủ, quét shop và tìm đối thủ giữ chế độ độc quyền. Khi đủ 4 tác vụ, yêu cầu tiếp theo trả `code: 'chrome_collection_busy', retryable: true, maxParallel: 4, activeCollections: 4, busyReason: 'capacity'` mà không mở thêm tab. Giao diện MarketLens có thể phân phối tất cả ngành đã chọn, tránh trùng ID ngành và lưu từng checkpoint trước tác vụ tiếp theo. Khi một tác vụ kết thúc, lỗi hoặc tạm dừng xác minh, chỗ chạy của nó được giải phóng; tab xác minh vẫn giữ mở để người dùng xử lý thủ công.


### Phiên bản 1.3.7 — tránh quá tải khi tiếp tục toàn bộ

**Chạy / tiếp tục tất cả** đưa toàn bộ ngành cần chạy vào hàng đợi, với tối đa 4 tab thu thập cùng lúc (hoặc 2 nếu chọn mức 2). Bản ứng dụng mới vẫn giới hạn 4 khi tiện ích cũ báo khả năng 100. Trang chi tiết có tối đa 90 giây để hiện dữ liệu; không đợi tài nguyên phụ tải xong nếu DOM đã đúng sản phẩm và thông tin ổn định. Bridge chờ tối đa 120 giây để nhận kết quả.

Lỗi `product_detail_timeout` chỉ thử lại sản phẩm đó một lần. Nếu vẫn lỗi, ghi sản phẩm vào danh sách lỗi rồi tiếp tục sản phẩm và ngành khác; **Tiếp tục / thử lại** sẽ đưa các sản phẩm lỗi vào hàng đợi lại. Tab sản phẩm quá hạn được đóng trước lần thử mới để không tích tụ tab. Tối đa 4 tab ngành hàng lỗi được giữ để kiểm tra; tab người dùng đã chuyển sang trang khác và tab xác minh không bị dọn. CAPTCHA, mất kết nối hoặc lỗi lưu database vẫn dừng để tránh mất tiến độ.

Nạp lại tiện ích từ thư mục `browser-extension`, rồi tải lại MarketLens để dùng bản 1.3.7; không thay đổi quyền truy cập.
