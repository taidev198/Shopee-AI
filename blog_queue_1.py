"""Scheduled blog posts, batch 1. No 'published' field: dates are assigned in blog_posts.py (Mon/Wed/Fri).

Rule: a scheduled post may only link (inline or in 'related') to posts published on or before it.
Policy, fee and limit details change often, so these posts point readers to Kênh Người Bán for current rules.
"""

QUEUE_1 = [
    {
        'slug': 'chuan-bi-hang-truoc-ngay-sale-doi-11-11',
        'title': 'Chuẩn bị shop Shopee trước ngày sale đôi 11.11 và 12.12',
        'h1': 'Chuẩn bị shop Shopee trước ngày sale đôi 11.11 và 12.12: checklist 7 ngày',
        'description': 'Checklist chuẩn bị shop Shopee trước các ngày sale đôi: tồn kho, giá, voucher, nhân sự, đóng gói và kiểm tra sản phẩm để không bỏ lỡ đơn.',
        'keywords': 'chuẩn bị sale 11.11 shopee, sale đôi shopee, checklist sale shopee, bán hàng ngày sale',
        'category': 'Vận hành', 'minutes': 5,
        'summary': 'Checklist 7 ngày trước sale đôi: tồn kho, giá hòa vốn, voucher, nhân sự và đóng gói để đón đơn tăng mạnh.',
        'steps': [('7 ngày trước', 'Kiểm tồn kho và giá hòa vốn.'), ('5 ngày trước', 'Cài voucher, combo, kiểm tra ảnh và tiêu đề.'), ('3 ngày trước', 'Chuẩn bị vật liệu và xếp lịch nhân sự.'), ('Ngày sale', 'Theo dõi đơn theo giờ, cập nhật tồn kho liên tục.')],
        'body': '''
<p>Những ngày sale đôi là lúc lượng khách tăng đột biến. Shop chuẩn bị tốt vừa bán được nhiều vừa không bị hủy đơn do thiếu hàng. Dưới đây là checklist 7 ngày bạn có thể làm theo.</p>
<h2 id="bay-ngay-truoc">1. Bảy ngày trước: tồn kho và giá</h2>
<ul><li>Đối chiếu tồn kho thật với số liệu trên sàn, sửa các sản phẩm lệch.</li><li>Xác định nhóm sản phẩm chủ lực sẽ đẩy trong ngày sale.</li><li>Tính lại giá hòa vốn (xem <a href="/blog/cach-tinh-gia-ban-va-loi-nhuan-shopee">cách tính giá bán và lợi nhuận</a>) và đặt mức giảm sâu nhất bạn chịu được.</li></ul>
<h2 id="nam-ngay-truoc">2. Năm ngày trước: khuyến mãi và nội dung</h2>
<ul><li>Cài mã giảm giá và combo theo mục tiêu, xem <a href="/blog/cong-cu-khuyen-mai-cua-shop-shopee">công cụ khuyến mãi của shop</a>.</li><li>Kiểm tra ảnh chính, tiêu đề, phân loại, cân nặng của sản phẩm chủ lực.</li><li>Đăng video ngắn giới thiệu ưu đãi.</li></ul>
<h2 id="ba-ngay-truoc">3. Ba ngày trước: vận hành</h2>
<ul><li>Mua dự trữ hộp, băng keo, túi chống sốc.</li><li>Xếp lịch người xử lý đơn cả ngày sale và hai ngày sau đó.</li><li>Soạn sẵn tin nhắn trả lời nhanh về phí ship, thời gian giao, đổi trả.</li></ul>
<h2 id="ngay-sale">4. Ngày sale</h2>
<ol><li>Theo dõi đơn theo giờ, xử lý theo hạn gửi (xem <a href="/blog/dong-goi-va-giao-hang-cho-don-vi-van-chuyen-shopee">đóng gói và bàn giao đơn</a>).</li><li>Tắt ngay sản phẩm hết hàng để tránh hủy đơn.</li><li>Nhắn khách thời gian giao dự kiến nếu vận chuyển chậm.</li></ol>
<h2 id="sau-sale">5. Sau sale</h2>
<p>So sánh số đơn, doanh thu, lãi thực và đánh giá mới. Ghi lại sản phẩm bán tốt, mức giảm hiệu quả và lỗi vận hành để làm tốt hơn đợt sau. Xem thêm <a href="/blog/van-hanh-shop-shopee-dip-cao-diem-tet">vận hành shop dịp cao điểm</a>.</p>
''',
        'faq': [('Nên chuẩn bị từ khi nào?', 'Khoảng 7 ngày trước ngày sale để kịp nhập hàng bổ sung, cài khuyến mãi và xếp nhân sự.'), ('Có nên giảm giá sâu cho mọi sản phẩm?', 'Không. Chọn vài sản phẩm chủ lực có biên lãi chịu được mức giảm, các sản phẩm còn lại giữ giá hợp lý.'), ('Hết hàng giữa ngày sale thì làm gì?', 'Tắt sản phẩm ngay và cập nhật tồn kho để không bị hủy đơn và ảnh hưởng điểm shop.')],
        'related': ['van-hanh-shop-shopee-dip-cao-diem-tet', 'cong-cu-khuyen-mai-cua-shop-shopee', 'cach-tinh-gia-ban-va-loi-nhuan-shopee'],
    },
    {
        'slug': 'cach-dat-ten-shop-shopee-dung-quy-dinh',
        'title': 'Cách đặt tên shop Shopee dễ nhớ và đúng quy định',
        'h1': 'Cách đặt tên shop Shopee dễ nhớ, tốt cho thương hiệu và đúng quy định',
        'description': 'Nguyên tắc đặt tên shop Shopee: ngắn gọn, gợi ngành hàng, dễ nhớ và tránh các lỗi bị tính vi phạm như từ nhạy cảm hoặc tên mang tính chính thức.',
        'keywords': 'đặt tên shop shopee, tên shop bán hàng, quy định tên shop shopee, thương hiệu shop',
        'category': 'Bắt đầu', 'minutes': 4,
        'summary': 'Tên shop là ấn tượng đầu tiên: cách chọn tên dễ nhớ và những lỗi đặt tên có thể bị tính vi phạm.',
        'steps': [('Xác định ngành và khách', 'Nghĩ shop bán gì, cho ai.'), ('Lên 5–10 tên', 'Ngắn, dễ đọc, dễ viết.'), ('Kiểm tra quy định', 'Tránh từ nhạy cảm, tên nền tảng, từ chính thức.'), ('Chọn và dùng nhất quán', 'Dùng cùng tên ở mọi kênh.')],
        'body': '''
<p>Tên shop xuất hiện ở mọi nơi: kết quả tìm kiếm, trang sản phẩm, đơn hàng. Một cái tên tốt giúp khách nhớ và quay lại; một cái tên sai quy định có thể khiến shop bị tính vi phạm.</p>
<h2 id="nguyen-tac">1. Nguyên tắc chọn tên</h2>
<ul><li><strong>Ngắn gọn:</strong> dễ đọc, dễ gõ, không quá 3 từ nếu có thể.</li><li><strong>Gợi ngành hàng:</strong> khách nhìn là đoán được shop bán gì.</li><li><strong>Khác biệt:</strong> tìm thử trên Shopee để tránh trùng hoặc quá giống shop khác.</li><li><strong>Dễ phát âm:</strong> tiện cho khách truyền miệng.</li></ul>
<h2 id="quy-dinh">2. Quy định cần tránh</h2>
<p>Theo hệ thống điểm phạt hiện hành, các lỗi đặt tên phổ biến gồm: chứa từ thô tục hoặc nhạy cảm, chứa tên nền tảng, chứa tên thương hiệu không thuộc về bạn, hoặc dùng từ mang tính chính thức mà bạn không có quyền như “official store” hay “flagship”. Xem thêm <a href="/blog/he-thong-sao-qua-ta-shopee">hệ thống Sao Quả Tạ</a> để biết hậu quả.</p>
<h2 id="quy-trinh">3. Quy trình chọn tên</h2>
<ol><li>Viết 5–10 phương án.</li><li>Đọc to từng tên, loại tên khó đọc.</li><li>Tìm trên Shopee và mạng xã hội xem đã bị dùng chưa.</li><li>Đối chiếu với quy định rồi chọn một tên.</li></ol>
<h2 id="nhat-quan">4. Dùng nhất quán</h2>
<p>Dùng cùng một tên, ảnh đại diện và phong cách ở các kênh khác nhau để khách nhận ra shop. Khi shop lớn lên, một tên nhất quán giúp xây dựng thương hiệu dễ hơn nhiều so với đổi tên liên tục.</p>
''',
        'faq': [('Có thể đổi tên shop không?', 'Thường có thể đổi theo giới hạn của Shopee. Hãy kiểm tra trong phần hồ sơ shop vì quy định có thể thay đổi.'), ('Tên shop có ảnh hưởng đến tìm kiếm không?', 'Tên gợi ngành hàng giúp khách nhận biết, nhưng thứ quyết định thứ hạng chủ yếu vẫn là sản phẩm, tiêu đề và hiệu quả bán.'), ('Có thể dùng tên thương hiệu nổi tiếng không?', 'Không, trừ khi bạn là chủ thương hiệu hoặc được ủy quyền. Dùng trái phép có thể bị phạt.')],
        'related': ['cach-ban-hang-tren-shopee-cho-nguoi-moi', 'he-thong-sao-qua-ta-shopee'],
    },
    {
        'slug': 'checklist-truoc-khi-dang-san-pham-shopee',
        'title': 'Checklist 12 điểm kiểm tra trước khi đăng sản phẩm Shopee',
        'h1': 'Checklist 12 điểm kiểm tra trước khi bấm đăng sản phẩm lên Shopee',
        'description': 'Checklist 12 điểm trước khi đăng sản phẩm Shopee: ngành hàng, tiêu đề, ảnh, phân loại, giá, cân nặng, vận chuyển, mô tả, từ cấm và tồn kho.',
        'keywords': 'checklist đăng sản phẩm shopee, đăng sản phẩm shopee, lỗi đăng sản phẩm, kiểm tra sản phẩm',
        'category': 'Tối ưu sản phẩm', 'minutes': 4,
        'summary': 'Mười hai điểm cần kiểm tra để sản phẩm hiển thị đúng, ít bị gỡ và ít phát sinh lỗi vận hành.',
        'steps': [('Nội dung', 'Ngành hàng, tiêu đề, mô tả, thuộc tính.'), ('Hình ảnh', 'Ảnh chính, ảnh phụ, video.'), ('Bán hàng', 'Giá, phân loại, tồn kho.'), ('Vận chuyển', 'Cân nặng, kích thước, đơn vị vận chuyển.')],
        'body': '''
<p>Một sản phẩm đăng thiếu sót thường phải sửa lại nhiều lần, mất thời gian và lượt hiển thị. Hãy dùng checklist này trước khi bấm đăng.</p>
<h2 id="noi-dung">Nội dung (5 điểm)</h2>
<ol><li>Chọn đúng ngành hàng.</li><li>Tiêu đề có từ khóa chính, thuộc tính, đối tượng (xem <a href="/blog/toi-uu-tieu-de-mo-ta-san-pham-shopee">cách tối ưu tiêu đề</a>).</li><li>Điền đủ thuộc tính ngành hàng.</li><li>Mô tả có thông số, cách dùng, chính sách.</li><li>Không dùng từ cấm, không dùng thương hiệu không thuộc về bạn.</li></ol>
<h2 id="hinh-anh">Hình ảnh (2 điểm)</h2>
<ol start="6"><li>Ảnh chính rõ, nền sạch, đúng sản phẩm.</li><li>Có ảnh phụ, ảnh thông số và video nếu phù hợp (xem <a href="/blog/hinh-anh-video-san-pham-shopee">hình ảnh và video sản phẩm</a>).</li></ol>
<h2 id="ban-hang">Bán hàng (3 điểm)</h2>
<ol start="8"><li>Giá đã trên giá hòa vốn.</li><li>Tên phân loại dễ hiểu, giá và tồn kho từng phân loại đúng.</li><li>Tồn kho khớp số hàng thật.</li></ol>
<h2 id="van-chuyen">Vận chuyển (2 điểm)</h2>
<ol start="11"><li>Cân nặng và kích thước sau đóng gói chính xác.</li><li>Bật đơn vị vận chuyển phù hợp (xem <a href="/blog/phuong-thuc-van-chuyen-shopee-nguoi-ban-can-biet">phương thức vận chuyển</a>).</li></ol>
<p>Với nhiều sản phẩm, hãy đăng bằng bản mẫu (xem <a href="/blog/dang-san-pham-hang-loat-tren-shopee">đăng sản phẩm hàng loạt</a>) và kiểm tra checklist cho vài dòng mẫu trước khi tải toàn bộ.</p>
''',
        'faq': [('Sản phẩm bị gỡ thường vì sao?', 'Thường do vi phạm quy định như hàng cấm, từ khóa vi phạm, trùng lặp hoặc thông tin sai. Hãy đọc thông báo vi phạm trong Kênh Người Bán.'), ('Có cần kiểm tra lại sản phẩm đã đăng?', 'Nên, đặc biệt tồn kho, giá và cân nặng, vì sai các thông tin này gây hủy đơn và phát sinh phí.'), ('Nên đăng nhiều sản phẩm cùng lúc không?', 'Có thể, nhưng hãy kiểm tra kỹ vài sản phẩm mẫu trước để tránh lặp lại lỗi trên hàng loạt.')],
        'related': ['toi-uu-tieu-de-mo-ta-san-pham-shopee', 'hinh-anh-video-san-pham-shopee', 'dang-san-pham-hang-loat-tren-shopee'],
    },
    {
        'slug': 'chup-anh-san-pham-bang-dien-thoai-ban-shopee',
        'title': 'Chụp ảnh sản phẩm bằng điện thoại để bán Shopee đẹp, rẻ',
        'h1': 'Chụp ảnh sản phẩm bằng điện thoại để bán Shopee: đẹp, rẻ và dễ làm',
        'description': 'Hướng dẫn chụp ảnh sản phẩm bằng điện thoại: ánh sáng, nền, góc chụp, bố cục, chỉnh ảnh nhẹ và bộ ảnh nên có cho một sản phẩm Shopee.',
        'keywords': 'chụp ảnh sản phẩm bằng điện thoại, ảnh sản phẩm shopee, chụp ảnh bán hàng, ánh sáng chụp ảnh',
        'category': 'Tối ưu sản phẩm', 'minutes': 5,
        'summary': 'Ánh sáng, nền, góc chụp và bộ ảnh cơ bản để có ảnh sản phẩm đẹp mà không cần studio.',
        'steps': [('Chọn ánh sáng', 'Gần cửa sổ, ánh sáng tự nhiên, tránh nắng gắt.'), ('Dựng nền', 'Tờ giấy hoặc vải trơn, phẳng.'), ('Chụp nhiều góc', 'Trước, sau, bên, chi tiết, kích thước.'), ('Chỉnh nhẹ', 'Cắt khung, chỉnh sáng, hạn chế filter.')],
        'body': '''
<p>Bạn không cần studio mới có ảnh bán hàng đẹp. Một chiếc điện thoại, một góc gần cửa sổ và vài thủ thuật đã đủ. Ảnh rõ ràng làm tăng tỷ lệ nhấp và giảm hoàn trả vì khách thấy đúng thứ họ mua.</p>
<h2 id="anh-sang">1. Ánh sáng là quan trọng nhất</h2>
<ul><li>Đặt sản phẩm gần cửa sổ, dùng ánh sáng tự nhiên ban ngày.</li><li>Tránh nắng gắt chiếu trực tiếp gây bóng cứng và cháy sáng.</li><li>Dùng tấm giấy trắng hắt sáng để làm mềm bóng.</li><li>Không bật đèn vàng lẫn ánh sáng ban ngày vì làm lệch màu.</li></ul>
<h2 id="nen">2. Nền đơn giản</h2>
<p>Dùng tờ giấy hoặc vải trơn màu trắng, xám hoặc màu tương phản nhẹ. Giữ nền phẳng, không nhăn. Bỏ các vật thừa khỏi khung hình để sản phẩm là điểm nhấn duy nhất.</p>
<h2 id="goc-chup">3. Góc chụp và bố cục</h2>
<ol><li>Giữ điện thoại song song với mặt phẳng, tránh nghiêng.</li><li>Để sản phẩm chiếm phần lớn khung hình và không bị cắt mép.</li><li>Chụp nhiều góc: trước, sau, bên, chi tiết, kích thước thật với thước đo hoặc vật đối chiếu.</li><li>Chụp ảnh sử dụng thật để khách hình dung.</li></ol>
<h2 id="chinh-anh">4. Chỉnh ảnh nhẹ</h2>
<p>Chỉ cắt khung, chỉnh sáng và độ tương phản nhẹ. Hạn chế filter vì làm lệch màu thật, dễ dẫn đến đánh giá thấp. Giữ ảnh có màu sắc đúng với sản phẩm khi nhận hàng.</p>
<h2 id="bo-anh">5. Bộ ảnh nên có</h2>
<p>Ảnh chính, 3–5 ảnh góc và chi tiết, ảnh thông số, ảnh từng phân loại và ảnh đóng gói. Xem thêm <a href="/blog/hinh-anh-video-san-pham-shopee">hướng dẫn hình ảnh và video</a> để sắp xếp bộ hình.</p>
''',
        'faq': [('Có cần mua đèn chuyên dụng không?', 'Không bắt buộc. Ánh sáng tự nhiên gần cửa sổ là đủ cho phần lớn sản phẩm. Đèn chỉ cần khi chụp ban đêm hoặc sản phẩm phản quang.'), ('Có nên dùng filter không?', 'Nên hạn chế vì làm sai màu thật của sản phẩm, gây hoàn trả vì lệch màu.'), ('Mỗi sản phẩm cần bao nhiêu ảnh?', 'Khoảng 5–9 ảnh gồm ảnh chính, góc chụp, chi tiết, thông số và phân loại là đủ cho đa số sản phẩm.')],
        'related': ['hinh-anh-video-san-pham-shopee', 'checklist-truoc-khi-dang-san-pham-shopee'],
    },
    {
        'slug': 'cach-dat-sku-va-ma-san-pham-de-quan-ly',
        'title': 'Cách đặt SKU và mã sản phẩm dễ quản lý khi bán nhiều hàng',
        'h1': 'Cách đặt SKU và mã sản phẩm dễ quản lý khi shop bán nhiều mặt hàng',
        'description': 'Quy ước đặt SKU và mã sản phẩm trên Shopee: cấu trúc ngắn gọn, nhất quán, không trùng, dễ đọc báo cáo và dễ đăng hàng loạt, kèm ví dụ cụ thể.',
        'keywords': 'đặt sku shopee, mã sản phẩm shopee, quản lý sku, quy ước đặt mã hàng',
        'category': 'Vận hành', 'minutes': 4,
        'summary': 'Quy ước SKU ngắn, nhất quán, không trùng giúp đọc báo cáo, kiểm kho và đăng hàng loạt nhanh hơn.',
        'steps': [('Chọn cấu trúc', 'Nhóm hàng, kiểu, màu, kích cỡ.'), ('Viết bảng quy ước', 'Mỗi phần có mã ngắn cố định.'), ('Áp dụng cho mọi sản phẩm', 'Không đổi quy ước giữa chừng.'), ('Kiểm tra trùng', 'Mỗi SKU chỉ một sản phẩm.')],
        'body': '''
<p>Khi shop có vài sản phẩm, bạn nhớ được tất cả. Khi có vài trăm, thiếu quy ước đặt mã sẽ khiến kiểm kho, đối soát và đọc báo cáo trở nên rối. SKU tốt là thứ bạn nhìn vào là biết đó là sản phẩm gì.</p>
<h2 id="cau-truc">1. Cấu trúc nên dùng</h2>
<p>Ghép các phần bằng dấu gạch: <strong>NHÓM-KIỂU-MÀU-CỠ</strong>. Ví dụ <em>AO-THUN-DEN-M</em> là áo thun màu đen cỡ M. Mỗi phần dùng mã ngắn cố định, viết hoa, không dấu, không khoảng trắng.</p>
<h2 id="nguyen-tac">2. Nguyên tắc</h2>
<ul><li><strong>Duy nhất:</strong> mỗi SKU chỉ ứng với một sản phẩm hoặc một phân loại. Không đặt trùng giữa các sản phẩm khác nhau.</li><li><strong>Nhất quán:</strong> cùng một cấu trúc cho cả shop.</li><li><strong>Dễ đọc:</strong> tránh ký tự dễ nhầm (số 0 và chữ O).</li><li><strong>Ổn định:</strong> không đổi SKU khi đã có đơn và báo cáo để giữ lịch sử.</li></ul>
<h2 id="ma-san-pham">3. Mã sản phẩm với hàng có phân loại</h2>
<p>Với sản phẩm có nhiều phân loại, các dòng phân loại dùng chung một mã sản phẩm và mỗi dòng có SKU phân loại riêng. Cách này cũng giúp bản mẫu đăng hàng loạt hoạt động đúng, xem <a href="/blog/dang-san-pham-hang-loat-tren-shopee">đăng sản phẩm hàng loạt</a>.</p>
<h2 id="loi-ich">4. Lợi ích khi dùng quy ước</h2>
<ol><li>Kiểm kho nhanh, ít nhầm.</li><li>Đối chiếu báo cáo thu nhập và lãi từng SKU (xem <a href="/blog/cac-loai-phi-ban-hang-tren-shopee">các loại phí</a>).</li><li>Dễ phân công người đóng gói, thêm kho (xem <a href="/blog/thiet-lap-da-kho-shopee">thiết lập đa kho</a>).</li></ol>
''',
        'faq': [('SKU có bắt buộc không?', 'Thường là tùy chọn khi đăng, nhưng rất nên điền để quản lý kho và đối soát.'), ('Có được trùng SKU giữa hai sản phẩm không?', 'Không nên. SKU cần là mã duy nhất để nhận diện đúng sản phẩm.'), ('Có nên đổi SKU sau khi đã bán không?', 'Không nên vì sẽ mất tính liên tục của báo cáo. Hãy thiết kế quy ước đúng ngay từ đầu.')],
        'related': ['dang-san-pham-hang-loat-tren-shopee', 'thiet-lap-da-kho-shopee'],
    },
    {
        'slug': 'cach-theo-doi-ton-kho-shopee-khong-het-hang',
        'title': 'Cách theo dõi tồn kho Shopee để không hết hàng hay ôm hàng',
        'h1': 'Cách theo dõi tồn kho trên Shopee để không hết hàng đột ngột và không ôm hàng',
        'description': 'Cách quản lý tồn kho shop Shopee: điểm đặt hàng lại, tồn kho an toàn, đối chiếu hằng tuần, xử lý hàng tồn lâu và tránh hủy đơn do thiếu hàng.',
        'keywords': 'quản lý tồn kho shopee, tồn kho an toàn, điểm đặt hàng lại, hàng tồn kho',
        'category': 'Vận hành', 'minutes': 5,
        'summary': 'Điểm đặt hàng lại, tồn kho an toàn và thói quen đối chiếu giúp shop không hủy đơn vì hết hàng hay ôm hàng chết.',
        'steps': [('Ghi tốc độ bán', 'Tính số bán trung bình mỗi ngày.'), ('Đặt tồn kho an toàn', 'Dự phòng cho thời gian nhập hàng.'), ('Đặt điểm đặt hàng lại', 'Khi chạm mức này thì nhập thêm.'), ('Đối chiếu hằng tuần', 'So số thật với số trên sàn.')],
        'body': '''
<p>Hết hàng làm shop bị hủy đơn và mất điểm, ôm hàng làm kẹt vốn. Quản lý tồn kho là tìm điểm cân bằng giữa hai rủi ro đó bằng vài công thức đơn giản.</p>
<h2 id="toc-do-ban">1. Biết tốc độ bán</h2>
<p>Với mỗi sản phẩm chủ lực, tính số bán trung bình mỗi ngày trong 2–4 tuần gần nhất. Con số này là nền tảng của mọi tính toán còn lại.</p>
<h2 id="ton-an-toan">2. Tồn kho an toàn</h2>
<p>Là lượng dự phòng cho trường hợp bán nhanh hơn dự kiến hoặc nhà cung cấp giao trễ. Cách tính nhanh: <strong>tồn kho an toàn = bán mỗi ngày × số ngày dự phòng</strong> (ví dụ 3–5 ngày tùy độ tin cậy của nguồn hàng).</p>
<h2 id="diem-dat-hang">3. Điểm đặt hàng lại</h2>
<p><strong>Điểm đặt hàng lại = bán mỗi ngày × thời gian nhập hàng + tồn kho an toàn.</strong> Khi tồn kho chạm mức này, đã đến lúc nhập thêm. Ví dụ bán 10 cái mỗi ngày, nhập mất 5 ngày, an toàn 30 cái thì điểm đặt hàng lại là 80.</p>
<h2 id="doi-chieu">4. Đối chiếu đều đặn</h2>
<ul><li>Mỗi tuần đếm hàng thật và so với số trên Kênh Người Bán.</li><li>Với shop nhiều kho, ghi nhận riêng từng kho (xem <a href="/blog/thiet-lap-da-kho-shopee">thiết lập đa kho</a>).</li><li>Tắt sản phẩm hết hàng ngay để tránh hủy đơn.</li></ul>
<h2 id="hang-ton">5. Xử lý hàng tồn lâu</h2>
<p>Sản phẩm không bán được sau một thời gian nên được xử lý: tạo combo, mua kèm, giảm giá có tính toán (xem <a href="/blog/cong-cu-khuyen-mai-cua-shop-shopee">công cụ khuyến mãi</a>) hoặc dừng nhập thêm. Đừng để vốn nằm im trong kho.</p>
''',
        'faq': [('Tồn kho an toàn nên là bao nhiêu?', 'Khoảng 3–5 ngày bán, tùy độ ổn định của nguồn hàng. Nguồn càng hay trễ thì mức dự phòng càng cao.'), ('Bao lâu nên đối chiếu tồn kho?', 'Hằng tuần với sản phẩm chủ lực, hằng tháng với phần còn lại, và ngay trước ngày sale.'), ('Hàng tồn lâu xử lý thế nào?', 'Tạo combo, mua kèm hoặc giảm giá có tính toán, đồng thời dừng nhập thêm.')],
        'related': ['thiet-lap-da-kho-shopee', 'cong-cu-khuyen-mai-cua-shop-shopee', 'ty-le-don-khong-thanh-cong-va-giao-tre-shopee'],
    },
    {
        'slug': 'cach-tra-loi-tin-nhan-khach-shopee-chuyen-nghiep',
        'title': 'Cách trả lời tin nhắn khách hàng trên Shopee chuyên nghiệp',
        'h1': 'Cách trả lời tin nhắn khách hàng trên Shopee nhanh, lịch sự và chốt được đơn',
        'description': 'Cách trả lời tin nhắn khách hàng Shopee: tốc độ, giọng điệu, mẫu trả lời nhanh cho câu hỏi phổ biến, xử lý khách khó và những điều không được làm.',
        'keywords': 'trả lời tin nhắn shopee, chăm sóc khách hàng shopee, mẫu trả lời nhanh, chat shopee',
        'category': 'Chăm sóc khách', 'minutes': 5,
        'summary': 'Trả lời nhanh, đúng, lịch sự: mẫu trả lời cho câu hỏi hay gặp và những điều cần tránh khi chat với khách.',
        'steps': [('Chào và xác nhận', 'Chào ngắn, nhắc lại câu hỏi.'), ('Trả lời đúng ý', 'Thông tin chính xác, ngắn gọn.'), ('Gợi ý bước tiếp', 'Hướng khách đến đặt hàng.'), ('Theo dõi', 'Hỏi lại nếu khách chưa phản hồi.')],
        'body': '''
<p>Tin nhắn là nơi nhiều đơn hàng được chốt hoặc mất. Khách hỏi tức là đang cân nhắc mua; phản hồi nhanh và rõ ràng thường quyết định họ ở lại hay sang shop khác.</p>
<h2 id="toc-do">1. Tốc độ và thái độ</h2>
<ul><li>Trả lời trong thời gian ngắn nhất có thể; dùng tin nhắn chào tự động khi vắng.</li><li>Xưng hô lịch sự, nhất quán, không dùng lời lẽ khiếm nhã. Đây cũng là tiêu chí vận hành, xem <a href="/blog/he-thong-sao-qua-ta-shopee">hệ thống Sao Quả Tạ</a>.</li></ul>
<h2 id="mau-tra-loi">2. Soạn sẵn mẫu trả lời</h2>
<p>Chuẩn bị mẫu cho các câu hỏi lặp lại và chỉnh nhẹ theo từng khách:</p>
<ul><li>Sản phẩm còn hàng không? Màu và cỡ nào còn?</li><li>Phí ship và thời gian giao dự kiến.</li><li>Chính sách đổi trả và bảo hành.</li><li>Cách chọn kích cỡ, cách dùng, cách bảo quản.</li></ul>
<h2 id="cau-truc">3. Cấu trúc một câu trả lời tốt</h2>
<ol><li>Chào và cảm ơn khách đã quan tâm.</li><li>Trả lời đúng câu hỏi bằng thông tin chính xác.</li><li>Gợi ý bước tiếp theo, ví dụ chọn phân loại và đặt hàng.</li></ol>
<h2 id="khach-kho">4. Khi khách khó chịu</h2>
<p>Lắng nghe, xin lỗi nếu có lỗi của shop, đưa giải pháp cụ thể (đổi, hoàn, bù). Giữ bình tĩnh và không tranh cãi. Lưu lại nội dung trao đổi để làm bằng chứng khi cần.</p>
<h2 id="dieu-khong-lam">5. Điều không được làm</h2>
<ul><li>Không mời khách giao dịch ngoài sàn.</li><li>Không yêu cầu khách hủy đơn.</li><li>Không gửi tin nhắn rác hàng loạt.</li></ul>
''',
        'faq': [('Nên trả lời trong bao lâu?', 'Càng nhanh càng tốt. Dùng tin nhắn tự động và mẫu soạn sẵn để rút ngắn thời gian.'), ('Có được hướng dẫn khách mua ngoài Shopee không?', 'Không. Điều hướng người mua ra ngoài sàn là hành vi bị cấm và có thể bị phạt điểm.'), ('Khách hỏi mà không mua thì sao?', 'Cảm ơn khách và để lại lời chào thân thiện. Có thể nhắn nhắc nhẹ một lần nếu khách đang cân nhắc.')],
        'related': ['he-thong-sao-qua-ta-shopee', 'quan-ly-don-tra-hang-hoan-tien-huy-don-shopee'],
    },
    {
        'slug': 'cach-xu-ly-danh-gia-xau-tren-shopee',
        'title': 'Cách xử lý đánh giá xấu trên Shopee để giữ uy tín shop',
        'h1': 'Cách xử lý đánh giá xấu trên Shopee để giữ uy tín và học được từ khách',
        'description': 'Cách xử lý đánh giá thấp trên Shopee: bình tĩnh đọc, phản hồi lịch sự, liên hệ khắc phục, rút bài học để cải thiện sản phẩm và những điều không nên làm.',
        'keywords': 'xử lý đánh giá xấu shopee, phản hồi đánh giá, đánh giá 1 sao, uy tín shop',
        'category': 'Chăm sóc khách', 'minutes': 5,
        'summary': 'Cách đọc, phản hồi và rút bài học từ đánh giá thấp, biến phàn nàn thành cải thiện sản phẩm.',
        'steps': [('Đọc kỹ đánh giá', 'Xác định khách phàn nàn điều gì.'), ('Liên hệ khắc phục', 'Nhắn riêng và đưa giải pháp.'), ('Phản hồi công khai', 'Lịch sự, ngắn, đúng sự thật.'), ('Sửa gốc vấn đề', 'Cập nhật mô tả, ảnh, đóng gói.')],
        'body': '''
<p>Không shop nào tránh được hoàn toàn đánh giá thấp. Điều quan trọng là cách bạn phản ứng: khách tiềm năng đọc cả đánh giá lẫn lời phản hồi của shop để quyết định mua.</p>
<h2 id="doc-ky">1. Đọc và phân loại</h2>
<ul><li><strong>Lỗi shop:</strong> giao sai, thiếu, đóng gói kém, giao chậm.</li><li><strong>Lỗi kỳ vọng:</strong> khách hiểu sai do ảnh hoặc mô tả chưa rõ.</li><li><strong>Lỗi vận chuyển:</strong> hàng hư hỏng, giao trễ do đơn vị vận chuyển.</li><li><strong>Không hợp lý:</strong> đánh giá sai sự thật hoặc có lời lẽ xúc phạm.</li></ul>
<h2 id="lien-he">2. Liên hệ khắc phục</h2>
<p>Nhắn riêng cho khách, xin lỗi nếu có lỗi và đề xuất giải pháp cụ thể: đổi hàng, hoàn tiền một phần, tặng voucher. Nhiều khách sẵn sàng thay đổi đánh giá khi vấn đề được giải quyết tử tế.</p>
<h2 id="phan-hoi">3. Phản hồi công khai</h2>
<ol><li>Cảm ơn khách đã góp ý.</li><li>Xin lỗi ngắn gọn nếu có lỗi.</li><li>Nêu cách bạn đã hoặc sẽ khắc phục.</li><li>Không tranh cãi, không dùng lời lẽ khiếm nhã.</li></ol>
<h2 id="sua-goc">4. Sửa tận gốc</h2>
<p>Mỗi nhóm lời phàn nàn lặp lại là một việc cần sửa: nếu khách nói sản phẩm nhỏ hơn mong đợi, ghi rõ kích thước thật và thêm ảnh có thước đo; nếu hàng hay hư, cải thiện đóng gói (xem <a href="/blog/dong-goi-va-giao-hang-cho-don-vi-van-chuyen-shopee">đóng gói và giao hàng</a>).</p>
<h2 id="khong-nen">5. Không nên làm</h2>
<ul><li>Không yêu cầu khách xóa hoặc sửa đánh giá bằng cách gây áp lực.</li><li>Không tự tạo đánh giá ảo để lấp, đây là hành vi bị cấm.</li></ul>
''',
        'faq': [('Có thể xóa đánh giá xấu không?', 'Thường không thể tự xóa. Bạn có thể phản hồi, xử lý với khách và báo cáo nếu đánh giá vi phạm quy định.'), ('Có nên phản hồi mọi đánh giá thấp không?', 'Nên phản hồi những đánh giá có thông tin cụ thể và giữ giọng lịch sự, vì khách tiềm năng sẽ đọc phản hồi của bạn.'), ('Đánh giá ảo có giúp không?', 'Không. Tạo đánh giá ảo là hành vi bị cấm và có thể bị phạt nặng.')],
        'related': ['cach-tra-loi-tin-nhan-khach-shopee-chuyen-nghiep', 'he-thong-sao-qua-ta-shopee'],
    },
    {
        'slug': 'cach-chon-nguon-hang-uy-tin-ban-shopee',
        'title': 'Cách chọn nguồn hàng uy tín để bán Shopee, tránh rủi ro',
        'h1': 'Cách chọn nguồn hàng uy tín để bán Shopee và tránh rủi ro pháp lý, chất lượng',
        'description': 'Tiêu chí chọn nguồn hàng uy tín để bán Shopee: kiểm tra chất lượng, giấy tờ, thử mẫu, điều khoản đổi trả, lô nhỏ và cách tránh hàng giả, hàng nhái.',
        'keywords': 'nguồn hàng shopee, tìm nguồn hàng uy tín, nhập hàng bán shopee, tránh hàng giả',
        'category': 'Tìm sản phẩm', 'minutes': 6,
        'summary': 'Sáu tiêu chí chọn nguồn hàng, cách thử mẫu, nhập lô nhỏ và tránh hàng giả hàng nhái làm shop bị phạt.',
        'steps': [('Lập danh sách nguồn', 'Tìm 3–5 nhà cung cấp.'), ('Thử mẫu', 'Đặt mẫu, kiểm tra chất lượng thật.'), ('Kiểm tra giấy tờ', 'Nguồn gốc, hóa đơn, chứng nhận.'), ('Nhập lô nhỏ', 'Thử bán rồi mới tăng số lượng.')],
        'body': '''
<p>Nguồn hàng quyết định chất lượng, giá vốn và rủi ro của cả shop. Một nguồn hàng xấu gây hoàn trả, đánh giá thấp và thậm chí bị xử phạt. Chọn kỹ ngay từ đầu rẻ hơn rất nhiều so với sửa sau.</p>
<h2 id="tieu-chi">1. Sáu tiêu chí đánh giá nguồn hàng</h2>
<ol><li><strong>Chất lượng ổn định:</strong> các lô hàng giống nhau, ít lỗi.</li><li><strong>Giá vốn hợp lý:</strong> đủ để còn lãi sau mọi khoản phí (xem <a href="/blog/cach-tinh-gia-ban-va-loi-nhuan-shopee">cách tính giá bán và lợi nhuận</a>).</li><li><strong>Giao đúng hẹn:</strong> trễ hàng sẽ làm shop hết hàng.</li><li><strong>Cho nhập lô nhỏ:</strong> phù hợp khi mới thử sản phẩm.</li><li><strong>Có chính sách đổi trả hàng lỗi.</strong></li><li><strong>Giấy tờ rõ ràng:</strong> hóa đơn, nguồn gốc, chứng nhận cần thiết cho ngành hàng.</li></ol>
<h2 id="thu-mau">2. Thử mẫu trước khi nhập</h2>
<p>Đặt một đến vài mẫu, dùng thử thật, kiểm tra đường may, độ bền, mùi, độ hoàn thiện, đóng gói. So sánh với mô tả của nhà cung cấp và với sản phẩm cùng loại trên sàn.</p>
<h2 id="tranh-hang-gia">3. Tránh hàng giả, hàng nhái</h2>
<ul><li>Cảnh giác với giá quá rẻ so với mặt bằng.</li><li>Yêu cầu giấy tờ chứng minh nguồn gốc với thương hiệu có bảo hộ.</li><li>Không bán sản phẩm vi phạm bản quyền, đây là nhóm vi phạm bị tính điểm phạt, xem <a href="/blog/he-thong-sao-qua-ta-shopee">hệ thống Sao Quả Tạ</a>.</li></ul>
<h2 id="lo-nho">4. Nhập lô nhỏ và đo kết quả</h2>
<p>Nhập số lượng đủ bán 1–2 tuần, theo dõi tỷ lệ hoàn trả và đánh giá. Chỉ tăng lô khi dữ liệu thật của shop cho thấy sản phẩm tốt, xem thêm <a href="/blog/cach-chon-san-pham-hot-trend-de-ban-shopee">cách chọn sản phẩm hot trend</a>.</p>
<h2 id="quan-he">5. Giữ quan hệ lâu dài</h2>
<p>Thanh toán đúng hạn, trao đổi rõ ràng và ghi lại thỏa thuận bằng văn bản giúp bạn có giá tốt và được ưu tiên khi hàng khan hiếm.</p>
''',
        'faq': [('Nên có bao nhiêu nhà cung cấp?', 'Ít nhất 2–3 cho nhóm hàng chủ lực để có phương án dự phòng khi một nguồn hết hàng hoặc giao trễ.'), ('Có cần hóa đơn khi nhập hàng không?', 'Nên có, đặc biệt với hàng cần chứng minh nguồn gốc. Hãy hỏi cơ quan thuế hoặc kế toán về quy định áp dụng cho shop của bạn.'), ('Làm sao biết hàng thật hay giả?', 'Yêu cầu giấy tờ nguồn gốc, đối chiếu với nhà phân phối chính thức và cảnh giác với giá thấp bất thường.')],
        'related': ['cach-chon-san-pham-hot-trend-de-ban-shopee', 'cach-tinh-gia-ban-va-loi-nhuan-shopee', 'he-thong-sao-qua-ta-shopee'],
    },
    {
        'slug': 'lap-bang-theo-doi-doanh-thu-loi-nhuan-shop-shopee',
        'title': 'Lập bảng theo dõi doanh thu và lợi nhuận cho shop Shopee',
        'h1': 'Lập bảng theo dõi doanh thu và lợi nhuận cho shop Shopee: cột nào cần có',
        'description': 'Mẫu bảng theo dõi doanh thu, chi phí và lợi nhuận shop Shopee: các cột cần có, công thức, cách cập nhật hằng tuần và những chỉ số nên xem mỗi tháng.',
        'keywords': 'bảng theo dõi lợi nhuận shopee, quản lý doanh thu shop, báo cáo thu nhập, theo dõi chi phí',
        'category': 'Giá & lợi nhuận', 'minutes': 5,
        'summary': 'Các cột cần có trong bảng theo dõi, công thức tính lãi và thói quen cập nhật giúp bạn biết shop thật sự lãi hay lỗ.',
        'steps': [('Tải báo cáo thu nhập', 'Lấy dữ liệu từ Kênh Người Bán.'), ('Nhập vào bảng tính', 'Mỗi đơn một dòng.'), ('Thêm giá vốn và chi phí', 'Đóng gói, quảng cáo, khác.'), ('Xem lãi theo SKU', 'Giữ SKU lãi, xem lại SKU lỗ.')],
        'body': '''
<p>Doanh thu hiển thị trên sàn chưa phải là tiền lãi. Chỉ khi ghi chép đầy đủ giá vốn, phí và chi phí khác bạn mới biết shop đang lãi hay lỗ và sản phẩm nào đáng đẩy.</p>
<h2 id="cot-can-co">1. Các cột nên có</h2>
<table class="data-table"><thead><tr><th>Cột</th><th>Nội dung</th></tr></thead><tbody>
<tr><td>Ngày, mã đơn</td><td>Để đối chiếu với báo cáo.</td></tr>
<tr><td>SKU, số lượng</td><td>Biết sản phẩm nào bán.</td></tr>
<tr><td>Giá bán thực nhận</td><td>Sau giảm giá và voucher shop chịu.</td></tr>
<tr><td>Các khoản phí</td><td>Lấy từ báo cáo thu nhập (xem <a href="/blog/cac-loai-phi-ban-hang-tren-shopee">các loại phí</a>).</td></tr>
<tr><td>Giá vốn</td><td>Giá nhập cộng vận chuyển nhập.</td></tr>
<tr><td>Đóng gói, quảng cáo</td><td>Chi phí phân bổ cho đơn.</td></tr>
<tr><td>Lãi đóng góp</td><td>Công thức bên dưới.</td></tr>
</tbody></table>
<h2 id="cong-thuc">2. Công thức</h2>
<p class="example">Lãi đóng góp = Tiền thực nhận − Giá vốn − Đóng gói − Quảng cáo phân bổ − Chi phí khác</p>
<h2 id="cap-nhat">3. Thói quen cập nhật</h2>
<ol><li>Mỗi tuần tải báo cáo thu nhập và nhập vào bảng.</li><li>Cuối tháng cộng lại theo SKU và theo nhóm hàng.</li><li>Ghi riêng các đơn hoàn trả và hàng lỗi.</li></ol>
<h2 id="chi-so">4. Chỉ số nên xem mỗi tháng</h2>
<ul><li>Lãi đóng góp trung bình mỗi đơn và biên lãi theo giá bán.</li><li>Top 5 SKU đem lại nhiều lãi nhất và 5 SKU lỗ.</li><li>Chi phí quảng cáo trên mỗi đơn.</li><li>Tỷ lệ hoàn trả.</li></ul>
<p>MarketLens giúp bạn nhập báo cáo và tính lãi từng sản phẩm tự động, thay vì cập nhật tay mỗi tuần.</p>
''',
        'faq': [('Doanh thu và lợi nhuận khác nhau thế nào?', 'Doanh thu là tiền khách trả, lợi nhuận là phần còn lại sau khi trừ giá vốn, phí và các chi phí khác.'), ('Bao lâu cập nhật bảng một lần?', 'Mỗi tuần, và tổng kết vào cuối tháng.'), ('Có cần tính thuế vào bảng không?', 'Nên dự phòng. Hãy hỏi kế toán hoặc cơ quan thuế về nghĩa vụ áp dụng cho shop của bạn.')],
        'related': ['cac-loai-phi-ban-hang-tren-shopee', 'cach-tinh-gia-ban-va-loi-nhuan-shopee'],
    },
    {
        'slug': 'ban-hang-shopee-tranh-hang-cam-hang-nhai',
        'title': 'Tránh bán hàng cấm, hàng nhái và vi phạm bản quyền trên Shopee',
        'h1': 'Tránh bán hàng cấm, hàng giả, hàng nhái và vi phạm bản quyền trên Shopee',
        'description': 'Những nhóm vi phạm sản phẩm hay gặp trên Shopee: hàng cấm, hàng giả nhái, bản quyền, từ khóa, giá ảo và sản phẩm trùng lặp, cùng cách tự kiểm tra trước khi đăng.',
        'keywords': 'hàng cấm shopee, hàng nhái, vi phạm bản quyền shopee, sản phẩm vi phạm',
        'category': 'Quy định', 'minutes': 5,
        'summary': 'Các nhóm vi phạm sản phẩm thường gặp và cách tự kiểm tra để không bị gỡ sản phẩm hay bị phạt điểm.',
        'steps': [('Đọc danh mục cấm', 'Xem quy định hàng cấm hiện hành.'), ('Kiểm tra nguồn gốc', 'Giấy tờ, thương hiệu, bản quyền.'), ('Rà từ khóa và giá', 'Không từ vi phạm, không giá ảo.'), ('Tránh trùng lặp', 'Mỗi sản phẩm đăng một lần.')],
        'body': '''
<p>Sản phẩm vi phạm không chỉ bị gỡ mà còn khiến shop bị tính điểm phạt và có thể bị hạn chế tài khoản. Biết các nhóm vi phạm phổ biến giúp bạn tự kiểm tra trước khi đăng.</p>
<h2 id="hang-cam">1. Hàng cấm và hàng hạn chế</h2>
<p>Gồm sản phẩm bị cấm theo quy định của Shopee và pháp luật Việt Nam, cùng nhóm hàng chỉ được bán khi có giấy phép hoặc điều kiện. Danh sách thay đổi theo thời gian, hãy đọc quy định đăng bán mới nhất trong Kênh Người Bán và Seller Education Hub.</p>
<h2 id="hang-gia">2. Hàng giả, hàng nhái, bản quyền</h2>
<ul><li>Không bán sản phẩm giả mạo thương hiệu.</li><li>Không dùng logo, ảnh, video của người khác khi chưa được phép.</li><li>Có giấy tờ chứng minh nguồn gốc với thương hiệu có bảo hộ.</li></ul>
<h2 id="tu-khoa-gia-ao">3. Từ khóa vi phạm và giá ảo</h2>
<ul><li>Không nhồi từ khóa không liên quan hoặc ghi tên thương hiệu khác vào tiêu đề (xem <a href="/blog/toi-uu-tieu-de-mo-ta-san-pham-shopee">tối ưu tiêu đề</a>).</li><li>Không đặt giá ảo để đánh lừa khách, ví dụ giá cao rồi giảm bất thường.</li></ul>
<h2 id="trung-lap">4. Sản phẩm trùng lặp</h2>
<p>Đăng cùng một sản phẩm nhiều lần để chiếm vị trí hiển thị là vi phạm. Hãy dùng phân loại hàng cho các biến thể thay vì tạo nhiều sản phẩm.</p>
<h2 id="tu-kiem-tra">5. Tự kiểm tra trước khi đăng</h2>
<ol><li>Sản phẩm có thuộc nhóm cấm hoặc hạn chế không?</li><li>Bạn có giấy tờ nguồn gốc và quyền dùng hình ảnh không?</li><li>Tiêu đề và mô tả có đúng thật và không mượn thương hiệu?</li><li>Giá có phản ánh đúng giá bán thực không?</li></ol>
<p>Hậu quả của vi phạm được mô tả trong bài <a href="/blog/he-thong-sao-qua-ta-shopee">hệ thống Sao Quả Tạ</a>.</p>
''',
        'faq': [('Sản phẩm bị gỡ thì làm gì?', 'Đọc lý do trong thông báo, sửa nội dung nếu có thể và gửi khiếu nại kèm bằng chứng nếu bạn cho rằng bị gỡ nhầm.'), ('Có thể bán hàng của thương hiệu khác không?', 'Chỉ khi bạn được ủy quyền hoặc nhập từ nguồn chính hãng và có giấy tờ chứng minh.'), ('Giá ảo là gì?', 'Là mức giá niêm yết bị nâng lên để tạo cảm giác giảm giá mạnh. Hành vi này bị coi là vi phạm.')],
        'related': ['he-thong-sao-qua-ta-shopee', 'cach-chon-nguon-hang-uy-tin-ban-shopee'],
    },
    {
        'slug': 'lam-combo-khuyen-mai-tang-gia-tri-don-hang',
        'title': 'Làm combo khuyến mãi để tăng giá trị đơn hàng trên Shopee',
        'h1': 'Làm combo khuyến mãi để tăng giá trị đơn hàng trên Shopee mà vẫn có lãi',
        'description': 'Cách thiết kế combo khuyến mãi trên Shopee: chọn sản phẩm ghép, mức giảm theo số lượng, tính lãi, đặt tên combo và theo dõi kết quả để tăng giá trị mỗi đơn.',
        'keywords': 'combo khuyến mãi shopee, tăng giá trị đơn hàng, mua kèm, bán nhiều hơn mỗi đơn',
        'category': 'Marketing', 'minutes': 5,
        'summary': 'Chọn sản phẩm ghép, đặt mức giảm theo số lượng và tính lãi để combo kéo giá trị đơn mà không làm lỗ.',
        'steps': [('Chọn sản phẩm ghép', 'Cùng nhóm hoặc bổ trợ nhau.'), ('Tính lãi combo', 'Còn lãi sau mức giảm.'), ('Đặt mức giảm', 'Mua nhiều giảm nhiều.'), ('Đo kết quả', 'So giá trị đơn trước sau.')],
        'body': '''
<p>Tăng giá trị mỗi đơn rẻ hơn nhiều so với tìm khách mới. Combo khuyến mãi khuyến khích khách mua nhiều hơn một món bằng ưu đãi hợp lý, đồng thời tiết kiệm chi phí đóng gói và vận chuyển trên mỗi sản phẩm.</p>
<h2 id="chon-san-pham">1. Chọn sản phẩm để ghép combo</h2>
<ul><li><strong>Cùng nhóm:</strong> cùng loại nhiều màu, nhiều cỡ (mua 2 giảm giá).</li><li><strong>Bổ trợ nhau:</strong> sản phẩm chính kèm phụ kiện.</li><li><strong>Hàng tồn:</strong> ghép sản phẩm tồn lâu với sản phẩm bán chạy.</li></ul>
<h2 id="muc-giam">2. Đặt mức giảm theo số lượng</h2>
<p>Thiết kế bậc thang rõ ràng: mua 2 giảm một mức, mua 3 giảm sâu hơn. Mức giảm phải nằm trên giá hòa vốn của cả combo (xem <a href="/blog/cach-tinh-gia-ban-va-loi-nhuan-shopee">cách tính giá bán và lợi nhuận</a>).</p>
<h2 id="tinh-lai">3. Tính lãi cho cả combo</h2>
<p>Tính lãi đóng góp của combo, không chỉ của từng sản phẩm: cộng giá vốn các món, trừ phí, đóng gói chung một hộp. Combo thường lãi tốt hơn vì chi phí đóng gói và vận chuyển được chia cho nhiều sản phẩm.</p>
<h2 id="dat-ten">4. Đặt tên và hiển thị</h2>
<ol><li>Tên combo nêu rõ lợi ích: “Mua 2 giảm 10%”, “Mua kèm tiết kiệm”.</li><li>Đưa combo vào ảnh chính hoặc ảnh phụ của sản phẩm chủ lực.</li><li>Nhắc ưu đãi trong tin nhắn khi khách hỏi mua.</li></ol>
<h2 id="do-ket-qua">5. Đo kết quả</h2>
<p>So sánh giá trị đơn trung bình, số sản phẩm mỗi đơn và lãi trước và sau khi có combo. Chỉ giữ combo thực sự làm tăng tổng lãi. Xem thêm tổng quan trong bài <a href="/blog/cong-cu-khuyen-mai-cua-shop-shopee">công cụ khuyến mãi của shop</a>.</p>
''',
        'faq': [('Combo khác mua kèm thế nào?', 'Combo giảm giá khi mua nhiều sản phẩm của shop, còn mua kèm cho ưu đãi khi mua thêm một sản phẩm khác cùng sản phẩm chính.'), ('Mức giảm combo bao nhiêu là hợp lý?', 'Không có con số chung; mức giảm phải nằm trên giá hòa vốn của cả combo và để lại lãi tối thiểu bạn chấp nhận.'), ('Combo có làm giảm lãi không?', 'Có thể nếu giảm quá sâu. Hãy tính lãi cả combo và đo kết quả để chắc chắn tổng lãi tăng.')],
        'related': ['cong-cu-khuyen-mai-cua-shop-shopee', 'cach-tinh-gia-ban-va-loi-nhuan-shopee'],
    },
    {
        'slug': 'dung-flash-sale-xa-hang-ton-an-toan',
        'title': 'Dùng flash sale để xả hàng tồn mà không bị lỗ',
        'h1': 'Dùng flash sale để xả hàng tồn mà không bị lỗ: cách làm an toàn',
        'description': 'Cách dùng flash sale của shop để xả hàng tồn trên Shopee: chọn sản phẩm, đặt giá không dưới hòa vốn, giới hạn số lượng, khung giờ, quảng bá và đo kết quả.',
        'keywords': 'flash sale shopee, xả hàng tồn, giảm giá hàng tồn, flash sale của shop',
        'category': 'Marketing', 'minutes': 4,
        'summary': 'Chọn đúng sản phẩm, đặt giá không dưới hòa vốn, giới hạn số lượng và đo kết quả để xả tồn mà vẫn an toàn.',
        'steps': [('Chọn hàng tồn', 'Sản phẩm bán chậm hoặc cận hạn.'), ('Tính giá tối thiểu', 'Không dưới hòa vốn hoặc mức lỗ chấp nhận.'), ('Giới hạn số lượng', 'Đủ để xả, không quá nhiều.'), ('Quảng bá và đo', 'Video, tin nhắn, so sánh trước sau.')],
        'body': '''
<p>Hàng tồn là vốn đang nằm im. Flash sale là cách nhanh để biến nó thành tiền mặt, nhưng giảm sâu thiếu tính toán dễ biến thành lỗ. Hãy làm theo một quy trình cố định.</p>
<h2 id="chon-san-pham">1. Chọn sản phẩm phù hợp</h2>
<ul><li>Sản phẩm bán chậm trong nhiều tuần.</li><li>Hàng sắp hết mùa hoặc có hạn dùng.</li><li>Mẫu cũ chuẩn bị thay thế.</li></ul>
<p>Không dùng flash sale cho sản phẩm chủ lực đang bán tốt ở giá thường.</p>
<h2 id="gia-toi-thieu">2. Đặt giá tối thiểu</h2>
<p>Xác định giá hòa vốn của sản phẩm (xem <a href="/blog/cach-tinh-gia-ban-va-loi-nhuan-shopee">cách tính giá bán và lợi nhuận</a>). Với hàng tồn, bạn có thể chấp nhận hòa vốn hoặc lỗ nhẹ nếu việc xả tồn giải phóng vốn để nhập hàng bán tốt hơn. Hãy quyết định mức lỗ tối đa bằng số trước khi bắt đầu.</p>
<h2 id="gioi-han">3. Giới hạn số lượng và thời gian</h2>
<p>Chỉ đưa vào chương trình lượng hàng bạn muốn xả. Khung giờ ngắn tạo cảm giác cấp bách và dễ kiểm soát. Đảm bảo tồn kho thực tế đủ để không bị hủy đơn.</p>
<h2 id="quang-ba">4. Quảng bá</h2>
<ol><li>Đăng video ngắn giới thiệu ưu đãi (xem <a href="/blog/dang-video-shopee-video-cho-nguoi-ban">đăng video Shopee Video</a>).</li><li>Nhắn khách đã quan tâm hoặc đã mua sản phẩm tương tự.</li><li>Ghép combo với sản phẩm bán tốt để tăng giá trị đơn.</li></ol>
<h2 id="do-ket-qua">5. Đo kết quả</h2>
<p>Ghi lại số lượng xả được, tiền thu về, lỗ lãi so với kế hoạch và ảnh hưởng đến các sản phẩm khác. Rút bài học để nhập hàng chính xác hơn lần sau, xem <a href="/blog/cach-theo-doi-ton-kho-shopee-khong-het-hang">cách theo dõi tồn kho</a>.</p>
''',
        'faq': [('Flash sale có phải giảm sâu?', 'Thường cần mức giảm đủ hấp dẫn, nhưng đừng thấp hơn mức lỗ tối đa bạn đã đặt trước.'), ('Nên xả bao nhiêu hàng mỗi lần?', 'Chỉ lượng bạn muốn xả và còn đủ tồn kho thực tế. Có thể lặp lại nhiều đợt nhỏ thay vì một đợt lớn.'), ('Flash sale có ảnh hưởng giá thường không?', 'Có thể làm khách chờ giảm giá. Vì vậy dùng cho hàng tồn, không dùng liên tục cho sản phẩm chủ lực.')],
        'related': ['cong-cu-khuyen-mai-cua-shop-shopee', 'cach-theo-doi-ton-kho-shopee-khong-het-hang', 'dang-video-shopee-video-cho-nguoi-ban'],
    },
    {
        'slug': 'lich-dang-video-shopee-video-hang-tuan',
        'title': 'Lập lịch đăng video Shopee Video hằng tuần cho shop nhỏ',
        'h1': 'Lập lịch đăng video Shopee Video hằng tuần cho shop nhỏ: ý tưởng và quy trình',
        'description': 'Cách lập lịch nội dung Shopee Video cho shop nhỏ: tần suất, loại video, ý tưởng nội dung, quay hàng loạt, lên lịch đăng và đo kết quả hằng tuần.',
        'keywords': 'lịch đăng video shopee, shopee video, ý tưởng video bán hàng, nội dung video shop nhỏ',
        'category': 'Marketing', 'minutes': 5,
        'summary': 'Quay hàng loạt một lần, lên lịch cả tuần và đo kết quả để duy trì video đều đặn mà không tốn nhiều thời gian.',
        'steps': [('Chọn 3 loại video', 'Giới thiệu, cách dùng, so sánh.'), ('Quay hàng loạt', 'Một buổi quay cho cả tuần.'), ('Lên lịch đăng', 'Đặt giờ trong công cụ.'), ('Xem kết quả', 'Giữ dạng video hiệu quả.')],
        'body': '''
<p>Video hiệu quả nhờ đều đặn hơn là nhờ một lần làm thật kỹ. Shop nhỏ không có nhiều thời gian nên cần một quy trình quay hàng loạt và lên lịch sẵn.</p>
<h2 id="tan-suat">1. Tần suất hợp lý</h2>
<p>Bắt đầu với 3 video mỗi tuần. Đủ đều để khách và hệ thống quen với kênh mà không quá tải. Khi có quy trình ổn định, hãy tăng dần.</p>
<h2 id="loai-video">2. Ba loại video dễ làm</h2>
<ul><li><strong>Giới thiệu sản phẩm:</strong> cận cảnh, thông số, kích thước thật.</li><li><strong>Cách dùng hoặc thử nghiệm:</strong> kéo thử độ co giãn, đổ nước thử độ chống thấm, ăn thử, mặc thử.</li><li><strong>So sánh hoặc mẹo:</strong> chọn size, phối đồ, bảo quản.</li></ul>
<h2 id="quay-hang-loat">3. Quay hàng loạt</h2>
<ol><li>Chọn một buổi trong tuần, chuẩn bị 3–5 sản phẩm và kịch bản ngắn.</li><li>Quay đủ sáng, giữ nền gọn, không có logo bên thứ ba (xem <a href="/blog/dang-video-shopee-video-cho-nguoi-ban">đăng video Shopee Video</a>).</li><li>Quay luôn các cảnh dự phòng.</li></ol>
<h2 id="len-lich">4. Lên lịch đăng</h2>
<p>Tải video lên trong công cụ, đặt lịch cho cả tuần, gắn đúng sản phẩm xuất hiện trong video. Thử các khung giờ khác nhau để tìm thời điểm khách xem nhiều nhất.</p>
<h2 id="do-ket-qua">5. Đo và cải thiện</h2>
<p>Mỗi tuần xem video nào nhiều lượt xem và dẫn đến đơn. Giữ lại dạng nội dung hiệu quả, bỏ dạng không ai xem. Kết hợp với <a href="/blog/hinh-anh-video-san-pham-shopee">ảnh và video sản phẩm</a> để đồng bộ hình ảnh toàn shop.</p>
''',
        'faq': [('Nên đăng bao nhiêu video mỗi tuần?', 'Khởi đầu 3 video mỗi tuần, sau đó điều chỉnh theo thời gian và kết quả.'), ('Có cần thiết bị quay đắt tiền không?', 'Không. Điện thoại, đủ sáng và giữ ổn định là đủ cho phần lớn video bán hàng.'), ('Làm sao biết video hiệu quả?', 'Theo dõi lượt xem và đơn hàng đến từ sản phẩm được gắn, rồi giữ dạng nội dung có kết quả tốt.')],
        'related': ['dang-video-shopee-video-cho-nguoi-ban', 'hinh-anh-video-san-pham-shopee'],
    },
]
