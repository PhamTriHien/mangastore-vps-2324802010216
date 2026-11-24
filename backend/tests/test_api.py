from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import httpx
import pytest

from app.config import get_settings
from app.database import SessionLocal, dispose_engine
from app.main import app
from app.seed import seed_catalog

TEST_JWT_SECRET = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"


@pytest.fixture()
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture()
async def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "test_mangastore.db"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file.as_posix()}")
    monkeypatch.setenv("JWT_SECRET", TEST_JWT_SECRET)
    monkeypatch.setenv("JWT_ALGORITHM", "HS256")
    monkeypatch.setenv("JWT_EXPIRE_MINUTES", "60")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173,http://192.168.100.10")

    get_settings.cache_clear()
    dispose_engine()

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as async_client:
            yield async_client

    dispose_engine()
    get_settings.cache_clear()


async def _register_and_get_headers(
    client: httpx.AsyncClient,
    username: str = "reader01",
    email: str = "reader01@example.com",
    password: str = "StrongPass123!",
) -> tuple[dict[str, str], dict]:
    resp = await client.post(
        "/api/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert resp.status_code == 201
    data = resp.json()
    return {"Authorization": f"Bearer {data['access_token']}"}, data


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
async def test_health_and_seeded_catalog(client: httpx.AsyncClient) -> None:
    health = await client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "db": "ok"}

    db = SessionLocal()
    try:
        assert seed_catalog(db) == 0
    finally:
        db.close()

    stats = await client.get("/api/stats")
    assert stats.status_code == 200
    stats_body = stats.json()
    assert stats_body["total_mangas"] == 12
    assert stats_body["total_chapters"] == 36
    assert stats_body["total_users"] == 0
    assert stats_body["total_views"] == 0
    assert stats_body["genres"] == [
        "Action",
        "Comedy",
        "Fantasy",
        "Seinen",
        "Shounen",
        "Sports",
    ]

    catalog = await client.get("/api/manga")
    assert catalog.status_code == 200
    items = catalog.json()
    assert len(items) == 12
    cover_urls = {item["cover_url"] for item in items}
    assert len(cover_urls) == 12
    assert "/covers/one-piece.jpg" in cover_urls
    assert "/covers/frieren.jpg" in cover_urls
    for item in items:
        assert item["chapter_count"] == 3
        assert item["created_by"] is None
        assert item["cover_url"].startswith("/covers/")


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
            assert resp.json() == {"status": "error", "db": "unavailable"}
    finally:
        dispose_engine()
        get_settings.cache_clear()


@pytest.mark.anyio
async def test_search_filter_and_sort(client: httpx.AsyncClient) -> None:
    by_search = await client.get("/api/manga", params={"search": "Oda"})
    assert by_search.status_code == 200
    assert [m["title"] for m in by_search.json()] == ["One Piece"]

    by_genre = await client.get("/api/manga", params={"genre": "Action", "sort": "title"})
    assert by_genre.status_code == 200
    assert [m["title"] for m in by_genre.json()] == ["Chainsaw Man", "Tokyo Revengers"]

    by_status = await client.get(
        "/api/manga",
        params={"genre": "Shounen", "status": "Hoàn thành", "sort": "rating"},
    )
    assert by_status.status_code == 200
    titles = [m["title"] for m in by_status.json()]
    assert titles == [
        "Demon Slayer: Kimetsu no Yaiba",
        "Naruto",
        "Jujutsu Kaisen",
        "My Hero Academia",
    ]


@pytest.mark.anyio
async def test_view_increment_and_chapter_reader_navigation(client: httpx.AsyncClient) -> None:
    mangas = (await client.get("/api/manga", params={"search": "Frieren"})).json()
    manga_id = mangas[0]["id"]
    assert mangas[0]["views"] == 0

    detail_1 = await client.get(f"/api/manga/{manga_id}")
    assert detail_1.status_code == 200
    body_1 = detail_1.json()
    assert body_1["views"] == 1
    assert body_1["chapter_count"] == 3
    chapters = body_1["chapters"]
    assert [ch["chapter_number"] for ch in chapters] == [1.0, 2.0, 3.0]

    detail_2 = await client.get(f"/api/manga/{manga_id}")
    assert detail_2.status_code == 200
    assert detail_2.json()["views"] == 2

    stats = (await client.get("/api/stats")).json()
    assert stats["total_views"] == 2

    ch_list = await client.get(f"/api/manga/{manga_id}/chapters")
    assert ch_list.status_code == 200
    assert len(ch_list.json()) == 3

    ch1 = (await client.get(f"/api/chapters/{chapters[0]['id']}")).json()
    ch2 = (await client.get(f"/api/chapters/{chapters[1]['id']}")).json()
    ch3 = (await client.get(f"/api/chapters/{chapters[2]['id']}")).json()

    assert ch1["manga_title"] == "Frieren: Pháp Sư Tiễn Táng"
    assert ch1["prev_chapter_id"] is None
    assert ch1["next_chapter_id"] == ch2["id"]
    assert len(ch1["content"]) > 100

    assert ch2["prev_chapter_id"] == ch1["id"]
    assert ch2["next_chapter_id"] == ch3["id"]

    assert ch3["prev_chapter_id"] == ch2["id"]
    assert ch3["next_chapter_id"] is None

    assert (await client.get("/api/manga/999999")).status_code == 404
    assert (await client.get("/api/manga/999999/chapters")).status_code == 404
    assert (await client.get("/api/chapters/999999")).status_code == 404


