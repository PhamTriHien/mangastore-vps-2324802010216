from io import BytesIO
from pathlib import Path
import sys
import zipfile

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import httpx
import openpyxl
import pytest

from app.config import get_settings
from app.database import SessionLocal, dispose_engine
from app.main import app
from app.seed import seed_catalog

TEST_JWT_SECRET = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


@pytest.fixture()
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture()
async def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "test_full_mangastore.db"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file.as_posix()}")
    monkeypatch.setenv("JWT_SECRET", TEST_JWT_SECRET)
    monkeypatch.setenv("JWT_ALGORITHM", "HS256")
    monkeypatch.setenv("JWT_EXPIRE_MINUTES", "60")
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173,http://192.168.100.10")

    get_settings.cache_clear()
    dispose_engine()

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as async_client:
            yield async_client

    dispose_engine()
    get_settings.cache_clear()


async def _login_headers(client: httpx.AsyncClient, identifier: str, password: str) -> tuple[dict[str, str], dict]:
    resp = await client.post("/api/auth/login", json={"identifier": identifier, "password": password})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return {"Authorization": f"Bearer {body['access_token']}"}, body


def test_config_requires_database_url_and_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    get_settings.cache_clear()
    try:
        with pytest.raises(ValueError, match="DATABASE_URL"):
            get_settings()
        monkeypatch.setenv("DATABASE_URL", "sqlite:///ignored.db")
        get_settings.cache_clear()
        with pytest.raises(ValueError, match="JWT_SECRET"):
            get_settings()
    finally:
        get_settings.cache_clear()


@pytest.mark.anyio
async def test_health_returns_503_when_db_unreachable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path.as_posix()}")
    monkeypatch.setenv("JWT_SECRET", TEST_JWT_SECRET)
    get_settings.cache_clear()
    dispose_engine()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as async_client:
            resp = await async_client.get("/api/health")
            assert resp.status_code == 503
            assert resp.json()["db"] == "unavailable"
    finally:
        dispose_engine()
        get_settings.cache_clear()


@pytest.mark.anyio
async def test_seed_auth_sessions_and_home_catalog(client: httpx.AsyncClient) -> None:
    health = await client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "db": "ok"}

    db = SessionLocal()
    try:
        assert seed_catalog(db) == 0
    finally:
        db.close()

    home = await client.get("/api/home")
    assert home.status_code == 200
    home_body = home.json()
    assert len(home_body["popular_products"]) >= 8
    assert len(home_body["store_tags"]) >= 5

    catalog = await client.get("/api/products", params={"page_size": 48})
    assert catalog.status_code == 200
    assert catalog.json()["total"] == 36

    headers, login_data = await _login_headers(client, "hien2324802010216", "phamtrihien")
    assert login_data["user"]["role_id"] == 3

    me = await client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["username"] == "hien2324802010216"

    logout = await client.post("/api/auth/logout", headers=headers)
    assert logout.status_code == 200

    after_logout = await client.get("/api/auth/me", headers=headers)
    assert after_logout.status_code == 401


@pytest.mark.anyio
async def test_store_cart_coupon_order_cancel_and_review_flow(client: httpx.AsyncClient) -> None:
    headers, _ = await _login_headers(client, "hien2324802010216", "phamtrihien")

    prod_list = (await client.get("/api/products", params={"search": "Naruto"})).json()["items"]
    naruto = next(p for p in prod_list if p["title"] == "Naruto")
    pid = naruto["id"]
    orig_stock = naruto["stock_quantity"]

    add_resp = await client.post("/api/cart", json={"product_id": pid, "quantity": 6}, headers=headers)
    assert add_resp.status_code == 200

    sub_total = float(naruto["price"]) * 6
    coupon = await client.get("/api/coupons/validate", params={"code": "GIAM10", "sub_total": sub_total}, headers=headers)
    assert coupon.status_code == 200
    assert coupon.json()["valid"] is True
    assert coupon.json()["discount"] > 0

    order_resp = await client.post(
        "/api/orders",
        json={
            "selected_product_ids": [pid],
            "payment_method": "cod",
            "coupon_code": "GIAM10",
            "full_name": "Phạm Trí Hiển",
            "phone": "0901234216",
            "email": "hien2324802010216@mangastore.vn",
            "address": "06 Trần Văn Ơn, Thủ Dầu Một",
            "province": "Bình Dương",
        },
        headers=headers,
    )
    assert order_resp.status_code in (200, 201), order_resp.text
    order_id = order_resp.json()["order_id"]

    naruto_after = (await client.get(f"/api/products/{pid}")).json()["product"]
    assert naruto_after["stock_quantity"] == orig_stock - 6

    cancel_resp = await client.post(
        f"/api/profile/orders/{order_id}/cancel",
        json={"reason": "Đổi địa chỉ"},
        headers=headers,
    )
    assert cancel_resp.status_code == 200

    naruto_restored = (await client.get(f"/api/products/{pid}")).json()["product"]
    assert naruto_restored["stock_quantity"] == orig_stock

    # Existing user already reviewed One Piece in seed; try reviewing a paid seeded product (Attack on Titan)
    aot_list = (await client.get("/api/products", params={"search": "Attack on Titan"})).json()["items"]
    aot_id = next(p for p in aot_list if p["title"] == "Attack on Titan")["id"]
    rev = await client.post(
        f"/api/products/{aot_id}/reviews",
        json={"rating": 5, "content": "Bản in rõ nét, rất đáng sưu tầm!"},
        headers=headers,
    )
    assert rev.status_code in (200, 201), rev.text
    del_rev = await client.delete(f"/api/products/{aot_id}/reviews", headers=headers)
    assert del_rev.status_code == 200


