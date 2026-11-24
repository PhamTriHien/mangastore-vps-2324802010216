# MangaStore VPS — Ứng dụng Web Quản lý & Đọc Truyện Tranh trên Hyper-V Ubuntu 24.04 LTS

- **Sinh viên thực hiện:** Phạm Trí Hiển — **MSSV:** `2324802010216`
- **Tên máy ảo VPS:** `vps-2324802010216` (`192.168.100.10/24`)
- **Kho mã nguồn:** https://github.com/PhamTriHien/mangastore-vps-2324802010216

Hệ thống web quản lý và đọc truyện tranh trực tuyến (**MangaStore**), được thiết kế theo mô hình triển khai thực tế trên **Windows Microsoft Hyper-V** + **Ubuntu Server 24.04 LTS**, sử dụng **Nginx** làm reverse proxy, **FastAPI + Uvicorn + systemd** cho backend API và **PostgreSQL** cho lưu trữ dữ liệu quan hệ.

---

## 1. Tổng quan & Công nghệ sử dụng

- **Frontend:** React 19 (`^19.3.1`), TypeScript, Vite (`^8.3.8`), Tailwind CSS v4 (`@tailwindcss/vite`), `lucide-react`
- **Backend:** Python FastAPI (`0.165.0`), Uvicorn (`0.54.0`), SQLAlchemy (`2.1.9`), `psycopg` (`3.3.9`), `pydantic-settings`
- **Xác thực & Bảo mật:** `bcrypt` (hash mật khẩu có salt), `PyJWT` (`HS256`), `CORS` cấu hình theo origin
- **Cơ sở dữ liệu:** PostgreSQL (`users`, `mangas`, `chapters` — khóa ngoại `ON DELETE CASCADE` / `ON DELETE SET NULL`, ràng buộc duy nhất `(manga_id, chapter_number)`)
- **Hạ tầng triển khai:** Windows Hyper-V (`vSwitch-CloudLab` Internal + `NAT-CloudLab`), Ubuntu Server 24.04 LTS, Nginx `:80`, `systemd` (`mangastore-api.service`), `ufw`

---

## 2. Kiến trúc hệ thống

```text
+-------------------+        HTTP :80        +-----------------------------------+
|  Windows Host /   | ---------------------> |     Ubuntu 24.04 LTS (Hyper-V)    |
|  Trình duyệt      |   192.168.100.10:80    |     VM IP: 192.168.100.10/24      |
+-------------------+                        |     GW:    192.168.100.1          |
                                             |                                   |
  vSwitch-CloudLab (Internal)                |  +-----------------------------+  |
  NAT-CloudLab (192.168.100.0/24)            |  | Nginx (:80 default_server)  |  |
                                             |  | - / & /assets/, /covers/    |  |
                                             |  |   -> frontend/dist/         |  |
                                             |  | - /api/ -> reverse proxy    |  |
                                             |  +--------------+--------------+  |
                                             |                 |                 |
                                             |                 v 127.0.0.1:8000  |
                                             |  +-----------------------------+  |
                                             |  | Uvicorn (systemd)           |  |
                                             |  | app.main:app (--workers 2)  |  |
                                             |  | User: mangastore            |  |
                                             |  +--------------+--------------+  |
                                             |                 |                 |
                                             |                 v 127.0.0.1:5432  |
                                             |  +-----------------------------+  |
                                             |  | PostgreSQL (mangastore_db)  |  |
                                             |  | listen_addresses='localhost'|  |
                                             |  +-----------------------------+  |
                                             +-----------------------------------+
```

---

## 3. Cấu trúc thư mục