@pytest.mark.anyio
async def test_protected_endpoints_require_auth(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/auth/me")).status_code == 401
    assert (
        await client.get("/api/auth/me", headers={"Authorization": "Bearer invalid.token"})
    ).status_code == 401
    assert (
        await client.post(
            "/api/manga",
            json={"title": "Test", "author": "Author", "genre": "Action"},
        )
    ).status_code == 401
    assert (await client.put("/api/manga/1", json={"title": "Changed"})).status_code == 401
    assert (await client.delete("/api/manga/1")).status_code == 401
    assert (
        await client.post(
            "/api/manga/1/chapters",
            json={"chapter_number": 4, "title": "Ch 4", "content": "Body"},
        )
    ).status_code == 401
    assert (await client.delete("/api/chapters/1")).status_code == 401


@pytest.mark.anyio
async def test_auth_register_login_and_me(client: httpx.AsyncClient) -> None:
    long_password = "P" * 90
    headers, reg_data = await _register_and_get_headers(
        client,
        username="otaku_vn",
        email="Otaku.VN@Example.com",
        password=long_password,
    )
    assert reg_data["token_type"] == "bearer"
    assert reg_data["user"]["username"] == "otaku_vn"
    assert reg_data["user"]["email"] == "otaku.vn@example.com"
    assert reg_data["user"]["role"] == "member"
    assert "password_hash" not in reg_data["user"]

    dup_user = await client.post(
        "/api/auth/register",
        json={"username": "otaku_vn", "email": "other@example.com", "password": "Password123"},
    )
    assert dup_user.status_code == 409

    dup_email = await client.post(
        "/api/auth/register",
        json={"username": "another_user", "email": "OTAKU.VN@example.com", "password": "Password123"},
    )
    assert dup_email.status_code == 409

    login_username = await client.post(
        "/api/auth/login",
        json={"identifier": "otaku_vn", "password": long_password},
    )
    assert login_username.status_code == 200
    assert login_username.json()["user"]["id"] == reg_data["user"]["id"]

    login_email = await client.post(
        "/api/auth/login",
        json={"identifier": "OTAKU.VN@EXAMPLE.COM", "password": long_password},
    )
    assert login_email.status_code == 200
    assert login_email.json()["user"]["username"] == "otaku_vn"

    bad_login = await client.post(
        "/api/auth/login",
        json={"identifier": "otaku_vn", "password": "wrong-password"},
    )
    assert bad_login.status_code == 401

    me = await client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["username"] == "otaku_vn"


@pytest.mark.anyio
async def test_manga_and_chapter_crud_lifecycle(client: httpx.AsyncClient) -> None:
    headers, auth_data = await _register_and_get_headers(client)
    user_id = auth_data["user"]["id"]

    created_manga = await client.post(
        "/api/manga",
        headers=headers,
        json={
            "title": "Dandadan",
            "author": "Yukinobu Tatsu",
            "genre": "Action",
            "cover_url": "/covers/one-piece.jpg",
            "description": "Cuộc phiêu lưu kỳ bí giữa ma quỷ và người ngoài hành tinh.",
            "rating": 4.9,
        },
    )
    assert created_manga.status_code == 201
    manga = created_manga.json()
    manga_id = manga["id"]
    assert manga["status"] == "Đang tiến hành"
    assert manga["created_by"] == user_id
    assert manga["chapter_count"] == 0

    updated_manga = await client.put(
        f"/api/manga/{manga_id}",
        headers=headers,
        json={"status": "Hoàn thành", "rating": 5.0},
    )
    assert updated_manga.status_code == 200
    assert updated_manga.json()["status"] == "Hoàn thành"
    assert updated_manga.json()["rating"] == 5.0

    ch1 = await client.post(
        f"/api/manga/{manga_id}/chapters",
        headers=headers,
        json={"chapter_number": 1, "title": "Chương 1", "content": "Nội dung chương một."},
    )
    assert ch1.status_code == 201
    ch1_id = ch1.json()["id"]

    ch2 = await client.post(
        f"/api/manga/{manga_id}/chapters",
        headers=headers,
        json={"chapter_number": 2, "title": "Chương 2", "content": "Nội dung chương hai."},
    )
    assert ch2.status_code == 201
    ch2_id = ch2.json()["id"]

    ch1_5 = await client.post(
        f"/api/manga/{manga_id}/chapters",
        headers=headers,
        json={"chapter_number": 1.5, "title": "Chương 1.5", "content": "Ngoại truyện."},
    )
    assert ch1_5.status_code == 201
    ch1_5_data = ch1_5.json()
    assert ch1_5_data["prev_chapter_id"] == ch1_id
    assert ch1_5_data["next_chapter_id"] == ch2_id

    dup_ch = await client.post(
        f"/api/manga/{manga_id}/chapters",
        headers=headers,
        json={"chapter_number": 1.5, "title": "Trùng", "content": "Trùng số chương."},
    )
    assert dup_ch.status_code == 409

    del_ch = await client.delete(f"/api/chapters/{ch1_5_data['id']}", headers=headers)
    assert del_ch.status_code == 200
    assert (await client.get(f"/api/chapters/{ch1_5_data['id']}")).status_code == 404

    views_sorted = (await client.get("/api/manga", params={"sort": "views"})).json()
    assert len(views_sorted) == 13

    del_manga = await client.delete(f"/api/manga/{manga_id}", headers=headers)
    assert del_manga.status_code == 200
    assert (await client.get(f"/api/manga/{manga_id}")).status_code == 404
    assert (await client.get(f"/api/chapters/{ch1_id}")).status_code == 404
    assert (await client.get(f"/api/chapters/{ch2_id}")).status_code == 404
    assert (await client.delete(f"/api/manga/{manga_id}", headers=headers)).status_code == 404


@pytest.mark.anyio
async def test_cors_headers_for_configured_origins(client: httpx.AsyncClient) -> None:
    allowed = await client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:5173"

    blocked = await client.options(
        "/api/health",
        headers={
            "Origin": "http://evil.example.org",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in blocked.headers
