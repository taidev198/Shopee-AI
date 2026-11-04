# MarketLens — Shopee Market Intelligence + Chrome collector

Web local phân tích **một shop Shopee cụ thể**, so sánh các shop tham chiếu và gợi ý sản phẩm phù hợp ngành hàng. Bản này được mở rộng từ v0.1: thêm worker Playwright đọc thẻ sản phẩm hiển thị công khai, hàng đợi, lịch quét, dữ liệu tích lũy và dự đoán tốc độ bán từ snapshot.


## Chức năng

1. **Workspace shop**: nhập `https://shopee.vn/ten_shop`, phân loại ngành hàng.
2. **Chrome collector**: nút Quét gọi tiện ích trong Chrome thường dùng, đọc dữ liệu mới từ trang shop, tự phân trang và lưu kết quả. Worker Playwright là chế độ tùy chọn. Lấy tên, link, giá hiển thị và số đã bán tích lũy nếu có.
3. **Job queue**: chạy bot trong worker nền; xem trạng thái `queued`, `running`, `done`, `failed`; lỗi đầy đủ trên dashboard.
4. **Lịch quét**: lên lịch 24h / 48h / 7 ngày. Lưu các bản snapshot SQLite. Chỉ chạy khi ứng dụng còn hoạt động.
5. **Tốc độ bán ước tính**: nếu có hai số *đã bán tích lũy* cách nhau từ 7–90 ngày, hiển thị `≈ (sold_mới - sold_cũ) × 30 / số_ngày`, và gắn nhãn **ước tính từ snapshot**, không phải doanh thu 30 ngày được Shopee xác nhận.
6. **Khám phá sản phẩm**: khi chỉ có `sold_total` tích lũy, vẫn xếp hạng *sơ bộ* nhưng giới hạn điểm tối đa 65/100 và độ tin cậy `Rất thấp`. Không biến `sold_total` thành đơn bán 30 ngày.
7. **CSV/XLSX**: tiếp tục hỗ trợ dữ liệu Seller Center và dữ liệu hợp lệ bên ngoài, giữ nguyên dữ liệu demo giả lập và xuất cơ hội sản phẩm CSV.

## Chạy trên MacBook (Python 3.11+)

```bash
cd shopee-market-intelligence
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Mở http://127.0.0.1:8000 để xem Home dành cho Guest. Lần đầu, mở http://127.0.0.1:8000/setup và tự tạo tài khoản System (mật khẩu ít nhất 12 ký tự). Không có mật khẩu mặc định. System vào `/system` để quản lý dữ liệu, thu thập và tạo tài khoản User; User đăng nhập vào `/user` để phân tích shop được cấp quyền.

Cài Chromium trước khi chạy web:

```bash
python -m playwright install chromium
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Crawler không yêu cầu biến cấu hình cấp phép. Hệ thống vẫn dừng nếu robots.txt không cho phép hoặc không thể kiểm tra.

Nếu cài trên macOS qua `./start_mac.command`, script tự cài thư viện Python. Script cũng cài Chromium.



## Nút Quét trực tiếp qua Chrome

Chế độ mặc định **Chrome đang dùng** thực hiện luồng đầy đủ từ mỗi lần bấm:

1. Trang MarketLens kiểm tra tiện ích Chrome đã kết nối.
2. Server tạo một lượt quét mới cùng mã gửi kết quả dùng một lần (hết hạn sau 5 phút).
3. Tiện ích mở một tab mới trong Chrome thường dùng, đọc DOM của shop, cuộn và chuyển trang (tối đa 5 trang/150 sản phẩm), rồi đóng tab của lượt quét.
4. Trang gửi kết quả mới về server; server kiểm tra đúng shop, lưu với nguồn `chrome_live_dom`, kết thúc lượt quét và cập nhật báo cáo.

Luồng này không gọi công cụ trong chat, không dùng tệp `exports` hoặc dữ liệu đã nhập để giả lập kết quả. Mỗi lần bấm đọc lại trang hiện tại. Nếu Shopee chặn ngay trong Chrome hoặc yêu cầu đăng nhập, lượt quét báo lỗi thay vì dùng kết quả cũ. Lịch định kỳ hiện vẫn dùng worker Chromium; tiện ích này phục vụ thao tác bấm Quét.

**Kết nối một lần:** mở `chrome://extensions` trong Chrome, bật **Developer mode**, bấm **Load unpacked**, chọn thư mục `browser-extension` trong dự án, rồi tải lại `http://127.0.0.1:8000`. Hoặc tải `/static/marketlens-chrome-extension.zip`, giải nén và chọn thư mục `browser-extension`. Tiện ích chỉ chạy từ trang ứng dụng localhost cổng 8000 và được cấp quyền chạy mã trên Shopee Việt Nam; không cần quyền cookies hay debugger. Chi tiết ở `browser-extension/README.md`.

Nếu báo **Chưa kết nối tiện ích MarketLens**, hãy kiểm tra đã nạp đúng thư mục có `manifest.json`, bật tiện ích và tải lại trang ứng dụng trong cùng Chrome. Không dùng cửa sổ trình duyệt bên trong Codex cho chế độ này. Sau khi sửa mã server, khởi động lại Uvicorn; sau khi sửa mã tiện ích, bấm Reload của tiện ích và tải lại MarketLens.

## Cách quét một shop và tìm cơ hội