```text
mangastore-vps/
├── .env.example                          # Mẫu biến môi trường (copy thành .env khi chạy local)
├── .gitignore                            # Loại trừ .env, .venv, node_modules, dist, *.db
├── README.md
├── backend/
│   ├── requirements.txt                  # Danh sách thư viện Python cho API & pytest
│   ├── sql/
│   │   └── init_db.sql                   # DDL khởi tạo bảng users, mangas, chapters
│   └── app/
│       ├── __init__.py
│       ├── config.py                     # Nạp cấu hình từ .env (pydantic-settings)
│       ├── database.py                   # SQLAlchemy Engine/Session (PostgreSQL & SQLite dev)
│       ├── main.py                       # Khởi tạo FastAPI, CORS, health check & routers
│       ├── models.py                     # ORM models: User, Manga, Chapter
│       ├── schemas.py                    # Pydantic request/response schemas & validation
│       ├── security.py                   # bcrypt password hash & PyJWT Bearer auth
│       ├── seed.py                       # Dữ liệu mẫu ban đầu (12 đầu truyện & chương)
│       └── routers/
│           ├── auth.py                   # /api/auth/*
│           └── manga.py                  # /api/stats, /api/manga/*, /api/chapters/*
├── frontend/
│   ├── index.html
│   ├── package.json                      # Scripts: dev, build (tsc --noEmit && vite build), preview
│   ├── vite.config.ts                    # Proxy /api -> http://127.0.0.1:8000 khi chạy dev
│   ├── public/
│   │   ├── brand-logo.svg
│   │   └── covers/                       # Ảnh bìa truyện phục vụ tĩnh tại /covers/*
│   └── src/
│       ├── index.css                     # Tailwind CSS v4 & custom 3D card/book styles
│       ├── lib/api.ts                    # Fetch API client & token storage
│       └── types/manga.ts                # TypeScript interfaces đồng bộ với API schemas
└── deploy/
    ├── hyperv/
    │   ├── setup-hyperv-network.ps1      # Tạo vSwitch-CloudLab, IP 192.168.100.1/24, NAT-CloudLab, bcdedit
    │   └── create-vps.ps1                # Tạo VM Hyper-V Gen 2 (vps-<MSSV>) kèm checkpoint sạch
    └── ubuntu/
        ├── mangastore-api.service        # systemd unit chạy Uvicorn trên 127.0.0.1:8000
        ├── nginx-mangastore.conf         # Nginx virtual host phục vụ dist/ & proxy /api/
        ├── setup-vps.sh                  # Script cài đặt & triển khai tự động trên Ubuntu 24.04 LTS
        └── verify-vps.sh                 # Script kiểm tra dịch vụ, socket loopback, ufw & HTTP API
```

---

## 4. Hướng dẫn chạy môi trường phát triển (Local Development)

### 4.1. Cấu hình biến môi trường

Sao chép file mẫu `.env.example` thành `.env` tại thư mục gốc `mangastore-vps/`:

```powershell
Copy-Item .env.example .env
```

Cập nhật `.env` với chuỗi kết nối PostgreSQL cục bộ (hoặc dùng SQLite tạm để phát triển nhanh với `DATABASE_URL=sqlite:///./mangastore_dev.db`) và tạo `JWT_SECRET` ngẫu nhiên 64 ký tự hex:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

### 4.2. Chạy Backend (FastAPI)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Chạy kiểm thử tự động (`pytest`):

```powershell
cd backend
.\.venv\Scripts\pytest -v
```

### 4.3. Chạy Frontend (Vite Dev Server)

Mở terminal khác tại thư mục gốc dự án:

```powershell
cd frontend
npm install
npm run dev
```

Truy cập `http://localhost:5173`. Vite đã cấu hình sẵn proxy `/api` trỏ về `http://127.0.0.1:8000` trong `frontend/vite.config.ts`.

Kiểm tra type-check và build production frontend:

```powershell
cd frontend
npm run build
```

---

## 5. Thiết lập máy ảo Ubuntu 24.04 LTS trên Windows Hyper-V

> **Yêu cầu:** Windows 10/11 Pro/Enterprise/Education đã bật tính năng `Microsoft-Hyper-V-All` và bộ cài **Ubuntu Server 24.04.x LTS** (`.iso`).

### Bước 1: Cấu hình mạng Hyper-V và boot readiness trên Windows

Mở **PowerShell với quyền Administrator** tại thư mục gốc dự án và chạy:

```powershell
.\deploy\hyperv\setup-hyperv-network.ps1
```

Script thực hiện theo cơ chế idempotent (chạy lại nhiều lần không lỗi):
1. Tạo Internal Virtual Switch `vSwitch-CloudLab` nếu chưa có.
2. Gán IP tĩnh `192.168.100.1/24` cho card mạng `vEthernet (vSwitch-CloudLab)`.
3. Tạo Windows NAT `NAT-CloudLab` cho dải mạng `192.168.100.0/24`.
4. Chạy `bcdedit /set hypervisorlaunchtype auto` để bật Hyper-V hypervisor tự động khi khởi động Windows.

> Nếu `Hypervisor Active` hiển thị `False`, hãy khởi động lại Windows **1 lần** để hypervisor nạp vào hệ thống trước khi chạy Bước 2.

### Bước 2: Tạo máy ảo Hyper-V (`vps-2324802010216`)

Chạy PowerShell (Administrator) với MSSV và đường dẫn file ISO Ubuntu Server 24.04 LTS:

```powershell
.\deploy\hyperv\create-vps.ps1 -Mssv "2324802010216" -IsoPath "C:\HyperV\ISO\ubuntu-24.04.5-live-server-amd64.iso"
```

Thông số máy ảo được cấp phát tự động:
- **Tên VM:** `vps-2324802010216` (Generation 2, UEFI Secure Boot `MicrosoftUEFICertificateAuthority`)
- **Tài nguyên:** `2 vCPU`, `2 GB` RAM cố định (`DynamicMemoryEnabled = $false`), `20 GB` ổ đĩa động `.vhdx`
- **Card mạng:** gắn vào `vSwitch-CloudLab`
- **Checkpoint sạch ban đầu:** `Initial-Clean`

Khởi động VM và mở màn hình cài đặt:

```powershell
Start-VM -Name "vps-2324802010216"
vmconnect localhost "vps-2324802010216"
```

### Bước 3: Cài đặt Ubuntu & cấu hình IP tĩnh (`192.168.100.10/24`)

Trong trình cài đặt Ubuntu Server 24.04 LTS:
- Chọn cài đặt **OpenSSH Server**.
- Cấu hình mạng IPv4 **Manual** (hoặc chỉnh `/etc/netplan/00-installer-config.yaml` sau khi cài):

```yaml
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: false
      addresses:
        - 192.168.100.10/24
      routes:
        - to: default
          via: 192.168.100.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
```

Áp dụng Netplan (nếu sửa sau khi cài):

```bash
sudo chmod 600 /etc/netplan/*.yaml
sudo netplan apply
```

### Bước 4: Thiết lập SSH Key từ Windows vào VPS

Trên Windows PowerShell:

```powershell
ssh-keygen -t ed25519
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh <ubuntu_user>@192.168.100.10 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

### Bước 5: Tạo Hyper-V Checkpoint / Snapshot

Nên tạo checkpoint sau khi cài xong hệ điều hành sạch (trước deploy) và sau khi deploy thành công:

```powershell
Checkpoint-VM -Name "vps-2324802010216" -SnapshotName "OS-Base-Clean"
# Sau khi deploy xong:
Checkpoint-VM -Name "vps-2324802010216" -SnapshotName "MangaStore-Deployed"
```

Khi cần khôi phục trạng thái trước đó:

```powershell
Restore-VMSnapshot -VMName "vps-2324802010216" -Name "OS-Base-Clean" -Confirm:$false
```

---

## 6. Triển khai & Kiểm chứng trên Ubuntu VPS

### Bước 1: Đưa mã nguồn lên VPS

**Cách 1 (Khuyến nghị — clone trực tiếp từ GitHub trên VPS):**

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/PhamTriHien/mangastore-vps-2324802010216.git /opt/mangastore-vps
```

**Cách 2 (Đóng gói và truyền trực tiếp từ Windows PowerShell qua SSH):**

```powershell
tar --exclude="backend/.venv" --exclude="frontend/node_modules" --exclude="frontend/dist" --exclude=".env" --exclude="*.db" -czf - . | ssh <ubuntu_user>@192.168.100.10 "sudo mkdir -p /opt/mangastore-vps && sudo tar -xzf - -C /opt/mangastore-vps"
```

*(Hoặc dùng `scp -r C:\WebDocTruyen\mangastore-vps <ubuntu_user>@192.168.100.10:/tmp/mangastore-vps`; script `setup-vps.sh` sẽ tự tạo lại `.venv` Linux và build lại `frontend/dist`.)*

### Bước 2: Chạy script cài đặt tự động

SSH vào VPS và chạy:

```bash
sudo bash /opt/mangastore-vps/deploy/ubuntu/setup-vps.sh
```

Script `setup-vps.sh` thực hiện tự động:
- Cài `python3`, `python3-venv`, `postgresql`, `nginx`, `ufw`, `curl`, `openssl` và nâng cấp **Node.js 22 LTS** nếu phiên bản hiện tại `< 20`.
- Khóa PostgreSQL chỉ lắng nghe tại `listen_addresses = 'localhost'`.
- Tạo system user `mangastore` (`nologin`), role PostgreSQL `mangastore_app`, database `mangastore_db` (kèm quyền schema `public` cho PostgreSQL 16).
- Giữ nguyên `/opt/mangastore-vps/.env` nếu đã có, hoặc sinh mật khẩu DB + `JWT_SECRET` ngẫu nhiên bằng `openssl rand -hex` và ghi `.env` (`chmod 600`, sở hữu `mangastore:mangastore`).
- Tạo Python `.venv` cài `requirements.txt` và chạy `npm ci && npm run build` cho frontend.
- Cài đặt và kích hoạt `mangastore-api.service` (`systemd`) và `nginx-mangastore.conf` (`nginx -t`).
- Cấu hình tường lửa `ufw` và bật bảo vệ ngay.

