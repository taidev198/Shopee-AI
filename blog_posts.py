"""Original blog articles for the public MarketLens blog (Vietnamese).

Each post is a dict: slug, title (<=60 chars, used as <title>), h1, description (<=160 chars), keywords,
category, minutes, published (ISO date), summary (card excerpt), body (HTML; every <h2> has an id used for the
table of contents), faq [(question, answer)], related [slugs].
The text is written by MarketLens; Shopee's Seller Education Hub is linked only as a reference.
"""

REFERENCE_URL = 'https://banhang.shopee.vn/edu/article'
REFERENCE_NOTE = (
    '<aside class="ref-box"><strong>Nguồn tham khảo chính thức</strong>'
    '<p>Quy định, mức phí và điều kiện của Shopee thay đổi theo thời gian. Hãy đối chiếu với '
    f'<a href="{REFERENCE_URL}" target="_blank" rel="noopener">Seller Education Hub của Shopee</a> '
    'và Trung tâm Người bán trước khi áp dụng.</p></aside>'
)

POSTS = [
    {
        'slug': 'cach-ban-hang-tren-shopee-cho-nguoi-moi',
        'title': 'Cách bán hàng trên Shopee cho người mới từ A đến Z',
        'h1': 'Cách bán hàng trên Shopee cho người mới bắt đầu: hướng dẫn từ A đến Z',
        'description': 'Hướng dẫn bán hàng trên Shopee cho người mới: chuẩn bị, chọn ngành hàng, đăng sản phẩm đầu tiên, vận chuyển, khuyến mãi và checklist 7 ngày đầu.',
        'keywords': 'cách bán hàng trên shopee, bán hàng shopee cho người mới, mở shop shopee, đăng sản phẩm shopee',
        'category': 'Bắt đầu',
        'minutes': 7,
        'published': '2026-11-07',
        'summary': 'Lộ trình từ lúc mở shop đến đơn hàng đầu tiên: chuẩn bị, chọn hàng, đăng sản phẩm, vận chuyển, khuyến mãi và checklist 7 ngày.',
        'body': '''
<p>Bán hàng trên Shopee không khó để bắt đầu, nhưng khó để bán đều. Phần lớn shop mới dừng lại vì làm theo cảm tính: chọn hàng theo thích, đặt giá theo đoán, đăng sản phẩm một lần rồi chờ đơn. Bài này đưa ra một lộ trình rõ ràng để bạn đi từ shop trống đến những đơn hàng đầu tiên, và biết cần đo gì để cải thiện.</p>

<h2 id="chuan-bi">1. Chuẩn bị trước khi mở shop</h2>
<ul>
<li><strong>Tài khoản và định danh:</strong> hoàn tất đăng ký người bán và xác minh thông tin theo hướng dẫn hiện hành của Shopee. Dùng thông tin thật, khớp với tài khoản ngân hàng nhận tiền.</li>
<li><strong>Tên shop và ảnh đại diện:</strong> tên ngắn, dễ nhớ, gợi đúng ngành hàng. Tránh dùng tên thương hiệu không thuộc về bạn.</li>
<li><strong>Kho và đóng gói:</strong> chuẩn bị chỗ để hàng, thùng, băng keo, túi chống sốc. Hàng đóng gói gọn giúp giảm hoàn trả và đánh giá thấp.</li>
<li><strong>Công cụ ghi chép:</strong> một bảng tính ghi giá vốn, phí và lãi từng sản phẩm. Đây là nền tảng cho mọi quyết định giá về sau.</li>
</ul>

<h2 id="chon-nganh-hang">2. Chọn ngành hàng và nguồn hàng</h2>
<p>Hãy chọn một nhóm hàng hẹp để bắt đầu thay vì bán đủ thứ. Một shop tập trung dễ xây dựng uy tín, dễ tối ưu từ khóa và dễ nhập hàng với số lượng nhỏ. Khi chọn, trả lời bốn câu hỏi:</p>
<ol>
<li>Nhu cầu có thật không? Xem số lượng đã bán và đánh giá mới của các shop đang bán cùng mặt hàng.</li>
<li>Biên lợi nhuận có đủ sau khi trừ phí, đóng gói và quảng cáo không? (Xem bài <a href="/blog/cach-tinh-gia-ban-va-loi-nhuan-shopee">cách tính giá bán và lợi nhuận</a>.)</li>
<li>Nguồn hàng có ổn định, có thể kiểm tra chất lượng và đổi trả không?</li>
<li>Mặt hàng có thuộc nhóm cấm hoặc cần giấy phép không? Kiểm tra trước để tránh bị gỡ sản phẩm hay khóa shop.</li>
</ol>

<h2 id="nghien-cuu-nhu-cau">Nghiên cứu nhu cầu trước, tìm nguồn hàng sau</h2>
<p>Sai lầm phổ biến của người mới là tìm được nguồn hàng rồi mới hỏi “ai sẽ mua?”. Hãy đảo thứ tự: xác định khách đang cần gì, rồi mới tìm sản phẩm đáp ứng. Bạn có thể quan sát câu hỏi của khách trong các nhóm và cộng đồng trên mạng xã hội, xem từ khóa nào được tìm nhiều mà ít nơi đáp ứng bằng công cụ xu hướng tìm kiếm, và xem ngành hàng nào đang bán đều ngay trên Shopee. Sau đó đối chiếu với sở thích và thế mạnh của bạn, vì bạn sẽ làm việc với nhóm hàng này lâu dài.</p>

<h2 id="dang-san-pham">3. Đăng sản phẩm đầu tiên đúng cách</h2>
<p>Sản phẩm là “mặt tiền” của shop. Một bài đăng đầy đủ gồm:</p>
<ul>
<li><strong>Tiêu đề</strong> chứa từ khóa người mua thật sự tìm (xem <a href="/blog/toi-uu-tieu-de-mo-ta-san-pham-shopee">cách tối ưu tiêu đề và mô tả</a>).</li>
<li><strong>Ngành hàng và thuộc tính</strong> điền đủ, chính xác. Đây là dữ liệu Shopee dùng để lọc và gợi ý.</li>
<li><strong>Hình ảnh và video</strong> rõ ràng, nhiều góc (xem <a href="/blog/hinh-anh-video-san-pham-shopee">hướng dẫn ảnh và video</a>).</li>
<li><strong>Phân loại hàng</strong> (màu, kích cỡ, mẫu) có tên dễ hiểu, giá và tồn kho từng phân loại.</li>
<li><strong>Mô tả</strong> nêu thông số, chất liệu, cách dùng, chính sách đổi trả, không hứa hẹn quá mức.</li>
</ul>

<h2 id="van-chuyen-thanh-toan">4. Thiết lập vận chuyển và nhận tiền</h2>
<p>Nhập cân nặng và kích thước kiện hàng chính xác để phí vận chuyển hiển thị đúng. Cân thiếu dễ bị phát sinh phí, cân thừa làm khách thấy đắt. Bật các đơn vị vận chuyển phù hợp, đặt thời gian chuẩn bị hàng thực tế mà bạn làm được, và kiểm tra thông tin tài khoản nhận tiền.</p>

<h2 id="khuyen-mai">5. Dùng khuyến mãi có kế hoạch</h2>
<p>Voucher của shop, combo, mua kèm và các chương trình của sàn giúp tăng chuyển đổi, nhưng chỉ nên dùng khi bạn đã biết giá hòa vốn. Quy tắc đơn giản: mỗi chương trình phải có mục tiêu (kéo đơn đầu tiên, tăng giá trị đơn, xả tồn) và một mức lãi tối thiểu bạn chấp nhận.</p>

<h2 id="quang-cao">Cân nhắc quảng cáo khi đã có dữ liệu</h2>
<p>Thị trường cạnh tranh nên chỉ đăng sản phẩm thường chưa đủ để được thấy. Quảng cáo giúp tăng tiếp cận, nhưng chỉ nên bật khi sản phẩm đã có ảnh tốt, mô tả rõ và lãi mỗi đơn đủ để gánh chi phí quảng cáo. Bắt đầu với ngân sách nhỏ cho một vài sản phẩm chủ lực, theo dõi chi phí trên mỗi đơn và dừng những nhóm không có lãi.</p>

<h2 id="cham-soc-khach">6. Chăm sóc khách hàng và giữ điểm shop</h2>
<p>Trả lời tin nhắn nhanh, giao hàng đúng hẹn, xử lý đổi trả lịch sự. Những chỉ số này ảnh hưởng đến uy tín shop và khả năng được hiển thị. Đừng bỏ qua đánh giá thấp: đọc chúng để biết sản phẩm hoặc mô tả đang thiếu gì và sửa ngay.</p>

<h2 id="checklist-7-ngay">7. Checklist 7 ngày đầu</h2>
<ol>
<li>Ngày 1: hoàn tất tài khoản, tên shop, ảnh đại diện, chính sách shop.</li>
<li>Ngày 2: chọn 5–10 sản phẩm cùng nhóm, tính giá vốn và giá hòa vốn.</li>
<li>Ngày 3–4: chụp ảnh, viết tiêu đề và mô tả, đăng sản phẩm.</li>
<li>Ngày 5: kiểm tra lại cân nặng, phân loại, tồn kho, vận chuyển.</li>
<li>Ngày 6: tạo một voucher nhỏ hoặc combo để kéo đơn đầu tiên.</li>
<li>Ngày 7: xem lượt xem, lượt thêm giỏ, đơn hàng; ghi lại điều cần chỉnh cho tuần sau.</li>
</ol>
<p>Sau tuần đầu, hãy làm việc theo chu kỳ: đo, sửa một thứ, đo lại. Khi có nhiều sản phẩm, một công cụ phân tích shop như MarketLens giúp bạn nhìn nhanh sản phẩm nào đang kéo lãi và sản phẩm nào cần xem lại.</p>
''',
        'faq': [
            ('Bán hàng trên Shopee cần chuẩn bị những gì?', 'Bạn cần tài khoản người bán đã xác minh, thông tin ngân hàng khớp để nhận tiền, nguồn hàng, chỗ lưu kho, vật liệu đóng gói và bảng ghi giá vốn. Điều kiện cụ thể có thể thay đổi, hãy kiểm tra trong Trung tâm Người bán.'),
            ('Người mới nên bán mặt hàng gì?', 'Nên chọn nhóm hàng hẹp, nhu cầu ổn định, dễ đóng gói, ít hoàn trả và có biên lợi nhuận đủ sau khi trừ phí. Tránh nhóm hàng cấm hoặc cần giấy phép.'),
            ('Bao lâu thì có đơn hàng đầu tiên?', 'Không có con số cố định. Shop có sản phẩm đăng đầy đủ, giá cạnh tranh và có khuyến mãi nhỏ thường có đơn sớm hơn, nhưng thời gian phụ thuộc ngành hàng và mức độ cạnh tranh.'),
        ],
        'related': ['toi-uu-tieu-de-mo-ta-san-pham-shopee', 'cach-tinh-gia-ban-va-loi-nhuan-shopee', 'hinh-anh-video-san-pham-shopee'],
    },
    {
        'slug': 'toi-uu-tieu-de-mo-ta-san-pham-shopee',
        'title': 'Tối ưu tiêu đề, mô tả sản phẩm Shopee để lên top tìm kiếm',
        'h1': 'Tối ưu tiêu đề và mô tả sản phẩm Shopee để dễ được tìm thấy',
        'description': 'Cách viết tiêu đề và mô tả sản phẩm Shopee chuẩn SEO: chọn từ khóa, công thức tiêu đề, thuộc tính ngành hàng, lỗi cần tránh và cách kiểm tra.',
        'keywords': 'tối ưu tiêu đề shopee, seo shopee, viết mô tả sản phẩm shopee, từ khóa shopee',
        'category': 'Tối ưu sản phẩm',
        'minutes': 6,
        'published': '2026-11-07',
        'summary': 'Công thức tiêu đề, cách chọn từ khóa, thuộc tính ngành hàng và mô tả giúp sản phẩm dễ được tìm thấy và dễ chốt đơn hơn.',
        'body': '''
<p>Khi người mua gõ vào ô tìm kiếm, tiêu đề và thông tin sản phẩm là thứ đầu tiên được so khớp. Tối ưu đúng không có nghĩa là nhồi thật nhiều từ khóa, mà là mô tả đúng sản phẩm bằng đúng từ khách đang dùng. Dưới đây là cách làm có hệ thống.</p>

<h2 id="tim-tu-khoa">1. Tìm từ khóa người mua thật sự dùng</h2>
<ul>
<li>Gõ tên sản phẩm vào ô tìm kiếm của Shopee và xem các gợi ý hiện ra. Đó là cụm từ có người đang tìm.</li>
<li>Mở tiêu đề của 5–10 sản phẩm bán tốt cùng loại để thấy cách họ đặt tên, thuộc tính nào được nhấn mạnh.</li>
<li>Phân loại từ khóa: <em>từ khóa chính</em> (tên sản phẩm), <em>từ khóa phụ</em> (chất liệu, kích thước, màu, công dụng), <em>từ khóa đối tượng</em> (cho bé, cho văn phòng, cho nam…).</li>
</ul>

<h2 id="cong-thuc-tieu-de">2. Công thức tiêu đề dễ áp dụng</h2>
<p>Một cấu trúc an toàn: <strong>Loại sản phẩm + thương hiệu (nếu là hàng của bạn) + thuộc tính nổi bật + đối tượng hoặc công dụng</strong>. Ví dụ với bình giữ nhiệt:</p>
<p class="example">Bình giữ nhiệt inox 304 500ml nắp chống tràn dùng cho văn phòng, đi học</p>
<p>Đưa từ khóa chính lên đầu, giữ tiêu đề tự nhiên để người đọc hiểu ngay. Một tiêu đề đọc như chuỗi từ rời rạc sẽ làm giảm tỷ lệ nhấp.</p>

<h2 id="thuoc-tinh">3. Điền đủ thuộc tính ngành hàng</h2>
<p>Thuộc tính (thương hiệu, chất liệu, xuất xứ, kích cỡ…) giúp sản phẩm xuất hiện khi khách lọc kết quả và giúp sàn hiểu đúng sản phẩm. Điền đầy đủ và nhất quán với tiêu đề, mô tả. Chọn đúng ngành hàng ngay từ đầu, vì sai ngành hàng làm sản phẩm khó được thấy.</p>

<h2 id="mo-ta">4. Viết mô tả giúp khách quyết định</h2>
<ol>
<li><strong>Đoạn mở đầu:</strong> 2–3 câu nêu sản phẩm là gì, dành cho ai, lợi ích chính.</li>
<li><strong>Thông số:</strong> kích thước, chất liệu, trọng lượng, màu, số lượng trong bộ, dạng danh sách để dễ quét mắt.</li>
<li><strong>Cách dùng và bảo quản:</strong> giảm câu hỏi lặp lại và đổi trả do dùng sai.</li>
<li><strong>Chính sách:</strong> bảo hành, đổi trả, thời gian chuẩn bị hàng.</li>
</ol>
<p>Viết bằng ngôn ngữ của bạn, không sao chép nguyên văn mô tả của shop khác. Ngoài rủi ro bản quyền, mô tả giống hệt còn làm sản phẩm của bạn không có điểm khác biệt.</p>

<h2 id="loi-can-tranh">5. Lỗi cần tránh</h2>
<ul>
<li>Nhồi từ khóa không liên quan hoặc ghi tên thương hiệu khác để “mượn” lượt tìm kiếm.</li>
<li>Dùng từ cấm hoặc cam kết quá mức (chữa bệnh, hiệu quả tuyệt đối) mà bạn không chứng minh được.</li>
<li>Tiêu đề khác với sản phẩm thực tế, gây đánh giá thấp và hoàn trả.</li>
<li>Bỏ trống thuộc tính hoặc để sai ngành hàng.</li>
</ul>

<h2 id="kiem-tra-cai-thien">6. Kiểm tra và cải thiện theo dữ liệu</h2>
<p>Chỉ đổi một yếu tố mỗi lần (ví dụ tiêu đề) rồi theo dõi lượt xem, tỷ lệ nhấp và đơn hàng trong 7–14 ngày. Nếu đổi nhiều thứ cùng lúc, bạn sẽ không biết điều gì tạo ra kết quả. Với nhiều sản phẩm, MarketLens giúp thu thập và đối chiếu tiêu đề, giá, đánh giá của các shop cùng ngành để bạn thấy mẫu chung và khoảng trống.</p>
''',
        'faq': [
            ('Tiêu đề sản phẩm Shopee nên dài bao nhiêu?', 'Nên đủ để chứa từ khóa chính, thuộc tính nổi bật và đối tượng/công dụng nhưng vẫn đọc tự nhiên. Hãy tuân thủ giới hạn ký tự hiện hành của Shopee và tránh nhồi từ khóa.'),
            ('Có nên copy mô tả của shop khác không?', 'Không nên. Có rủi ro về bản quyền và sản phẩm của bạn sẽ không có điểm khác biệt. Hãy viết lại bằng thông tin thực tế của sản phẩm bạn bán.'),
            ('Bao lâu thì thấy hiệu quả sau khi đổi tiêu đề?', 'Thường nên theo dõi 7–14 ngày và chỉ đổi một yếu tố mỗi lần để biết thay đổi nào tạo ra khác biệt.'),
        ],
        'related': ['hinh-anh-video-san-pham-shopee', 'cach-nghien-cuu-doi-thu-tren-shopee', 'cach-ban-hang-tren-shopee-cho-nguoi-moi'],
    },
    {
        'slug': 'cach-tinh-gia-ban-va-loi-nhuan-shopee',
        'title': 'Cách tính giá bán và lợi nhuận khi bán hàng trên Shopee',
        'h1': 'Cách tính giá bán và lợi nhuận khi bán hàng trên Shopee',
        'description': 'Công thức tính lãi mỗi đơn, giá hòa vốn và cách thử giá trên Shopee: giá vốn, phí sàn, đóng gói, quảng cáo, kèm ví dụ số cụ thể.',
        'keywords': 'cách tính giá bán shopee, tính lợi nhuận shopee, giá hòa vốn, phí shopee',
        'category': 'Giá & lợi nhuận',
        'minutes': 6,
        'published': '2026-11-07',
        'summary': 'Công thức lãi đóng góp mỗi đơn, giá hòa vốn và cách thử giá an toàn, có ví dụ số để bạn tự tính cho sản phẩm của mình.',
        'body': '''
<p>Doanh thu cao chưa chắc là lãi cao. Nhiều shop bán nhiều đơn nhưng vẫn lỗ vì không tính đủ chi phí trên mỗi đơn. Bài này giúp bạn tính đúng lãi mỗi đơn và đặt giá có cơ sở.</p>

<h2 id="cong-thuc">1. Công thức lãi đóng góp mỗi đơn</h2>
<p><strong>Lãi đóng góp = Giá bán − Giá vốn − Phí tính theo giá bán − Đóng gói − Quảng cáo phân bổ − Chi phí khác</strong></p>
<ul>
<li><strong>Giá vốn:</strong> giá nhập cộng vận chuyển nhập, hao hụt.</li>
<li><strong>Phí tính theo giá bán:</strong> các khoản phí của sàn theo phần trăm. Mức phí khác nhau theo ngành hàng và thời điểm, hãy lấy số hiện hành trong Trung tâm Người bán.</li>
<li><strong>Đóng gói:</strong> hộp, băng keo, túi, công xử lý.</li>
<li><strong>Quảng cáo phân bổ:</strong> tổng chi quảng cáo chia cho số đơn do quảng cáo mang lại.</li>
</ul>

<h2 id="vi-du">2. Ví dụ bằng số</h2>
<p>Giả sử bạn bán một sản phẩm với các giả định sau:</p>
<ul>
<li>Giá bán 99.000 ₫, giá vốn 45.000 ₫</li>
<li>Phí theo giá bán 15% = 14.850 ₫</li>
<li>Đóng gói 5.000 ₫, quảng cáo phân bổ 12.000 ₫</li>
</ul>
<p>Lãi đóng góp = 99.000 − 45.000 − 14.850 − 5.000 − 12.000 = <strong>22.150 ₫ mỗi đơn</strong>, tương đương khoảng 22,4% giá bán. Đây chỉ là số minh họa; hãy thay bằng chi phí thật của bạn. Bạn có thể thử nhanh bằng <a href="/#xem-thu">bản xem thử tính lãi trên trang chủ MarketLens</a>.</p>

<h2 id="gia-hoa-von">3. Giá hòa vốn</h2>
<p>Giá hòa vốn là mức giá thấp nhất để bạn không lỗ trên mỗi đơn. Khi phí tính theo phần trăm giá bán, công thức là:</p>
<p class="example">Giá hòa vốn = (Giá vốn + Đóng gói + Quảng cáo phân bổ) ÷ (1 − tỷ lệ phí)</p>
<p>Với ví dụ trên: (45.000 + 5.000 + 12.000) ÷ (1 − 0,15) ≈ 72.941 ₫. Dưới mức này, mỗi đơn bán ra là lỗ. Mọi chương trình giảm giá, voucher nên được kiểm tra so với con số này.</p>

<h2 id="thu-gia">4. Thử giá có kiểm soát</h2>
<ol>
<li>Chọn một sản phẩm và ghi lại số liệu nền: lượt xem, tỷ lệ chuyển đổi, đơn mỗi ngày, lãi mỗi đơn.</li>
<li>Đổi giá một mức hợp lý (ví dụ ±5–10%) và giữ nguyên các yếu tố khác.</li>
<li>Theo dõi 7 ngày, so sánh <strong>tổng lãi</strong> chứ không chỉ số đơn.</li>
<li>Đặt điều kiện dừng trước: nếu tổng lãi hoặc chuyển đổi giảm quá ngưỡng, quay lại giá cũ.</li>
</ol>
<p>Lãi mỗi đơn cao hơn không bảo đảm tổng lãi cao hơn, vì số đơn có thể giảm. Luôn nhìn cả hai.</p>

<h2 id="luu-y">5. Những khoản dễ bị bỏ sót</h2>
<ul>
<li>Thuế và nghĩa vụ tài chính theo quy định hiện hành (hãy hỏi kế toán hoặc cơ quan thuế).</li>
<li>Chi phí hoàn trả, đổi hàng, hàng lỗi.</li>
<li>Voucher và chương trình khuyến mãi do shop chịu.</li>
<li>Chi phí lưu kho và hàng tồn lâu.</li>
</ul>
''',
        'faq': [
            ('Lãi đóng góp khác lợi nhuận ròng thế nào?', 'Lãi đóng góp là phần còn lại của mỗi đơn sau khi trừ chi phí biến đổi (giá vốn, phí, đóng gói, quảng cáo phân bổ). Lợi nhuận ròng còn phải trừ chi phí cố định như thuê kho, nhân sự và thuế.'),
            ('Phí bán hàng trên Shopee là bao nhiêu?', 'Mức phí thay đổi theo ngành hàng, loại shop và thời điểm. Hãy xem bảng phí hiện hành trong Trung tâm Người bán hoặc Seller Education Hub, không nên dùng số cũ.'),
            ('Nên đặt giá thấp hơn đối thủ không?', 'Chỉ khi giá vẫn trên giá hòa vốn và bạn có lý do (chi phí thấp hơn, bán số lượng lớn). Giảm giá để cạnh tranh mà không tính lãi dễ dẫn đến lỗ.'),
        ],
        'related': ['cach-nghien-cuu-doi-thu-tren-shopee', 'cach-chon-san-pham-hot-trend-de-ban-shopee', 'cach-ban-hang-tren-shopee-cho-nguoi-moi'],
    },
    {
        'slug': 'cach-nghien-cuu-doi-thu-tren-shopee',
        'title': 'Cách nghiên cứu đối thủ trên Shopee để bán tốt hơn',
        'h1': 'Cách nghiên cứu đối thủ trên Shopee để bán tốt hơn',
        'description': 'Hướng dẫn phân tích đối thủ trên Shopee: tìm đúng đối thủ cùng quy cách, so sánh giá, đánh giá, phân loại, ảnh, mô tả và tìm khoảng trống để khác biệt.',
        'keywords': 'phân tích đối thủ shopee, nghiên cứu đối thủ, so sánh giá shopee, theo dõi đối thủ',
        'category': 'Đối thủ',
        'minutes': 6,
        'published': '2026-11-07',
        'summary': 'Cách chọn đúng đối thủ, thu thập dữ liệu có ích, đọc đánh giá để tìm khoảng trống và biến phân tích thành việc cụ thể.',
        'body': '''
<p>Nghiên cứu đối thủ không phải để bắt chước, mà để hiểu thị trường đang trả lời nhu cầu như thế nào và bạn có thể làm khác ở đâu. Làm đúng, bạn tiết kiệm nhiều tháng thử sai.</p>

<h2 id="chon-dung-doi-thu">1. Chọn đúng đối thủ</h2>
<p>Đối thủ thực sự là những shop bán sản phẩm <strong>cùng loại, cùng quy cách, cùng tập khách</strong>. Một chiếc bình inox 500ml không cạnh tranh trực tiếp với bộ hai bình 1 lít dù cùng ngành. Tìm theo tên sản phẩm của bạn trên Shopee, lấy 5–10 kết quả đầu, rồi loại những sản phẩm khác chất liệu, kích thước hoặc số lượng trong bộ.</p>

<h2 id="thu-thap">2. Thu thập dữ liệu cần thiết</h2>
<table class="data-table"><thead><tr><th>Yếu tố</th><th>Cần xem</th></tr></thead><tbody>
<tr><td>Giá</td><td>Giá thấp nhất, cao nhất, giá phổ biến; giá sau voucher</td></tr>
<tr><td>Số đã bán và đánh giá</td><td>Sản phẩm bán đều hay chỉ đột biến; điểm đánh giá trung bình</td></tr>
<tr><td>Phân loại</td><td>Mẫu, màu, kích cỡ nào được chọn nhiều</td></tr>
<tr><td>Ảnh và video</td><td>Ảnh chính, ảnh thông số, video có hay không</td></tr>
<tr><td>Tiêu đề và mô tả</td><td>Từ khóa chung, thông tin họ nhấn mạnh</td></tr>
<tr><td>Ưu đãi</td><td>Voucher, combo, quà tặng, miễn phí vận chuyển</td></tr>
</tbody></table>
<p>Thu thập thủ công mất nhiều thời gian. Tiện ích Chrome của MarketLens đọc các trang công khai khi bạn yêu cầu và lưu lại giá, đánh giá, phân loại để so sánh theo thời gian.</p>

<h2 id="doc-danh-gia">3. Đọc đánh giá để tìm khoảng trống</h2>
<p>Đánh giá từ 1 đến 3 sao là nguồn thông tin rẻ nhất về điều khách chưa hài lòng: sản phẩm nhỏ hơn mô tả, giao chậm, đóng gói kém, màu không đúng ảnh. Mỗi lời phàn nàn lặp lại là một cơ hội: bạn có thể ghi rõ kích thước thật, chụp màu chuẩn, đóng gói kỹ hơn và nói điều đó trong mô tả.</p>

<h2 id="so-sanh">4. So sánh và tìm điểm khác biệt</h2>
<ol>
<li>Lập bảng so sánh sản phẩm của bạn với 3–5 đối thủ theo các yếu tố trên.</li>
<li>Đánh dấu nơi bạn kém (giá, ảnh, đánh giá) và nơi bạn tốt (chất liệu, bảo hành, phụ kiện).</li>
<li>Chọn một đến hai điểm khác biệt để nhấn mạnh ở ảnh chính, tiêu đề và mô tả.</li>
</ol>

<h2 id="theo-doi">5. Theo dõi định kỳ, không chỉ một lần</h2>
<p>Thị trường đổi nhanh. Giá, khuyến mãi và đánh giá của đối thủ biến động theo tuần. Lên lịch xem lại 1–2 lần mỗi tuần với nhóm sản phẩm chủ lực và ghi lại thay đổi quan trọng.</p>

<h2 id="luu-y-dao-duc">6. Giới hạn cần tôn trọng</h2>
<p>Chỉ dùng thông tin công khai. Không sao chép nguyên văn mô tả, hình ảnh, video của người khác để đăng, vì có thể vi phạm bản quyền và quy định của sàn. Hãy dùng dữ liệu để hiểu thị trường, sau đó tạo nội dung của riêng bạn.</p>
''',
        'faq': [
            ('Nên theo dõi bao nhiêu đối thủ?', 'Khoảng 3–5 đối thủ cùng loại, cùng quy cách là đủ để thấy mặt bằng giá và cách trình bày. Nhiều hơn thường gây nhiễu.'),
            ('Có thể dùng ảnh của đối thủ không?', 'Không nên. Ảnh và video thuộc quyền của người tạo ra chúng. Hãy tự chụp hoặc dùng nội dung bạn có quyền sử dụng.'),
            ('Bao lâu nên kiểm tra đối thủ một lần?', 'Với nhóm sản phẩm chủ lực nên xem 1–2 lần mỗi tuần; nhóm khác có thể xem hằng tháng.'),
        ],
        'related': ['cach-tinh-gia-ban-va-loi-nhuan-shopee', 'toi-uu-tieu-de-mo-ta-san-pham-shopee', 'cach-chon-san-pham-hot-trend-de-ban-shopee'],
    },
    {
        'slug': 'cach-chon-san-pham-hot-trend-de-ban-shopee',
        'title': 'Cách chọn sản phẩm hot trend để bán trên Shopee',
        'h1': 'Cách chọn sản phẩm hot trend để bán trên Shopee mà không “đu trend” mù quáng',
        'description': 'Cách tìm và kiểm chứng sản phẩm hot trend trên Shopee: tín hiệu cần xem, nguồn dữ liệu, tiêu chí đánh giá, thử nghiệm nhỏ và điều kiện dừng.',
        'keywords': 'sản phẩm hot trend shopee, tìm sản phẩm bán chạy, xu hướng shopee, chọn hàng bán shopee',
        'category': 'Tìm sản phẩm',
        'minutes': 6,
        'published': '2026-11-07',
        'summary': 'Phân biệt tín hiệu quan tâm với nhu cầu thật, kiểm chứng biên lợi nhuận và cạnh tranh, rồi thử nhỏ trước khi nhập số lượng lớn.',
        'body': '''
<p>Sản phẩm hot trend có thể mang lại doanh số nhanh, nhưng cũng là nơi nhiều người ôm hàng tồn nhất. Trend đến nhanh thì cũng đi nhanh. Cách an toàn là coi trend là <em>giả thuyết</em> cần kiểm chứng, không phải kết luận.</p>

<h2 id="tin-hieu">1. Những tín hiệu đáng xem</h2>
<ul>
<li><strong>Số đã bán tăng đều:</strong> nhiều sản phẩm cùng loại có lượng bán tăng trong vài tuần, không chỉ một shop đột biến.</li>
<li><strong>Đánh giá mới xuất hiện nhiều:</strong> cho thấy khách đang mua và dùng thật.</li>
<li><strong>Nhiều shop mới tham gia:</strong> vừa là dấu hiệu nhu cầu, vừa là cảnh báo cạnh tranh sắp tăng.</li>
<li><strong>Tín hiệu bên ngoài sàn:</strong> mức quan tâm tìm kiếm hoặc nội dung video ngắn. Đây là mức quan tâm, chưa phải đơn hàng.</li>
</ul>

<h2 id="nguon-du-lieu">2. Nguồn dữ liệu để tham khảo</h2>
<p>Kết hợp nhiều nguồn: danh sách bán chạy theo ngành hàng ngay trên Shopee, công cụ xu hướng tìm kiếm công khai, nội dung các nền tảng video ngắn và dữ liệu thu thập theo ngành hàng của riêng bạn. Với MarketLens, bạn có thể thu thập sản phẩm theo ngành hàng và lưu giá, đánh giá, phân loại để xem sản phẩm nào tăng theo thời gian.</p>

<h2 id="kiem-chung">3. Kiểm chứng trước khi nhập hàng</h2>
<ol>
<li><strong>Biên lợi nhuận:</strong> sau khi trừ phí, đóng gói, quảng cáo, lãi mỗi đơn có đủ không? (<a href="/blog/cach-tinh-gia-ban-va-loi-nhuan-shopee">Cách tính</a>.)</li>
<li><strong>Cạnh tranh:</strong> có bao nhiêu shop lớn đã chiếm vị trí? Bạn có điểm khác biệt nào?</li>
<li><strong>Tính mùa vụ:</strong> sản phẩm bán theo mùa hay theo đợt viral? Tránh nhập nhiều khi đã qua đỉnh.</li>
<li><strong>Nguồn hàng:</strong> nhập được lô nhỏ, đổi trả được, chất lượng ổn định?</li>
<li><strong>Rủi ro pháp lý:</strong> hàng nhái, thương hiệu có bảo hộ, nhóm hàng hạn chế.</li>
</ol>

<h2 id="thu-nho">4. Thử nhỏ, đo rõ</h2>
<p>Nhập số lượng vừa đủ cho 1–2 tuần bán, đăng sản phẩm với tiêu đề, ảnh tốt rồi theo dõi lượt xem, tỷ lệ chuyển đổi và lãi thực tế. Chỉ tăng số lượng khi dữ liệu thật của shop bạn xác nhận, không dựa vào số liệu của người khác.</p>

<h2 id="dieu-kien-dung">5. Đặt điều kiện dừng từ đầu</h2>
<p>Trước khi bắt đầu, hãy ghi lại: mức tồn kho tối đa chấp nhận, mức lãi tối thiểu mỗi đơn, thời gian thử nghiệm. Khi một ngưỡng bị vượt, dừng nhập thêm và xả hàng tồn bằng combo hoặc ưu đãi nhỏ. Việc này tránh biến một thử nghiệm thành khoản lỗ lớn.</p>
''',
        'faq': [
            ('Sản phẩm hot trend có phải lúc nào cũng nên bán?', 'Không. Hãy kiểm chứng biên lợi nhuận, mức cạnh tranh, tính mùa vụ và nguồn hàng trước. Trend ngắn hạn dễ để lại hàng tồn.'),
            ('Dữ liệu từ công cụ xu hướng có phản ánh đơn hàng Shopee không?', 'Không trực tiếp. Chúng cho thấy mức quan tâm, còn số đơn Shopee cần được xác nhận bằng dữ liệu bán hàng thực tế trên sàn và của shop bạn.'),
            ('Nên nhập bao nhiêu hàng khi thử sản phẩm mới?', 'Chỉ đủ cho 1–2 tuần bán và đặt trước mức tồn kho tối đa chấp nhận được. Tăng số lượng sau khi có dữ liệu thật.'),
        ],
        'related': ['cach-nghien-cuu-doi-thu-tren-shopee', 'cach-tinh-gia-ban-va-loi-nhuan-shopee', 'cach-ban-hang-tren-shopee-cho-nguoi-moi'],
    },
    {
        'slug': 'hinh-anh-video-san-pham-shopee',
        'title': 'Hình ảnh và video sản phẩm Shopee: cách làm tăng chuyển đổi',
        'h1': 'Hình ảnh và video sản phẩm Shopee: cách làm để khách bấm vào và chốt đơn',
        'description': 'Hướng dẫn chụp ảnh và làm video sản phẩm Shopee: ảnh chính, ảnh phân loại, ảnh thông số, video ngắn, lỗi thường gặp và cách thử để tăng tỷ lệ nhấp.',
        'keywords': 'ảnh sản phẩm shopee, video sản phẩm shopee, ảnh bìa shopee, tăng chuyển đổi shopee',
        'category': 'Tối ưu sản phẩm',
        'minutes': 5,
        'published': '2026-11-07',
        'summary': 'Bộ ảnh nên có cho một sản phẩm, cách làm video ngắn, lỗi hay gặp và cách thử đổi ảnh chính để tăng tỷ lệ nhấp.',
        'body': '''
<p>Trên trang kết quả tìm kiếm, khách quyết định có bấm vào hay không chỉ trong vài giây, và thứ họ thấy trước tiên là ảnh. Ảnh và video tốt vừa kéo lượt bấm, vừa giảm câu hỏi và hoàn trả.</p>

<h2 id="anh-chinh">1. Ảnh chính: nhìn rõ, đúng sản phẩm</h2>
<ul>
<li>Nền sạch, sáng, sản phẩm chiếm phần lớn khung hình, không bị cắt.</li>
<li>Chụp đúng sản phẩm bạn bán. Không dùng ảnh của shop khác hoặc ảnh minh họa không đúng.</li>
<li>Tránh logo, watermark của nền tảng khác và quá nhiều chữ che sản phẩm.</li>
<li>Tuân thủ yêu cầu tỷ lệ, kích thước và dung lượng hiện hành của Shopee.</li>
</ul>

<h2 id="bo-anh-phu">2. Bộ ảnh phụ nên có</h2>
<ol>
<li><strong>Nhiều góc:</strong> mặt trước, sau, bên, chi tiết.</li>
<li><strong>Ảnh kích thước và thông số:</strong> thước đo hoặc bảng thông số giúp khách yên tâm.</li>
<li><strong>Ảnh phân loại:</strong> mỗi màu hoặc mẫu một ảnh rõ ràng, khớp với tên phân loại.</li>
<li><strong>Ảnh sử dụng thật:</strong> sản phẩm trong bối cảnh dùng giúp khách hình dung.</li>
<li><strong>Ảnh đóng gói:</strong> cho thấy hàng được bảo vệ cẩn thận.</li>
</ol>

<h2 id="video">3. Video ngắn</h2>
<p>Video 20–60 giây thường đủ để cho thấy sản phẩm hoạt động, kích thước thật và cách dùng. Mở đầu bằng điều khách quan tâm nhất, quay đủ sáng, ổn định tay, có chữ chú thích đơn giản. Kiểm tra giới hạn dung lượng và thời lượng hiện hành của sàn trước khi tải lên.</p>

<h2 id="loi-thuong-gap">4. Lỗi thường gặp</h2>
<ul>
<li>Ảnh mờ, thiếu sáng, màu lệch so với thực tế dẫn đến đánh giá thấp.</li>
<li>Ảnh phân loại không khớp tên, khiến khách chọn nhầm.</li>
<li>Dùng ảnh, video lấy từ shop khác: rủi ro bản quyền và bị báo cáo.</li>
<li>Chỉ có ảnh đẹp, thiếu thông số kích thước.</li>
</ul>

<h2 id="thu-nghiem">5. Thử nghiệm đổi ảnh chính</h2>
<p>Ghi lại tỷ lệ nhấp hiện tại, thay ảnh chính bằng một phiên bản khác (nền, góc chụp hoặc điểm nhấn), giữ nguyên các yếu tố còn lại và theo dõi 7 ngày. Giữ phiên bản có tỷ lệ nhấp và chuyển đổi tốt hơn. Làm đều đặn với từng nhóm sản phẩm chủ lực sẽ cho kết quả rõ hơn việc đổi ngẫu nhiên.</p>
''',
        'faq': [
            ('Ảnh sản phẩm Shopee cần kích thước bao nhiêu?', 'Hãy theo yêu cầu hiện hành của Shopee về tỷ lệ, độ phân giải và dung lượng ảnh trong Trung tâm Người bán, vì thông số này có thể thay đổi.'),
            ('Có bắt buộc phải có video không?', 'Không bắt buộc ở mọi ngành hàng, nhưng video giúp khách hiểu sản phẩm nhanh hơn và thường hữu ích với hàng cần xem cách dùng hoặc kích thước thật.'),
            ('Có thể dùng lại ảnh của nhà cung cấp không?', 'Chỉ khi bạn được cho phép sử dụng. Nếu không chắc, hãy tự chụp hoặc xin phép bằng văn bản để tránh tranh chấp bản quyền.'),
        ],
        'related': ['toi-uu-tieu-de-mo-ta-san-pham-shopee', 'cach-ban-hang-tren-shopee-cho-nguoi-moi', 'cach-nghien-cuu-doi-thu-tren-shopee'],
    },
    {
        'slug': 'dong-goi-va-giao-hang-cho-don-vi-van-chuyen-shopee',
        'title': 'Đóng gói và giao hàng cho đơn vị vận chuyển Shopee',
        'h1': 'Đóng gói và giao hàng cho đơn vị vận chuyển: quy trình xử lý đơn gọn, ít sai sót',
        'description': 'Cách tổ chức soạn hàng, đóng gói và bàn giao cho đơn vị vận chuyển trên Shopee: thứ tự ưu tiên đơn, mẹo đóng gói, lúc shipper đến lấy và khi tự ra bưu cục.',
        'keywords': 'đóng gói hàng shopee, giao hàng cho đơn vị vận chuyển, xử lý đơn hàng shopee, bàn giao đơn hàng',
        'category': 'Vận hành',
        'minutes': 6,
        'published': '2026-11-07',
        'summary': 'Cách chia việc kho, ưu tiên đơn theo hạn gửi, đóng gói đúng cách và bàn giao cho shipper hoặc bưu cục mà không bị trễ hạn.',
        'body': '''
<p>Khách chỉ nhớ hai điều sau khi mua hàng: hàng có đúng không và có đến nhanh không. Cả hai đều quyết định ở khâu soạn, đóng gói và bàn giao. Một quy trình rõ ràng giúp shop giảm giao trễ, giảm hoàn trả và giữ điểm vận hành ổn định.</p>

<h2 id="phan-vai-tro">1. Phân vai trong kho</h2>
<p>Dù chỉ có một hai người, hãy tách rõ bốn việc: <strong>sắp xếp đơn giao cho đơn vị vận chuyển</strong>, <strong>in phiếu gửi hàng và mã vận đơn</strong>, <strong>soạn sản phẩm vào đúng hộp</strong> và <strong>đóng gói, dán phiếu, bàn giao</strong>. Một người có thể kiêm nhiều việc, nhưng phải biết mình đang làm bước nào và ai chịu trách nhiệm điều phối. Kho gọn gàng, có chỗ để cố định cho từng loại vật liệu, sẽ giúp bạn xử lý nhanh hơn khi đơn tăng.</p>

<h2 id="uu-tien-don">2. Ưu tiên đơn theo hạn gửi</h2>
<ul>
<li>Xử lý theo từng đợt dựa trên <strong>hạn gửi hàng</strong>, không theo thứ tự ngẫu nhiên.</li>
<li>Trong mỗi đợt, làm trước đơn đã sát hoặc quá hạn và các đơn giao nhanh trong ngày, sau đó mới đến đơn giao tiêu chuẩn và các điểm nhận hàng.</li>
<li><strong>Tách đơn một sản phẩm</strong> khỏi đơn nhiều sản phẩm. Đơn một món đóng nhanh hơn, có thể giao hết cho một người xử lý liên tục.</li>
<li>Dùng chức năng giao hàng loạt và bộ lọc theo mã sản phẩm (SKU) trong Kênh Người Bán để gom nhóm.</li>
</ul>

<h2 id="meo-dong-goi">3. Mẹo soạn hàng và đóng gói</h2>
<ol>
<li>Soạn hàng của mỗi đơn vào một khay hoặc hộp riêng, phiếu gửi hàng để riêng để kiểm tra lại trước khi dán.</li>
<li>Để toàn bộ vật liệu (hộp, băng keo, xốp, túi chống sốc) ở cùng một khu vực, tránh phải đi lấy giữa chừng.</li>
<li>Chia khu đóng gói theo tính chất hàng: dễ vỡ, dễ hỏng, giá trị cao.</li>
<li>Đóng đúng theo quy định đóng gói hiện hành của Shopee và quy định theo từng ngành hàng.</li>
<li>Kiểm tra phiếu gửi hàng dán thẳng, không nhăn, mã quét được. Mã quét lỗi là nguyên nhân hay gặp khiến shipper không xác nhận lấy hàng được.</li>
</ol>

<h2 id="khi-shipper-den">4. Khi shipper đến lấy hàng</h2>
<ul>
<li>Chuẩn bị sẵn kiện hàng trước giờ hẹn và bố trí khu bàn giao gần cửa để shipper ra vào nhanh.</li>
<li>Tách kiện theo thời điểm cần lấy (hôm nay, ngày mai) và theo từng phương thức vận chuyển để không nhầm nhãn.</li>
<li>Cập nhật đúng địa chỉ và số liên hệ của shop để shipper tìm đến chính xác.</li>
<li>Yêu cầu quét mã ngay tại chỗ để xác nhận lấy hàng thành công.</li>
<li>Nếu shipper chưa đến mà sắp hết giờ làm việc của shop, gọi số hiển thị trong màn hình bàn giao đơn hàng và ghi lại các lần lấy hàng không thành công làm bằng chứng khi cần khiếu nại.</li>
</ul>

<h2 id="tu-mang-ra-buu-cuc">5. Khi tự mang hàng ra bưu cục</h2>
<p>Biết trước vị trí và giờ làm việc của bưu cục gần bạn. Mang những kiện chưa được lấy theo lịch ra bưu cục đủ sớm để kịp hạn gửi, và luôn yêu cầu nhân viên quét mã ngay tại quầy.</p>

<h2 id="khi-co-su-co">6. Khi có sự cố</h2>
<p>Nếu vấn đề phát sinh ở khâu giao nhận, liên hệ trực tiếp đơn vị vận chuyển để được xử lý nhanh nhất. Nếu bạn bị tính lỗi oan vì shipper không đến lấy hoặc lấy trễ, hãy xem chính sách khiếu nại hiện hành của Shopee và gửi khiếu nại kèm bằng chứng đã ghi lại.</p>
''',
        'faq': [
            ('Nên xử lý đơn theo thứ tự nào?', 'Theo hạn gửi hàng: đơn sát hạn hoặc quá hạn và đơn giao nhanh trước, sau đó đến đơn tiêu chuẩn. Tách đơn một sản phẩm ra xử lý riêng để tăng tốc.'),
            ('Shipper không đến lấy hàng thì làm gì?', 'Gọi số điện thoại hiển thị trong màn hình bàn giao đơn hàng, ghi lại lần lấy không thành công và đưa hàng ra bưu cục nếu sắp hết hạn gửi. Nếu bị tính lỗi oan, khiếu nại theo hướng dẫn của Shopee.'),
            ('Cần chuẩn bị vật liệu đóng gói gì?', 'Hộp hoặc túi đúng kích cỡ, băng keo, vật liệu chống sốc cho hàng dễ vỡ và giấy in phiếu gửi hàng. Giữ tất cả ở một khu vực để đóng gói liên tục.'),
        ],
        'related': ['phuong-thuc-van-chuyen-shopee-nguoi-ban-can-biet', 'van-hanh-shop-shopee-dip-cao-diem-tet', 'cach-ban-hang-tren-shopee-cho-nguoi-moi'],
    },
    {
        'slug': 'phuong-thuc-van-chuyen-shopee-nguoi-ban-can-biet',
        'title': 'Phương thức vận chuyển Shopee: người bán cần biết gì',
        'h1': 'Phương thức vận chuyển trên Shopee: người bán cần biết và cài đặt thế nào',
        'description': 'Tổng quan các nhóm phương thức vận chuyển trên Shopee, giới hạn cân nặng kích thước, cách đơn được phân bổ cho đơn vị vận chuyển và mẹo cài đặt cho shop.',
        'keywords': 'phương thức vận chuyển shopee, cài đặt vận chuyển shopee, phí vận chuyển shopee, đơn vị vận chuyển shopee',
        'category': 'Vận hành',
        'minutes': 6,
        'published': '2026-11-07',
        'summary': 'Các nhóm phương thức vận chuyển, vì sao nên bật nhiều lựa chọn, cách đơn được phân bổ và cách nhập cân nặng, kích thước cho đúng.',
        'body': '''
<p>Vận chuyển ảnh hưởng trực tiếp đến tỷ lệ chốt đơn: khách nhìn phí và thời gian giao ngay trên trang sản phẩm. Hiểu các phương thức và cài đặt đúng giúp shop vừa bán được nhiều hơn, vừa ít phát sinh sự cố.</p>

<h2 id="cac-nhom">1. Các nhóm phương thức</h2>
<p>Shopee gom vận chuyển thành các nhóm theo tốc độ và cách nhận hàng. Danh sách và tên gọi có thể thay đổi, nhưng nhìn chung gồm:</p>
<ul>
<li><strong>Giao hỏa tốc và trong ngày:</strong> dành cho đơn cần đến nhanh trong nội thành, thường áp giới hạn cân nặng và kích thước chặt hơn.</li>
<li><strong>Giao nhanh (tiêu chuẩn):</strong> lựa chọn phổ biến cho phần lớn đơn hàng.</li>
<li><strong>Hàng cồng kềnh:</strong> cho kiện lớn, nặng hơn mức giao nhanh thông thường.</li>
<li><strong>Nhận hàng tại tủ hoặc điểm nhận:</strong> khách chủ động ra lấy, thường chi phí thấp hơn.</li>
<li><strong>Người bán tự vận chuyển:</strong> shop tự giao theo điều kiện riêng, phù hợp khi hàng đặc thù.</li>
</ul>

<h2 id="vi-sao-bat-nhieu">2. Vì sao nên bật nhiều phương thức</h2>
<p>Khách có nhu cầu khác nhau: người cần gấp chọn giao nhanh, người tiết kiệm chọn nhận tại điểm. Bật nhiều lựa chọn phù hợp với sản phẩm giúp shop không bỏ lỡ nhóm khách nào. Một số nhóm hàng đặc biệt (hàng nguy hiểm, thực phẩm cần bảo quản, hàng tươi sống) bị giới hạn phương thức, và Shopee có thể điều chỉnh mặc định theo chính sách từng thời kỳ. Hãy xem thông báo mới nhất trong Kênh Người Bán thay vì nhớ theo số cũ.</p>

<h2 id="gioi-han">3. Cân nặng và kích thước sau đóng gói</h2>
<p>Mỗi phương thức có giới hạn tối đa về kích thước từng cạnh và cân nặng. Quy tắc nên nhớ:</p>
<ol>
<li>Nhập số đo <strong>sau khi đóng gói</strong>, không phải số đo sản phẩm trần.</li>
<li>Cân thật bằng cân, đo thật bằng thước cho vài đơn mẫu rồi dùng làm chuẩn.</li>
<li>Khai thấp hơn thực tế dễ bị phát sinh phí; khai cao hơn làm phí hiển thị cao khiến khách bỏ đi.</li>
<li>Kiểm tra giới hạn hiện hành của từng phương thức trước khi bật cho sản phẩm cồng kềnh.</li>
</ol>

<h2 id="phan-bo-don">4. Đơn được phân bổ cho đơn vị vận chuyển thế nào</h2>
<p>Hệ thống thường phân bổ dựa trên khu vực hoạt động, giới hạn cân nặng kích thước và chất lượng dịch vụ của từng đơn vị (đúng hạn lấy hàng, đúng hạn giao, tỷ lệ giao không thành công, tỷ lệ thất lạc hoặc hư hỏng). Khách cũng có thể tự chọn đơn vị phù hợp trong mạng lưới nền tảng cung cấp. Vì vậy, shop nên chuẩn bị để làm việc với nhiều đơn vị khác nhau và đừng giả định lúc nào cũng là một đơn vị quen thuộc.</p>

<h2 id="cai-dat">5. Cài đặt và mẹo thực hành</h2>
<ul>
<li>Thiết lập tại trang cài đặt vận chuyển của shop, sau đó kiểm tra lại trong chi tiết từng sản phẩm.</li>
<li>Khi đăng hàng loạt, tải bản mẫu mới nhất trước khi cập nhật để tránh thiếu trường vận chuyển.</li>
<li>Chọn đúng hình thức “đơn vị vận chuyển đến lấy” cho những đơn bạn muốn shipper đến tận nơi.</li>
<li>Chuẩn bị biên bản giao nhận để đối chiếu khi có tranh chấp.</li>
<li>Đối xử tử tế với tài xế: chỗ ngồi chờ, nước uống. Quan hệ tốt giúp việc bàn giao suôn sẻ hơn.</li>
</ul>
<p>Muốn biết phí vận chuyển ảnh hưởng thế nào đến lãi mỗi đơn, xem bài <a href="/blog/cach-tinh-gia-ban-va-loi-nhuan-shopee">cách tính giá bán và lợi nhuận</a>.</p>
''',
        'faq': [
            ('Có nên bật tất cả phương thức vận chuyển không?', 'Nên bật mọi phương thức phù hợp với sản phẩm để không bỏ lỡ nhóm khách nào, trừ những nhóm hàng bị giới hạn theo chính sách của Shopee.'),
            ('Nhập cân nặng bao nhiêu cho đúng?', 'Nhập cân nặng và kích thước sau khi đóng gói, đo thật vài đơn mẫu. Khai sai làm phát sinh phí hoặc làm khách thấy phí vận chuyển cao.'),
            ('Giới hạn cân nặng của từng phương thức là bao nhiêu?', 'Giới hạn thay đổi theo thời gian và theo phương thức. Hãy xem bảng quy định hiện hành trong Kênh Người Bán hoặc Seller Education Hub.'),
        ],
        'related': ['dong-goi-va-giao-hang-cho-don-vi-van-chuyen-shopee', 'cach-tinh-gia-ban-va-loi-nhuan-shopee', 'van-hanh-shop-shopee-dip-cao-diem-tet'],
    },
    {
        'slug': 'van-hanh-shop-shopee-dip-cao-diem-tet',
        'title': 'Vận hành shop Shopee dịp cao điểm và Tết: checklist cần có',
        'h1': 'Vận hành shop Shopee dịp cao điểm và Tết: checklist để không bị quá tải',
        'description': 'Checklist vận hành shop Shopee dịp cao điểm và Tết: dự báo tồn kho, nhân sự, đóng gói, vận chuyển trễ, chăm sóc khách và giữ điểm shop ổn định.',
        'keywords': 'vận hành shop shopee dịp tết, bán hàng shopee cao điểm, chuẩn bị hàng tết shopee, xử lý đơn mùa cao điểm',
        'category': 'Vận hành',
        'minutes': 5,
        'published': '2026-11-07',
        'summary': 'Chuẩn bị hàng, nhân sự, vận chuyển và chăm sóc khách trước mùa cao điểm để tận dụng nhu cầu mua sắm mà không bị trễ đơn.',
        'body': '''
<p>Cận Tết và các đợt khuyến mãi lớn là lúc đơn tăng mạnh nhưng cũng là lúc vận chuyển chậm hơn và sai sót nhiều hơn. Shop chuẩn bị tốt sẽ lấy được doanh thu, shop chuẩn bị kém sẽ bị trễ đơn và đánh giá thấp.</p>

<h2 id="du-bao-ton-kho">1. Dự báo và chuẩn bị tồn kho</h2>
<ul>
<li>Xem số đơn cùng kỳ năm trước và tốc độ tăng của vài tuần gần đây để ước lượng nhu cầu.</li>
<li>Nhập đủ cho nhóm hàng chủ lực, thận trọng với hàng thử nghiệm.</li>
<li>Cập nhật tồn kho thường xuyên để tránh bán quá số lượng có thật.</li>
<li>Biết trước hạn nhà cung cấp nghỉ lễ để nhập sớm.</li>
</ul>

<h2 id="nhan-su">2. Sắp xếp nhân sự và lịch làm việc</h2>
<p>Lên lịch người xử lý đơn cả cuối tuần ở những ngày cao điểm và nhớ lịch nghỉ Tết của kho, đơn vị vận chuyển. Khi có thông báo chậm nhận hàng, hãy tranh thủ xử lý để giảm đơn tồn đọng, đừng để dồn sang các ngày cuối.</p>

<h2 id="dong-goi-san">3. Chuẩn bị vật liệu và đóng gói sẵn</h2>
<p>Mua dự trữ hộp, băng keo, túi chống sốc. Hàng bán chạy có thể đóng gói sẵn theo bộ để rút ngắn thời gian. Xem lại bài <a href="/blog/dong-goi-va-giao-hang-cho-don-vi-van-chuyen-shopee">đóng gói và giao cho đơn vị vận chuyển</a> để tổ chức kho gọn.</p>

<h2 id="van-chuyen-cham">4. Làm gì khi vận chuyển chậm</h2>
<ol>
<li>Ghi nhận các đơn chậm lấy hoặc chậm giao và lưu bằng chứng.</li>
<li>Xem thông báo của Shopee: trong những giai đoạn cao điểm, Shopee có thể điều chỉnh cách tính chỉ số hoặc gia hạn xử lý đơn. Nội dung cụ thể thay đổi theo từng năm nên hãy đọc thông báo mới nhất.</li>
<li>Chủ động nhắn khách về thời gian giao dự kiến để giảm hủy đơn.</li>
<li>Với đơn thất lạc hoặc hư hỏng, làm theo chính sách đền bù hiện hành.</li>
</ol>

<h2 id="cham-soc-khach-cao-diem">5. Chăm sóc khách trong mùa cao điểm</h2>
<ul>
<li>Soạn sẵn tin nhắn trả lời nhanh cho các câu hỏi lặp lại: phí ship, thời gian giao, đổi trả.</li>
<li>Ghi rõ trong mô tả lịch nghỉ Tết và thời gian chuẩn bị hàng thực tế.</li>
<li>Trả lời tin nhắn nhanh và xử lý đánh giá thấp có lịch sự.</li>
</ul>

<h2 id="khuyen-mai-cao-diem">6. Khuyến mãi có tính toán</h2>
<p>Mùa cao điểm dễ khiến shop giảm giá quá tay. Trước khi tham gia chương trình, hãy tính lại giá hòa vốn và lãi tối thiểu như trong bài <a href="/blog/cach-tinh-gia-ban-va-loi-nhuan-shopee">cách tính giá bán và lợi nhuận</a>, và chỉ tham gia khi vẫn có lãi.</p>
''',
        'faq': [
            ('Nên chuẩn bị hàng cho Tết từ khi nào?', 'Sớm nhất có thể, vì nhà cung cấp và đơn vị vận chuyển thường nghỉ hoặc chậm trước Tết. Xem số đơn cùng kỳ năm trước để ước lượng.'),
            ('Đơn bị chậm do vận chuyển có ảnh hưởng điểm shop không?', 'Shopee có thể điều chỉnh cách tính cho đơn chậm không do lỗi người bán, nhưng chính sách thay đổi theo từng thời điểm. Hãy đọc thông báo mới nhất và lưu bằng chứng để khiếu nại khi cần.'),
            ('Có nên giảm giá mạnh dịp Tết không?', 'Chỉ khi giá sau giảm vẫn trên giá hòa vốn và bạn có đủ hàng. Giảm quá tay dễ dẫn đến bán nhiều nhưng không có lãi.'),
        ],
        'related': ['dong-goi-va-giao-hang-cho-don-vi-van-chuyen-shopee', 'phuong-thuc-van-chuyen-shopee-nguoi-ban-can-biet', 'cach-tinh-gia-ban-va-loi-nhuan-shopee'],
    },
]

from blog_posts_more import MORE, STEPS  # noqa: E402  (second batch + step lists for diagrams)

POSTS.extend(MORE)
for _post in POSTS:
    _post.setdefault('steps', STEPS.get(_post['slug'], []))