1. Tạo workspace shop mục tiêu (ví dụ Family's House). **Demo Family's House ở màn hình ban đầu là dữ liệu giả lập, không phải dữ liệu shop thật.**
2. Bấm **Bot thu thập**, chọn `Shop đang phân tích` hoặc `Đối thủ / thị trường`, nhập URL của shop cần thu thập. Chế độ **Chromium có hỗ trợ** mở Chromium trên máy chạy ứng dụng. Bạn tự đăng nhập hoặc thao tác trên trang nếu cần, rồi mở lại đúng URL shop. Bot chờ tối đa 3 phút và chỉ thu thập khi danh sách sản phẩm hiển thị. Đóng trình duyệt để dừng sớm.
3. Xem danh sách lượt chạy ở cuối tab, kiểm tra số sản phẩm nhập thành công.
4. Thu thập thêm shop đối thủ trong cùng ngành → vào **Cơ hội sản phẩm** để xem điểm ưu tiên và lý do.
5. Đặt lịch 24h hoặc 7 ngày để so sánh giá và thay đổi số đã bán tích lũy. Ban đầu chưa đủ snapshot thì không thể suy ra tốc độ bán.

## So sánh đối thủ và chọn sản phẩm để nghiên cứu

**So sánh theo sản phẩm chủ lực:** bấm **Tìm đối thủ cho top sản phẩm** để tìm
cho ba sản phẩm đứng đầu của shop và đọc tối đa ba mặt hàng đối thủ cho mỗi
sản phẩm. Mỗi kết quả được lưu ngay, gắn với sản phẩm shop bạn và từ khóa đã
tìm; không thay thế danh sách đối thủ đã quét. Bảng hiển thị shop/sản phẩm,
khoảng giá các phân loại, tổng đã bán, số lượt đánh giá, điểm sao, mức khớp và
ngày dữ liệu. Có thể bấm **Tìm đối thủ sản phẩm này** hoặc **Tìm thêm đối thủ**
ở từng mặt hàng.

Thứ tự ưu tiên dùng số bán 30 ngày khi có dữ liệu, nếu không dùng tổng đã bán
hiển thị và ghi rõ cơ sở xếp hạng. “Tên tương tự” và “ứng viên từ tìm kiếm”
không xác nhận hai mặt hàng giống hoàn toàn về mẫu, vật liệu hay quy cách.
Giá trên trang chi tiết và giá danh sách được ghi riêng khi có hai nguồn.

1. Chọn workspace shop của bạn, mở **Đối thủ & thị trường** và bấm **Tự tìm & phân tích** (tiện ích 1.2.0). Ứng dụng lấy từ khóa từ các nhóm sản phẩm thật của shop, tìm trên Shopee, xác minh liên kết người bán, loại shop mình và shop trùng rồi tự quét shop đầu tiên. Các ứng viên còn lại có nút **Quét & so sánh** cùng từ khóa và sản phẩm minh chứng. Có thể nhập link thủ công trong mục thu gọn khi đã biết shop muốn so sánh.
2. Xem giá trung vị của shop bạn và từng đối thủ, đánh giá, số đã bán hiển thị, độ đầy đủ và ngày quan sát. Giá trung vị tính từ các sản phẩm có giá trong mẫu đã theo dõi.
3. So sánh giá ở bảng nhóm hàng: phần trăm chênh lệch chỉ xuất hiện khi cả hai bên có giá trong cùng nhóm. Chênh lệch giá giữa hai danh mục không chứng minh giá của cùng một sản phẩm khác nhau.
4. Xem các sản phẩm đáng nghiên cứu cùng điểm và lý do. Ngành hàng, số đánh giá và số đã bán còn thiếu trên thẻ shop được bổ sung từ lần đọc chi tiết thành công. Giá danh sách vẫn được giữ riêng với giá trên trang chi tiết.
5. Lọc sản phẩm theo shop, nhóm hàng hoặc tên; bấm tên để xem ảnh, mô tả và phân loại đã lưu.

Mặc định đọc chi tiết mẫu 20 sản phẩm đối thủ; có thể chọn 50 hoặc tối đa 150. Danh sách vẫn được lưu trong giới hạn của lượt quét. Quét shop mình tiếp tục đọc toàn bộ sản phẩm đã tìm thấy như trước. Không cần đưa danh sách đối thủ cho ứng dụng hoặc nhập sản phẩm bằng tay để bắt đầu.

`Đã bán` là số tích lũy hiển thị trên Shopee; `1k+` giữ ý nghĩa mức tối thiểu, không phải số bán trong tháng. Tổng chỉ tính những sản phẩm có dữ liệu và kèm độ phủ. Điểm dựa trên số tích lũy hoặc lượt đánh giá là gợi ý khám phá với độ tin cậy thấp; cần kiểm tra nguồn hàng và nhu cầu trước khi chọn bán. Chi tiết giữ lại từ lần đọc cũ có ngày thu thập để đối chiếu.

Tổng quan phân tích dùng toàn bộ sản phẩm đối thủ đã theo dõi. Danh sách chi tiết trên dashboard có giới hạn 300 sản phẩm và phân trang; giao diện báo rõ khi đang hiển thị một phần dữ liệu. Shop đang phân tích không thể được quét làm đối thủ của chính nó.

Phiên trình duyệt được lưu cục bộ trong `.browser-profile` cạnh cơ sở dữ liệu, được loại khỏi Git. Các lượt **Chạy nền** và lịch tự động dùng lại phiên này nếu đã có; phiên đăng nhập vẫn có thể hết hạn hoặc bị Shopee từ chối. Bot không nhập thông tin đăng nhập hay giải CAPTCHA thay người dùng. Chế độ mở trình duyệt cần máy có giao diện đồ họa (ví dụ chạy trực tiếp trên Mac); lịch tự động không mở cửa sổ và không chờ thao tác.

Nếu Chromium của bot luôn bị chuyển sang `/verify/traffic/error` nhưng trình duyệt thường xem được sản phẩm, dùng mục **Nhập sản phẩm từ trình duyệt của bạn** trong tab Bot thu thập:

1. Mở shop trong Chrome/Safari thường dùng, cuộn để các thẻ sản phẩm tải xong.
2. Nhấn **Cmd + S**, lưu dưới dạng **HTML / Trang web, hoàn chỉnh**. Không dùng MHTML hoặc PDF.
3. Chọn tệp `.html` hoặc `.htm` (tối đa 8MB), URL shop, vai trò và ngày lưu trang rồi bấm **Nhập sản phẩm từ HTML**.

Ứng dụng đọc nội dung tệp cục bộ, không thực thi script hay tải thêm nội dung từ Shopee. Chỉ nhập tối đa 150 sản phẩm có trong tệp và gắn nguồn `saved_browser_dom`; chỉ số 30 ngày chưa biết vẫn để trống. Nếu canonical/og:url chỉ ra shop khác hoặc trang lỗi, tệp bị từ chối. Nếu tệp không có metadata URL thì người nhập cần kiểm tra đúng shop. Lưu riêng các trang phân trang để lấy thêm sản phẩm. Nhập lại cùng SKU, vai trò, shop nguồn và ngày sẽ cập nhật snapshot đó.

Đã kiểm chứng bằng tab Chrome thường dùng ngày 13/10/2026: thu được 53 SKU riêng biệt của `familys_house` từ hai trang sản phẩm, khớp số lượng 53 sản phẩm hiển thị trên shop. Cả 53 có giá; 29 có số đã bán tích lũy hiển thị. Bản chụp thẻ sản phẩm được lưu trong `exports/familys-house-2026-10-13.html`. Kết quả này không xác nhận worker Chromium chạy nền đã hết bị chặn.

**Dữ liệu crawl không bảo đảm đầy đủ:** Shopee thay đổi DOM thường xuyên, có lazy loading, A/B test, trang yêu cầu xác minh, giới hạn hiển thị. Bot chờ thẻ sản phẩm tối đa 15 giây, gom dữ liệu trước và sau mỗi lần cuộn (mặc định ba lần), tối đa 150 sản phẩm/lượt. Không đảm bảo toàn bộ SKU của shop. Crawler là giải pháp dựa trên trang công khai, **không phải API ổn định**.

**Chẩn đoán lượt quét lỗi:** HTTP 200 của `GET /api/crawl/jobs` chỉ xác nhận giao diện tải được lịch sử. Kết quả thu thập nằm ở `status`, `rows_imported` và `error` của từng lượt quét. Worker phân biệt chuyển hướng đăng nhập, xác minh, chặn lưu lượng, lỗi HTTP và không có thẻ sản phẩm; đồng thời ghi lý do vào log máy chủ. Kiểm tra trực tiếp ngày 13/10/2026 với `https://shopee.vn/familys_house`: phiên bot bị chuyển tới `/verify/traffic/error`, không nhận được danh sách sản phẩm. Sửa parser hoặc chờ lâu hơn không giải quyết việc trang từ chối truy cập đó.

## API

### Guest và Seller Workspace

`/` là Home công khai cho Guest, dùng số liệu minh họa có nhãn và calculator tương tác; `/guest` chuyển về Home. `/user` là Seller Workspace có đăng nhập; `/system` dành cho System. `/workspace` tương thích đường dẫn cũ và chuyển tới khu vực tương ứng với `view`. Ví dụ `/user?view=optimizer&shop_id=...` hoặc `/system?view=categoryMarket`.

**Đăng nhập và phân quyền:** lần đầu tự tạo tài khoản System tại `/setup`. Sau đó vào System → **Tài khoản & quyền shop**, tạo User và chọn các shop được phép phân tích. Tài khoản User không tự thấy shop cũ, kể cả shop demo, nếu chưa được gán. Có thể thu hồi quyền shop hoặc tạm khóa User; tạm khóa hủy các phiên đăng nhập hiện có. System được truy cập toàn bộ shop và có thể mở cả User Workspace. Home luôn xem được khi chưa đăng nhập.

Quyền được kiểm tra ở máy chủ cho cả trang và API. User chỉ đọc/phân tích shop được gán, lưu chi phí và kế hoạch của shop đó, dùng AI đã được System cấu hình, và đọc dataset ngành hàng dùng chung. Thu thập, nhập dữ liệu, lịch quét, cấu hình AI và quản lý tài khoản dành cho System. Tab User không chạy hàng đợi thu thập trong nền. Lịch thu thập Chrome cần mở trang System với phiên đăng nhập còn hiệu lực.

Phiên đăng nhập có thời hạn 12 giờ, dùng cookie HttpOnly/SameSite Strict; mật khẩu được băm có salt và phiên chỉ lưu digest token trong database. Với API: đăng nhập `POST /api/auth/login` từ đúng origin của ứng dụng, giữ cookie và gửi `X-CSRF-Token` từ phản hồi hoặc `GET /api/auth/me` trong các yêu cầu thay đổi dữ liệu. API không công khai yêu cầu đăng nhập; connector nhập dữ liệu còn cần `MARKET_INGEST_KEY`. Giữ ứng dụng ở địa chỉ loopback theo lệnh khởi động ở trên.

Seller Workspace có Overview, My Shops, Shop Analysis, My Products, Product Optimizer, Competitor Research, Hot Trend Discovery, AI Strategy, Action Center và Reports. Các công cụ dữ liệu và thu thập có menu riêng trong System Workspace.

**Product Optimizer** đọc dữ liệu từng SKU để lập kế hoạch bán hàng: quảng cáo, đánh giá khách hàng, ảnh, tiêu đề, mô tả và video. Đề xuất gồm căn cứ, các bước, chỉ số đo và điều kiện dừng; dùng quy tắc công khai, không phải dự báo từ LLM. Thiếu video trong dữ liệu collector không có nghĩa sản phẩm không có video. Số ảnh không xác nhận chất lượng ảnh; tổng đã bán không thay thế đơn trong kỳ. Đánh giá được đề xuất thu thập từ khách đã mua, không tạo đánh giá giả.

Chi phí và báo cáo người bán được lưu riêng theo shop/SKU. Có thể nhập hiển thị, lượt nhấp, đơn quy gán quảng cáo, chi quảng cáo và doanh thu quảng cáo **cùng kỳ 30 ngày** để tính CTR, CPC, CPA, chuyển đổi và ROAS. Tăng quảng cáo chỉ là ứng viên thử nghiệm khi có đủ chi phí, lãi đóng góp dương và hiệu quả vượt hòa vốn; ngưỡng mẫu trong đề xuất là quy tắc vận hành, không bảo đảm hiệu quả tương lai. Phần kịch bản giá chỉ tính số học theo chi phí đã nhập và không tự đổi giá trên Shopee.

**AI cục bộ bằng Ollama:** Product Optimizer tự kết nối và chọn model chat đã cài phù hợp với bộ nhớ máy. Người dùng không cần chọn model hoặc lưu cấu hình; chỉ chọn SKU rồi bấm **Phân tích bằng AI cục bộ**. Mở tab chỉ kiểm tra kết nối, không tự chạy suy luận. Nếu model trước không còn dùng được, lần phân tích tiếp theo tự chọn model phù hợp khác trong số đã cài; ứng dụng không tự tải model hay dùng model cloud. Ứng dụng gửi dữ liệu SKU và các chỉ số đã tính đến `127.0.0.1:11434`; không dùng API key hoặc gọi dịch vụ AI đám mây. Ollama tạo chiến lược và bản nháp nội dung, còn số liệu tài chính vẫn được tính bằng analytics. Model không thực thi lệnh, thay đổi listing hoặc tự tăng ngân sách. Kết quả giữ model, thời điểm và dấu vết nguồn; dữ liệu mới làm kết quả cũ được đánh dấu cần phân tích lại.

Cài bản macOS chính thức bằng `brew install --cask ollama-app`, chạy `ollama serve` và tải model bằng `ollama pull qwen3.5:9b`. Bộ chọn tự động cân nhắc danh sách model chat đang cài và bộ nhớ máy; không mặc định lấy model lớn nhất. Trạng thái kết nối hiển thị model thực tế đã chọn. `start_mac.command` ưu tiên bộ chạy trong Ollama.app và khởi động Ollama nếu có sẵn. Tài liệu cài đặt: [Ollama macOS](https://docs.ollama.com/macos). Nếu Ollama/model chưa sẵn sàng, giao diện báo rõ và giữ phần chẩn đoán quy tắc, không giả thành kết quả AI. Đầu vào hiện là văn bản/thuộc tính và số ảnh đã thu thập; chưa gửi ảnh trực tiếp cho model để chấm chất lượng hình ảnh. Đầu vào còn có phân loại, tồn hiển thị, biên đóng góp và các SKU cùng shop/cùng ngành để cân nhắc chào bán; SKU cùng ngành chưa tự chứng minh phù hợp làm combo. AI cân nhắc 12 hướng bán hàng (nội dung, quảng cáo, giá, ưu đãi, combo, phân loại, dịch vụ, định vị…), chọn chiến lược theo bằng chứng của SKU. Bản phân tích đầy đủ hỗ trợ đến 8 chẩn đoán và 8 chiến lược; mỗi chẩn đoán có nhận định, hướng xử lý, căn cứ và dữ liệu cần bổ sung. Bản cũ vẫn đọc được khi chưa có hai trường nhận định/hướng xử lý. Không ép đúng 3 chiến lược hoặc thêm lời khuyên cho đủ số. Mỗi chiến lược giữ thứ tự triển khai, giả thuyết, đánh đổi, bước làm, chỉ số đo và điều kiện dừng; đây không phải dự báo mức tăng doanh số. Đầu ra mới bắt buộc có giả thuyết và đánh đổi; bộ kiểm tra chặn một số khẳng định thiếu căn cứ về ảnh, phân loại, lãi và các cam kết quảng cáo không có trong nguồn. Nếu một kế hoạch đúng cấu trúc có nhận định chưa đạt kiểm tra, AI viết lại riêng các trường đó bằng schema giới hạn; các trường khác được giữ nguyên rồi toàn bộ kế hoạch được kiểm tra lại, gồm điều kiện tài chính. Chỉ trường và ngữ cảnh cần sửa được gửi, không sao chép câu sai để model lặp lại. Thiếu riêng các trường đơn giản như ưu tiên/độ tin cậy cũng được AI bổ sung từng trường sau khi kiểm tra các phần còn lại; lỗi cấu trúc phức tạp dùng một lượt tạo lại. Tối đa một lượt sửa với cùng dữ liệu/model, trong tổng thời gian chờ 300 giây. Không tự dựng nội dung thay cho kết quả AI. Giao diện hiển thị giai đoạn hoàn thiện và thời gian thực tế; tác vụ lưu diagnostics đã giới hạn và thống kê token/thời gian, không lưu raw output bị từ chối hoặc prompt riêng trong log. Yêu cầu model chỉ gửi ID và giá trị của facts, giữ nguyên dữ liệu thiếu; catalog có nhãn đầy đủ vẫn lưu trong DB để kiểm chứng. Profile tổng quan đầy đủ dùng context 12.288 token, tối đa 6.144 token đầu ra và không phạt việc lặp lại thuật ngữ nguồn. Không cấm số trong tổng quan hoặc ép chẩn đoán xuống hai mục để rút thời gian. Mỗi chiến lược có thể gồm nhiều bước thực hiện, chỉ số đo và điều kiện cần. Tốc độ được cải thiện bằng dữ liệu đầu vào gọn, cache theo nguồn và sửa đúng trường sai; giới hạn gốc của bộ kiểm tra vẫn được giữ. Bản nháp mô tả giữ đủ thông tin sản phẩm phù hợp thay vì sao chép cả listing; vẫn có tiêu đề, ý tưởng ảnh và video. Những bản nháp này cần đối chiếu với sản phẩm thực tế.

Yêu cầu sinh kế hoạch dùng `/api/generate` với `system`, `prompt`, JSON schema và `think=false`. Cách gọi này giữ ràng buộc JSON trên bản Ollama 0.30.6 đã cài, tránh [lỗi `/api/chat` bỏ qua schema với Qwen3.5 khi tắt thinking](https://github.com/ollama/ollama/issues/14645). Mỗi job lưu tuyến gọi thực tế trong telemetry. Schema gửi model bỏ `maxLength` của chuỗi để tránh bộ grammar Ollama cũ từ chối các giới hạn lặp lớn; bộ kiểm tra `ModelPlan` trên máy chủ vẫn giữ đầy đủ giới hạn độ dài trước khi lưu kết quả. Schema từng job giới hạn mã bằng chứng theo catalog thật và mã dữ liệu thiếu theo các trường chưa biết của SKU; số 0 đã khai báo không bị coi là thiếu. Bộ kiểm tra độc lập vẫn từ chối chẩn đoán gọi một fact đã có giá trị là thiếu. Căn cứ dài có thể mở rộng để xem đủ nội dung catalog đã giới hạn, không cắt mất SKU được dẫn. Trần giảm giá hòa vốn chỉ là giới hạn kinh tế, không phải mức giảm được khuyến nghị. Chiến lược quảng cáo không được tự đặt ngân sách tiền khi chưa có hạn mức được xác nhận; ngưỡng dừng ROAS không được thấp hơn điểm hòa vốn do engine tính. Các nhận định chi quảng cáo lịch sử vẫn cần khớp dữ liệu nguồn và không trở thành hạn mức chi mới. Tiền lãi đóng góp được AI trích dẫn phải khớp phép tính engine, với dung sai làm tròn 1₫; nhận định thiếu điểm hòa vốn bị từ chối nếu engine đã có. Tổng quan hiển thị số liệu trực tiếp từ database/engine, giữ toàn bộ đoạn phân tích và tất cả khía cạnh AI. AI có thể trích số trong nhận định khi đúng nguồn và đơn vị. Lượt sửa được cấp đủ token cho trường dài thay vì cắt ngắn nội dung.

Công việc giữ lại kế hoạch và mốc KPI khi bắt đầu; báo cáo tự đối chiếu sau 7/14 ngày khi máy chủ chạy. Chỉ số nguồn 30 ngày giữ nhãn 30 ngày, không đổi thành đơn phát sinh trong 7/14 ngày. So sánh trước/sau không chứng minh thay đổi do một chiến lược gây ra. Báo cáo xuất được JSON/HTML.

- `GET /api/seller/analysis?shop_id=...`: phân tích, kế hoạch từng SKU, công việc và báo cáo.
- `PUT /api/seller/products/{sku}/inputs?shop_id=...`: lưu chi phí/chỉ số người bán, trường chưa biết để `null`.
- `POST /api/seller/optimize?shop_id=...`: tính thử `{sku, inputs}`; không lưu thay cho API inputs.
- `POST /api/seller/actions?shop_id=...`: tạo công việc từ `{strategy_key, sku}` còn phù hợp dữ liệu.
- `PATCH /api/seller/actions/{id}?shop_id=...`: lưu `{status, notes}`.
- `POST /api/seller/reports?shop_id=...`: lưu mốc dữ liệu với `{period_days: 7|14}`.
- `GET /api/seller/reports/{id}/export?shop_id=...&format=json|html`: xuất báo cáo đúng shop.

Khởi động lại Uvicorn sau khi cập nhật mã server. Giao diện dừng chờ sau 20 giây và hiện nút Thử lại khi API lỗi, không lặp yêu cầu vô hạn.

- `GET /api/crawl/config`: trạng thái crawler.
- `POST /api/crawl/jobs`: tạo lượt quét `{ "shop_id": "...", "target_url": "https://shopee.vn/shop_abc", "role": "market", "interactive": true }`. Bỏ `interactive` hoặc đặt `false` để chạy nền. Khi đang chạy, `error` trong lịch sử cũng chứa ghi chú tiến độ; thành công sẽ xóa ghi chú và cập nhật số sản phẩm.
- `GET /api/crawl/jobs?shop_id=...`: lịch sử quét.
- `GET /api/crawl/jobs/{job_id}`: trạng thái thực thi.
- `POST /api/crawl/schedules`: `{ "shop_id":"...", "target_url":"https://shopee.vn/shop_abc", "role":"market", "interval_hours":24 }`.
- `GET /api/crawl/schedules?shop_id=...`: danh sách lịch.
- `DELETE /api/crawl/schedules/{schedule_id}?shop_id=...`: xóa lịch.
- `GET /api/dashboard?shop_id=...`: báo cáo.
- `POST /api/import`: nhập CSV/XLSX.
- `POST /api/crawl/import-html`: multipart gồm `shop_id`, `target_url`, `role` (`own`/`market`), `snapshot_date` (YYYY-MM-DD) và `file` HTML. Trả số sản phẩm đã nhập và `data_origin: saved_browser_dom`.
- `GET /api/export/opportunities?shop_id=...`: CSV xếp hạng.

Xem tài liệu tương tác tại http://127.0.0.1:8000/docs.

## Docker

```bash
docker compose up --build -d
```

Crawler được bật mặc định trong Docker. Dockerfile cài Chromium; build cần tải bộ trình duyệt và thư viện hệ thống, image tương đối lớn. Để trải nghiệm giao diện, cách chạy Python local nhanh hơn.

## Test offline (không liên hệ Shopee)

```bash
pip install pytest httpx
pytest -q
node --check static/app.js
```

Test dùng dữ liệu HTML giả lập để kiểm chứng parser, lọc URL, chống nhầm số bán tích lũy, API gate, job queue và lịch. Không dùng tài khoản hoặc session Shopee.

## Giới hạn hệ thống / triển khai production

- Chưa xác minh crawler có thể đọc Shopee thật tại thời điểm sử dụng; Shopee có thể ngăn truy cập tự động. Worker dừng khi gặp xác minh/chặn, không bypass.
- Chỉ có tối đa 150 sản phẩm ở một trang render; không tự đi qua tất cả trang phân loại/khuyến mãi.
- Lịch chạy bằng daemon thread của process FastAPI; cần chuyển sang Celery/APScheduler + Redis và PostgreSQL khi triển khai multi-worker, HA, retry/recovery.
- API **chưa có xác thực người dùng/RBAC**, tuyệt đối không expose ra Internet. Bind cục bộ `127.0.0.1`.
- Điểm sản phẩm là rule-based; **không phải AI đã huấn luyện** hay số liệu toàn sàn.
- Cần dữ liệu giá vốn, phí sàn thực tế, ngân sách quảng cáo và chất lượng hàng để quyết định nhập hàng.

## Thu thập ngành hàng, lịch quét và dữ liệu máy học

Hai tab mới **Ngành hàng & Hot trend** và **Lịch quét ngành hàng** dùng kho dữ liệu riêng trong `market.db`, không trộn dữ liệu demo hoặc dữ liệu shop vào dataset ngành hàng.

1. Khởi động lại FastAPI sau khi cập nhật. Trong Chrome, tải lại tiện ích từ thư mục `browser-extension` (bản 1.3.7), rồi tải lại `http://127.0.0.1:8000`.
2. Bấm **Đọc danh mục từ Shopee** để lấy các link ngành hàng hiển thị trên trang chủ; hoặc nhập tên và link ngành hàng/ngành con có dạng `https://shopee.vn/...-cat.12345`. Chọn các ngành hoặc **Chọn tất cả**.
3. Chọn **Quét hết các trang hiển thị**, rồi **Quét ngay ngành đã chọn**. Bộ thu thập đọc từng trang danh sách và từng trang chi tiết, lưu kết quả sau mỗi sản phẩm. Chế độ này không dùng giới hạn số trang/sản phẩm của chế độ quét mẫu. Không có cam kết lấy được tất cả sản phẩm Shopee: trang hiển thị có thể bị giới hạn, cá nhân hóa, thay đổi thứ tự hoặc thiếu nút phân trang. Hệ thống dừng khi không thấy trang tiếp theo, không có sản phẩm mới, gặp lỗi hoặc bạn bấm dừng.
4. Trong **Lịch quét ngành hàng**, chọn giờ bắt đầu theo Việt Nam (UTC+7) và chu kỳ 6/12/24/168 giờ. Lưu lịch cho nhiều ngành tạo một lịch trên mỗi ngành. Lưu lại cùng ngành sẽ cập nhật lịch. Có nút **Quét ngay**, **Tắt lịch/Bật lịch** cho từng ngành.
5. Scheduler máy chủ kiểm tra mỗi 30 giây, tạo hàng đợi đến hạn và gộp các kỳ bị lỡ thành một lượt. Lượt đang chờ hoặc tạm dừng được tái sử dụng, không tạo chồng các lượt cùng ngành. Nút Quét ngay không đổi mốc lịch tiếp theo. Tắt lịch cũng tạm dừng hàng đợi của lịch; tác vụ Chrome đang đọc được phép lưu nốt kết quả.
6. Chrome phải mở trang MarketLens tại cổng 8000 để tự nhận và thực thi các lượt theo lịch. Trang kiểm tra khoảng mỗi 30 giây; trình duyệt có thể trì hoãn timer khi chạy nền. Máy chủ tắt thì không tạo lượt đến hạn cho đến khi chạy lại; máy ngủ hoặc đóng Chrome thì không thu thập. Lịch đến hạn không tự mở Chrome, không chạy headless và không giả lập dữ liệu cho ngày bị bỏ lỡ. Web Locks tránh hai tab MarketLens cùng chạy hàng đợi ngành hàng.
7. CAPTCHA/đăng nhập/lỗi làm dừng hàng đợi, giữ tiến độ. Sau khi xử lý bằng Chrome, bấm **Tiếp tục** hoặc **Quét ngay**. Có thể bỏ qua sản phẩm lỗi; lượt đó được đánh dấu có lỗi. Dừng tự động không làm mất những sản phẩm đã lưu.

### Dữ liệu và tín hiệu xu hướng

- `market_categories`: danh mục đã chọn. `market_schedules`: lịch và lần đến hạn. `market_runs`: con trỏ trang/phạm vi/trạng thái. `market_queue`: sản phẩm cần đọc và trạng thái từng sản phẩm. `market_snapshots`: snapshot sản phẩm/ngày/ngành hàng, thời gian thực sự thu thập và JSON chi tiết gốc.
- Định danh sản phẩm = shop ID + item ID. Trong cùng ngày Việt Nam, quét lại cập nhật snapshot; ngày mới tạo snapshot mới. Cùng sản phẩm xuất hiện ở nhiều ngành được khử trùng theo sản phẩm/ngày trong bản xuất tổng hợp; bản xuất lọc ngành chỉ lấy ngành đó.
- **Features CSV** chứa giá đơn nếu đọc được, số bán hiển thị, cờ làm tròn, điểm/số đánh giá, tốc độ bán ước tính và thay đổi tốc độ. **JSONL** chứa thêm mô tả, ảnh, phân loại, thuộc tính và chuỗi gốc. Không tải ảnh về máy.
- Thiếu dữ liệu giữ `null`. Số bán `1k`, `1k+` không dùng để tính chênh lệch; bộ đếm giảm/reset cũng không tạo tăng trưởng giả. Chỉ có ít nhất ba ngày quan sát liên tiếp hợp lệ mới có điểm quy tắc xu hướng. Đây chưa phải mô hình ML huấn luyện hoặc dự báo đã được kiểm chứng.
- Features chỉ dùng snapshot hiện tại và quá khứ. Khi huấn luyện cần tự xây nhãn tương lai (ví dụ tăng trưởng 7 ngày sau), chia train/validation/test theo thời gian, kiểm tra độ phủ và thiên lệch mẫu. Không dùng điểm quy tắc như nhãn “hot trend” đã xác thực.

API mới nằm dưới `/api/category-market`: `campaigns`, `runs`, `schedules`, `scheduled-ready`, `products`, `export`. Lịch và hàng đợi là local single-process MVP, chưa phải bộ thu thập phân tán toàn sàn.

### Quét tất cả ngành hàng bằng một nút (1.3.7)

Trong **Ngành hàng & Hot trend**, bấm **Quét tất cả ngành hàng**. Ứng dụng tự đọc danh mục mới từ trang chủ Shopee, duyệt carousel danh mục, chờ danh sách ổn định, tạo lượt quét hết trang cho tất cả ngành tìm được rồi chạy ngay. Không nhập tên/link, không phải chọn từng ngành hay bấm tạo hàng đợi riêng. Các thiết lập chọn ngành thủ công được đưa vào phần **Tùy chọn nâng cao**.

Không dùng danh mục cũ thay thế nếu việc đọc danh mục mới thất bại. Lượt quét hết đang dang dở được tiếp tục; lượt quét mẫu dang dở được giữ lại và thay bằng một lượt quét hết bắt đầu từ trang đầu để không bỏ sót thẻ sản phẩm do giới hạn mẫu. “Tất cả” chỉ phạm vi danh mục và trang Shopee hiển thị cho phiên Chrome, không phải xác nhận truy cập được toàn bộ catalog nội bộ. Cần tải lại tiện ích 1.3.7 và trang MarketLens. Tiện ích kiểm tra điểm cuối thanh danh mục và trang đang hiển thị; nếu danh mục chưa đủ thì báo rõ và chưa tạo hàng đợi quét tất cả. Nếu Shopee yêu cầu xác minh, lượt quét dừng, giữ tiến độ đã lưu và giữ tab Shopee để bạn xác minh thủ công. Sau khi xem sản phẩm bình thường, quay về MarketLens bấm **Chạy / tiếp tục tất cả** (hoặc **Quét tất cả ngành hàng** nếu chưa tạo hàng đợi). Bot không tự thử lại khi đang bị chặn.

### Phân tích ngành hàng và máy học

Mở **Phân tích ngành hàng** để đọc trực tiếp kho dữ liệu đã thu thập. Màn hình có bộ lọc ngành và cửa sổ quan sát 7/14/30 ngày, top sản phẩm theo số đã bán hiển thị, top shop trong mẫu, khoảng giá, độ phủ theo ngày, tăng trưởng đã quan sát và kết quả máy học. Một SKU chỉ tính một lần trong bảng tổng; hàng ngành được tính riêng vì sản phẩm có thể xuất hiện ở nhiều ngành. Cửa sổ thời gian lọc ngày ghi nhận, không biến tổng đã bán thành doanh số trong cửa sổ đó. Shop chưa có tên được hiển thị bằng ID người bán từ URL sản phẩm.

Sau khi lưu chi tiết sản phẩm vào `market_snapshots`, worker kiểm tra thay đổi dữ liệu mỗi 30 giây và tự cập nhật mô hình. Cần ít nhất 20 sản phẩm có đủ giá, số bán và lượt đánh giá trong một ngành để học nhóm của ngành đó. Worker cũng xử lý sửa dữ liệu cùng ngày và phục hồi khi khởi động lại máy chủ. Có thể bấm **Huấn luyện lại từ database** bất cứ lúc nào. `market_ml_models` lưu phiên bản, mốc dữ liệu, bộ chuẩn hóa và tâm cụm dạng JSON; `market_ml_predictions` lưu kết quả theo phiên bản. Khởi động lại ứng dụng giữ nguyên dữ liệu và mô hình. Lỗi huấn luyện không làm mất checkpoint sản phẩm.

Mô hình K-means học các nhóm sản phẩm từ log giá, log số đã bán, log lượt đánh giá và điểm sao. Chỉ dùng dữ liệu thực của kho ngành hàng, không dùng shop demo. Số bán làm tròn dùng để mô tả vị thế hiện tại và luôn được ghi rõ; điểm ML không phải xác suất bán chạy hay dự báo hot trend. Nếu thiếu một đặc trưng khi chấm điểm, mô hình có thể dùng trung vị đã học và giải thích việc này; dữ liệu gốc vẫn giữ là thiếu. Thiếu quá nhiều dữ liệu thì không chấm điểm.

Tín hiệu tăng trưởng được tính riêng từ ít nhất ba ngày có số bán chính xác. Khi số bán làm tròn, có thể dùng tăng trưởng lượt đánh giá chính xác và ghi rõ đơn vị đánh giá/ngày; không quy đổi thành số bán. Bộ đếm giảm hoặc reset không tạo tín hiệu tăng trưởng. Một ngày dữ liệu chỉ cho phép xếp hạng và phân nhóm hiện tại.

API: `GET /api/category-market/analysis`, `POST /api/category-market/ml/train`, `GET /api/category-market/ml/export`. CSV/JSONL lịch sử và đặc trưng tiếp tục dùng `/api/category-market/export`. Không cần thư viện máy học bên ngoài hoặc gửi dữ liệu sang dịch vụ khác.

### Tiếp tục và thử lại các ngành hàng

Mỗi dòng hàng đợi có **Tiếp tục / thử lại**. **Chạy / tiếp tục tất cả** chạy phần còn lại của mọi lượt đang dở và thử lại sản phẩm đã báo lỗi; **Thử lại tất cả lỗi** chỉ chọn các dòng đang lỗi hoặc tạm dừng. Sản phẩm đã lưu thành công, con trỏ trang và mô hình đã có được giữ nguyên. Lượt quét cũ đã được thay thế bởi lượt quét hết không được chạy lại.

Chọn **Số ngành chạy đồng thời**: 2 hoặc 4. **Tất cả danh mục** đưa mọi ngành vào hàng đợi nhưng vẫn chỉ chạy tối đa 4 tab cùng lúc, tránh quá tải Chrome. Mặc định 4; mỗi ngành đang đọc dùng một tab riêng. Nút **Chạy / tiếp tục tất cả** đưa mọi ngành cần chạy vào pool, kể cả các dòng ở trang khác của bảng. Có thể bấm Tiếp tục ở dòng khác hoặc nút toàn bộ trong lúc đang chạy để bổ sung vào hàng đợi; mỗi ngành chỉ có một tác vụ đang chạy hoặc chờ. Từng ngành vẫn đọc và lưu sản phẩm tuần tự. Trang chi tiết chờ tối đa 90 giây và được đọc ngay khi DOM ổn định, kể cả khi tài nguyên phụ vẫn tải. Sản phẩm quá hạn được thử lại một lần; nếu tiếp tục lỗi thì ghi vào danh sách lỗi để thử lại sau và chuyển sang sản phẩm tiếp theo. Lỗi tải riêng một trang ngành hàng tạm dừng dòng đó và để các ngành khác tiếp tục; CAPTCHA, lỗi lưu checkpoint hoặc Chrome không thể thao tác sẽ dừng nhận tác vụ mới, chờ các tác vụ đang đọc lưu xong rồi tạm dừng toàn bộ. Không có cơ chế tự vượt CAPTCHA.

Bản tiện ích 1.3.7 đọc thêm bố cục thẻ sản phẩm và liên kết phân trang mới; URL ngành được đối chiếu bằng đầy đủ ID ngành, không phụ thuộc slug tiếng Anh/Việt. Nếu không đọc được trang, tab Shopee được giữ để kiểm tra và thông báo phân biệt sai ngành, sai trang, lệch phân trang hay chưa thấy thẻ sản phẩm. Cần Reload tiện ích đã nạp từ `browser-extension` và tải lại MarketLens để nhận bản này.


### Phân trang các màn hình

Các bảng và danh sách sản phẩm, cơ hội, đối thủ, lượt quét, lịch quét, lịch sử nhập, phân tích ngành hàng và kết quả ML đều có điều khiển phân trang: 10/20/50/100 mục, trang đầu/trước/sau/cuối và số mục đang xem. Tìm kiếm, sắp xếp và lọc chạy trước khi chia trang. Mỗi danh sách giữ trang và số mục riêng khi chuyển tab hoặc cập nhật trạng thái. Các phần xem nhanh trên Tổng quan vẫn dẫn đến danh sách đầy đủ.

Giao diện dùng `all_rows=true` để đọc toàn bộ bản ghi đã lưu cho các danh sách này; các API giữ giới hạn mặc định cho client cũ. Phân trang chỉ thay đổi phần đang hiển thị, không giới hạn phạm vi dữ liệu dùng phân tích hoặc xuất CSV/JSONL.


### Tự học và phân tích từ database

Máy chủ khởi động worker học máy độc lập với giao diện. Mỗi 30 giây, worker kiểm tra fingerprint của dữ liệu nguồn, gồm SKU, ngành, ngày, thời gian và các chỉ số quan sát. Khi có thay đổi, mô hình tự học lại từ dữ liệu đã commit. Sửa giá/số bán trong cùng ngày cũng được nhận diện. Khi khởi động lại, worker kiểm tra ngay để phục hồi các cập nhật chưa xử lý. Nguồn không đổi không tạo thêm phiên bản mô hình. Lỗi học giữ lại dữ liệu và mô hình đã lưu, được hiển thị trong trạng thái tự động.

Màn hình **Phân tích ngành hàng** tự đọc báo cáo mới mỗi 30 giây khi đang mở. Phần **Tự học và cập nhật đang bật** hiển thị thời điểm kiểm tra, trạng thái worker và nhận định sinh từ số liệu đang lọc: sản phẩm dẫn đầu trong mẫu, khoảng giá tập trung, lịch sử tăng trưởng và độ phủ mô hình. K-means học bộ chuẩn hóa, trung vị và tâm cụm từ DB; các câu nhận định lấy tên/chỉ số trực tiếp từ kết quả phân tích. Điểm vị thế là cách diễn giải phân cụm, không phải dự báo doanh số. Không cần Codex chạy thủ công hoặc nhập lại kết quả. Cần giữ máy chủ chạy; Chrome chỉ cần cho bước thu thập.


### Shop Analysis · năm góc nhìn cho cùng một SKU

Shop Analysis có năm tab nội bộ: **Shop**, **Sản phẩm**, **Tối ưu giá**, **Đối thủ**, **Cơ hội**. Chọn SKU một lần để dùng xuyên suốt các góc nhìn; mỗi shop giữ lựa chọn và bộ lọc riêng. Khối Shop tổng hợp điểm sức khỏe, nhóm chủ lực / tiềm năng / biên thấp / bán chậm và nhóm chưa đủ dữ liệu; bấm nhóm để lọc danh sách thực tế.

Sản phẩm dùng thông tin đã lưu của SKU. Tối ưu giá cho phép sửa giả định và so ba mức giá ngay trong trình duyệt, có nút khôi phục dữ liệu SKU; không tự ghi đè chi phí trong database. Đối thủ đối chiếu quy cách và chỉ tổng hợp khoảng giá của các mặt hàng đủ bằng chứng tương đương. Cơ hội đọc lịch sử quan sát sản phẩm và kết quả ML đã lưu; chưa có đủ lịch sử thì nêu dữ liệu còn thiếu, không thay bằng chỉ số tìm kiếm giả lập. Các nút mở Product Optimizer, phân tích đối thủ và phân tích ngành hàng tiếp tục dùng chức năng đầy đủ của workspace.

## Dùng Ollama trên máy cá nhân cho bản host trên Render

1. Mở Ollama.app, rồi chạy `./start_ollama_tunnel.command` trên máy có model (cần `cloudflared`).
2. Script in ra `OLLAMA_API_TOKEN` và một URL `https://xxxx.trycloudflare.com`.
3. Trên Render, mở service → Environment, đặt `OLLAMA_BASE_URL` (URL trên) và `OLLAMA_API_TOKEN`, rồi redeploy.

Gateway (`ollama_gateway.py`) chỉ chuyển tiếp `/api/tags` và `/api/generate`, và yêu cầu Bearer token.
URL quick tunnel đổi mỗi lần chạy lại; muốn URL cố định hãy dùng named tunnel của Cloudflare. Máy phải bật thì AI mới hoạt động.

## Tài khoản admin lần deploy đầu và nhật ký hoạt động

- Đặt `ADMIN_USERNAME` (3–80 ký tự, không khoảng trắng) và `ADMIN_PASSWORD` (≥ 12 ký tự) trên Render: ở lần chạy đầu, khi DB chưa có tài khoản nào, app tạo sẵn tài khoản **System** này. Các lần sau biến này bị bỏ qua (không ghi đè, không đổi mật khẩu). Trên Render, nếu không đặt `ADMIN_PASSWORD`, app tự sinh mật khẩu ngẫu nhiên cho tài khoản `admin` và in **một lần** trong log (`ĐÃ TẠO TÀI KHOẢN ADMIN…`); đăng nhập rồi đổi ngay ở System → Tài khoản & hoạt động → *Đổi mật khẩu của tôi*. Tài khoản luôn được lưu trong DB (mật khẩu băm PBKDF2), mọi thao tác của admin cũng ghi vào nhật ký như User. Chạy máy cá nhân không đặt biến thì mở `/setup`.
- System → **Tài khoản & hoạt động**: danh sách tài khoản (đăng nhập gần nhất, số thao tác 30 ngày), tạo User, gán shop, khóa/mở, đặt lại mật khẩu, và **nhật ký hoạt động** (đăng nhập, đăng ký, thêm shop, thu thập, AI, đổi quyền…; lọc theo tài khoản/từ khóa, lưu 90 ngày). Mật khẩu không bao giờ được ghi vào nhật ký.

## Lưu dữ liệu trên Neon Postgres (DB chính)

Đặt biến môi trường `DATABASE_URL` = connection string của Neon (`postgresql://…?sslmode=require`, lấy ở nút **Connect**). Khi có biến này, app lưu **toàn bộ dữ liệu trực tiếp trong Neon** (tài khoản, shop, sản phẩm, job, AI…): không dùng file SQLite, không sao lưu, nên deploy lại trên Render không mất gì. Bảng được tạo tự động ở lần chạy đầu.

- Không đặt `DATABASE_URL` → app chạy bằng SQLite cục bộ (`MARKET_DB`) như trước.
- Nên dùng connection string có `-pooler` khi Neon có nhiều kết nối; app tự giữ pool tối đa 10 kết nối (`PG_POOL_MAX`).
- Dữ liệu cũ trong SQLite không tự chuyển sang Neon; chạy `python migrate_sqlite_to_postgres.py market.db` nếu cần.
- Kiểm thử trên Postgres: `MARKETLENS_TEST_PG_URL=postgresql://… pytest` (mỗi test dùng một schema riêng).
- `pgcompat.py` dịch cú pháp SQLite sang Postgres khi chạy, nên code truy vấn không đổi.



## Sao chép sản phẩm sang Kênh Người Bán

Menu **Sao chép sản phẩm** (site User) lấy sản phẩm của shop khác đã thu thập (có ảnh, mô tả, thuộc tính, phân loại nếu đã bật “Đọc chi tiết từng sản phẩm”), tạo bản nháp để chỉnh, rồi đăng theo hai cách:

1. **Tải file Mass Upload (.xlsx)** – bảng dữ liệu để sao chép vào mẫu Đăng hàng loạt của Shopee theo ngành hàng (Kênh Người Bán > Sản phẩm > Thêm nhiều sản phẩm).
2. **Đăng bằng tiện ích Chrome** (tiện ích ≥ 1.4.0) – mở `banhang.shopee.vn/portal/product/new`, hiện khung MarketLens để tự điền tên, mô tả, giá, kho, cân nặng và tải ảnh. Tiện ích không tự bấm Đăng; người bán kiểm tra rồi tự đăng. Giao diện Kênh Người Bán do Shopee đổi thường xuyên nên ô nào không nhận ra sẽ được báo để dán bằng nút Sao chép.

Ảnh và mô tả thuộc về shop gốc: chỉ đăng khi bạn có quyền sử dụng.