### Bước 3: Kiểm chứng vận hành

```bash
sudo bash /opt/mangastore-vps/deploy/ubuntu/verify-vps.sh
```

Kiểm tra từ trình duyệt trên máy Windows host:
- Truy cập giao diện web: `http://192.168.100.10`
- Kiểm tra API health qua Nginx: `http://192.168.100.10/api/health`

---

## 7. Checklist Bảo mật & Thiết kế Môi trường

- [x] **Cô lập dịch vụ nội bộ (`127.0.0.1`):** PostgreSQL (`:5432`) và Uvicorn (`:8000`) chỉ lắng nghe trên loopback `127.0.0.1`, không mở ra card mạng ngoài; toàn bộ lưu lượng đi qua Nginx (`:80`).
- [x] **Tường lửa `ufw`:** `default deny incoming`, `default allow outgoing`, cổng SSH `22/tcp` chỉ cho phép từ dải nội bộ Hyper-V `192.168.100.0/24`, chỉ mở `80/tcp` cho web HTTP.
- [x] **Quản lý bí mật `.env`:** File `/opt/mangastore-vps/.env` đặt quyền `chmod 600` thuộc user `mangastore`, bí mật sinh bằng `openssl rand -hex`, không bao giờ commit lên Git nhờ `.gitignore`.
- [x] **Xác thực & Mật khẩu:** Mật khẩu băm bằng `bcrypt` kèm salt; phiên làm việc ký bằng `PyJWT` (`HS256`) có thời hạn (`JWT_EXPIRE_MINUTES=1440`).
- [x] **Security Headers tại Nginx:** Bật `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` cho cả trang HTML và static assets.
- [x] **Quyền thực thi tối thiểu:** Backend chạy dưới system user `mangastore` (`--shell /usr/sbin/nologin`), tách biệt với quyền `root` và `www-data`.

---

## 8. Bảng API Endpoints

Tất cả endpoint sử dụng tiền tố `/api` (trong production được Nginx chuyển tiếp từ `:80/api/` vào `127.0.0.1:8000`). Các route yêu cầu xác thực dùng header `Authorization: Bearer <access_token>`.

| Method | Endpoint | Xác thực | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Công khai | Kiểm tra tình trạng API và kết nối cơ sở dữ liệu (`status`, `db`). |
| `POST` | `/api/auth/register` | Công khai | Đăng ký tài khoản mới (`username`, `email`, `password`), trả về `201` kèm JWT token. |
| `POST` | `/api/auth/login` | Công khai | Đăng nhập bằng `identifier` (username hoặc email) và `password`, trả về JWT token. |
| `GET` | `/api/auth/me` | Bearer JWT | Lấy thông tin người dùng đang đăng nhập. |
| `GET` | `/api/stats` | Công khai | Thống kê tổng số truyện, chương, người dùng, lượt xem và danh sách thể loại (`genres`). |
| `GET` | `/api/manga` | Công khai | Danh sách truyện hỗ trợ query `search`, `genre`, `status`, `sort` (`latest`, `views`, `rating`, `title`). |
| `GET` | `/api/manga/{manga_id}` | Công khai | Chi tiết truyện kèm danh sách chương và tự động tăng `views`. |
| `POST` | `/api/manga` | Bearer JWT | Tạo đầu truyện mới (`201`). |
| `PUT` | `/api/manga/{manga_id}` | Bearer JWT | Cập nhật thông tin đầu truyện theo `manga_id`. |
| `DELETE` | `/api/manga/{manga_id}` | Bearer JWT | Xóa đầu truyện và tự động xóa các chương liên quan. |
| `GET` | `/api/manga/{manga_id}/chapters` | Công khai | Lấy danh sách chương của một truyện theo thứ tự `chapter_number` tăng dần. |
| `POST` | `/api/manga/{manga_id}/chapters` | Bearer JWT | Thêm chương mới cho truyện (`201`, trả lỗi `409` nếu trùng `chapter_number`). |
| `GET` | `/api/chapters/{chapter_id}` | Công khai | Đọc nội dung chương kèm `prev_chapter_id` và `next_chapter_id` để chuyển chương. |
| `DELETE` | `/api/chapters/{chapter_id}` | Bearer JWT | Xóa chương theo `chapter_id`. |
