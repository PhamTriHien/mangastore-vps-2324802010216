# MangaStore VPS — Hệ thống Thương mại Điện tử & Đọc Truyện Tranh Đa Nguồn trên Hyper-V Ubuntu 24.04 LTS

- **Sinh viên thực hiện:** Phạm Trí Hiển — **MSSV:** `2324802010216`
- **Tên máy ảo VPS:** `vps-2324802010216` (`192.168.100.10/24`)
- **Kho mã nguồn:** https://github.com/PhamTriHien/mangastore-vps-2324802010216

Hệ thống **MangaStore** phiên bản port đầy đủ kiến trúc ASP.NET MVC 5 gốc sang **React 19 + TypeScript 7 + Tailwind CSS v4** kết hợp **Python FastAPI + SQLAlchemy 2 + PostgreSQL 16**, triển khai trên **Windows Microsoft Hyper-V** (`Ubuntu Server 24.04.5 LTS`, **Nginx** cổng `80`, **systemd**, tường lửa **UFW**).

---

## 1. Phân hệ chức năng đã hoàn thiện

1. **Cửa hàng bán truyện tranh (`Storefront`):**
   - Trang chủ với Hero Banner Carousel 4 slide hiệu ứng Parallax 3D, Collage 3D 8 bìa truyện, thanh tìm kiếm kép (Mua truyện / Đọc online), phân loại thẻ cửa hàng/đọc online và 3 kệ cuộn ngang (`Phổ biến`, `Bán chạy`, `Mới cập nhật`).
   - Danh mục sản phẩm (`/products`) lọc đa thể loại, khoảng giá, tag, sắp xếp, phân trang, gợi ý tự động (`suggestions`) và lưu lịch sử tìm kiếm.
   - Chi tiết sách (`/products/:id`) với mô hình sách vật lý 3D, thư viện ảnh thu nhỏ, tồn kho thời gian thực, chọn số lượng, nút **Mua ngay**, đánh giá 5 sao kèm phản hồi quản trị (chỉ mở cho người đã mua hàng) và sản phẩm liên quan.
2. **Giỏ hàng, Thanh toán, Mã giảm giá & Bản đồ (`Cart & Checkout`):**
   - Giỏ hàng lưu PostgreSQL theo phiên đăng nhập, chọn từng sản phẩm thanh toán một phần, tự động miễn phí vận chuyển từ `150.000đ` (dưới ngưỡng tính `30.000đ`).
   - Áp dụng mã giảm giá (`GIAM10`, `GIAM15`, `GIAM20`) kiểm tra hạn sử dụng, lượt dùng/người và đơn tối thiểu.
   - Bản đồ **Leaflet + OpenStreetMap Nominatim** tìm kiếm địa chỉ Việt Nam và chọn vị trí giao hàng trực quan, hỗ trợ **COD** và **MoMo v2 HMAC-SHA256** (tạo giao dịch, kiểm tra chữ ký IPN/Return và trừ/hoàn kho nguyên tử).
3. **Trình đọc truyện Online 7 nguồn (`Online Reader & Community`):**
   - Tích hợp 7 nguồn đọc: `mangadex-vi`, `mangadex-en`, `nettruyen`, `nhattruyen`, `truyenqq`, `archive-manga` và `local-db` (36 chương truyện đọc chữ nội bộ trên PostgreSQL), hỗ trợ tìm đa nguồn đồng thời (`cross-search`) và liên kết sách in tại cửa hàng.
   - **Image Proxy chống SSRF:** kiểm tra allowlist tên miền + phân giải DNS chặn IP nội bộ/loopback/link-local/ULA trên mọi bước chuyển hướng, giới hạn kích thước cache bộ nhớ phù hợp VPS `2 GB RAM`.
   - Giao diện đọc toàn màn hình không xao nhãng: 4 chế độ (`webtoon`, `vertical`, `rtl`, `ltr`), 4 chủ đề (`amoled`, `dark`, `sepia`, `light`), 4 khổ rộng, lưu lịch sử/kệ sách theo tài khoản, đánh giá 5 sao và bình luận 2 cấp.
4. **Tài khoản & Hồ sơ cá nhân (`Auth & Profile`):**
   - Đăng nhập/Đăng ký (`bcrypt` + `PyJWT` theo bảng phiên `user_sessions` thu hồi được ngay), khôi phục mật khẩu 3 bước qua OTP 6 chữ số + SMTP, đổi ảnh đại diện, đổi mật khẩu, danh sách yêu thích, sổ địa chỉ giao hàng và theo dõi đơn hàng 5 bước + hủy đơn khi chưa xác nhận.
5. **Trang Quản trị RBAC (`Admin Dashboard & Excel/ZIP Bulk Import`):**
   - Phân quyền 2 cấp quản trị: `role_id = 1` (Quản trị viên toàn quyền) và `role_id = 2` (Nhân viên — bị chặn truy cập Quản lý khách hàng và Hoàn tác import, có bảo vệ chống tự khóa/tự hạ quyền).
   - Biểu đồ **Chart.js** doanh thu 6 tháng & phân bổ danh mục, CRUD sản phẩm kèm tải ảnh bìa/gallery, quản lý đơn hàng theo đúng luồng COD/Online, kiểm duyệt & trả lời đánh giá, và **Nhập hàng hàng loạt `.xlsx` / `.zip`** (chống zip-slip/zip-bomb + kiểm tra magic byte ảnh + xem trước + hoàn tác theo lô).
6. **Trợ lý AI Chatbot:**
   - Góc phải dưới dùng quả cầu 3D tích hợp **Groq LLM (`llama-3.1-8b-instant`)** nạp ngữ cảnh danh mục trực tiếp, tự động dự phòng sang bộ máy 18 ý định tiếng Việt và gợi ý thẻ sản phẩm.

---

## 2. Tài khoản mẫu & Mã giảm giá kiểm thử

Tất cả tài khoản khởi tạo trong `backend/app/seed.py` dùng mật khẩu băm `bcrypt` mặc định là `phamtrihien`:
- **Khách hàng (`role_id = 3`):** `hien2324802010216` (`hien2324802010216@mangastore.vn`)
- **Quản trị viên (`role_id = 1`):** `admin` (`admin@mangastore.vn`) — đăng nhập qua `/admin/login`
- **Nhân viên (`role_id = 2`):** `staff` (`staff@mangastore.vn`) — đăng nhập qua `/admin/login`
- **Mã giảm giá mẫu:** `GIAM10`, `GIAM15`, `GIAM20`

---

## 3. Chạy phát triển Local & Kiểm thử

```powershell
# Backend (FastAPI + Pytest)
cd backend
.\.venv\Scripts\python.exe -m pytest tests\test_full_app.py -v
.\.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000 --reload

# Frontend (TypeScript + Vite + React 19)
cd frontend
npm install
npm run build
npm run dev
```

---

## 4. Triển khai & Vận hành trên Hyper-V VPS (`192.168.100.10`)

- Sao chép `.env.example` thành `/opt/mangastore-vps/.env` (`chmod 600 mangastore:mangastore`), không commit `.env` lên Git.
- Khởi chạy thiết lập hệ thống (tạo user `mangastore`, PostgreSQL `mangastore_db` chỉ nghe `127.0.0.1`, Nginx `:80`, `systemd`, `ufw`):

```bash
sudo bash /opt/mangastore-vps/deploy/ubuntu/setup-vps.sh
sudo bash /opt/mangastore-vps/deploy/ubuntu/verify-vps.sh
```