@pytest.mark.anyio
async def test_reader_local_db_ssrf_and_community(client: httpx.AsyncClient) -> None:
    sources = await client.get("/api/reader/sources")
    assert sources.status_code == 200
    src_ids = {s["id"] for s in sources.json()}
    assert {"mangadex-vi", "mangadex-en", "nettruyen", "nhattruyen", "truyenqq", "archive-manga", "local-db"} <= src_ids

    browse = await client.get("/api/reader/browse", params={"source": "local-db"})
    assert browse.status_code == 200
    items = browse.json()["items"]
    assert len(items) == 24

    one_piece_id = next(i["id"] for i in items if i["title"] == "One Piece")
    detail = await client.get("/api/reader/detail", params={"source": "local-db", "id": one_piece_id})
    assert detail.status_code == 200
    detail_json = detail.json()
    assert len(detail_json["chapters"]) == 3

    chap_id = detail_json["chapters"][-1]["id"]
    read_res = await client.get(
        "/api/reader/read",
        params={"source": "local-db", "manga_id": one_piece_id, "chapter_id": chap_id},
    )
    assert read_res.status_code == 200
    assert read_res.json()["is_text_content"] is True
    assert len(read_res.json()["text_content"]) > 50

    for unsafe in ("http://127.0.0.1/secret.png", "http://169.254.169.254/latest", "http://localhost/a.jpg"):
        proxy_res = await client.get("/api/reader/image-proxy", params={"url": unsafe})
        assert proxy_res.status_code == 403

    headers, _ = await _login_headers(client, "hien2324802010216", "phamtrihien")
    rate_res = await client.post(
        "/api/reader/rate",
        json={"source_id": "local-db", "manga_id": str(one_piece_id), "score": 5},
        headers=headers,
    )
    assert rate_res.status_code == 200

    c1 = await client.post(
        "/api/reader/comments",
        json={"source_id": "local-db", "manga_id": str(one_piece_id), "content": "Chương mở đầu hay tuyệt!"},
        headers=headers,
    )
    assert c1.status_code in (200, 201)
    cid = c1.json()["comment"]["id"]
    c_del = await client.delete(f"/api/reader/comments/{cid}", headers=headers)
    assert c_del.status_code == 200


@pytest.mark.anyio
async def test_admin_rbac_import_restore_and_chatbot(client: httpx.AsyncClient) -> None:
    member_headers, _ = await _login_headers(client, "hien2324802010216", "phamtrihien")
    assert (await client.get("/api/admin/dashboard", headers=member_headers)).status_code == 403

    staff_resp = await client.post("/api/admin/login", json={"identifier": "staff", "password": "phamtrihien"})
    assert staff_resp.status_code == 200
    staff_headers = {"Authorization": f"Bearer {staff_resp.json()['access_token']}"}
    assert (await client.get("/api/admin/dashboard", headers=staff_headers)).status_code == 200
    assert (await client.get("/api/admin/customers", headers=staff_headers)).status_code == 403

    admin_resp = await client.post("/api/admin/login", json={"identifier": "admin", "password": "phamtrihien"})
    assert admin_resp.status_code == 200
    admin_headers = {"Authorization": f"Bearer {admin_resp.json()['access_token']}"}
    assert (await client.get("/api/admin/customers", headers=admin_headers)).status_code == 200

    tpl = await client.get("/api/admin/import/template", params={"type": "excel"}, headers=admin_headers)
    assert tpl.status_code == 200

    # Create valid Excel + ZIP import and test preview -> execute -> restore rollback
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Name", "Category", "Price", "OriginalPrice", "StockQuantity", "Author", "Publisher", "Description", "Tags", "IsFeatured", "CoverImageFile"])
    ws.append(["Truyen Import Test 232", "Action", 50000, 60000, 15, "Tac Gia A", "NXB Kim Dong", "Mo ta test", "action,new", 1, "test_cover.png"])
    xlsx_buf = BytesIO()
    wb.save(xlsx_buf)

    zip_buf = BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        zf.writestr("products.xlsx", xlsx_buf.getvalue())
        zf.writestr("images/test_cover.png", PNG_BYTES)

    prev = await client.post(
        "/api/admin/import/preview",
        files={"file": ("import.zip", zip_buf.getvalue(), "application/zip")},
        headers=admin_headers,
    )
    assert prev.status_code == 200, prev.text
    token = prev.json()["import_token"]
    exe = await client.post("/api/admin/import/execute", json={"import_token": token}, headers=admin_headers)
    assert exe.status_code == 200, exe.text
    batch_id = exe.json()["batch_id"]
    assert exe.json()["success_count"] == 1

    # Staff cannot restore import batch
    assert (await client.post(f"/api/admin/import/history/{batch_id}/restore", headers=staff_headers)).status_code == 403
    restore = await client.post(f"/api/admin/import/history/{batch_id}/restore", headers=admin_headers)
    assert restore.status_code == 200, restore.text

    # Chatbot rule fallback & admin status check
    chat = await client.post("/api/chatbot/message", json={"message": "Gợi ý truyện One Piece và phí ship"})
    assert chat.status_code == 200
    assert len(chat.json()["text"]) > 10
    assert len(chat.json()["product_cards"]) >= 1
    assert (await client.get("/api/chatbot/status", headers=member_headers)).status_code == 403
    assert (await client.get("/api/chatbot/status", headers=staff_headers)).status_code == 200
