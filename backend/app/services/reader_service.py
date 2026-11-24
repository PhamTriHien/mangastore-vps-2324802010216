from __future__ import annotations

import asyncio
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
import ipaddress
import json
import logging
import re
import socket
import threading
import time
from typing import Any, Awaitable, Callable, Iterable, Protocol, TypeVar
from urllib.parse import quote, urljoin, urlsplit
from uuid import UUID

from bs4 import BeautifulSoup, NavigableString, Tag as BsTag
from fastapi import HTTPException, status
import httpx
from sqlalchemy import exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Chapter,
    Genre,
    Product,
    ProductGenre,
    ProductTag,
    ReaderBookmark,
    ReaderComment,
    ReaderHistory,
    ReaderRating,
    ReaderStat,
    Tag,
    User,
    utc_now,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")

DEFAULT_COVER_URL = "/covers/default-manga.svg"
DEFAULT_AVATAR_URL = "/content/icons/spots/avatar-default.svg"

MANGADEX_USER_AGENT = "WebsiteMangaReader/1.0"
CHROME_DESKTOP_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36"
)

API_CACHE_MAX_ENTRIES = 512
API_CACHE_MIN_TTL_SECONDS = 120
API_CACHE_MAX_TTL_SECONDS = 900

IMAGE_CACHE_MAX_ENTRIES = 128
IMAGE_CACHE_MAX_BYTES = 768 * 1024
IMAGE_CACHE_TTL_SECONDS = 15 * 60
IMAGE_DOWNLOAD_HARD_LIMIT_BYTES = 15 * 1024 * 1024

MAX_DYNAMIC_IMAGE_HOSTS = 256
MAX_IMAGE_PROXY_REDIRECTS = 3
ARCHIVE_MAX_PAGE_LIMIT = 500
MAX_COMMENT_LENGTH = 2000

ALLOWED_EXACT_IMAGE_HOSTS: frozenset[str] = frozenset(
    {
        "uploads.mangadex.org",
        "archive.org",
        "nettruyenar.com",
        "nhattruyenqq.com",
        "truyenqqko.com",
        "truyenqqgo.com",
    }
)

ALLOWED_IMAGE_HOST_SUFFIXES: tuple[str, ...] = (
    ".mangadex.network",
    ".archive.org",
    ".nettruyenar.com",
    ".nhattruyenqq.com",
    ".truyenqqko.com",
    ".truyenqqgo.com",
    ".cloud-zzz.com",
    ".beercloudy.com",
    ".hinhhinh.com",
    ".truyenvua.com",
    ".tintruyen.net",
)

SOURCE_REFERERS: dict[str, str] = {
    "nettruyen": "https://nettruyenar.com/",
    "nhattruyen": "https://nhattruyenqq.com/",
    "truyenqq": "https://truyenqqko.com/",
}

READER_DEMOGRAPHICS: tuple[tuple[str, str], ...] = (
    ("shounen", "Shounen"),
    ("seinen", "Seinen"),
    ("shoujo", "Shoujo"),
    ("josei", "Josei"),
)

ALLOWED_BOOKMARK_CATEGORIES: frozenset[str] = frozenset(
    {"reading", "plan", "favorite", "completed"}
)

TAG_VIETNAMESE_MAP: dict[str, str] = {
    "action": "Hành động",
    "romance": "Lãng mạn",
    "comedy": "Hài hước",
    "fantasy": "Giả tưởng",
    "adventure": "Phiêu lưu",
    "drama": "Chính kịch",
    "long strip": "Webtoon cuộn dọc",
    "isekai": "Dị giới",
    "school life": "Học đường",
    "mystery": "Bí ẩn",
    "horror": "Kinh dị",
    "slice of life": "Đời thường",
    "martial arts": "Võ thuật",
    "sci-fi": "Viễn tưởng",
    "sports": "Thể thao",
    "historical": "Lịch sử",
    "psychological": "Tâm lý",
    "supernatural": "Siêu nhiên",
    "thriller": "Giật gân",
    "full color": "Truyện màu",
    "oneshot": "Truyện ngắn",
    "one shot": "Truyện ngắn",
    "adaptation": "Chuyển thể",
    "reincarnation": "Chuyển sinh",
    "magic": "Phép thuật",
    "award winning": "Đoạt giải",
    "web comic": "Truyện tranh mạng",
    "4-koma": "Truyện 4 khung",
    "official colored": "Bản màu chính thức",
    "fan colored": "Fan tô màu",
    "anthology": "Tuyển tập",
    "doujinshi": "Đồng nhân",
    "self-published": "Tự xuất bản",
    "tragedy": "Bi kịch",
    "mecha": "Người máy",
    "crime": "Tội phạm",
    "medical": "Y học",
    "philosophical": "Triết lý",
    "superhero": "Siêu anh hùng",
    "wuxia": "Kiếm hiệp",
    "magical girls": "Phép thuật thiếu nữ",
    "boys' love": "Đam mỹ",
    "girls' love": "Bách hợp",
    "cooking": "Ẩm thực",
    "music": "Âm nhạc",
    "demons": "Ác quỷ",
    "ghosts": "Ma quái",
    "monsters": "Quái vật",
    "monster girls": "Nữ quái vật",
    "survival": "Sinh tồn",
    "time travel": "Du hành thời gian",
    "post-apocalyptic": "Hậu tận thế",
    "video games": "Trò chơi điện tử",
    "virtual reality": "Thực tế ảo",
    "samurai": "Kiếm sĩ",
    "ninja": "Nhẫn giả",
    "military": "Quân sự",
    "police": "Cảnh sát",
    "mafia": "Thế giới ngầm",
    "vampires": "Ma cà rồng",
    "zombies": "Xác sống",
    "villainess": "Nữ phản diện",
    "harem": "Hậu cung",
    "reverse harem": "Hậu cung đảo ngược",
    "delinquents": "Học sinh cá biệt",
    "office workers": "Công sở",
    "aliens": "Người ngoài hành tinh",
    "animals": "Động vật",
    "traditional games": "Trò chơi truyền thống",
    "mahjong": "Mạt chược",
    "genderswap": "Hoán đổi giới tính",
    "crossdressing": "Giả trang",
    "gyaru": "Nữ sinh cá tính",
    "gore": "Bạo lực",
    "sexual violence": "Nhạy cảm",
}

_CORE_TITLE_SPLIT_RE = re.compile(r"[:\(\[\|]|(\s-\s)")
_WORD_SPLIT_RE = re.compile(r"[^\w]+", re.UNICODE)
_STOP_WORDS: frozenset[str] = frozenset(
    {
        "the",
        "and",
        "for",
        "with",
        "from",
        "into",
        "part",
        "vol",
        "volume",
        "chapter",
        "tap",
        "tập",
        "chuong",
        "chương",
        "truyen",
        "truyện",
        "manga",
        "comic",
        "edition",
    }
)

_WHITESPACE_RE = re.compile(r"\s+")
_HORIZONTAL_SPACE_RE = re.compile(r"[ \t]+")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")
_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_COMIC_ID_RE = re.compile(r"(?:gOpts\.)?comicId\s*=\s*['\"]?(\d+)['\"]?", re.IGNORECASE)
_TRAILING_COMIC_ID_RE = re.compile(r"-\d+$")
_CHAPTER_NUM_RE = re.compile(r"(\d+(?:\.\d+)?)")
_LEAD_TRUYEN_TRANH_RE = re.compile(r"^Truyện\s+tranh\s+", re.IGNORECASE)
_COMPACT_COUNT_RE = re.compile(r"([0-9]+(?:[.,][0-9]+)*)(?:\s*([KMB])(?![a-zA-Z]))?", re.IGNORECASE)
_TRUYENQQ_SLUG_CHAP_RE = re.compile(r"(?:-chap-|-chuong-)([0-9]+(?:[.-][0-9]+)?)", re.IGNORECASE)
_TRUYENQQ_TAG_SUFFIX_RE = re.compile(r"-([0-9]+)(?:\.html)?$", re.IGNORECASE)
_TRUYENQQ_NUMERIC_CAT_RE = re.compile(r"^[0-9]+(?:\s*,\s*[0-9]+)*$")
_ARCHIVE_LEAF_COUNT_RE = re.compile(r"<leafCount>(\d+)</leafCount>", re.IGNORECASE)
_HTML_BREAK_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_NATURAL_TOKEN_RE = re.compile(r"(\d+|\D+)")
_SOLR_UNSAFE_RE = re.compile(r'["\\():\[\]{}+!\-~^?*]')
_YEAR_RE = re.compile(r"((?:19|20)\d{2})")

_MISSING = object()


class TTLCache:
    """Thread-safe bounded OrderedDict cache with per-entry TTL eviction."""

    def __init__(self, maxsize: int = API_CACHE_MAX_ENTRIES, default_ttl: int = 180) -> None:
        self._maxsize = max(1, maxsize)
        self._default_ttl = default_ttl
        self._store: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.RLock()

    def get(self, key: str) -> Any:
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return _MISSING
            expires_at, value = entry
            if expires_at <= now:
                self._store.pop(key, None)
                return _MISSING
            self._store.move_to_end(key)
            return value

    def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        ttl_seconds = self._default_ttl if ttl is None else ttl
        if ttl_seconds <= 0 or value is None:
            return
        now = time.monotonic()
        expires_at = now + ttl_seconds
        with self._lock:
            if key in self._store:
                self._store.pop(key, None)
            elif len(self._store) >= self._maxsize:
                expired_keys = [k for k, (exp, _) in self._store.items() if exp <= now]
                for ek in expired_keys:
                    self._store.pop(ek, None)
                while len(self._store) >= self._maxsize:
                    self._store.popitem(last=False)
            self._store[key] = (expires_at, value)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)


_api_cache = TTLCache(maxsize=API_CACHE_MAX_ENTRIES, default_ttl=180)
_image_cache = TTLCache(maxsize=IMAGE_CACHE_MAX_ENTRIES, default_ttl=IMAGE_CACHE_TTL_SECONDS)
_dynamic_hosts_lock = threading.RLock()
_dynamic_image_hosts: OrderedDict[str, str] = OrderedDict()


async def _get_or_add_cached(key: str, ttl_seconds: int, loader: Callable[[], Awaitable[T]]) -> T:
    clamped_ttl = max(API_CACHE_MIN_TTL_SECONDS, min(API_CACHE_MAX_TTL_SECONDS, ttl_seconds))
    cached = _api_cache.get(key)
    if cached is not _MISSING:
        return cached
    value = await loader()
    if value is not None:
        _api_cache.set(key, value, ttl=clamped_ttl)
    return value


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso_utc(dt: datetime | None) -> str | None:
    resolved = _ensure_utc(dt)
    return resolved.isoformat() if resolved is not None else None


def _has_suffix(host: str, suffix: str) -> bool:
    return len(host) > len(suffix) and host.endswith(suffix)


def _is_ip_literal(host: str) -> bool:
    candidate = host.strip().strip("[]")
    if not candidate:
        return True
    try:
        ipaddress.ip_address(candidate)
        return True
    except ValueError:
        pass
    try:
        socket.inet_aton(candidate)
        return True
    except OSError:
        return False


def _is_private_or_disallowed_host(host: str | None) -> bool:
    if not host or not host.strip():
        return True
    normalized = host.strip().rstrip(".").lower()
    if not normalized or "." not in normalized:
        return True
    if (
        normalized == "localhost"
        or normalized.endswith(".localhost")
        or normalized.endswith(".local")
        or normalized.endswith(".internal")
    ):
        return True
    return _is_ip_literal(normalized)


def _is_disallowed_ipv4(ip: ipaddress.IPv4Address) -> bool:
    if (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or not ip.is_global
    ):
        return True
    b0, b1, b2, _ = ip.packed
    if b0 in (0, 10, 127) or b0 >= 224:
        return True
    if b0 == 100 and 64 <= b1 <= 127:
        return True
    if b0 == 169 and b1 == 254:
        return True
    if b0 == 172 and 16 <= b1 <= 31:
        return True
    if b0 == 192 and ((b1 == 0 and b2 == 0) or b1 == 168):
        return True
    if b0 == 198 and b1 in (18, 19):
        return True
    return False


def _is_disallowed_ip_address(raw_ip: str | ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    try:
        addr = raw_ip if isinstance(raw_ip, (ipaddress.IPv4Address, ipaddress.IPv6Address)) else ipaddress.ip_address(str(raw_ip).split("%", 1)[0])
    except ValueError:
        return True

    if isinstance(addr, ipaddress.IPv4Address):
        return _is_disallowed_ipv4(addr)

    if addr.ipv4_mapped is not None:
        return _is_disallowed_ipv4(addr.ipv4_mapped)
    if addr.sixtofour is not None and _is_disallowed_ipv4(addr.sixtofour):
        return True
    if addr.teredo is not None:
        return True
    if (
        addr.is_loopback
        or addr.is_private
        or addr.is_link_local
        or addr.is_site_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
        or not addr.is_global
    ):
        return True
    packed = addr.packed
    if (packed[0] & 0xFE) == 0xFC:
        return True
    if all(b == 0 for b in packed[:12]):
        return _is_disallowed_ipv4(ipaddress.IPv4Address(packed[12:16]))
    return False


def _is_mangadex_host(host: str) -> bool:
    return host == "uploads.mangadex.org" or _has_suffix(host, ".mangadex.network")


def _is_archive_host(host: str) -> bool:
    return host == "archive.org" or _has_suffix(host, ".archive.org")


def is_allowed_image_host(host: str | None) -> bool:
    if not host or not host.strip():
        return False
    normalized = host.strip().rstrip(".").lower()
    if _is_private_or_disallowed_host(normalized):
        return False
    if normalized in ALLOWED_EXACT_IMAGE_HOSTS:
        return True
    if any(_has_suffix(normalized, suffix) for suffix in ALLOWED_IMAGE_HOST_SUFFIXES):
        return True
    with _dynamic_hosts_lock:
        return normalized in _dynamic_image_hosts


def _resolve_host_ips_sync(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, None)
    ips: list[str] = []
    for info in infos:
        sockaddr = info[4]
        if sockaddr:
            ips.append(str(sockaddr[0]))
    return ips


def is_safe_public_url(url: str | None, *, check_dns: bool = False) -> bool:
    if not url or not isinstance(url, str):
        return False
    cleaned = url.strip()
    if not cleaned:
        return False
    try:
        parsed = urlsplit(cleaned)
    except ValueError:
        return False
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        return False
    if parsed.username or parsed.password:
        return False
    host = (parsed.hostname or "").strip().rstrip(".").lower()
    if not is_allowed_image_host(host):
        return False
    if check_dns:
        try:
            ips = _resolve_host_ips_sync(host)
        except OSError:
            return False
        if not ips or any(_is_disallowed_ip_address(ip) for ip in ips):
            return False
    return True


def register_image_host(image_url: str | None, source_id: str | None) -> None:
    if not image_url or not source_id:
        return
    referer = SOURCE_REFERERS.get(source_id.strip().lower())
    if not referer:
        return
    try:
        parsed = urlsplit(image_url.strip())
    except ValueError:
        return
    if (parsed.scheme or "").lower() not in ("http", "https"):
        return
    host = (parsed.hostname or "").strip().rstrip(".").lower()
    if _is_private_or_disallowed_host(host) or _is_mangadex_host(host) or _is_archive_host(host):
        return
    with _dynamic_hosts_lock:
        if host in _dynamic_image_hosts:
            _dynamic_image_hosts[host] = referer
            _dynamic_image_hosts.move_to_end(host)
        else:
            while len(_dynamic_image_hosts) >= MAX_DYNAMIC_IMAGE_HOSTS:
                _dynamic_image_hosts.popitem(last=False)
            _dynamic_image_hosts[host] = referer


def resolve_referer_for_image(host: str | None, source_id: str | None) -> str | None:
    normalized_host = (host or "").strip().rstrip(".").lower()
    if normalized_host and (_is_mangadex_host(normalized_host) or _is_archive_host(normalized_host)):
        return None
    if source_id:
        sid = source_id.strip().lower()
        if sid in SOURCE_REFERERS:
            return SOURCE_REFERERS[sid]
        if sid in ("mangadex-vi", "mangadex-en", "archive-manga"):
            return None
    if not normalized_host:
        return None
    if normalized_host == "nettruyenar.com" or any(
        _has_suffix(normalized_host, s) for s in (".nettruyenar.com", ".cloud-zzz.com")
    ):
        return "https://nettruyenar.com/"
    if normalized_host == "nhattruyenqq.com" or any(
        _has_suffix(normalized_host, s) for s in (".nhattruyenqq.com", ".beercloudy.com")
    ):
        return "https://nhattruyenqq.com/"
    if normalized_host in ("truyenqqko.com", "truyenqqgo.com") or any(
        _has_suffix(normalized_host, s)
        for s in (".truyenvua.com", ".hinhhinh.com", ".tintruyen.net", ".truyenqqko.com", ".truyenqqgo.com")
    ):
        return "https://truyenqqko.com/"
    with _dynamic_hosts_lock:
        referer = _dynamic_image_hosts.get(normalized_host)
        if referer:
            _dynamic_image_hosts.move_to_end(normalized_host)
            return referer
    return None


def _upgrade_http_to_https_if_default_port(url: str) -> str:
    trimmed = (url or "").strip()
    if not trimmed:
        return ""
    if trimmed.lower().startswith("http://"):
        try:
            parsed = urlsplit(trimmed)
        except ValueError:
            return trimmed
        if parsed.port in (None, 80) and parsed.hostname:
            if ":80" in parsed.netloc:
                netloc = parsed.netloc.replace(":80", "", 1)
                return f"https://{netloc}{parsed.path}{('?' + parsed.query) if parsed.query else ''}"
            return "https://" + trimmed[len("http://") :]
    return trimmed


def wrap_proxy_url(raw_url: str, source_id: str | None = None) -> str:
    target = _upgrade_http_to_https_if_default_port(raw_url.strip())
    encoded = quote(target, safe="")
    if source_id and source_id.strip():
        return f"/api/reader/image-proxy?url={encoded}&source={quote(source_id.strip(), safe='')}"
    return f"/api/reader/image-proxy?url={encoded}"


def resolve_display_image_url(raw_url: str | None, source_id: str | None = None, *, use_proxy: bool = True) -> str:
    if not raw_url or not raw_url.strip():
        return DEFAULT_COVER_URL
    trimmed = raw_url.strip()
    if trimmed.startswith("//"):
        trimmed = "https:" + trimmed
    if trimmed.startswith("/"):
        return trimmed
    if source_id:
        register_image_host(trimmed, source_id)
    if use_proxy:
        try:
            parsed = urlsplit(trimmed)
            host = (parsed.hostname or "").lower()
            if (parsed.scheme or "").lower() in ("http", "https") and is_allowed_image_host(host):
                return wrap_proxy_url(trimmed, source_id)
        except ValueError:
            pass
    return trimmed


async def _ensure_host_resolves_to_public_ip(host: str) -> None:
    if _is_private_or_disallowed_host(host):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tên miền đích không được phép truy cập.",
        )
    try:
        ips = await asyncio.to_thread(_resolve_host_ips_sync, host)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không phân giải được địa chỉ máy chủ ảnh.",
        ) from exc
    if not ips:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không tìm thấy địa chỉ IP hợp lệ cho máy chủ ảnh.",
        )
    for ip_str in ips:
        if _is_disallowed_ip_address(ip_str):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Địa chỉ IP đích bị chặn bởi chính sách bảo mật.",
            )


async def fetch_proxied_image(url: str, source: str | None = None) -> tuple[bytes, str]:
    if not url or not url.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL ảnh không hợp lệ.")
    cleaned = url.strip()
    if not is_safe_public_url(cleaned, check_dns=False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tên miền ảnh không nằm trong danh sách cho phép hoặc bị chặn bởi chính sách bảo mật.",
        )

    parsed_initial = urlsplit(cleaned)
    referer = resolve_referer_for_image(parsed_initial.hostname, source)
    cache_key = f"img:{referer or ''}|{cleaned}"
    cached = _image_cache.get(cache_key)
    if cached is not _MISSING:
        return cached

    current_url = cleaned
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(15.0, connect=5.0),
        follow_redirects=False,
    ) as client:
        for hop in range(MAX_IMAGE_PROXY_REDIRECTS + 1):
            parsed = urlsplit(current_url)
            scheme = (parsed.scheme or "").lower()
            host = (parsed.hostname or "").strip().rstrip(".").lower()
            if scheme not in ("http", "https") or parsed.username or parsed.password:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Địa chỉ chuyển hướng ảnh không hợp lệ.",
                )
            await _ensure_host_resolves_to_public_ip(host)

            headers: dict[str, str] = {"Accept": "image/*,*/*;q=0.8"}
            hop_referer = None if (_is_mangadex_host(host) or _is_archive_host(host)) else referer
            if hop_referer:
                headers["Referer"] = hop_referer
                headers["User-Agent"] = CHROME_DESKTOP_USER_AGENT
            else:
                headers["User-Agent"] = MANGADEX_USER_AGENT

            try:
                resp = await client.get(current_url, headers=headers)
            except httpx.HTTPError as exc:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Không thể tải ảnh từ máy chủ nguồn.",
                ) from exc

            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("location")
                if hop >= MAX_IMAGE_PROXY_REDIRECTS or not location:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="Chuyển hướng tải ảnh vượt quá giới hạn cho phép.",
                    )
                next_url = urljoin(current_url, location.strip())
                try:
                    next_parsed = urlsplit(next_url)
                except ValueError as exc:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Chuyển hướng ảnh tới địa chỉ không hợp lệ.",
                    ) from exc
                next_host = (next_parsed.hostname or "").strip().rstrip(".").lower()
                if (
                    (next_parsed.scheme or "").lower() not in ("http", "https")
                    or next_parsed.username
                    or next_parsed.password
                    or _is_private_or_disallowed_host(next_host)
                ):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Chuyển hướng ảnh tới địa chỉ không được phép.",
                    )
                current_url = next_url
                continue

            if resp.status_code == 404:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy ảnh.")
            if resp.status_code >= 400:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Máy chủ ảnh phản hồi mã lỗi {resp.status_code}.",
                )

            raw_ct = (resp.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
            content = resp.content
            if not content or not raw_ct.startswith("image/"):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tài nguyên phản hồi không phải hình ảnh hợp lệ.",
                )
            if len(content) > IMAGE_DOWNLOAD_HARD_LIMIT_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Kích thước ảnh vượt quá giới hạn cho phép.",
                )

            if len(content) <= IMAGE_CACHE_MAX_BYTES:
                _image_cache.set(cache_key, (content, raw_ct), ttl=IMAGE_CACHE_TTL_SECONDS)
            return content, raw_ct

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Không thể tải ảnh sau số lần chuyển hướng tối đa.",
    )


def _decode_bytes(content: bytes) -> str:
    text = content.decode("utf-8", errors="replace")
    return text[1:] if text.startswith("\ufeff") else text


def _is_cloudflare_challenge(html: str) -> bool:
    if not html:
        return False
    lower = html.lower()
    return (
        "cf-browser-verification" in lower
        or "_cf_chl_opt" in lower
        or "/cdn-cgi/challenge-platform/" in lower
        or "<title>just a moment...</title>" in lower
    )


async def _http_get_text(url: str, *, accept: str = "application/json", user_agent: str = MANGADEX_USER_AGENT) -> str:
    headers = {"User-Agent": user_agent, "Accept": accept}
    async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=5.0), follow_redirects=True) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        return _decode_bytes(resp.content)


async def _http_get_html(url: str, *, referer: str | None = None) -> str:
    headers: dict[str, str] = {
        "User-Agent": CHROME_DESKTOP_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    if referer:
        headers["Referer"] = referer
    async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=5.0), follow_redirects=True) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        return _decode_bytes(resp.content)


async def _http_post_form(
    url: str,
    data: dict[str, str],
    *,
    referer: str | None = None,
    is_ajax: bool = False,
) -> str:
    headers: dict[str, str] = {
        "User-Agent": CHROME_DESKTOP_USER_AGENT,
        "Accept": "text/html, */*; q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    }
    if referer:
        headers["Referer"] = referer
    if is_ajax:
        headers["X-Requested-With"] = "XMLHttpRequest"
    async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=5.0), follow_redirects=True) as client:
        resp = await client.post(url, data=data, headers=headers)
        resp.raise_for_status()
        return _decode_bytes(resp.content)


async def _probe_html(
    cache_key: str,
    url: str,
    *,
    referer: str | None = None,
    validator: Callable[[str], bool] | None = None,
) -> bool:
    cached = _api_cache.get(cache_key)
    if cached is not _MISSING and isinstance(cached, bool):
        return cached

    available = False
    try:
        headers: dict[str, str] = {
            "User-Agent": CHROME_DESKTOP_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        }
        if referer:
            headers["Referer"] = referer
        async with httpx.AsyncClient(timeout=httpx.Timeout(2.0, connect=1.5), follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            if 200 <= resp.status_code < 300:
                html = _decode_bytes(resp.content)
                available = bool(html.strip()) and not _is_cloudflare_challenge(html) and (
                    validator is None or validator(html)
                )
    except Exception as exc:
        logger.debug("Probe %s failed: %s", cache_key, exc)
        available = False

    _api_cache.set(cache_key, available, ttl=300 if available else 180)
    return available


def _clean_inline_text(raw: str | None) -> str:
    if not raw:
        return ""
    return _WHITESPACE_RE.sub(" ", unescape(raw)).strip()


def _clean_multiline_text(raw: str | None) -> str:
    if not raw:
        return ""
    normalized = unescape(raw).replace("\r\n", "\n").replace("\r", "\n")
    lines = [_HORIZONTAL_SPACE_RE.sub(" ", ln).strip() for ln in normalized.split("\n")]
    return _MULTI_NEWLINE_RE.sub("\n\n", "\n".join(lines)).strip()


def _parse_compact_count(raw: str | None) -> int | None:
    if not raw:
        return None
    cleaned = _clean_inline_text(raw)
    if not cleaned:
        return None
    match = _COMPACT_COUNT_RE.search(cleaned)
    if not match:
        return None
    number_part = match.group(1)
    suffix = (match.group(2) or "").upper()
    if not suffix:
        digits = number_part.replace(".", "").replace(",", "")
        return int(digits) if digits.isdigit() else None
    multiplier = {"K": 1_000.0, "M": 1_000_000.0, "B": 1_000_000_000.0}.get(suffix)
    if multiplier is None:
        return None
    dot_count = number_part.count(".")
    comma_count = number_part.count(",")
    if dot_count > 0 and comma_count > 0:
        norm = (
            number_part.replace(",", "")
            if number_part.rfind(".") > number_part.rfind(",")
            else number_part.replace(".", "").replace(",", ".")
        )
    elif dot_count > 1:
        norm = number_part.replace(".", "")
    elif comma_count > 1:
        norm = number_part.replace(",", "")
    else:
        norm = number_part.replace(",", ".")
    try:
        val = float(norm)
    except ValueError:
        return None
    if val < 0:
        return None
    return int(round(val * multiplier))


def _extract_icon_stats(container: BsTag | None) -> tuple[int | None, int | None, int | None]:
    views: int | None = None
    comments: int | None = None
    follows: int | None = None
    if container is None:
        return views, comments, follows

    current_kind: str | None = None
    buf: list[str] = []

    def _flush() -> None:
        nonlocal views, comments, follows
        if not current_kind:
            return
        parsed = _parse_compact_count("".join(buf))
        if parsed is None:
            return
        if current_kind == "eye" and views is None:
            views = parsed
        elif current_kind == "comment" and comments is None:
            comments = parsed
        elif current_kind == "follow" and follows is None:
            follows = parsed

    for node in container.descendants:
        if isinstance(node, BsTag):
            cls_str = " ".join(node.get("class") or []).lower()
            next_kind: str | None = None
            if "fa-eye" in cls_str:
                next_kind = "eye"
            elif "fa-comment" in cls_str:
                next_kind = "comment"
            elif "fa-heart" in cls_str or "fa-bookmark" in cls_str:
                next_kind = "follow"
            if next_kind is not None:
                _flush()
                buf.clear()
                current_kind = next_kind
        elif isinstance(node, NavigableString) and current_kind is not None:
            buf.append(str(node))

    _flush()
    return views, comments, follows


def _extract_readable_html_text(node: BsTag) -> str:
    parts: list[str] = []

    def _walk(cur: Any) -> None:
        if isinstance(cur, NavigableString):
            parts.append(str(cur))
            return
        if not isinstance(cur, BsTag):
            return
        tag_name = (cur.name or "").lower()
        if tag_name in ("script", "style"):
            return
        if tag_name == "br":
            parts.append("\n")
            return
        is_block = tag_name in ("p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote")
        if is_block and parts and not parts[-1].endswith("\n"):
            parts.append("\n")
        for child in cur.children:
            _walk(child)
        if is_block and parts and not parts[-1].endswith("\n"):
            parts.append("\n")

    _walk(node)
    return _clean_multiline_text("".join(parts))


def _strip_query_and_fragment(value: str) -> str:
    q_idx = value.find("?")
    h_idx = value.find("#")
    cuts = [idx for idx in (q_idx, h_idx) if idx >= 0]
    return value[: min(cuts)] if cuts else value


def _is_valid_uuid(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(UUID(value.strip()))
    except (ValueError, AttributeError):
        return None


def _safe_float(val: Any) -> float | None:
    if val is None or isinstance(val, bool):
        return None
    try:
        num = float(val)
    except (TypeError, ValueError):
        return None
    if num != num or num in (float("inf"), float("-inf")):
        return None
    return num


def _safe_int(val: Any) -> int | None:
    if val is None or isinstance(val, bool):
        return None
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def _parse_iso_datetime(raw: str | None) -> str | None:
    if not raw or not raw.strip():
        return None
    cleaned = raw.strip()
    try:
        if cleaned.endswith("Z"):
            cleaned = cleaned[:-1] + "+00:00"
        dt = datetime.fromisoformat(cleaned)
        return _iso_utc(dt)
    except ValueError:
        return None


def _natural_sort_key(text: str) -> list[tuple[int, int | str]]:
    tokens: list[tuple[int, int | str]] = []
    for part in _NATURAL_TOKEN_RE.findall(text):
        if part.isdigit():
            tokens.append((0, int(part)))
        else:
            tokens.append((1, part.lower()))
    return tokens


def _make_summary(
    *,
    id: str,
    source_id: str,
    source_name: str,
    title: str,
    alt_title: str = "",
    author: str = "",
    cover_url: str = DEFAULT_COVER_URL,
    status: str = "",
    status_label: str = "",
    language: str = "vi",
    year: int | None = None,
    rating: float | None = None,
    rating_max: int = 5,
    rating_count: int | None = None,
    view_count: int | None = None,
    follow_count: int | None = None,
    comment_count: int | None = None,
    chapter_count: int | None = None,
    tags: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "id": id,
        "source_id": source_id,
        "source_name": source_name,
        "title": title,
        "alt_title": alt_title,
        "author": author,
        "cover_url": cover_url or DEFAULT_COVER_URL,
        "status": status,
        "status_label": status_label,
        "language": language,
        "year": year,
        "rating": rating,
        "rating_max": rating_max,
        "rating_count": rating_count,
        "view_count": view_count,
        "follow_count": follow_count,
        "comment_count": comment_count,
        "chapter_count": chapter_count,
        "tags": tags or [],
    }


def _make_chapter(
    *,
    id: str,
    source_id: str,
    manga_id: str,
    chapter_number: str,
    title: str,
    display_label: str,
    language: str = "vi",
    volume_number: str = "",
    scanlation_group: str = "",
    page_count: int = 0,
    published_at: str | None = None,
) -> dict[str, Any]:
    return {
        "id": id,
        "source_id": source_id,
        "manga_id": manga_id,
        "chapter_number": chapter_number,
        "volume_number": volume_number,
        "title": title,
        "display_label": display_label,
        "language": language,
        "scanlation_group": scanlation_group,
        "page_count": page_count,
        "published_at": published_at,
    }


def _wrap_pages_if_needed(pages: list[str], source_id: str) -> list[str]:
    proxied: list[str] = []
    for p in pages:
        cleaned = (p or "").strip()
        if not cleaned:
            continue
        if cleaned.startswith("/"):
            proxied.append(cleaned)
            continue
        try:
            parsed = urlsplit(cleaned)
            host = (parsed.hostname or "").lower()
            if (parsed.scheme or "").lower() in ("http", "https") and is_allowed_image_host(host):
                proxied.append(wrap_proxy_url(cleaned, source_id))
                continue
        except ValueError:
            pass
        proxied.append(cleaned)
    return proxied


def _make_chapter_pages(
    *,
    source_id: str,
    manga_id: str,
    manga_title: str,
    chapter_id: str,
    chapter_label: str,
    original_pages: list[str] | None = None,
    data_saver_pages: list[str] | None = None,
    is_text_content: bool = False,
    text_content: str | None = None,
    prev_chapter_id: str | None = None,
    next_chapter_id: str | None = None,
    chapters: list[dict[str, Any]] | None = None,
    error_message: str | None = None,
    quality: str = "saver",
    use_proxy: bool = True,
) -> dict[str, Any]:
    orig = list(original_pages or [])
    saver = list(data_saver_pages or [])
    proxied_orig = _wrap_pages_if_needed(orig, source_id)
    proxied_saver = _wrap_pages_if_needed(saver, source_id)

    prefer_original = quality.strip().lower() == "original"
    raw_selected = (orig if orig else saver) if prefer_original else (saver if saver else orig)
    proxied_selected = (
        (proxied_orig if proxied_orig else proxied_saver)
        if prefer_original
        else (proxied_saver if proxied_saver else proxied_orig)
    )
    active_pages = proxied_selected if use_proxy else raw_selected

    return {
        "source_id": source_id,
        "manga_id": manga_id,
        "manga_title": manga_title,
        "chapter_id": chapter_id,
        "chapter_label": chapter_label,
        "original_pages": orig,
        "data_saver_pages": saver,
        "proxied_original_pages": proxied_orig,
        "proxied_data_saver_pages": proxied_saver,
        "proxied_saver_pages": proxied_saver,
        "raw_pages": raw_selected,
        "proxied_pages": proxied_selected,
        "pages": active_pages,
        "is_text_content": is_text_content,
        "text_content": text_content,
        "prev_chapter_id": prev_chapter_id,
        "previous_chapter_id": prev_chapter_id,
        "next_chapter_id": next_chapter_id,
        "chapters": list(chapters or []),
        "error_message": error_message,
    }


@dataclass(frozen=True)
class BrowseQuery:
    source_id: str
    keyword: str | None = None
    tag_id: str | None = None
    demographic: str | None = None
    status: str | None = None
    sort: str = "popular"
    page: int = 1
    page_size: int = 24
    use_proxy: bool = True


class MangaSourceProvider(Protocol):
    source_id: str

    async def get_source_info(self, db: Session) -> dict[str, Any]: ...
    async def get_tags(self, db: Session) -> list[dict[str, Any]]: ...
    async def browse(self, query: BrowseQuery, db: Session) -> dict[str, Any]: ...
    async def get_manga_detail(
        self, manga_id: str, preferred_language: str | None, db: Session, *, use_proxy: bool = True
    ) -> dict[str, Any]: ...
    async def get_chapter_pages(
        self,
        manga_id: str,
        chapter_id: str,
        preferred_language: str | None,
        db: Session,
        *,
        quality: str = "saver",
        use_proxy: bool = True,
    ) -> dict[str, Any]: ...


class MangaDexProvider:
    BASE_API_URL = "https://api.mangadex.org"
    ALLOWED_DEMOGRAPHICS: frozenset[str] = frozenset({"shounen", "seinen", "shoujo", "josei"})
    ALLOWED_STATUSES: frozenset[str] = frozenset({"ongoing", "completed", "hiatus", "cancelled"})

    def __init__(self, source_id: str, display_name: str, language_code: str, description: str) -> None:
        self.source_id = source_id
        self.display_name = display_name
        self.language_code = language_code.lower()
        self.description = description

    def _source_info(self, *, is_available: bool = True, status_message: str | None = None) -> dict[str, Any]:
        return {
            "id": self.source_id,
            "display_name": self.display_name,
            "language_badge": self.language_code.upper(),
            "description": self.description,
            "is_available": is_available,
            "status_message": status_message,
            "supports_demographic": True,
            "supports_status": True,
            "supports_sort": True,
        }

    async def get_source_info(self, db: Session) -> dict[str, Any]:
        return self._source_info(is_available=True, status_message=None)

    async def get_tags(self, db: Session) -> list[dict[str, Any]]:
        raw_json = await _get_or_add_cached(
            "mangadex:tags:all",
            900,
            lambda: _http_get_text(f"{self.BASE_API_URL}/manga/tag"),
        )
        root = json.loads(raw_json)
        data = root.get("data") or []
        tags: list[dict[str, Any]] = []
        for obj in data:
            if isinstance(obj, dict):
                parsed = self._parse_tag(obj)
                if parsed is not None:
                    tags.append(parsed)
        group_priority = {"format": 0, "genre": 1, "theme": 2}
        tags.sort(key=lambda t: (group_priority.get(t["group"], 3), t["vietnamese_name"].lower()))
        return tags

    async def browse(self, query: BrowseQuery, db: Session) -> dict[str, Any]:
        page = max(1, query.page)
        page_size = min(max(1, query.page_size), 100)
        offset = (page - 1) * page_size

        available_tags: list[dict[str, Any]] = []
        try:
            available_tags = await self.get_tags(db)
        except Exception:
            available_tags = []

        params: list[tuple[str, str]] = [
            ("limit", str(page_size)),
            ("offset", str(offset)),
            ("availableTranslatedLanguage[]", self.language_code),
            ("includes[]", "cover_art"),
            ("includes[]", "author"),
            ("contentRating[]", "safe"),
            ("contentRating[]", "suggestive"),
        ]
        if query.keyword and query.keyword.strip():
            params.append(("title", query.keyword.strip()))
        if query.tag_id:
            tag_uuid = _is_valid_uuid(query.tag_id)
            if tag_uuid:
                params.append(("includedTags[]", tag_uuid))
        if query.demographic and query.demographic.strip().lower() in self.ALLOWED_DEMOGRAPHICS:
            params.append(("publicationDemographic[]", query.demographic.strip().lower()))
        if query.status and query.status.strip().lower() in self.ALLOWED_STATUSES:
            params.append(("status[]", query.status.strip().lower()))
        order_key, order_val = self._build_order_param(query.sort)
        params.append((order_key, order_val))

        query_str = "&".join(f"{quote(k, safe='[]')}={quote(v, safe='')}" for k, v in params)
        url = f"{self.BASE_API_URL}/manga?{query_str}"

        try:
            raw_json = await _get_or_add_cached(
                f"mangadex:{self.source_id}:browse:{url}",
                120,
                lambda: _http_get_text(url),
            )
            root = json.loads(raw_json)
            data = root.get("data") or []
            total = int(root.get("total") or 0)
            items = [
                self._parse_manga_summary(obj, self.language_code, use_proxy=query.use_proxy)
                for obj in data
                if isinstance(obj, dict)
            ]
            if items:
                stats_map = await self._fetch_batch_statistics([item["id"] for item in items])
                for item in items:
                    st = stats_map.get(item["id"])
                    if st:
                        self._apply_statistics(item, st)
            return {
                "source": self._source_info(is_available=True),
                "items": items,
                "available_tags": available_tags,
                "page": page,
                "page_size": page_size,
                "total_items": total,
                "has_next_page": (offset + len(items)) < total and len(items) > 0,
                "error_message": None,
            }
        except Exception as exc:
            logger.warning("MangaDex browse (%s) failed: %s", self.source_id, exc)
            err = f"Không thể kết nối {self.display_name} lúc này."
            return {
                "source": self._source_info(is_available=False, status_message=err),
                "items": [],
                "available_tags": available_tags,
                "page": page,
                "page_size": page_size,
                "total_items": 0,
                "has_next_page": False,
                "error_message": err,
            }

    async def get_manga_detail(
        self, manga_id: str, preferred_language: str | None, db: Session, *, use_proxy: bool = True
    ) -> dict[str, Any]:
        norm_id = _is_valid_uuid(manga_id)
        if not norm_id:
            return {
                "manga": None,
                "description": "",
                "chapters": [],
                "available_languages": [],
                "selected_language": self.language_code,
                "error_message": "Mã truyện MangaDex không hợp lệ.",
            }
        try:
            initial_lang = preferred_language.strip().lower() if preferred_language and preferred_language.strip() else self.language_code
            manga_obj, feed_chapters, stats_map = await asyncio.gather(
                self._fetch_manga_object(norm_id),
                self._fetch_chapters_feed(norm_id, initial_lang),
                self._fetch_batch_statistics([norm_id]),
            )
            if not manga_obj:
                return {
                    "manga": None,
                    "description": "",
                    "chapters": [],
                    "available_languages": [],
                    "selected_language": self.language_code,
                    "error_message": "Không tìm thấy thông tin truyện trên MangaDex.",
                }
            attrs = manga_obj.get("attributes") or {}
            available_langs = self._extract_available_languages(attrs)
            selected_lang = self._resolve_selected_language(preferred_language, available_langs)
            summary = self._parse_manga_summary(manga_obj, selected_lang, use_proxy=use_proxy)
            if norm_id in stats_map:
                self._apply_statistics(summary, stats_map[norm_id])
            description = self._extract_description(attrs)
            chapters = (
                feed_chapters
                if selected_lang.lower() == initial_lang.lower()
                else await self._fetch_chapters_feed(norm_id, selected_lang)
            )
            return {
                "manga": summary,
                "description": description,
                "chapters": chapters,
                "available_languages": available_langs,
                "selected_language": selected_lang,
                "error_message": None,
            }
        except Exception as exc:
            logger.warning("MangaDex detail (%s) failed: %s", self.source_id, exc)
            return {
                "manga": None,
                "description": "",
                "chapters": [],
                "available_languages": [],
                "selected_language": self.language_code,
                "error_message": "Không thể tải chi tiết truyện lúc này.",
            }

    async def get_chapter_pages(
        self,
        manga_id: str,
        chapter_id: str,
        preferred_language: str | None,
        db: Session,
        *,
        quality: str = "saver",
        use_proxy: bool = True,
    ) -> dict[str, Any]:
        norm_chap = _is_valid_uuid(chapter_id)
        if not norm_chap:
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=manga_id or "",
                manga_title="",
                chapter_id=chapter_id or "",
                chapter_label="",
                error_message="Mã chương MangaDex không hợp lệ.",
                quality=quality,
                use_proxy=use_proxy,
            )
        try:
            at_home_raw = await _get_or_add_cached(
                f"mangadex:athome:{norm_chap}",
                240,
                lambda: _http_get_text(f"{self.BASE_API_URL}/at-home/server/{norm_chap}"),
            )
            at_home_root = json.loads(at_home_raw)
            base_url = (at_home_root.get("baseUrl") or "").rstrip("/")
            ch_obj = at_home_root.get("chapter") or {}
            ch_hash = ch_obj.get("hash") or ""
            if not base_url or not ch_hash:
                return _make_chapter_pages(
                    source_id=self.source_id,
                    manga_id=manga_id or "",
                    manga_title="",
                    chapter_id=norm_chap,
                    chapter_label="",
                    error_message="Không tải được danh sách trang hợp lệ. Vui lòng thử lại sau.",
                    quality=quality,
                    use_proxy=use_proxy,
                )

            original_pages = [
                f"{base_url}/data/{ch_hash}/{fn.strip()}"
                for fn in (ch_obj.get("data") or [])
                if isinstance(fn, str) and fn.strip()
            ]
            data_saver_pages = [
                f"{base_url}/data-saver/{ch_hash}/{fn.strip()}"
                for fn in (ch_obj.get("dataSaver") or [])
                if isinstance(fn, str) and fn.strip()
            ]
            if not original_pages and not data_saver_pages:
                return _make_chapter_pages(
                    source_id=self.source_id,
                    manga_id=manga_id or "",
                    manga_title="",
                    chapter_id=norm_chap,
                    chapter_label="",
                    error_message="Chương này hiện chưa có trang ảnh khả dụng trên MangaDex.",
                    quality=quality,
                    use_proxy=use_proxy,
                )

            resolved_manga_id = _is_valid_uuid(manga_id) or ""
            resolved_lang = (
                preferred_language.strip().lower()
                if preferred_language and preferred_language.strip()
                else self.language_code
            )
            manga_title = ""
            chapter_label = "Đọc chương"
            ordered_chapters: list[dict[str, Any]] = []

            if not resolved_manga_id:
                parent_id, ch_lang = await self._fetch_single_chapter_metadata(norm_chap)
                if parent_id:
                    resolved_manga_id = parent_id
                if ch_lang and not (preferred_language and preferred_language.strip()):
                    resolved_lang = ch_lang

            if resolved_manga_id:
                manga_obj, feed_chapters = await asyncio.gather(
                    self._fetch_manga_object(resolved_manga_id),
                    self._fetch_chapters_feed(resolved_manga_id, resolved_lang),
                )
                if manga_obj:
                    manga_title = self._extract_title(manga_obj.get("attributes") or {})
                if not any(ch["id"].lower() == norm_chap.lower() for ch in feed_chapters):
                    _, ch_lang = await self._fetch_single_chapter_metadata(norm_chap)
                    if ch_lang and ch_lang.lower() != resolved_lang.lower():
                        resolved_lang = ch_lang
                        feed_chapters = await self._fetch_chapters_feed(resolved_manga_id, resolved_lang)
                ordered_chapters = self._sort_chapters_ascending(feed_chapters)

            current_index = -1
            for idx, ch in enumerate(ordered_chapters):
                if ch["id"].lower() == norm_chap.lower():
                    current_index = idx
                    chapter_label = ch["display_label"]
                    break

            prev_id: str | None = None
            next_id: str | None = None
            if current_index >= 0:
                cur_ch = ordered_chapters[current_index]
                prev_id = self._find_adjacent_chapter_id(ordered_chapters, current_index, -1, cur_ch)
                next_id = self._find_adjacent_chapter_id(ordered_chapters, current_index, 1, cur_ch)

            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=resolved_manga_id,
                manga_title=manga_title,
                chapter_id=norm_chap,
                chapter_label=chapter_label,
                original_pages=original_pages,
                data_saver_pages=data_saver_pages,
                is_text_content=False,
                text_content=None,
                prev_chapter_id=prev_id,
                next_chapter_id=next_id,
                chapters=ordered_chapters,
                quality=quality,
                use_proxy=use_proxy,
            )
        except Exception as exc:
            logger.warning("MangaDex read (%s) failed: %s", self.source_id, exc)
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=manga_id or "",
                manga_title="",
                chapter_id=norm_chap,
                chapter_label="",
                error_message="Không thể tải trang truyện lúc này.",
                quality=quality,
                use_proxy=use_proxy,
            )

    async def _fetch_manga_object(self, norm_id: str) -> dict[str, Any] | None:
        url = f"{self.BASE_API_URL}/manga/{norm_id}?includes[]=cover_art&includes[]=author&includes[]=artist"
        raw = await _get_or_add_cached(f"mangadex:detail:{norm_id}", 300, lambda: _http_get_text(url))
        return json.loads(raw).get("data")

    async def _fetch_batch_statistics(self, manga_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
        ids = sorted({mid.strip() for mid in manga_ids if mid and mid.strip()})
        result: dict[str, dict[str, Any]] = {}
        for offset in range(0, len(ids), 100):
            batch = ids[offset : offset + 100]
            q = "&".join(f"manga[]={quote(mid, safe='')}" for mid in batch)
            url = f"{self.BASE_API_URL}/statistics/manga?{q}"
            cache_key = f"mangadex:stats:{','.join(batch)}"
            try:
                raw = await _get_or_add_cached(cache_key, 300, lambda u=url: _http_get_text(u))
                stats_obj = json.loads(raw).get("statistics") or {}
                if isinstance(stats_obj, dict):
                    for k, v in stats_obj.items():
                        if isinstance(v, dict):
                            result[k] = v
            except Exception as exc:
                logger.debug("MangaDex stats batch failed: %s", exc)
        return result

    async def _fetch_single_chapter_metadata(self, norm_chap: str) -> tuple[str | None, str | None]:
        try:
            raw = await _get_or_add_cached(
                f"mangadex:chapter-meta:{norm_chap}",
                600,
                lambda: _http_get_text(f"{self.BASE_API_URL}/chapter/{norm_chap}"),
            )
            data = json.loads(raw).get("data")
            if not isinstance(data, dict):
                return None, None
            lang = ((data.get("attributes") or {}).get("translatedLanguage") or "").strip().lower() or None
            parent_id = None
            for rel in data.get("relationships") or []:
                if isinstance(rel, dict) and (rel.get("type") or "").lower() == "manga":
                    parent_id = rel.get("id")
                    break
            return parent_id, lang
        except Exception:
            return None, None

    async def _fetch_chapters_feed(self, norm_manga_id: str, lang: str) -> list[dict[str, Any]]:
        page_limit = 300
        max_chapters = 1500
        resolved_lang = lang.strip().lower() if lang else self.language_code
        chapters: list[dict[str, Any]] = []
        seen: set[str] = set()

        for offset in range(0, max_chapters, page_limit):
            url = (
                f"{self.BASE_API_URL}/manga/{norm_manga_id}/feed"
                f"?limit={page_limit}&offset={offset}&translatedLanguage[]={quote(resolved_lang, safe='')}"
                "&includeEmptyPages=0&includeExternalUrl=0&contentRating[]=safe"
                "&contentRating[]=suggestive&includes[]=scanlation_group&order[chapter]=desc"
            )
            cache_key = f"mangadex:feed:{norm_manga_id}:{resolved_lang}:{offset}"
            try:
                raw = await _get_or_add_cached(cache_key, 180, lambda u=url: _http_get_text(u))
            except Exception:
                if offset == 0:
                    raise
                break

            root = json.loads(raw)
            data = root.get("data") or []
            if not data:
                break

            for obj in data:
                if not isinstance(obj, dict):
                    continue
                attrs = obj.get("attributes") or {}
                pages_cnt = int(attrs.get("pages") or 0)
                external_url = attrs.get("externalUrl")
                is_unavailable = bool(attrs.get("isUnavailable"))
                if pages_cnt <= 0 or (external_url and str(external_url).strip()) or is_unavailable:
                    continue
                cid = str(obj.get("id") or "").strip()
                if not cid or cid.lower() in seen:
                    continue
                seen.add(cid.lower())
                ch_num = str(attrs.get("chapter") or "").strip()
                vol_num = str(attrs.get("volume") or "").strip()
                ch_title = str(attrs.get("title") or "").strip()
                ch_lang = str(attrs.get("translatedLanguage") or resolved_lang).strip().lower()
                scan_group = self._extract_scanlation_group(obj.get("relationships") or [])
                pub_raw = attrs.get("publishAt") or attrs.get("readableAt")
                display = (
                    f"Chương {ch_num}" + (f" - {ch_title}" if ch_title else "")
                    if ch_num
                    else (ch_title or "Oneshot")
                )
                chapters.append(
                    _make_chapter(
                        id=cid,
                        source_id=self.source_id,
                        manga_id=norm_manga_id,
                        chapter_number=ch_num,
                        volume_number=vol_num,
                        title=ch_title,
                        display_label=display,
                        language=ch_lang,
                        scanlation_group=scan_group,
                        page_count=pages_cnt,
                        published_at=_parse_iso_datetime(pub_raw),
                    )
                )

            total = int(root.get("total") or 0)
            if len(data) < page_limit or (total > 0 and offset + len(data) >= total):
                break
        return chapters

    def _parse_manga_summary(
        self, manga_obj: dict[str, Any], language: str, *, use_proxy: bool = True
    ) -> dict[str, Any]:
        mid = str(manga_obj.get("id") or "")
        attrs = manga_obj.get("attributes") or {}
        rels = manga_obj.get("relationships") or []
        title = self._extract_title(attrs)
        alt_title = self._extract_alt_title(attrs, title)
        author = self._extract_author(rels)
        cover_url = self._extract_cover_url(mid, rels, use_proxy=use_proxy)
        status_val = str(attrs.get("status") or "").strip().lower()
        year = _safe_int(attrs.get("year"))
        tags = [
            parsed
            for tag_obj in (attrs.get("tags") or [])
            if isinstance(tag_obj, dict) and (parsed := self._parse_tag(tag_obj)) is not None
        ]
        return _make_summary(
            id=mid,
            source_id=self.source_id,
            source_name=self.display_name,
            title=title,
            alt_title=alt_title,
            author=author,
            cover_url=cover_url,
            status=status_val,
            status_label=self._map_status_label(status_val),
            language=language,
            year=year,
            tags=tags,
        )

    @staticmethod
    def _parse_tag(tag_obj: dict[str, Any]) -> dict[str, Any] | None:
        tid = str(tag_obj.get("id") or "").strip()
        attrs = tag_obj.get("attributes")
        if not tid or not isinstance(attrs, dict):
            return None
        name_map = attrs.get("name") or {}
        en_name = (name_map.get("en") or "").strip() or MangaDexProvider._first_non_empty(name_map) or ""
        if not en_name:
            return None
        group = str(attrs.get("group") or "").strip().lower()
        vi_name = TAG_VIETNAMESE_MAP.get(en_name.lower(), en_name)
        return {
            "id": tid,
            "name": en_name,
            "vietnamese_name": vi_name,
            "group": group,
        }

    @staticmethod
    def _apply_statistics(item: dict[str, Any], stats: dict[str, Any]) -> None:
        rating_obj = stats.get("rating")
        if isinstance(rating_obj, dict):
            rating = _safe_float(rating_obj.get("bayesian"))
            if not rating or rating <= 0:
                rating = _safe_float(rating_obj.get("average"))
            if rating and rating > 0:
                item["rating"] = round(rating, 2)
                item["rating_max"] = 10
            dist = rating_obj.get("distribution")
            if isinstance(dist, dict):
                total_ratings = sum(max(0, _safe_int(v) or 0) for v in dist.values())
                item["rating_count"] = total_ratings

        follows = _safe_int(stats.get("follows"))
        if follows is not None and follows >= 0:
            item["follow_count"] = follows

        comments_obj = stats.get("comments")
        if isinstance(comments_obj, dict):
            replies = _safe_int(comments_obj.get("repliesCount"))
            if replies is not None and replies >= 0:
                item["comment_count"] = replies

    @staticmethod
    def _get_localized(mapping: dict[str, Any] | None, lang: str) -> str | None:
        if not isinstance(mapping, dict) or not lang:
            return None
        target = lang.lower()
        for k, v in mapping.items():
            if str(k).lower() == target and isinstance(v, str) and v.strip():
                return v.strip()
        return None

    @staticmethod
    def _get_alt_title(alt_list: list[Any] | None, lang: str) -> str | None:
        if not isinstance(alt_list, list):
            return None
        for entry in alt_list:
            if isinstance(entry, dict):
                val = MangaDexProvider._get_localized(entry, lang)
                if val:
                    return val
        return None

    @staticmethod
    def _first_non_empty(mapping: dict[str, Any] | None) -> str | None:
        if not isinstance(mapping, dict):
            return None
        for v in mapping.values():
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None

    def _extract_title(self, attrs: dict[str, Any]) -> str:
        title_map = attrs.get("title")
        alt_list = attrs.get("altTitles")
        for candidate in (
            self._get_localized(title_map, self.language_code),
            self._get_alt_title(alt_list, self.language_code),
            self._get_localized(title_map, "en"),
            self._get_alt_title(alt_list, "en"),
            self._get_localized(title_map, "ja-ro"),
            self._get_localized(title_map, "ko-ro"),
            self._first_non_empty(title_map),
        ):
            if candidate:
                return candidate
        if isinstance(alt_list, list):
            for entry in alt_list:
                val = self._first_non_empty(entry)
                if val:
                    return val
        return ""

    def _extract_alt_title(self, attrs: dict[str, Any], primary_title: str) -> str:
        title_map = attrs.get("title")
        alt_list = attrs.get("altTitles")
        candidates = (
            self._get_localized(title_map, self.language_code),
            self._get_alt_title(alt_list, self.language_code),
            self._get_localized(title_map, "vi"),
            self._get_alt_title(alt_list, "vi"),
            self._get_localized(title_map, "en"),
            self._get_alt_title(alt_list, "en"),
            self._get_localized(title_map, "ja-ro"),
            self._get_alt_title(alt_list, "ja-ro"),
            self._get_localized(title_map, "ko-ro"),
            self._get_alt_title(alt_list, "ko-ro"),
            self._get_localized(title_map, "ja"),
            self._get_alt_title(alt_list, "ja"),
            self._get_localized(title_map, "ko"),
            self._get_alt_title(alt_list, "ko"),
            self._first_non_empty(title_map),
        )
        primary_lower = primary_title.strip().lower()
        for c in candidates:
            if c and c.strip().lower() != primary_lower:
                return c.strip()
        return ""

    def _extract_description(self, attrs: dict[str, Any]) -> str:
        desc_map = attrs.get("description")
        raw = (
            self._get_localized(desc_map, self.language_code)
            or self._get_localized(desc_map, "en")
            or self._get_localized(desc_map, "ja-ro")
            or self._get_localized(desc_map, "ko-ro")
            or self._first_non_empty(desc_map)
            or ""
        )
        if not raw:
            return ""
        cleaned = _MARKDOWN_LINK_RE.sub(r"\1", raw.replace("\r\n", "\n").strip())
        if len(cleaned) > 900:
            sep_idx = cleaned.find("\n---")
            if sep_idx > 120:
                cleaned = cleaned[:sep_idx].strip()
        return _MULTI_NEWLINE_RE.sub("\n\n", cleaned).strip()

    def _extract_cover_url(self, manga_id: str, rels: list[Any], *, use_proxy: bool = True) -> str:
        if not manga_id:
            return DEFAULT_COVER_URL
        for rel in rels:
            if isinstance(rel, dict) and (rel.get("type") or "").lower() == "cover_art":
                fn = ((rel.get("attributes") or {}).get("fileName") or "").strip()
                if fn:
                    raw = f"https://uploads.mangadex.org/covers/{manga_id}/{fn}.512.jpg"
                    return resolve_display_image_url(raw, self.source_id, use_proxy=use_proxy)
        return DEFAULT_COVER_URL

    @staticmethod
    def _extract_author(rels: list[Any]) -> str:
        authors: list[str] = []
        artists: list[str] = []
        for rel in rels:
            if not isinstance(rel, dict):
                continue
            rtype = (rel.get("type") or "").lower()
            name = ((rel.get("attributes") or {}).get("name") or "").strip()
            if not name:
                continue
            if rtype == "author" and name.lower() not in {a.lower() for a in authors}:
                authors.append(name)
            elif rtype == "artist" and name.lower() not in {a.lower() for a in artists}:
                artists.append(name)
        selected = authors or artists
        return ", ".join(selected)

    @staticmethod
    def _extract_scanlation_group(rels: list[Any]) -> str:
        groups: list[str] = []
        for rel in rels:
            if isinstance(rel, dict) and (rel.get("type") or "").lower() == "scanlation_group":
                name = ((rel.get("attributes") or {}).get("name") or "").strip()
                if name and name.lower() not in {g.lower() for g in groups}:
                    groups.append(name)
        return ", ".join(groups)

    @staticmethod
    def _extract_available_languages(attrs: dict[str, Any]) -> list[str]:
        langs: list[str] = []
        for raw in attrs.get("availableTranslatedLanguages") or []:
            if isinstance(raw, str):
                code = raw.strip().lower()
                if code and code not in langs:
                    langs.append(code)
        langs.sort(key=lambda code: (0 if code == "vi" else (1 if code == "en" else 2), code))
        return langs

    def _resolve_selected_language(self, preferred: str | None, available: list[str]) -> str:
        if preferred and preferred.strip():
            req = preferred.strip().lower()
            if not available or req in available:
                return req
        if self.language_code in available:
            return self.language_code
        if "vi" in available:
            return "vi"
        if "en" in available:
            return "en"
        return available[0] if available else self.language_code

    @staticmethod
    def _sort_chapters_ascending(chapters: list[dict[str, Any]]) -> list[dict[str, Any]]:
        def _key(ch: dict[str, Any]) -> tuple[int, float, str, str]:
            num = _safe_float(ch.get("chapter_number"))
            return (
                0 if num is not None else 1,
                num if num is not None else 0.0,
                ch.get("published_at") or "9999-12-31T23:59:59+00:00",
                (ch.get("id") or "").lower(),
            )

        return sorted(chapters, key=_key)

    @staticmethod
    def _find_adjacent_chapter_id(
        ordered: list[dict[str, Any]],
        current_index: int,
        step: int,
        current_ch: dict[str, Any],
    ) -> str | None:
        cur_num = _safe_float(current_ch.get("chapter_number"))
        cur_raw = (current_ch.get("chapter_number") or "").strip().lower()
        cur_group = (current_ch.get("scanlation_group") or "").strip().lower()
        target_num: float | None = None
        target_raw: str | None = None
        first_match: dict[str, Any] | None = None

        idx = current_index + step
        while 0 <= idx < len(ordered):
            cand = ordered[idx]
            cand_num = _safe_float(cand.get("chapter_number"))
            cand_raw = (cand.get("chapter_number") or "").strip().lower()
            same_num = (
                (cur_num is not None and cand_num is not None and cand_num == cur_num)
                or (cur_num is None and cand_num is None and cur_raw != "" and cand_raw == cur_raw)
            )
            if same_num:
                idx += step
                continue

            cand_group = (cand.get("scanlation_group") or "").strip().lower()
            if first_match is None:
                first_match = cand
                target_num = cand_num
                target_raw = cand_raw
                if not cur_group or cand_group == cur_group:
                    return cand["id"]
                idx += step
                continue

            matches_target = (
                (target_num is not None and cand_num is not None and cand_num == target_num)
                or (target_num is None and cand_num is None and cand_raw == target_raw)
            )
            if not matches_target:
                break
            if cand_group == cur_group:
                return cand["id"]
            idx += step

        if first_match is not None:
            return first_match["id"]
        fb = current_index + step
        return ordered[fb]["id"] if 0 <= fb < len(ordered) else None

    @staticmethod
    def _build_order_param(sort: str | None) -> tuple[str, str]:
        s = (sort or "").strip().lower()
        if s in ("latest", "newest"):
            return "order[latestUploadedChapter]", "desc"
        if s == "rating":
            return "order[rating]", "desc"
        if s == "title":
            return "order[title]", "asc"
        return "order[followedCount]", "desc"

    @staticmethod
    def _map_status_label(status_val: str) -> str:
        return {
            "ongoing": "Đang tiến hành",
            "completed": "Hoàn thành",
            "hiatus": "Tạm ngưng",
            "cancelled": "Đã hủy",
        }.get(status_val.lower(), status_val)


class WpComicsProvider:
    def __init__(
        self,
        source_id: str,
        display_name: str,
        domain: str,
        description: str,
        include_comic_id_in_chapter_api: bool,
    ) -> None:
        self.source_id = source_id
        self.display_name = display_name
        self.domain = domain.strip().rstrip("/")
        self.description = description
        self.include_comic_id_in_chapter_api = include_comic_id_in_chapter_api

    def _source_info(self, *, is_available: bool = True, status_message: str | None = None) -> dict[str, Any]:
        return {
            "id": self.source_id,
            "display_name": self.display_name,
            "language_badge": "VI",
            "description": self.description,
            "is_available": is_available,
            "status_message": status_message,
            "supports_demographic": False,
            "supports_status": True,
            "supports_sort": True,
        }

    async def get_source_info(self, db: Session) -> dict[str, Any]:
        probe_url = f"https://{self.domain}/tim-truyen?page=1"
        ok = await _probe_html(
            f"wpcomics:health:{self.source_id}",
            probe_url,
            referer=f"https://{self.domain}/",
            validator=lambda html: "tim-truyen" in html.lower() or "truyen-tranh" in html.lower(),
        )
        return self._source_info(
            is_available=ok,
            status_message=None if ok else f"Không thể kết nối {self.display_name} lúc này.",
        )

    async def get_tags(self, db: Session) -> list[dict[str, Any]]:
        try:
            return await _get_or_add_cached(
                f"wpcomics:tags:{self.source_id}",
                900,
                self._load_tags,
            )
        except Exception:
            return []

    async def _load_tags(self) -> list[dict[str, Any]]:
        html = await _http_get_html(f"https://{self.domain}/tim-truyen", referer=f"https://{self.domain}/")
        soup = BeautifulSoup(html, "lxml")
        tags: list[dict[str, Any]] = []
        seen: set[str] = set()
        for opt in soup.select("option"):
            val = str(opt.get("value") or "")
            if "/tim-truyen/" not in val.lower():
                continue
            slug = self._extract_tag_slug(val)
            name = _clean_inline_text(opt.get_text())
            if not slug or not name or slug.lower() in seen:
                continue
            seen.add(slug.lower())
            tags.append({"id": slug, "name": name, "vietnamese_name": name, "group": "genre"})
        return tags

    async def browse(self, query: BrowseQuery, db: Session) -> dict[str, Any]:
        page = max(1, query.page)
        requested_page_size = max(1, query.page_size)
        site_page_size = 36
        available_tags = await self.get_tags(db)
        tag_slug_by_name = {t["name"].lower(): t["id"] for t in available_tags if t.get("name")}
        url = self._build_browse_url(query, page)

        try:
            html = await _get_or_add_cached(
                f"wpcomics:browse:{self.source_id}:{url}",
                120,
                lambda: _http_get_html(url, referer=f"https://{self.domain}/"),
            )
            soup = BeautifulSoup(html, "lxml")
            cards = soup.select("div.items div.item")
            items: list[dict[str, Any]] = []
            seen: set[str] = set()
            for card in cards:
                summary = self._parse_browse_card(card, tag_slug_by_name, use_proxy=query.use_proxy)
                if summary is None or summary["id"].lower() in seen:
                    continue
                seen.add(summary["id"].lower())
                items.append(summary)
                if len(items) >= min(site_page_size, requested_page_size):
                    break

            next_token = f"page={page + 1}"
            has_next = bool(items) and (
                any(next_token in str(a.get("href") or "") for a in soup.select("ul.pagination a[href]"))
                or len(cards) >= 30
            )
            total = 0 if not items else ((page * len(items)) + 1 if has_next else ((page - 1) * site_page_size) + len(items))
            return {
                "source": self._source_info(is_available=True),
                "items": items,
                "available_tags": available_tags,
                "page": page,
                "page_size": len(items) if requested_page_size < site_page_size else site_page_size,
                "total_items": total,
                "has_next_page": has_next,
                "error_message": None,
            }
        except Exception as exc:
            logger.warning("WpComics browse (%s) failed: %s", self.source_id, exc)
            err = f"Không thể kết nối {self.display_name} lúc này."
            return {
                "source": self._source_info(is_available=False, status_message=err),
                "items": [],
                "available_tags": available_tags,
                "page": page,
                "page_size": requested_page_size,
                "total_items": 0,
                "has_next_page": False,
                "error_message": err,
            }

    async def get_manga_detail(
        self, manga_id: str, preferred_language: str | None, db: Session, *, use_proxy: bool = True
    ) -> dict[str, Any]:
        clean_id = self._normalize_manga_id(manga_id)
        if not clean_id:
            return {
                "manga": None,
                "description": "",
                "chapters": [],
                "available_languages": ["vi"],
                "selected_language": "vi",
                "error_message": f"Mã truyện {self.display_name} không hợp lệ.",
            }
        detail_url = f"https://{self.domain}/truyen-tranh/{quote(clean_id, safe='')}"
        try:
            html = await _get_or_add_cached(
                f"wpcomics:detail:{self.source_id}:{clean_id}",
                180,
                lambda: _http_get_html(detail_url, referer=f"https://{self.domain}/"),
            )
            soup = BeautifulSoup(html, "lxml")
            title_node = soup.select_one("h1.title-detail") or soup.select_one("h1")
            title = _clean_inline_text(title_node.get_text() if title_node else "")
            if not title:
                return {
                    "manga": None,
                    "description": "",
                    "chapters": [],
                    "available_languages": ["vi"],
                    "selected_language": "vi",
                    "error_message": f"Không tìm thấy thông tin truyện trên {self.display_name}.",
                }
            alt_node = soup.select_one("h2.other-name")
            alt_title = _clean_inline_text(alt_node.get_text() if alt_node else "")
            if alt_title.lower() == title.lower():
                alt_title = ""

            author_node = soup.select_one("li.author p.col-xs-8") or soup.select_one("li.author a")
            author = _clean_inline_text(author_node.get_text() if author_node else "")
            status_node = soup.select_one("li.status p.col-xs-8")
            st_code, st_label = self._normalize_status(_clean_inline_text(status_node.get_text() if status_node else ""))
            tags = self._parse_detail_tags(soup)
            description = self._extract_description(soup)
            cover_url = self._resolve_cover_url(soup.select_one("div.col-image img"), use_proxy=use_proxy)

            view_count: int | None = None
            follow_count: int | None = None
            for li in soup.select("ul.list-info li"):
                txt = _clean_inline_text(li.get_text())
                if view_count is None and (li.select_one(".fa-eye") is not None or "lượt xem" in txt.lower()):
                    val_node = li.select_one("p.col-xs-8") or (li.select("p")[-1] if li.select("p") else None)
                    view_count = _parse_compact_count(val_node.get_text() if val_node else "")
                if follow_count is None and (li.select_one(".fa-heart") is not None or "theo dõi" in txt.lower()):
                    val_node = li.select_one("p.col-xs-8") or (li.select("p")[-1] if li.select("p") else None)
                    follow_count = _parse_compact_count(val_node.get_text() if val_node else "")

            if follow_count is None:
                f_node = soup.select_one("div.follow .number_follow") or soup.select_one("span.number_follow")
                follow_count = _parse_compact_count(f_node.get_text() if f_node else "")

            rating_node = soup.select_one("span[itemprop='ratingValue']")
            rating = self._parse_double(rating_node.get_text() if rating_node else None)
            if not rating or rating <= 0:
                r_div = soup.select_one("div.rating")
                rating = self._parse_double(str(r_div.get("data-default") or "") if r_div else None)
            if rating is not None and rating <= 0:
                rating = None

            best_node = soup.select_one("span[itemprop='bestRating']")
            best_val = self._parse_double(best_node.get_text() if best_node else None)
            rating_max = int(round(best_val)) if best_val and best_val >= 1 else 5

            rc_node = soup.select_one("span[itemprop='ratingCount']")
            rating_count = _parse_compact_count(rc_node.get_text() if rc_node else "")

            chapters = await self._fetch_chapters(clean_id, html, detail_url, soup)
            summary = _make_summary(
                id=clean_id,
                source_id=self.source_id,
                source_name=self.display_name,
                title=title,
                alt_title=alt_title,
                author=author,
                cover_url=cover_url,
                status=st_code,
                status_label=st_label,
                language="vi",
                rating=rating,
                rating_max=rating_max,
                rating_count=rating_count,
                view_count=view_count,
                follow_count=follow_count,
                tags=tags,
            )
            return {
                "manga": summary,
                "description": description,
                "chapters": chapters,
                "available_languages": ["vi"],
                "selected_language": "vi",
                "error_message": None,
            }
        except Exception as exc:
            logger.warning("WpComics detail (%s) failed: %s", self.source_id, exc)
            return {
                "manga": None,
                "description": "",
                "chapters": [],
                "available_languages": ["vi"],
                "selected_language": "vi",
                "error_message": f"Không thể tải chi tiết truyện từ {self.display_name} lúc này.",
            }

    async def get_chapter_pages(
        self,
        manga_id: str,
        chapter_id: str,
        preferred_language: str | None,
        db: Session,
        *,
        quality: str = "saver",
        use_proxy: bool = True,
    ) -> dict[str, Any]:
        clean_manga = self._normalize_manga_id(manga_id)
        clean_chap = self._normalize_chapter_id(chapter_id)
        if not clean_manga or not clean_chap:
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=manga_id or "",
                manga_title="",
                chapter_id=chapter_id or "",
                chapter_label="",
                error_message=f"Mã truyện hoặc mã chương {self.display_name} không hợp lệ.",
                quality=quality,
                use_proxy=use_proxy,
            )

        path_slug = (
            self._strip_trailing_comic_id(clean_manga)
            if self.include_comic_id_in_chapter_api
            else clean_manga
        )
        escaped_chap = "/".join(quote(seg, safe="") for seg in clean_chap.split("/") if seg)
        chapter_url = f"https://{self.domain}/truyen-tranh/{quote(path_slug, safe='')}/{escaped_chap}"
        referer_url = f"https://{self.domain}/truyen-tranh/{quote(clean_manga, safe='')}"

        try:
            html = await _get_or_add_cached(
                f"wpcomics:chapter:{self.source_id}:{clean_manga}:{clean_chap}",
                300,
                lambda: _http_get_html(chapter_url, referer=referer_url),
            )
            soup = BeautifulSoup(html, "lxml")
            page_urls = self._extract_chapter_page_urls(soup)
            detail = await self.get_manga_detail(clean_manga, preferred_language, db, use_proxy=use_proxy)
            manga_title = (detail.get("manga") or {}).get("title") or ""
            ordered_chapters: list[dict[str, Any]] = []
            chapter_label = ""
            prev_id: str | None = None
            next_id: str | None = None

            raw_chapters = detail.get("chapters") or []
            if raw_chapters:
                ordered_chapters = self._order_chapters_ascending(raw_chapters)
                for i, ch in enumerate(ordered_chapters):
                    if ch["id"].lower() == clean_chap.lower():
                        chapter_label = ch["display_label"]
                        prev_id = ordered_chapters[i - 1]["id"] if i > 0 else None
                        next_id = ordered_chapters[i + 1]["id"] if i + 1 < len(ordered_chapters) else None
                        break

            if not manga_title:
                a_node = soup.select_one("h1.txt-primary a")
                manga_title = _clean_inline_text(a_node.get_text() if a_node else "")
            if not chapter_label:
                sp_node = soup.select_one("h1.txt-primary span")
                sp = _clean_inline_text(sp_node.get_text() if sp_node else "")
                if sp.startswith("-"):
                    sp = sp[1:].strip()
                chapter_label = sp or clean_chap

            if not page_urls:
                return _make_chapter_pages(
                    source_id=self.source_id,
                    manga_id=clean_manga,
                    manga_title=manga_title,
                    chapter_id=clean_chap,
                    chapter_label=chapter_label,
                    prev_chapter_id=prev_id,
                    next_chapter_id=next_id,
                    chapters=ordered_chapters,
                    error_message=f"Chương này hiện chưa có trang ảnh khả dụng trên {self.display_name}.",
                    quality=quality,
                    use_proxy=use_proxy,
                )

            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=clean_manga,
                manga_title=manga_title,
                chapter_id=clean_chap,
                chapter_label=chapter_label,
                original_pages=page_urls,
                data_saver_pages=page_urls,
                prev_chapter_id=prev_id,
                next_chapter_id=next_id,
                chapters=ordered_chapters,
                quality=quality,
                use_proxy=use_proxy,
            )
        except Exception as exc:
            logger.warning("WpComics read (%s) failed: %s", self.source_id, exc)
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=clean_manga,
                manga_title="",
                chapter_id=clean_chap,
                chapter_label="",
                error_message=f"Không thể tải trang chương từ {self.display_name} lúc này.",
                quality=quality,
                use_proxy=use_proxy,
            )

    def _build_browse_url(self, query: BrowseQuery, page: int) -> str:
        if query.keyword and query.keyword.strip():
            return f"https://{self.domain}/tim-truyen?keyword={quote(query.keyword.strip(), safe='')}&page={page}"
        sort_code = {"latest": 0, "newest": 15, "rating": 20}.get((query.sort or "").strip().lower(), 10)
        status_code = {"ongoing": 1, "completed": 2}.get((query.status or "").strip().lower(), -1)
        status_seg = f"&status={status_code}" if status_code > 0 else ""
        raw_tag = (query.tag_id or "").strip().strip("/")
        tag_seg = f"/{quote(raw_tag, safe='')}" if raw_tag else ""
        return f"https://{self.domain}/tim-truyen{tag_seg}?sort={sort_code}{status_seg}&page={page}"

    def _parse_browse_card(
        self, card: BsTag, tag_slug_by_name: dict[str, str], *, use_proxy: bool = True
    ) -> dict[str, Any] | None:
        anchor = (
            card.select_one("div.image a[href]")
            or card.select_one("h3 a[href]")
            or card.select_one("a[href*='/truyen-tranh/']")
        )
        mid = self._extract_manga_id_from_href(str(anchor.get("href") or "") if anchor else "")
        if not mid:
            return None

        title_node = (
            card.select_one("h3 a")
            or card.select_one("figcaption h3 a")
            or card.select_one("a.jtip")
        )
        title = _clean_inline_text(title_node.get_text() if title_node else "")
        img_node = card.select_one("div.image img")
        if not title and img_node:
            alt_txt = _clean_inline_text(str(img_node.get("alt") or ""))
            if alt_txt:
                title = _LEAD_TRUYEN_TRANH_RE.sub("", alt_txt).strip()
        if not title:
            title = mid

        cover_url = self._resolve_cover_url(img_node, use_proxy=use_proxy)
        alt_title = ""
        author = ""
        st_code = ""
        st_label = ""
        view_count: int | None = None
        comment_count: int | None = None
        follow_count: int | None = None
        item_tags: list[dict[str, Any]] = []

        for p_node in card.select("div.message_main p"):
            label_node = p_node.find("label")
            if not label_node:
                continue
            label = _clean_inline_text(label_node.get_text()).rstrip(":").strip().lower()
            value = _clean_inline_text(
                "".join(
                    child.get_text() if isinstance(child, BsTag) else str(child)
                    for child in p_node.children
                    if not (isinstance(child, BsTag) and (child.name or "").lower() == "label")
                )
            )
            if not value:
                continue
            if label.startswith("tên khác") and value.lower() != title.lower():
                alt_title = value
            elif label.startswith("tác giả") and value.lower() != "đang cập nhật":
                author = value
            elif label.startswith("tình trạng"):
                st_code, st_label = self._normalize_status(value)
            elif label.startswith("thể loại"):
                seen_t: set[str] = set()
                for part in value.split(","):
                    tname = part.strip()
                    if not tname or tname.lower() == "đang cập nhật":
                        continue
                    tid = tag_slug_by_name.get(tname.lower(), tname)
                    if tid.lower() not in seen_t:
                        seen_t.add(tid.lower())
                        item_tags.append({"id": tid, "name": tname, "vietnamese_name": tname, "group": "genre"})
            elif label.startswith("lượt xem"):
                view_count = _parse_compact_count(value)
            elif label.startswith("bình luận"):
                comment_count = _parse_compact_count(value)
            elif label.startswith("theo dõi"):
                follow_count = _parse_compact_count(value)

        if view_count is None or comment_count is None or follow_count is None:
            spans = card.select("div.view span.pull-left")
            targets = spans if spans else ([card.select_one("div.view")] if card.select_one("div.view") else [])
            for container in targets:
                v, c, f = _extract_icon_stats(container)
                if view_count is None:
                    view_count = v
                if comment_count is None:
                    comment_count = c
                if follow_count is None:
                    follow_count = f

        return _make_summary(
            id=mid,
            source_id=self.source_id,
            source_name=self.display_name,
            title=title,
            alt_title=alt_title,
            author=author,
            cover_url=cover_url,
            status=st_code,
            status_label=st_label,
            language="vi",
            view_count=view_count,
            follow_count=follow_count,
            comment_count=comment_count,
            tags=item_tags,
        )

    async def _fetch_chapters(
        self, clean_id: str, detail_html: str, detail_url: str, detail_soup: BeautifulSoup
    ) -> list[dict[str, Any]]:
        api_chapters: list[dict[str, Any]] | None = None
        try:
            api_url = self._build_chapter_api_url(clean_id, detail_html)
            if api_url:
                raw_json = await _get_or_add_cached(
                    f"wpcomics:chapters:{self.source_id}:{clean_id}",
                    180,
                    lambda: _http_get_html(api_url, referer=detail_url),
                )
                api_chapters = self._parse_chapters_from_json(clean_id, raw_json)
        except Exception:
            api_chapters = None

        if api_chapters:
            return self._ensure_newest_first(api_chapters)

        html_chapters = self._parse_chapters_from_html(clean_id, detail_soup)
        if html_chapters:
            return self._ensure_newest_first(html_chapters)
        return []

    def _build_chapter_api_url(self, clean_id: str, detail_html: str) -> str | None:
        if not self.include_comic_id_in_chapter_api:
            return f"https://{self.domain}/Comic/Services/ComicService.asmx/ChapterList?slug={quote(clean_id, safe='')}"

        slug = clean_id
        comic_id: str | None = None
        if "-" in clean_id:
            prefix, suffix = clean_id.rsplit("-", 1)
            if prefix and suffix.isdigit():
                slug = prefix
                comic_id = suffix
        if not comic_id:
            m = _COMIC_ID_RE.search(detail_html)
            if m:
                comic_id = m.group(1)
                slug = clean_id
        if not comic_id:
            return None
        return (
            f"https://{self.domain}/Comic/Services/ComicService.asmx/ChapterList"
            f"?slug={quote(slug, safe='')}&comicId={quote(comic_id, safe='')}"
        )

    def _parse_chapters_from_json(self, clean_id: str, raw_json: str) -> list[dict[str, Any]] | None:
        root = json.loads(raw_json)
        data = root.get("data")
        if not isinstance(data, list):
            return None
        chapters: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in data:
            if not isinstance(item, dict):
                continue
            ch_slug = str(item.get("chapter_slug") or "").strip().strip("/")
            if not ch_slug:
                continue
            ch_id_tok = str(item.get("chapter_id") or "").strip().strip("/")
            cid = f"{ch_slug}/{ch_id_tok}" if (self.include_comic_id_in_chapter_api and ch_id_tok) else ch_slug
            if cid.lower() in seen:
                continue
            seen.add(cid.lower())
            ch_name = _clean_inline_text(str(item.get("chapter_name") or ""))
            ch_num = str(item.get("chapter_num") or "").strip()
            upd = str(item.get("updated_at") or "").strip()
            page_cnt = max(0, _safe_int(item.get("image_num")) or 0)
            label = ch_name or (f"Chapter {ch_num}" if ch_num else "Chapter")
            chapters.append(
                _make_chapter(
                    id=cid,
                    source_id=self.source_id,
                    manga_id=clean_id,
                    chapter_number=ch_num,
                    title=ch_name,
                    display_label=label,
                    language="vi",
                    page_count=page_cnt,
                    published_at=_parse_iso_datetime(upd),
                )
            )
        return chapters

    def _parse_chapters_from_html(self, clean_id: str, soup: BeautifulSoup) -> list[dict[str, Any]]:
        chapters: list[dict[str, Any]] = []
        seen: set[str] = set()
        for li in soup.select("div.list-chapter li"):
            if "heading" in [c.lower() for c in (li.get("class") or [])]:
                continue
            link = li.select_one("a[href]")
            if not link:
                continue
            cid = self._extract_chapter_id_from_href(str(link.get("href") or ""))
            if not cid or cid.lower() in seen:
                continue
            seen.add(cid.lower())
            label = _clean_inline_text(link.get_text()) or cid
            m = _CHAPTER_NUM_RE.search(label) or _CHAPTER_NUM_RE.search(cid)
            ch_num = m.group(1) if m else ""
            chapters.append(
                _make_chapter(
                    id=cid,
                    source_id=self.source_id,
                    manga_id=clean_id,
                    chapter_number=ch_num,
                    title=label,
                    display_label=label,
                    language="vi",
                )
            )
        return chapters

    def _parse_detail_tags(self, soup: BeautifulSoup) -> list[dict[str, Any]]:
        nodes = soup.select("li.kind p.col-xs-8 a") or soup.select("li.kind a")
        tags: list[dict[str, Any]] = []
        seen: set[str] = set()
        for node in nodes:
            name = _clean_inline_text(node.get_text())
            if not name:
                continue
            slug = self._extract_tag_slug(str(node.get("href") or ""))
            tid = slug or name
            if tid.lower() not in seen:
                seen.add(tid.lower())
                tags.append({"id": tid, "name": name, "vietnamese_name": name, "group": "genre"})
        return tags

    def _resolve_cover_url(self, img_node: BsTag | None, *, use_proxy: bool = True) -> str:
        raw = self._extract_valid_image_url(img_node, ("data-original", "data-src", "data-retries", "src"))
        if not raw:
            return DEFAULT_COVER_URL
        register_image_host(raw, self.source_id)
        return resolve_display_image_url(raw, self.source_id, use_proxy=use_proxy)

    def _extract_chapter_page_urls(self, soup: BeautifulSoup) -> list[str]:
        pages: list[str] = []
        for img in soup.select("div.page-chapter img"):
            url = self._extract_valid_image_url(img, ("data-sv1", "data-original", "data-src", "data-sv2", "src"))
            if url:
                register_image_host(url, self.source_id)
                pages.append(url)
        return pages

    def _extract_valid_image_url(self, img_node: BsTag | None, attrs: tuple[str, ...]) -> str | None:
        if img_node is None:
            return None
        for attr in attrs:
            raw = img_node.get(attr)
            if isinstance(raw, list):
                raw = raw[0] if raw else ""
            norm = self._normalize_image_candidate(str(raw or ""))
            if norm:
                return norm
        return None

    def _normalize_image_candidate(self, raw: str | None) -> str | None:
        if not raw:
            return None
        trimmed = unescape(raw).strip()
        lower = trimmed.lower()
        if (
            not trimmed
            or lower.startswith("data:")
            or "thumb-default" in lower
            or "loading.gif" in lower
        ):
            return None
        if trimmed.startswith("//"):
            trimmed = "https:" + trimmed
        elif trimmed.startswith("/"):
            trimmed = f"https://{self.domain}{trimmed}"
        else:
            trimmed = _upgrade_http_to_https_if_default_port(trimmed)
        try:
            parsed = urlsplit(trimmed)
            if (parsed.scheme or "").lower() in ("http", "https") and parsed.netloc:
                return trimmed
        except ValueError:
            pass
        return None

    @staticmethod
    def _extract_description(soup: BeautifulSoup) -> str:
        shortened = soup.select_one("div.detail-content div.shortened")
        if shortened is not None:
            return _extract_readable_html_text(shortened)
        detail = soup.select_one("div.detail-content")
        if detail is None:
            return ""
        chunks: list[str] = []
        for child in detail.children:
            if isinstance(child, BsTag) and (child.name or "").lower() == "h2":
                if "list-title" in [c.lower() for c in (child.get("class") or [])]:
                    continue
            if isinstance(child, BsTag):
                chunks.append(_extract_readable_html_text(child))
            elif isinstance(child, NavigableString):
                chunks.append(str(child))
        return _clean_multiline_text("\n".join(chunks))

    @staticmethod
    def _is_ascending(chapters: list[dict[str, Any]]) -> bool | None:
        first_num = next((_safe_float(ch["chapter_number"]) for ch in chapters if _safe_float(ch["chapter_number"]) is not None), None)
        last_num = next((_safe_float(ch["chapter_number"]) for ch in reversed(chapters) if _safe_float(ch["chapter_number"]) is not None), None)
        if first_num is None or last_num is None or first_num == last_num:
            return None
        return first_num < last_num

    @classmethod
    def _ensure_newest_first(cls, chapters: list[dict[str, Any]]) -> list[dict[str, Any]]:
        res = list(chapters)
        if len(res) > 1 and cls._is_ascending(res) is True:
            res.reverse()
        return res

    @classmethod
    def _order_chapters_ascending(cls, chapters: list[dict[str, Any]]) -> list[dict[str, Any]]:
        res = list(chapters)
        if len(res) > 1 and cls._is_ascending(res) is not True:
            res.reverse()
        return res

    @staticmethod
    def _normalize_manga_id(raw_id: str | None) -> str:
        if not raw_id or not raw_id.strip():
            return ""
        cleaned = _strip_query_and_fragment(raw_id.strip()).strip("/")
        lower = cleaned.lower()
        marker = "/truyen-tranh/"
        if marker in lower:
            cleaned = cleaned[lower.index(marker) + len(marker) :].strip("/")
        elif lower.startswith("truyen-tranh/"):
            cleaned = cleaned[len("truyen-tranh/") :].strip("/")
        if not cleaned or ".." in cleaned or "/" in cleaned or "\\" in cleaned:
            return ""
        return cleaned

    @staticmethod
    def _normalize_chapter_id(raw_id: str | None) -> str:
        if not raw_id or not raw_id.strip():
            return ""
        cleaned = _strip_query_and_fragment(raw_id.strip()).strip("/")
        if not cleaned or ".." in cleaned or "\\" in cleaned:
            return ""
        return cleaned

    @staticmethod
    def _strip_trailing_comic_id(clean_id: str) -> str:
        stripped = _TRAILING_COMIC_ID_RE.sub("", clean_id)
        return stripped or clean_id

    @classmethod
    def _extract_path_remainder(cls, href: str | None) -> str:
        if not href or not href.strip():
            return ""
        cleaned = _strip_query_and_fragment(unescape(href)).rstrip("/")
        lower = cleaned.lower()
        marker = "/truyen-tranh/"
        if marker not in lower:
            return ""
        return cleaned[lower.index(marker) + len(marker) :].strip("/")

    @classmethod
    def _extract_manga_id_from_href(cls, href: str | None) -> str:
        rem = cls._extract_path_remainder(href)
        if not rem:
            return ""
        return rem.split("/", 1)[0].strip()

    @classmethod
    def _extract_chapter_id_from_href(cls, href: str | None) -> str:
        rem = cls._extract_path_remainder(href)
        if "/" not in rem:
            return ""
        return rem.split("/", 1)[1].strip("/")

    @staticmethod
    def _extract_tag_slug(raw_val: str | None) -> str:
        if not raw_val or not raw_val.strip():
            return ""
        cleaned = _strip_query_and_fragment(unescape(raw_val)).rstrip("/")
        if "/tim-truyen/" not in cleaned.lower():
            return ""
        slug = cleaned.rsplit("/", 1)[-1].strip()
        return "" if slug.lower() == "tim-truyen" else slug

    @staticmethod
    def _normalize_status(raw: str) -> tuple[str, str]:
        if not raw or not raw.strip():
            return "", ""
        t = raw.strip()
        lower = t.lower()
        if lower == "ongoing" or any(k in lower for k in ("đang", "tiến hành", "cập nhật")):
            return "ongoing", "Đang cập nhật"
        if lower in ("completed", "full") or "hoàn thành" in lower:
            return "completed", "Hoàn thành"
        return t, t

    @staticmethod
    def _parse_double(raw: str | None) -> float | None:
        if not raw:
            return None
        return _safe_float(_clean_inline_text(raw).replace(",", "."))


class TruyenQqProvider:
    BASE_DOMAIN = "https://truyenqqko.com"
    DISPLAY_NAME = "TruyenQQ"
    ADV_SEARCH_URL = BASE_DOMAIN + "/tim-kiem-nang-cao"
    SEARCH_URL = BASE_DOMAIN + "/frontend/search/search"
    DEMOGRAPHIC_GENRE_IDS: dict[str, str] = {
        "shounen": "31",
        "seinen": "42",
        "shoujo": "38",
        "josei": "54",
    }

    def __init__(self) -> None:
        self.source_id = "truyenqq"

    def _source_info(self, *, is_available: bool = True, status_message: str | None = None) -> dict[str, Any]:
        return {
            "id": self.source_id,
            "display_name": self.DISPLAY_NAME,
            "language_badge": "VI",
            "description": "Kho truyện tranh tiếng Việt đa dạng từ TruyenQQ.",
            "is_available": is_available,
            "status_message": status_message,
            "supports_demographic": True,
            "supports_status": True,
            "supports_sort": True,
        }

    async def get_source_info(self, db: Session) -> dict[str, Any]:
        ok = await _probe_html(
            "truyenqq:probe",
            self.ADV_SEARCH_URL,
            referer=self.BASE_DOMAIN + "/",
        )
        return self._source_info(
            is_available=ok,
            status_message=None if ok else "Không thể kết nối TruyenQQ lúc này. Vui lòng thử lại sau.",
        )

    async def get_tags(self, db: Session) -> list[dict[str, Any]]:
        try:
            tags = await _get_or_add_cached("truyenqq:tags", 900, self._load_tags)
            return tags or []
        except Exception:
            return []

    async def _load_tags(self) -> list[dict[str, Any]] | None:
        html = await _http_get_html(self.ADV_SEARCH_URL, referer=self.BASE_DOMAIN + "/")
        soup = BeautifulSoup(html, "lxml")
        nodes = soup.select("div.advsearch-form div.genre-item") or soup.select("div.genre-item")
        tags: list[dict[str, Any]] = []
        seen: set[str] = set()
        for node in nodes:
            sp = node.select_one("span[data-id]")
            tid = _clean_inline_text(str(sp.get("data-id") or "") if sp else "")
            name = _clean_inline_text(node.get_text())
            if not tid or not name or tid.lower() in seen:
                continue
            seen.add(tid.lower())
            tags.append({"id": tid, "name": name, "vietnamese_name": name, "group": "genre"})
        return tags if tags else None

    async def browse(self, query: BrowseQuery, db: Session) -> dict[str, Any]:
        page = max(1, query.page)
        page_size = max(1, query.page_size)
        available_tags = await self.get_tags(db)
        try:
            if query.keyword and query.keyword.strip():
                return await self._search_by_keyword(query.keyword.strip(), page, page_size, available_tags, use_proxy=query.use_proxy)
            return await self._browse_filtered(query, page, page_size, available_tags)
        except Exception as exc:
            logger.warning("TruyenQQ browse failed: %s", exc)
            err = "Không thể kết nối TruyenQQ lúc này. Vui lòng thử lại sau."
            return {
                "source": self._source_info(is_available=False, status_message=err),
                "items": [],
                "available_tags": available_tags,
                "page": page,
                "page_size": page_size,
                "total_items": 0,
                "has_next_page": False,
                "error_message": err,
            }

    async def _search_by_keyword(
        self,
        keyword: str,
        page: int,
        page_size: int,
        available_tags: list[dict[str, Any]],
        *,
        use_proxy: bool = True,
    ) -> dict[str, Any]:
        if page > 1:
            return {
                "source": self._source_info(is_available=True),
                "items": [],
                "available_tags": available_tags,
                "page": page,
                "page_size": page_size,
                "total_items": 0,
                "has_next_page": False,
                "error_message": None,
            }
        html = await _get_or_add_cached(
            f"truyenqq:search:{keyword.lower()}",
            120,
            lambda: _http_post_form(
                self.SEARCH_URL,
                {"search": keyword, "type": "0"},
                referer=self.BASE_DOMAIN + "/",
                is_ajax=True,
            ),
        )
        soup = BeautifulSoup(html, "lxml")
        items: list[dict[str, Any]] = []
        for li in soup.select("li"):
            if li.select_one("div.no_result") is not None:
                continue
            anchor = li.select_one("a[href]")
            if not anchor:
                continue
            mid = self._extract_slug_after_truyen_tranh(str(anchor.get("href") or ""))
            if not mid:
                continue
            name_node = next(
                (p for p in li.select("p.name") if "name_other" not in [c.lower() for c in (p.get("class") or [])]),
                None,
            )
            title = _clean_inline_text(name_node.get_text() if name_node else "")
            if not title:
                continue
            alt_node = li.select_one("p.name_other")
            alt_title = _clean_inline_text(alt_node.get_text() if alt_node else "")
            if alt_title.lower() == title.lower():
                alt_title = ""
            cover_url = self._resolve_cover_url(
                li.select_one("div.search_avatar img"), ("src", "data-fb"), use_proxy=use_proxy
            )
            items.append(
                _make_summary(
                    id=mid,
                    source_id=self.source_id,
                    source_name=self.DISPLAY_NAME,
                    title=title,
                    alt_title=alt_title,
                    cover_url=cover_url,
                    language="vi",
                )
            )
            if len(items) >= page_size:
                break
        return {
            "source": self._source_info(is_available=True),
            "items": items,
            "available_tags": available_tags,
            "page": page,
            "page_size": page_size,
            "total_items": len(items),
            "has_next_page": False,
            "error_message": None,
        }

    async def _browse_filtered(
        self, query: BrowseQuery, page: int, page_size: int, available_tags: list[dict[str, Any]]
    ) -> dict[str, Any]:
        sort_code = {"newest": "0", "latest": "2", "rating": "1"}.get((query.sort or "").strip().lower(), "4")
        status_code = {"ongoing": "0", "hiatus": "1", "completed": "2"}.get((query.status or "").strip().lower(), "-1")
        category = self._resolve_category_filter(query.tag_id, query.demographic, available_tags)
        use_fav = (query.sort or "").strip().lower() == "rating" and not category
        if use_fav:
            url = (
                f"{self.BASE_DOMAIN}/truyen-yeu-thich/trang-{page}"
                if status_code == "-1"
                else f"{self.BASE_DOMAIN}/truyen-yeu-thich/trang-{page}?status={status_code}"
            )
        else:
            url = (
                f"{self.BASE_DOMAIN}/tim-kiem-nang-cao/trang-{page}"
                f"?country=0&sort={sort_code}&status={status_code}&category={quote(category, safe='')}&notcategory=&minchapter=0"
            )

        html = await _get_or_add_cached(
            f"truyenqq:browse:{url}",
            120,
            lambda: _http_get_html(url, referer=self.BASE_DOMAIN + "/"),
        )
        soup = BeautifulSoup(html, "lxml")
        nodes = soup.select("#main_homepage ul.list_grid li") or soup.select("#main_homepage li")
        tag_by_name = {t["name"].lower(): t for t in available_tags if t.get("name")}
        items: list[dict[str, Any]] = []

        for node in nodes:
            anchor = node.select_one("div.book_avatar a[href]") or node.select_one("a[href]")
            mid = self._extract_slug_after_truyen_tranh(str(anchor.get("href") or "") if anchor else "")
            if not mid:
                continue
            img_node = node.select_one("div.book_avatar img")
            bname = node.select_one("div.book_name a")
            title = _clean_inline_text(bname.get_text() if bname else "")
            if not title and img_node:
                title = _clean_inline_text(str(img_node.get("alt") or ""))
            if not title:
                continue
            cover_url = self._resolve_cover_url(img_node, ("data-original", "src", "data-fb"), use_proxy=query.use_proxy)
            alt_node = node.select_one("div.title-more-other")
            raw_alt = _clean_inline_text(alt_node.get_text() if alt_node else "")
            alt_title = raw_alt[len("Tên khác:") :].strip() if raw_alt.lower().startswith("tên khác:") else raw_alt

            st_code = ""
            st_label = ""
            view_count: int | None = None
            follow_count: int | None = None
            for p_info in node.select("div.more-info p.info"):
                txt = _clean_inline_text(p_info.get_text())
                lower_txt = txt.lower()
                if lower_txt.startswith("tình trạng:"):
                    st_code, st_label = self._map_status(txt[len("tình trạng:") :].strip())
                elif lower_txt.startswith("lượt xem:"):
                    view_count = _parse_compact_count(txt[len("lượt xem:") :])
                elif lower_txt.startswith("lượt theo dõi:"):
                    follow_count = _parse_compact_count(txt[len("lượt theo dõi:") :])

            if view_count is None or follow_count is None:
                v, _, f = _extract_icon_stats(node.select_one("div.text_detail"))
                if view_count is None:
                    view_count = v
                if follow_count is None:
                    follow_count = f

            card_tags: list[dict[str, Any]] = []
            for p_tag in node.select("div.more-info div.list-tags p"):
                tname = _clean_inline_text(p_tag.get_text())
                if tname:
                    card_tags.append(
                        tag_by_name.get(tname.lower())
                        or {"id": tname, "name": tname, "vietnamese_name": tname, "group": "genre"}
                    )

            items.append(
                _make_summary(
                    id=mid,
                    source_id=self.source_id,
                    source_name=self.DISPLAY_NAME,
                    title=title,
                    alt_title=alt_title,
                    cover_url=cover_url,
                    status=st_code,
                    status_label=st_label,
                    language="vi",
                    view_count=view_count,
                    follow_count=follow_count,
                    tags=card_tags,
                )
            )
            if len(items) >= page_size:
                break

        next_token = f"trang-{page + 1}"
        links = soup.select("div.page_redirect a[href]") or soup.select("a[href]")
        has_next = bool(items) and (
            any(next_token in str(a.get("href") or "").lower() for a in links) or len(nodes) >= 36
        )
        return {
            "source": self._source_info(is_available=True),
            "items": items,
            "available_tags": available_tags,
            "page": page,
            "page_size": page_size,
            "total_items": len(items),
            "has_next_page": has_next,
            "error_message": None,
        }

    async def get_manga_detail(
        self, manga_id: str, preferred_language: str | None, db: Session, *, use_proxy: bool = True
    ) -> dict[str, Any]:
        clean_id = self._clean_slug(manga_id)
        if not clean_id:
            return {
                "manga": None,
                "description": "",
                "chapters": [],
                "available_languages": ["vi"],
                "selected_language": "vi",
                "error_message": "Mã truyện TruyenQQ không hợp lệ.",
            }
        try:
            detail_url = f"{self.BASE_DOMAIN}/truyen-tranh/{clean_id}"
            html = await _get_or_add_cached(
                f"truyenqq:detail:{clean_id}",
                180,
                lambda: _http_get_html(detail_url, referer=self.BASE_DOMAIN + "/"),
            )
            soup = BeautifulSoup(html, "lxml")
            h1 = soup.select_one("h1")
            title = _clean_inline_text(h1.get_text() if h1 else "")
            if not title:
                return {
                    "manga": None,
                    "description": "",
                    "chapters": [],
                    "available_languages": ["vi"],
                    "selected_language": "vi",
                    "error_message": "Không tìm thấy thông tin truyện trên TruyenQQ.",
                }

            alt_node = (
                soup.select_one("h2.other-name")
                or soup.select_one("li.othername p.other-name")
                or soup.select_one("li.othername p.col-xs-9")
            )
            alt_title = _clean_inline_text(alt_node.get_text() if alt_node else "")
            if alt_title.lower() == title.lower():
                alt_title = ""

            author_links = soup.select("li.author a")
            if author_links:
                seen_a: list[str] = []
                for lnk in author_links:
                    aname = _clean_inline_text(lnk.get_text())
                    if aname and aname.lower() not in {x.lower() for x in seen_a}:
                        seen_a.append(aname)
                author = ", ".join(seen_a)
            else:
                ap = soup.select_one("li.author p.col-xs-9")
                author = _clean_inline_text(ap.get_text() if ap else "")

            st_node = soup.select_one("li.status p.col-xs-9") or (
                soup.select("li.status p")[-1] if soup.select("li.status p") else None
            )
            st_code, st_label = self._map_status(_clean_inline_text(st_node.get_text() if st_node else ""))
            tags = self._extract_detail_tags(soup)
            desc_node = soup.select_one("div.story-detail-info")
            description = _clean_multiline_text(desc_node.get_text("\n") if desc_node else "")
            cover_url = self._resolve_cover_url(
                soup.select_one("div.book_avatar img"), ("src", "data-fb", "data-original"), use_proxy=use_proxy
            )
            chapters = self._extract_chapters(soup, clean_id)

            view_count: int | None = None
            follow_count: int | None = None
            for row in soup.select("ul.list-info li"):
                rtext = _clean_inline_text(row.get_text())
                is_views = row.select_one(".fa-eye") is not None or "lượt xem" in rtext.lower()
                is_follows = row.select_one(".fa-heart") is not None or "lượt theo dõi" in rtext.lower()
                if not is_views and not is_follows:
                    continue
                val_node = (
                    row.select_one("p.col-xs-9")
                    or row.select_one("p.col-xs-8")
                    or (row.select("p")[-1] if row.select("p") else row)
                )
                cnt = _parse_compact_count(val_node.get_text() if val_node else "")
                if cnt is not None:
                    if is_views and view_count is None:
                        view_count = cnt
                    if is_follows and follow_count is None:
                        follow_count = cnt

            summary = _make_summary(
                id=clean_id,
                source_id=self.source_id,
                source_name=self.DISPLAY_NAME,
                title=title,
                alt_title=alt_title,
                author=author,
                cover_url=cover_url,
                status=st_code,
                status_label=st_label,
                language="vi",
                view_count=view_count,
                follow_count=follow_count,
                tags=tags,
            )
            return {
                "manga": summary,
                "description": description,
                "chapters": chapters,
                "available_languages": ["vi"],
                "selected_language": "vi",
                "error_message": None,
            }
        except Exception as exc:
            logger.warning("TruyenQQ detail failed: %s", exc)
            return {
                "manga": None,
                "description": "",
                "chapters": [],
                "available_languages": ["vi"],
                "selected_language": "vi",
                "error_message": "Không thể tải chi tiết truyện từ TruyenQQ lúc này.",
            }

    async def get_chapter_pages(
        self,
        manga_id: str,
        chapter_id: str,
        preferred_language: str | None,
        db: Session,
        *,
        quality: str = "saver",
        use_proxy: bool = True,
    ) -> dict[str, Any]:
        clean_chap = self._clean_slug(chapter_id)
        clean_manga = self._clean_slug(manga_id)
        if not clean_chap or (manga_id and manga_id.strip() and not clean_manga):
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=manga_id or "",
                manga_title="",
                chapter_id=chapter_id or "",
                chapter_label="",
                error_message="Mã truyện hoặc mã chương TruyenQQ không hợp lệ.",
                quality=quality,
                use_proxy=use_proxy,
            )
        if not clean_manga and "-chap-" in clean_chap.lower():
            clean_manga = clean_chap[: clean_chap.lower().index("-chap-")]

        try:
            chapter_url = f"{self.BASE_DOMAIN}/truyen-tranh/{clean_chap}"
            referer = f"{self.BASE_DOMAIN}/truyen-tranh/{clean_manga}" if clean_manga else self.BASE_DOMAIN + "/"
            html = await _get_or_add_cached(
                f"truyenqq:chapter:{clean_chap}",
                300,
                lambda: _http_get_html(chapter_url, referer=referer),
            )
            soup = BeautifulSoup(html, "lxml")
            pages: list[str] = []
            for img in soup.select("div.page-chapter img"):
                img_url = self._extract_usable_image_url(img, ("data-original", "data-cdn", "src"))
                if img_url:
                    register_image_host(img_url, self.source_id)
                    pages.append(img_url)

            if not pages:
                return _make_chapter_pages(
                    source_id=self.source_id,
                    manga_id=clean_manga,
                    manga_title="",
                    chapter_id=clean_chap,
                    chapter_label="",
                    error_message="Không tìm thấy trang ảnh nào cho chương này trên TruyenQQ.",
                    quality=quality,
                    use_proxy=use_proxy,
                )

            manga_title = ""
            chapter_label = ""
            asc_chapters: list[dict[str, Any]] = []
            if clean_manga:
                detail = await self.get_manga_detail(clean_manga, preferred_language, db, use_proxy=use_proxy)
                manga_title = (detail.get("manga") or {}).get("title") or ""
                if detail.get("chapters"):
                    asc_chapters = list(reversed(detail["chapters"]))

            idx = -1
            for i, ch in enumerate(asc_chapters):
                if ch["id"].lower() == clean_chap.lower():
                    idx = i
                    chapter_label = ch["display_label"]
                    break

            if not chapter_label:
                h1 = soup.select_one("h1")
                chapter_label = _clean_inline_text(h1.get_text() if h1 else "") or clean_chap

            prev_id = asc_chapters[idx - 1]["id"] if idx > 0 else None
            next_id = asc_chapters[idx + 1]["id"] if 0 <= idx < len(asc_chapters) - 1 else None
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=clean_manga,
                manga_title=manga_title,
                chapter_id=clean_chap,
                chapter_label=chapter_label,
                original_pages=pages,
                data_saver_pages=pages,
                prev_chapter_id=prev_id,
                next_chapter_id=next_id,
                chapters=asc_chapters,
                quality=quality,
                use_proxy=use_proxy,
            )
        except Exception as exc:
            logger.warning("TruyenQQ read failed: %s", exc)
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=clean_manga,
                manga_title="",
                chapter_id=clean_chap,
                chapter_label="",
                error_message="Không thể tải trang truyện từ TruyenQQ lúc này.",
                quality=quality,
                use_proxy=use_proxy,
            )

    def _resolve_cover_url(
        self, img_node: BsTag | None, attrs: tuple[str, ...], *, use_proxy: bool = True
    ) -> str:
        if img_node is None:
            return DEFAULT_COVER_URL
        raw = self._extract_usable_image_url(img_node, attrs)
        return resolve_display_image_url(raw, self.source_id, use_proxy=use_proxy) if raw else DEFAULT_COVER_URL

    def _extract_usable_image_url(self, img_node: BsTag, attrs: tuple[str, ...]) -> str:
        for attr in attrs:
            val = img_node.get(attr)
            if isinstance(val, list):
                val = val[0] if val else ""
            raw = unescape(str(val or "")).strip()
            if not self._is_usable_image_url(raw):
                continue
            norm = self._normalize_absolute_url(raw)
            try:
                parsed = urlsplit(norm)
                if (parsed.scheme or "").lower() in ("http", "https") and parsed.netloc:
                    return norm
            except ValueError:
                pass
        return ""

    @staticmethod
    def _is_usable_image_url(raw: str) -> bool:
        if not raw or not raw.strip():
            return False
        lower = raw.strip().lower()
        if lower.startswith("data:"):
            return False
        return not any(
            bad in lower
            for bad in ("no_image", "no-image", "thumb-default", "/loading", "loading.", "blank.gif", "spacer.gif")
        )

    def _normalize_absolute_url(self, raw: str) -> str:
        trimmed = raw.strip()
        if trimmed.startswith("//"):
            return "https:" + trimmed
        if trimmed.lower().startswith(("http://", "https://")):
            return _upgrade_http_to_https_if_default_port(trimmed)
        if trimmed.startswith("/"):
            return self.BASE_DOMAIN + trimmed
        return f"{self.BASE_DOMAIN}/{trimmed}"

    @classmethod
    def _extract_slug_after_truyen_tranh(cls, href: str | None) -> str:
        if not href or not href.strip():
            return ""
        path = _strip_query_and_fragment(unescape(href))
        lower = path.lower()
        marker = "/truyen-tranh/"
        if marker not in lower:
            return ""
        slug = path[lower.index(marker) + len(marker) :].strip("/")
        return slug if cls._is_safe_slug(slug) else ""

    @classmethod
    def _clean_slug(cls, raw: str | None) -> str:
        if not raw or not raw.strip():
            return ""
        cleaned = _strip_query_and_fragment(raw.strip())
        lower = cleaned.lower()
        marker = "/truyen-tranh/"
        if marker in lower:
            cleaned = cleaned[lower.index(marker) + len(marker) :]
        cleaned = cleaned.strip("/")
        return cleaned if cls._is_safe_slug(cleaned) else ""

    @staticmethod
    def _is_safe_slug(slug: str) -> bool:
        return bool(slug and slug.strip()) and ".." not in slug and "/" not in slug and "\\" not in slug

    @classmethod
    def _resolve_category_filter(
        cls, raw_tag_id: str | None, raw_demo: str | None, available_tags: list[dict[str, Any]]
    ) -> str:
        ids: list[str] = []
        if raw_tag_id and raw_tag_id.strip():
            t = raw_tag_id.strip()
            if _TRUYENQQ_NUMERIC_CAT_RE.match(t):
                for part in t.split(","):
                    p = part.strip()
                    if p and p not in ids:
                        ids.append(p)
            elif not _is_valid_uuid(t):
                for tag in available_tags:
                    if t.lower() in (tag["name"].lower(), tag["vietnamese_name"].lower()):
                        if tag["id"] not in ids:
                            ids.append(tag["id"])
                        break
        if raw_demo and raw_demo.strip():
            demo_id = cls.DEMOGRAPHIC_GENRE_IDS.get(raw_demo.strip().lower())
            if demo_id and demo_id not in ids:
                ids.append(demo_id)
        return ",".join(ids)

    @staticmethod
    def _map_status(raw: str) -> tuple[str, str]:
        if not raw or not raw.strip():
            return "", ""
        lower = raw.strip().lower()
        if any(k in lower for k in ("đang cập nhật", "đang ra", "đang tiến hành")):
            return "ongoing", "Đang cập nhật"
        if "hoàn thành" in lower:
            return "completed", "Hoàn thành"
        if "tạm ngưng" in lower or "tạm dừng" in lower:
            return "hiatus", "Tạm ngưng"
        return lower, raw.strip()

    @staticmethod
    def _extract_detail_tags(soup: BeautifulSoup) -> list[dict[str, Any]]:
        tags: list[dict[str, Any]] = []
        seen: set[str] = set()
        for link in soup.select("ul.list01 li a"):
            name = _clean_inline_text(link.get_text())
            if not name:
                continue
            href = str(link.get("href") or "")
            seg = _strip_query_and_fragment(href).rstrip("/").rsplit("/", 1)[-1]
            m = _TRUYENQQ_TAG_SUFFIX_RE.search(seg)
            tid = m.group(1) if m else name
            if tid.lower() not in seen:
                seen.add(tid.lower())
                tags.append({"id": tid, "name": name, "vietnamese_name": name, "group": "genre"})
        return tags

    def _extract_chapters(self, soup: BeautifulSoup, clean_id: str) -> list[dict[str, Any]]:
        chapters: list[dict[str, Any]] = []
        seen: set[str] = set()
        for node in soup.select("div.list_chapter div.works-chapter-item"):
            anchor = node.select_one("a[href]")
            cid = self._extract_slug_after_truyen_tranh(str(anchor.get("href") or "") if anchor else "")
            if not cid or cid.lower() in seen:
                continue
            seen.add(cid.lower())
            label = _clean_inline_text(anchor.get_text() if anchor else "") or cid
            m = _CHAPTER_NUM_RE.search(label)
            if m:
                ch_num = m.group(1)
            else:
                sm = _TRUYENQQ_SLUG_CHAP_RE.search(cid)
                ch_num = sm.group(1).replace("-", ".") if sm else ""
            time_node = node.select_one("div.time-chap")
            time_raw = _clean_inline_text(time_node.get_text() if time_node else "")
            pub_iso: str | None = None
            for fmt in ("%d/%m/%Y", "%d/%m/%Y %H:%M"):
                if time_raw:
                    try:
                        pub_iso = _iso_utc(datetime.strptime(time_raw, fmt))
                        break
                    except ValueError:
                        continue
            chapters.append(
                _make_chapter(
                    id=cid,
                    source_id=self.source_id,
                    manga_id=clean_id,
                    chapter_number=ch_num,
                    title="",
                    display_label=label,
                    language="vi",
                    scanlation_group=self.DISPLAY_NAME,
                    published_at=pub_iso,
                )
            )
        return chapters


class InternetArchiveProvider:
    BASE_URL = "https://archive.org"
    BASE_QUERY = "subject:(manga) AND mediatype:(texts) AND NOT access-restricted-item:true"

    def __init__(self) -> None:
        self.source_id = "archive-manga"

    def _source_info(self, *, is_available: bool = True, status_message: str | None = None) -> dict[str, Any]:
        return {
            "id": self.source_id,
            "display_name": "Kho Lưu Trữ Manga Mở",
            "language_badge": "EN / JP",
            "description": "Kho lưu trữ manga cộng đồng miễn phí.",
            "is_available": is_available,
            "status_message": status_message,
            "supports_demographic": False,
            "supports_status": False,
            "supports_sort": True,
        }

    async def get_source_info(self, db: Session) -> dict[str, Any]:
        return self._source_info(is_available=True)

    async def get_tags(self, db: Session) -> list[dict[str, Any]]:
        url = (
            f"{self.BASE_URL}/advancedsearch.php?q={quote(self.BASE_QUERY, safe='')}"
            "&fl[]=subject&sort[]=downloads+desc&rows=50&page=1&output=json"
        )
        raw = await _get_or_add_cached("archive:tags:top", 900, lambda: _http_get_text(url))
        docs = (json.loads(raw).get("response") or {}).get("docs") or []
        counts: dict[str, int] = {}
        canonical: dict[str, str] = {}
        for doc in docs:
            if not isinstance(doc, dict):
                continue
            for subj in self._read_string_list(doc.get("subject")):
                if 2 <= len(subj) <= 40:
                    key = subj.lower()
                    canonical.setdefault(key, subj)
                    counts[key] = counts.get(key, 0) + 1
        ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:30]
        return [
            {
                "id": canonical[k],
                "name": canonical[k],
                "vietnamese_name": canonical[k],
                "group": "subject",
            }
            for k, _ in ranked
        ]

    async def browse(self, query: BrowseQuery, db: Session) -> dict[str, Any]:
        page = max(1, query.page)
        page_size = min(max(1, query.page_size), 50)
        available_tags: list[dict[str, Any]] = []
        try:
            available_tags = await self.get_tags(db)
        except Exception:
            available_tags = []

        q_parts = [self.BASE_QUERY]
        if query.keyword and query.keyword.strip():
            safe_kw = self._sanitize_solr(query.keyword)
            if safe_kw:
                clause = f'"{safe_kw}"' if " " in safe_kw else safe_kw
                q_parts.append(f"AND (title:({clause}) OR creator:({clause}))")
        if query.tag_id and query.tag_id.strip():
            safe_tag = self._sanitize_solr(query.tag_id)
            if safe_tag:
                q_parts.append(f'AND subject:("{safe_tag}")')

        sort_param = {
            "latest": "publicdate desc",
            "newest": "publicdate desc",
            "rating": "avg_rating desc",
            "title": "titleSorter asc",
        }.get((query.sort or "").strip().lower(), "downloads desc")

        solr_q = " ".join(q_parts)
        url = (
            f"{self.BASE_URL}/advancedsearch.php?q={quote(solr_q, safe='')}"
            "&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=subject&fl[]=year"
            "&fl[]=imagecount&fl[]=downloads&fl[]=avg_rating&fl[]=num_reviews"
            f"&sort[]={quote(sort_param, safe='')}&rows={page_size}&page={page}&output=json"
        )
        try:
            raw = await _get_or_add_cached(f"archive:browse:{url}", 180, lambda: _http_get_text(url))
            resp = json.loads(raw).get("response") or {}
            total = int(resp.get("numFound") or 0)
            docs = resp.get("docs") or []
            items: list[dict[str, Any]] = []
            for doc in docs:
                if not isinstance(doc, dict):
                    continue
                identifier = self._read_first_string(doc.get("identifier"))
                if not identifier:
                    continue
                title = self._read_first_string(doc.get("title")) or identifier
                authors = self._read_string_list(doc.get("creator"))
                subjects = self._read_string_list(doc.get("subject"))
                year = _safe_int(self._read_first_string(doc.get("year")))
                downloads = _safe_int(self._read_first_string(doc.get("downloads")))
                avg_rating = _safe_float(self._read_first_string(doc.get("avg_rating")))
                num_reviews = _safe_int(self._read_first_string(doc.get("num_reviews")))
                cover = resolve_display_image_url(
                    f"{self.BASE_URL}/services/img/{quote(identifier, safe='')}",
                    self.source_id,
                    use_proxy=query.use_proxy,
                )
                items.append(
                    _make_summary(
                        id=identifier,
                        source_id=self.source_id,
                        source_name="Kho Lưu Trữ Manga Mở",
                        title=title,
                        author=", ".join(authors),
                        cover_url=cover,
                        status="archive",
                        status_label="Lưu trữ mở",
                        language="en",
                        year=year,
                        rating=round(avg_rating, 2) if avg_rating and avg_rating > 0 else None,
                        rating_max=5,
                        rating_count=num_reviews if num_reviews is not None and num_reviews >= 0 else None,
                        view_count=downloads if downloads is not None and downloads >= 0 else None,
                        comment_count=num_reviews if num_reviews is not None and num_reviews >= 0 else None,
                        tags=[
                            {"id": s, "name": s, "vietnamese_name": s, "group": "subject"}
                            for s in subjects[:8]
                        ],
                    )
                )
            return {
                "source": self._source_info(is_available=True),
                "items": items,
                "available_tags": available_tags,
                "page": page,
                "page_size": page_size,
                "total_items": total,
                "has_next_page": (page * page_size) < total and len(items) > 0,
                "error_message": None,
            }
        except Exception as exc:
            logger.warning("Archive browse failed: %s", exc)
            err = "Không thể kết nối kho truyện lúc này. Vui lòng thử lại sau."
            return {
                "source": self._source_info(is_available=False, status_message=err),
                "items": [],
                "available_tags": available_tags,
                "page": page,
                "page_size": page_size,
                "total_items": 0,
                "has_next_page": False,
                "error_message": err,
            }

    async def get_manga_detail(
        self, manga_id: str, preferred_language: str | None, db: Session, *, use_proxy: bool = True
    ) -> dict[str, Any]:
        if not self._is_valid_id(manga_id):
            return {
                "manga": None,
                "description": "",
                "chapters": [],
                "available_languages": ["en"],
                "selected_language": "en",
                "error_message": "Mã tài liệu không hợp lệ.",
            }
        clean_id = manga_id.strip()
        try:
            meta_root, solr_stats = await asyncio.gather(
                self._fetch_metadata(clean_id),
                self._fetch_single_stats(clean_id),
            )
            metadata = meta_root.get("metadata")
            if not isinstance(metadata, dict):
                return {
                    "manga": None,
                    "description": "",
                    "chapters": [],
                    "available_languages": ["en"],
                    "selected_language": "en",
                    "error_message": "Không tìm thấy tài liệu.",
                }

            title = self._read_first_string(metadata.get("title")) or clean_id
            authors = self._read_string_list(metadata.get("creator"))
            subjects = self._read_string_list(metadata.get("subject"))
            description = self._clean_html_desc(self._read_first_string(metadata.get("description")))
            year = _safe_int(self._read_first_string(metadata.get("year")))
            if year is None:
                ym = _YEAR_RE.search(self._read_first_string(metadata.get("publicdate")) or "")
                year = int(ym.group(1)) if ym else None
            languages = self._normalize_languages(self._read_string_list(metadata.get("language")))
            selected_lang = (
                preferred_language.strip().lower()
                if preferred_language and preferred_language.strip()
                else languages[0]
            )
            chapters = self._extract_chapters_from_metadata(clean_id, meta_root.get("files"), selected_lang)
            view_count = (
                _safe_int(self._read_first_string(metadata.get("downloads")))
                or _safe_int(self._read_first_string(meta_root.get("downloads")))
                or solr_stats[0]
            )
            if view_count is not None and view_count < 0:
                view_count = None

            rating: float | None = None
            rating_count: int | None = None
            comment_count: int | None = None
            reviews = meta_root.get("reviews")
            if isinstance(reviews, list) and reviews:
                comment_count = len(reviews)
                stars_vals = [
                    s
                    for r in reviews
                    if isinstance(r, dict)
                    and (s := _safe_float(self._read_first_string(r.get("stars")))) is not None
                    and 1.0 <= s <= 5.0
                ]
                if stars_vals:
                    rating = round(sum(stars_vals) / len(stars_vals), 2)
                    rating_count = len(stars_vals)
                else:
                    rating_count = len(reviews)

            if rating is None and solr_stats[1] and solr_stats[1] > 0:
                rating = round(solr_stats[1], 2)
            if rating_count is None and solr_stats[2] is not None and solr_stats[2] >= 0:
                rating_count = solr_stats[2]
            if comment_count is None and solr_stats[2] is not None and solr_stats[2] >= 0:
                comment_count = solr_stats[2]

            summary = _make_summary(
                id=clean_id,
                source_id=self.source_id,
                source_name="Kho Lưu Trữ Manga Mở",
                title=title,
                author=", ".join(authors),
                cover_url=resolve_display_image_url(
                    f"{self.BASE_URL}/services/img/{quote(clean_id, safe='')}",
                    self.source_id,
                    use_proxy=use_proxy,
                ),
                status="archive",
                status_label="Lưu trữ mở",
                language=selected_lang,
                year=year,
                rating=rating,
                rating_max=5,
                rating_count=rating_count,
                view_count=view_count,
                comment_count=comment_count,
                tags=[{"id": s, "name": s, "vietnamese_name": s, "group": "subject"} for s in subjects],
            )
            return {
                "manga": summary,
                "description": description,
                "chapters": chapters,
                "available_languages": languages,
                "selected_language": selected_lang,
                "error_message": "Tài liệu này chưa hỗ trợ đọc trực tuyến." if not chapters else None,
            }
        except Exception as exc:
            logger.warning("Archive detail failed: %s", exc)
            return {
                "manga": None,
                "description": "",
                "chapters": [],
                "available_languages": ["en"],
                "selected_language": "en",
                "error_message": "Không tải được chi tiết truyện lúc này.",
            }

    async def get_chapter_pages(
        self,
        manga_id: str,
        chapter_id: str,
        preferred_language: str | None,
        db: Session,
        *,
        quality: str = "saver",
        use_proxy: bool = True,
    ) -> dict[str, Any]:
        if not self._is_valid_id(manga_id) or not chapter_id or not chapter_id.strip():
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=manga_id or "",
                manga_title="",
                chapter_id=chapter_id or "",
                chapter_label="",
                error_message="Mã tài liệu hoặc tập đọc không hợp lệ.",
                quality=quality,
                use_proxy=use_proxy,
            )
        clean_id = manga_id.strip()
        sub_prefix = chapter_id.strip()
        if ".." in sub_prefix:
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=clean_id,
                manga_title="",
                chapter_id=sub_prefix,
                chapter_label="",
                error_message="Định danh tập đọc không hợp lệ.",
                quality=quality,
                use_proxy=use_proxy,
            )
        try:
            meta_root = await self._fetch_metadata(clean_id)
            metadata = meta_root.get("metadata")
            if not isinstance(metadata, dict):
                return _make_chapter_pages(
                    source_id=self.source_id,
                    manga_id=clean_id,
                    manga_title="",
                    chapter_id=sub_prefix,
                    chapter_label="",
                    error_message="Không tìm thấy tài liệu.",
                    quality=quality,
                    use_proxy=use_proxy,
                )

            manga_title = self._read_first_string(metadata.get("title")) or clean_id
            languages = self._normalize_languages(self._read_string_list(metadata.get("language")))
            selected_lang = (
                preferred_language.strip().lower()
                if preferred_language and preferred_language.strip()
                else languages[0]
            )
            chapters = list(
                reversed(self._extract_chapters_from_metadata(clean_id, meta_root.get("files"), selected_lang))
            )
            matched = next((c for c in chapters if c["id"].lower() == sub_prefix.lower()), None)
            chapter_label = matched["display_label"] if matched else sub_prefix
            leaf_count = await self._resolve_leaf_count(
                clean_id, sub_prefix, metadata, matched["page_count"] if matched else 0
            )
            if leaf_count <= 0:
                return _make_chapter_pages(
                    source_id=self.source_id,
                    manga_id=clean_id,
                    manga_title=manga_title,
                    chapter_id=sub_prefix,
                    chapter_label=chapter_label,
                    chapters=chapters,
                    error_message="Không tìm thấy danh sách trang cho tài liệu này.",
                    quality=quality,
                    use_proxy=use_proxy,
                )

            page_count = min(leaf_count, ARCHIVE_MAX_PAGE_LIMIT)
            esc_id = quote(clean_id, safe="")
            esc_prefix = quote(sub_prefix, safe="")
            orig_pages = [
                f"{self.BASE_URL}/download/{esc_id}/{esc_prefix}/page/n{i}_w1000.jpg"
                for i in range(page_count)
            ]
            saver_pages = [
                f"{self.BASE_URL}/download/{esc_id}/{esc_prefix}/page/n{i}_w800.jpg"
                for i in range(page_count)
            ]

            prev_id: str | None = None
            next_id: str | None = None
            for idx, ch in enumerate(chapters):
                if ch["id"].lower() == sub_prefix.lower():
                    if idx > 0:
                        prev_id = chapters[idx - 1]["id"]
                    if idx + 1 < len(chapters):
                        next_id = chapters[idx + 1]["id"]
                    break

            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=clean_id,
                manga_title=manga_title,
                chapter_id=sub_prefix,
                chapter_label=chapter_label,
                original_pages=orig_pages,
                data_saver_pages=saver_pages,
                prev_chapter_id=prev_id,
                next_chapter_id=next_id,
                chapters=chapters,
                quality=quality,
                use_proxy=use_proxy,
            )
        except Exception as exc:
            logger.warning("Archive read failed: %s", exc)
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=clean_id,
                manga_title="",
                chapter_id=sub_prefix,
                chapter_label="",
                error_message="Không tải được trang truyện lúc này.",
                quality=quality,
                use_proxy=use_proxy,
            )

    async def _fetch_metadata(self, clean_id: str) -> dict[str, Any]:
        url = f"{self.BASE_URL}/metadata/{quote(clean_id, safe='')}"
        raw = await _get_or_add_cached(f"archive:metadata:{clean_id}", 600, lambda: _http_get_text(url))
        return json.loads(raw)

    async def _fetch_single_stats(self, clean_id: str) -> tuple[int | None, float | None, int | None]:
        try:
            safe_id = clean_id.replace('"', "")
            url = (
                f"{self.BASE_URL}/advancedsearch.php?q=identifier%3A%22{quote(safe_id, safe='')}%22"
                "&fl[]=downloads&fl[]=avg_rating&fl[]=num_reviews&rows=1&output=json"
            )
            raw = await _get_or_add_cached(f"archive:stats:{clean_id}", 600, lambda: _http_get_text(url))
            docs = (json.loads(raw).get("response") or {}).get("docs") or []
            if not docs or not isinstance(docs[0], dict):
                return None, None, None
            doc = docs[0]
            return (
                _safe_int(self._read_first_string(doc.get("downloads"))),
                _safe_float(self._read_first_string(doc.get("avg_rating"))),
                _safe_int(self._read_first_string(doc.get("num_reviews"))),
            )
        except Exception:
            return None, None, None

    async def _resolve_leaf_count(
        self, clean_id: str, sub_prefix: str, metadata: dict[str, Any], file_count_fallback: int
    ) -> int:
        scandata_url = (
            f"{self.BASE_URL}/download/{quote(clean_id, safe='')}/"
            f"{quote(sub_prefix + '_scandata.xml', safe='')}"
        )
        try:
            xml = await _get_or_add_cached(
                f"archive:scandata:{clean_id}:{sub_prefix}",
                900,
                lambda: _http_get_text(scandata_url, accept="application/xml,text/xml,*/*"),
            )
            m = _ARCHIVE_LEAF_COUNT_RE.search(xml)
            if m and int(m.group(1)) > 0:
                return int(m.group(1))
        except Exception:
            pass
        if file_count_fallback > 0:
            return file_count_fallback
        return _safe_int(self._read_first_string(metadata.get("imagecount"))) or 0

    def _extract_chapters_from_metadata(
        self, clean_id: str, files: Any, language: str
    ) -> list[dict[str, Any]]:
        if not isinstance(files, list) or not files:
            return []
        entries: list[tuple[str, int, str | None]] = []
        for f in files:
            if not isinstance(f, dict):
                continue
            name = str(f.get("name") or "")
            if not name.lower().endswith("_jp2.zip"):
                continue
            sub_prefix = name[: -len("_jp2.zip")]
            if not sub_prefix:
                continue
            page_cnt = _safe_int(self._read_first_string(f.get("filecount"))) or 0
            mtime_unix = _safe_int(self._read_first_string(f.get("mtime")))
            mtime_iso = (
                _iso_utc(datetime.fromtimestamp(mtime_unix, tz=timezone.utc))
                if mtime_unix and mtime_unix > 0
                else None
            )
            entries.append((sub_prefix, page_cnt, mtime_iso))
        if not entries:
            return []
        entries.sort(key=lambda e: _natural_sort_key(e[0]))
        single = len(entries) == 1
        chapters: list[dict[str, Any]] = []
        for idx, (prefix, page_cnt, mtime_iso) in enumerate(entries, start=1):
            ch_num = str(idx)
            chapters.append(
                _make_chapter(
                    id=prefix,
                    source_id=self.source_id,
                    manga_id=clean_id,
                    chapter_number=ch_num,
                    volume_number="1" if single else ch_num,
                    title=prefix,
                    display_label="Đọc trọn bộ" if single else prefix,
                    language=language,
                    scanlation_group="Kho Lưu Trữ Manga Mở",
                    page_count=page_cnt,
                    published_at=mtime_iso,
                )
            )
        chapters.reverse()
        return chapters

    @staticmethod
    def _is_valid_id(identifier: str | None) -> bool:
        if not identifier or not identifier.strip():
            return False
        t = identifier.strip()
        return ".." not in t and "/" not in t and "\\" not in t

    @staticmethod
    def _sanitize_solr(raw: str) -> str:
        return _WHITESPACE_RE.sub(" ", _SOLR_UNSAFE_RE.sub(" ", raw)).strip()

    @staticmethod
    def _read_first_string(val: Any) -> str | None:
        if val is None:
            return None
        if isinstance(val, list):
            for item in val:
                s = str(item).strip()
                if s:
                    return s
            return None
        s = str(val).strip()
        return s or None

    @staticmethod
    def _read_string_list(val: Any) -> list[str]:
        res: list[str] = []
        seen: set[str] = set()
        items = val if isinstance(val, list) else ([val] if val is not None else [])
        for item in items:
            s = str(item).strip()
            if s and s.lower() not in seen:
                seen.add(s.lower())
                res.append(s)
        return res

    @staticmethod
    def _normalize_languages(raw_langs: list[str]) -> list[str]:
        res: list[str] = []
        for raw in raw_langs:
            norm = {"eng": "en", "jpn": "ja", "vie": "vi"}.get(raw.strip().lower(), raw.strip().lower())
            if norm and norm not in res:
                res.append(norm)
        return res or ["en"]

    @staticmethod
    def _clean_html_desc(raw: str | None) -> str:
        if not raw or not raw.strip():
            return ""
        txt = _HTML_BREAK_RE.sub("\n", raw)
        txt = _HTML_TAG_RE.sub("", txt)
        return unescape(txt).strip()


class LocalDbProvider:
    DISPLAY_NAME = "Truyện Tại Cửa Hàng"

    def __init__(self) -> None:
        self.source_id = "local-db"

    def _source_info(self, *, is_available: bool = True, status_message: str | None = None) -> dict[str, Any]:
        return {
            "id": self.source_id,
            "display_name": self.DISPLAY_NAME,
            "language_badge": "VI",
            "description": "Đọc các chương truyện hiện có tại cửa hàng MangaStore.",
            "is_available": is_available,
            "status_message": status_message,
            "supports_demographic": False,
            "supports_status": False,
            "supports_sort": True,
        }

    async def get_source_info(self, db: Session) -> dict[str, Any]:
        try:
            count = db.scalar(select(func.count(Product.id))) or 0
            return self._source_info(is_available=True, status_message=f"{int(count)} đầu truyện tại cửa hàng")
        except Exception as exc:
            logger.warning("LocalDb get_source_info failed: %s", exc)
            return self._source_info(
                is_available=False,
                status_message="Cửa hàng hiện tạm thời không khả dụng. Vui lòng thử lại sau.",
            )

    async def get_tags(self, db: Session) -> list[dict[str, Any]]:
        try:
            genres = db.scalars(select(Genre).order_by(Genre.display_order.asc(), Genre.name.asc())).all()
            tags = db.scalars(select(Tag).order_by(Tag.name.asc())).all()
            res: list[dict[str, Any]] = []
            for g in genres:
                if g.name and g.name.strip():
                    res.append(
                        {"id": f"genre:{g.id}", "name": g.name, "vietnamese_name": g.name, "group": "genre"}
                    )
            for t in tags:
                if t.name and t.name.strip():
                    res.append(
                        {"id": f"tag:{t.id}", "name": t.name, "vietnamese_name": t.name, "group": "theme"}
                    )
            return res
        except Exception:
            return []

    async def browse(self, query: BrowseQuery, db: Session) -> dict[str, Any]:
        page = max(1, query.page)
        page_size = min(max(1, query.page_size), 48)
        try:
            has_chapters = exists(select(Chapter.id).where(Chapter.product_id == Product.id))
            stmt = select(Product).options(
                selectinload(Product.genres),
                selectinload(Product.tags),
                selectinload(Product.chapters),
            )

            if query.keyword and query.keyword.strip():
                kw = f"%{query.keyword.strip()}%"
                stmt = stmt.where(
                    or_(
                        Product.title.ilike(kw),
                        Product.author.ilike(kw),
                        Product.description.ilike(kw),
                        Product.genres.any(Genre.name.ilike(kw)),
                        Product.tags.any(Tag.name.ilike(kw)),
                    )
                )

            if query.tag_id and query.tag_id.strip():
                stmt = self._apply_tag_filter(stmt, query.tag_id.strip())

            if query.status and query.status.strip():
                st_term = query.status.strip().lower()
                if st_term == "ongoing":
                    stmt = stmt.where(Product.status == "dang_ban")
                elif st_term == "completed":
                    stmt = stmt.where(Product.status.in_(["dang_ban", "ngung_ban"]))
                else:
                    stmt = stmt.where(Product.status == query.status.strip())

            sort_key = (query.sort or "popular").strip().lower()
            if sort_key in ("latest", "newest"):
                stmt = stmt.order_by(has_chapters.desc(), Product.updated_at.desc(), Product.id.desc())
            elif sort_key == "rating":
                stmt = stmt.order_by(
                    has_chapters.desc(), Product.average_rating.desc(), Product.ratings_count.desc(), Product.id.asc()
                )
            elif sort_key == "title":
                stmt = stmt.order_by(has_chapters.desc(), Product.title.asc(), Product.id.asc())
            else:
                stmt = stmt.order_by(
                    has_chapters.desc(),
                    Product.is_featured.desc(),
                    Product.units_sold.desc(),
                    Product.updated_at.desc(),
                    Product.id.asc(),
                )

            all_matching = list(db.scalars(stmt).all())
            total = len(all_matching)
            offset = (page - 1) * page_size
            entities = all_matching[offset : offset + page_size]

            items = [self._map_summary(p) for p in entities]
            available_tags = await self.get_tags(db)
            return {
                "source": self._source_info(is_available=True),
                "items": items,
                "available_tags": available_tags,
                "page": page,
                "page_size": page_size,
                "total_items": total,
                "has_next_page": (offset + len(items)) < total and len(items) > 0,
                "error_message": None,
            }
        except Exception as exc:
            logger.warning("LocalDb browse failed: %s", exc)
            err = "Cửa hàng hiện tạm thời không khả dụng. Vui lòng thử lại sau."
            return {
                "source": self._source_info(is_available=False, status_message=err),
                "items": [],
                "available_tags": [],
                "page": page,
                "page_size": page_size,
                "total_items": 0,
                "has_next_page": False,
                "error_message": err,
            }

    async def get_manga_detail(
        self, manga_id: str, preferred_language: str | None, db: Session, *, use_proxy: bool = True
    ) -> dict[str, Any]:
        pid = _safe_int(manga_id.strip()) if manga_id and manga_id.strip().isdigit() else None
        if not pid or pid <= 0:
            return {
                "manga": None,
                "description": "",
                "chapters": [],
                "available_languages": ["vi"],
                "selected_language": "vi",
                "error_message": "Mã truyện không hợp lệ.",
            }
        try:
            product = db.scalar(
                select(Product)
                .options(
                    selectinload(Product.genres),
                    selectinload(Product.tags),
                    selectinload(Product.chapters),
                )
                .where(Product.id == pid)
            )
            if product is None:
                return {
                    "manga": None,
                    "description": "",
                    "chapters": [],
                    "available_languages": ["vi"],
                    "selected_language": "vi",
                    "error_message": "Không tìm thấy truyện.",
                }
            ordered_desc = sorted(
                product.chapters, key=lambda c: (c.chapter_number, c.id), reverse=True
            )
            chapters = [self._map_chapter(product.id, ch) for ch in ordered_desc]
            return {
                "manga": self._map_summary(product),
                "description": product.description or "",
                "chapters": chapters,
                "available_languages": ["vi"],
                "selected_language": "vi",
                "error_message": None,
            }
        except Exception as exc:
            logger.warning("LocalDb detail failed: %s", exc)
            return {
                "manga": None,
                "description": "",
                "chapters": [],
                "available_languages": ["vi"],
                "selected_language": "vi",
                "error_message": "Cửa hàng hiện tạm thời không khả dụng. Vui lòng thử lại sau.",
            }

    async def get_chapter_pages(
        self,
        manga_id: str,
        chapter_id: str,
        preferred_language: str | None,
        db: Session,
        *,
        quality: str = "saver",
        use_proxy: bool = True,
    ) -> dict[str, Any]:
        pid = _safe_int(manga_id.strip()) if manga_id and manga_id.strip().isdigit() else None
        cid = _safe_int(chapter_id.strip()) if chapter_id and chapter_id.strip().isdigit() else None
        if not pid or not cid:
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=manga_id or "",
                manga_title="",
                chapter_id=chapter_id or "",
                chapter_label="",
                error_message="Mã truyện hoặc chương không hợp lệ.",
                quality=quality,
                use_proxy=use_proxy,
            )
        try:
            product = db.scalar(
                select(Product)
                .options(selectinload(Product.chapters))
                .where(Product.id == pid)
            )
            if product is None:
                return _make_chapter_pages(
                    source_id=self.source_id,
                    manga_id=str(pid),
                    manga_title="",
                    chapter_id=str(cid),
                    chapter_label="",
                    error_message="Không tìm thấy truyện.",
                    quality=quality,
                    use_proxy=use_proxy,
                )
            ordered = sorted(product.chapters, key=lambda c: (c.chapter_number, c.id))
            ch_dtos = [self._map_chapter(product.id, ch) for ch in ordered]
            idx = next((i for i, ch in enumerate(ordered) if ch.id == cid), -1)
            if idx < 0:
                return _make_chapter_pages(
                    source_id=self.source_id,
                    manga_id=str(product.id),
                    manga_title=product.title,
                    chapter_id=str(cid),
                    chapter_label="",
                    chapters=ch_dtos,
                    error_message="Không tìm thấy chương truyện yêu cầu.",
                    quality=quality,
                    use_proxy=use_proxy,
                )

            target = ordered[idx]
            prev_id = str(ordered[idx - 1].id) if idx > 0 else None
            next_id = str(ordered[idx + 1].id) if idx + 1 < len(ordered) else None
            img_urls = self._extract_image_urls(target.content)
            is_text = len(img_urls) == 0
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=str(product.id),
                manga_title=product.title,
                chapter_id=str(target.id),
                chapter_label=ch_dtos[idx]["display_label"],
                original_pages=[] if is_text else img_urls,
                data_saver_pages=[] if is_text else img_urls,
                is_text_content=is_text,
                text_content=(target.content or "") if is_text else None,
                prev_chapter_id=prev_id,
                next_chapter_id=next_id,
                chapters=ch_dtos,
                quality=quality,
                use_proxy=use_proxy,
            )
        except Exception as exc:
            logger.warning("LocalDb read failed: %s", exc)
            return _make_chapter_pages(
                source_id=self.source_id,
                manga_id=manga_id or "",
                manga_title="",
                chapter_id=chapter_id or "",
                chapter_label="",
                error_message="Cửa hàng hiện tạm thời không khả dụng. Vui lòng thử lại sau.",
                quality=quality,
                use_proxy=use_proxy,
            )

    @staticmethod
    def _apply_tag_filter(stmt: Any, raw_tag: str) -> Any:
        lower = raw_tag.lower()
        if lower.startswith("genre:") and raw_tag[6:].isdigit():
            gid = int(raw_tag[6:])
            return stmt.where(Product.genres.any(Genre.id == gid))
        if lower.startswith("tag:") and raw_tag[4:].isdigit():
            tid = int(raw_tag[4:])
            return stmt.where(Product.tags.any(Tag.id == tid))
        if raw_tag.isdigit():
            nid = int(raw_tag)
            return stmt.where(
                or_(Product.genres.any(Genre.id == nid), Product.tags.any(Tag.id == nid))
            )
        return stmt.where(
            or_(
                Product.genres.any(func.lower(Genre.name) == lower),
                Product.tags.any(func.lower(Tag.name) == lower),
            )
        )

    @staticmethod
    def normalize_store_cover_url(raw_cover: str | None) -> str:
        if not raw_cover or not raw_cover.strip():
            return DEFAULT_COVER_URL
        t = raw_cover.strip()
        if t.startswith("/") or t.lower().startswith(("http://", "https://")):
            return t
        return f"/covers/{t}"

    @staticmethod
    def _extract_image_urls(content: str | None) -> list[str]:
        if not content or not content.strip():
            return []
        lines = [ln.strip() for ln in content.replace("\r\n", "\n").replace("\r", "\n").split("\n") if ln.strip()]
        if not lines:
            return []
        if all(ln.lower().startswith(("http://", "https://")) or ln.startswith("/") for ln in lines):
            return lines
        return []

    @staticmethod
    def _format_chapter_num(num: float) -> str:
        if float(num).is_integer():
            return str(int(num))
        return f"{num:g}"

    def _map_chapter(self, product_id: int, ch: Chapter) -> dict[str, Any]:
        num_str = self._format_chapter_num(ch.chapter_number)
        title = (ch.title or "").strip()
        display = title or f"Chương {num_str}"
        page_cnt = len(self._extract_image_urls(ch.content))
        return _make_chapter(
            id=str(ch.id),
            source_id=self.source_id,
            manga_id=str(product_id),
            chapter_number=num_str,
            title=title,
            display_label=display,
            language="vi",
            scanlation_group="MangaStore",
            page_count=page_cnt,
            published_at=_iso_utc(ch.created_at),
        )

    def _map_summary(self, product: Product) -> dict[str, Any]:
        tags: list[dict[str, Any]] = []
        for g in product.genres or []:
            if g.name and g.name.strip():
                tags.append({"id": f"genre:{g.id}", "name": g.name, "vietnamese_name": g.name, "group": "genre"})
        for t in product.tags or []:
            if t.name and t.name.strip():
                tags.append({"id": f"tag:{t.id}", "name": t.name, "vietnamese_name": t.name, "group": "theme"})

        year: int | None = None
        if product.publication_date:
            m = _YEAR_RE.search(product.publication_date)
            if m:
                year = int(m.group(1))

        status_label = {
            "dang_ban": "Đang phát hành",
            "het_hang": "Tạm hết hàng",
            "tam_ngung": "Tạm ngưng",
            "ngung_ban": "Ngừng bán",
        }.get((product.status or "").strip().lower(), product.status or "")

        return _make_summary(
            id=str(product.id),
            source_id=self.source_id,
            source_name=self.DISPLAY_NAME,
            title=product.title or "",
            author=product.author or "",
            cover_url=self.normalize_store_cover_url(product.cover_url),
            status=product.status or "",
            status_label=status_label,
            language="vi",
            year=year,
            rating=round(float(product.average_rating), 2) if product.average_rating > 0 else None,
            rating_max=5,
            rating_count=product.ratings_count,
            view_count=product.view_count,
            chapter_count=len(product.chapters) if product.chapters is not None else 0,
            tags=tags,
        )


_MANGADEX_VI_PROVIDER = MangaDexProvider(
    "mangadex-vi",
    "MangaDex Tiếng Việt",
    "vi",
    "Kho truyện MangaDex bản dịch tiếng Việt từ cộng đồng dịch thuật.",
)

PROVIDERS: tuple[MangaSourceProvider, ...] = (
    _MANGADEX_VI_PROVIDER,
    WpComicsProvider(
        "nettruyen",
        "NetTruyen",
        "nettruyenar.com",
        "Kho truyện tranh tiếng Việt cập nhật nhanh từ NetTruyen.",
        include_comic_id_in_chapter_api=True,
    ),
    WpComicsProvider(
        "nhattruyen",
        "NhatTruyenVN",
        "nhattruyenqq.com",
        "Kho truyện tranh Manga, Manhwa, Manhua tiếng Việt từ NhatTruyenVN.",
        include_comic_id_in_chapter_api=False,
    ),
    TruyenQqProvider(),
    MangaDexProvider(
        "mangadex-en",
        "MangaDex English",
        "en",
        "Kho truyện MangaDex bản tiếng Anh cập nhật nhanh.",
    ),
    InternetArchiveProvider(),
    LocalDbProvider(),
)

PROVIDER_MAP: dict[str, MangaSourceProvider] = {p.source_id: p for p in PROVIDERS}


def resolve_provider(source_id: str | None) -> MangaSourceProvider:
    key = (source_id or "mangadex-vi").strip().lower()
    provider = PROVIDER_MAP.get(key)
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Nguồn đọc '{source_id}' không tồn tại.",
        )
    return provider


def _normalize_keys(source_id: str | None, manga_id: str | None) -> tuple[str, str]:
    src = (source_id or "").strip().lower()[:64]
    mid = (manga_id or "").strip()[:255]
    if not src or not mid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Thông tin nguồn hoặc mã truyện không hợp lệ.",
        )
    return src, mid


def _normalize_avatar_url(avatar: str | None) -> str:
    if not avatar or not avatar.strip():
        return DEFAULT_AVATAR_URL
    t = avatar.strip()
    if t.startswith("/") or t.lower().startswith(("http://", "https://")):
        return t
    return "/" + t.lstrip("~/")


def _get_or_create_stat(db: Session, source_id: str, manga_id: str) -> ReaderStat:
    stat = db.scalar(
        select(ReaderStat).where(
            ReaderStat.source_id == source_id,
            ReaderStat.manga_id == manga_id,
        )
    )
    if stat is None:
        stat = ReaderStat(
            source_id=source_id,
            manga_id=manga_id,
            read_count=0,
            average_rating=0.0,
            ratings_count=0,
            comment_count=0,
        )
        db.add(stat)
        db.flush()
    return stat


def get_batch_stats_map(
    db: Session, source_id: str, manga_ids: Iterable[str]
) -> dict[str, dict[str, Any]]:
    norm_src = (source_id or "").strip().lower()
    ids = list({mid.strip() for mid in manga_ids if mid and mid.strip()})
    if not norm_src or not ids:
        return {}
    stats_rows = db.scalars(
        select(ReaderStat).where(
            ReaderStat.source_id == norm_src,
            ReaderStat.manga_id.in_(ids),
        )
    ).all()
    comment_rows = db.execute(
        select(ReaderComment.manga_id, func.count(ReaderComment.id))
        .where(
            ReaderComment.source_id == norm_src,
            ReaderComment.manga_id.in_(ids),
        )
        .group_by(ReaderComment.manga_id)
    ).all()
    comment_counts = {str(mid): int(cnt) for mid, cnt in comment_rows}

    result: dict[str, dict[str, Any]] = {}
    for row in stats_rows:
        result[row.manga_id] = {
            "source_id": norm_src,
            "manga_id": row.manga_id,
            "read_count": int(row.read_count or 0),
            "average_rating": float(row.average_rating or 0.0),
            "ratings_count": int(row.ratings_count or 0),
            "comment_count": max(int(row.comment_count or 0), comment_counts.get(row.manga_id, 0)),
        }
    for mid, cnt in comment_counts.items():
        if mid not in result:
            result[mid] = {
                "source_id": norm_src,
                "manga_id": mid,
                "read_count": 0,
                "average_rating": 0.0,
                "ratings_count": 0,
                "comment_count": cnt,
            }
    return result


def get_single_stats(db: Session, source_id: str, manga_id: str) -> dict[str, Any]:
    norm_src = (source_id or "").strip().lower()
    norm_mid = (manga_id or "").strip()
    if not norm_src or not norm_mid:
        return {
            "source_id": norm_src,
            "manga_id": norm_mid,
            "read_count": 0,
            "average_rating": 0.0,
            "ratings_count": 0,
            "comment_count": 0,
        }
    stat = db.scalar(
        select(ReaderStat).where(
            ReaderStat.source_id == norm_src,
            ReaderStat.manga_id == norm_mid,
        )
    )
    cnt = db.scalar(
        select(func.count(ReaderComment.id)).where(
            ReaderComment.source_id == norm_src,
            ReaderComment.manga_id == norm_mid,
        )
    ) or 0
    return {
        "source_id": norm_src,
        "manga_id": norm_mid,
        "read_count": int(stat.read_count) if stat else 0,
        "average_rating": float(stat.average_rating) if stat else 0.0,
        "ratings_count": int(stat.ratings_count) if stat else 0,
        "comment_count": max(int(stat.comment_count) if stat else 0, int(cnt)),
    }


def merge_local_stats(db: Session, source_id: str, items: list[dict[str, Any]]) -> None:
    if not items:
        return
    stats_map = get_batch_stats_map(db, source_id, [str(it.get("id") or "") for it in items])
    if not stats_map:
        return
    is_local = source_id.strip().lower() == "local-db"
    lookup_ci = {k.lower(): v for k, v in stats_map.items()}
    for item in items:
        mid = str(item.get("id") or "").strip()
        local = stats_map.get(mid) or lookup_ci.get(mid.lower())
        if not local:
            continue
        if is_local:
            item["view_count"] = max(int(item.get("view_count") or 0), local["read_count"])
        else:
            item["view_count"] = int(item.get("view_count") or 0) + local["read_count"]
        item["comment_count"] = int(item.get("comment_count") or 0) + local["comment_count"]
        if (not item.get("rating") or float(item["rating"]) <= 0) and local["ratings_count"] > 0:
            item["rating"] = local["average_rating"]
            item["rating_max"] = 5
            item["rating_count"] = local["ratings_count"]


def increment_read_count(db: Session, source_id: str, manga_id: str) -> None:
    norm_src = (source_id or "").strip().lower()[:64]
    norm_mid = (manga_id or "").strip()[:255]
    if not norm_src or not norm_mid:
        return
    for attempt in range(2):
        try:
            stat = db.scalar(
                select(ReaderStat).where(
                    ReaderStat.source_id == norm_src,
                    ReaderStat.manga_id == norm_mid,
                )
            )
            if stat is None:
                db.add(
                    ReaderStat(
                        source_id=norm_src,
                        manga_id=norm_mid,
                        read_count=1,
                        average_rating=0.0,
                        ratings_count=0,
                        comment_count=0,
                    )
                )
            else:
                stat.read_count = int(stat.read_count or 0) + 1
                stat.updated_at = utc_now()

            if norm_src == "local-db" and norm_mid.isdigit() and int(norm_mid) > 0:
                db.execute(
                    update(Product)
                    .where(Product.id == int(norm_mid))
                    .values(view_count=Product.view_count + 1)
                )
            db.commit()
            return
        except IntegrityError:
            db.rollback()
            if attempt == 1:
                logger.warning("Failed incrementing read_count for %s/%s", norm_src, norm_mid)
        except Exception as exc:
            db.rollback()
            logger.warning("increment_read_count error: %s", exc)
            return


def _extract_core_keyword(normalized_title: str) -> str:
    m = _CORE_TITLE_SPLIT_RE.search(normalized_title)
    if m and m.start() >= 3:
        return normalized_title[: m.start()].strip()
    return normalized_title.strip()


def _build_search_terms(full_title: str, core_phrase: str) -> list[str]:
    terms: list[str] = []
    if len(core_phrase) >= 2:
        terms.append(core_phrase)
    elif full_title:
        terms.append(full_title)

    raw_tokens = [tok.strip() for tok in _WORD_SPLIT_RE.split(core_phrase) if tok and tok.strip()]
    filtered: list[str] = []
    seen = {t.lower() for t in terms}
    for tok in raw_tokens:
        if len(tok) >= 3 and tok.lower() not in _STOP_WORDS and tok.lower() not in seen:
            seen.add(tok.lower())
            filtered.append(tok)
    filtered.sort(key=len, reverse=True)
    terms.extend(filtered)
    return terms


def _map_store_product(product: Product) -> dict[str, Any]:
    gallery = [a.url for a in (product.assets or []) if a.url]
    cover = LocalDbProvider.normalize_store_cover_url(product.cover_url)
    if cover and cover.lower() not in {g.lower() for g in gallery}:
        gallery.insert(0, cover)
    genres = [g.name for g in (product.genres or []) if g.name]
    tags = [t.name for t in (product.tags or []) if t.name]
    in_stock = (product.status or "").lower() != "ngung_ban" and int(product.stock_quantity or 0) > 0
    return {
        "id": product.id,
        "title": product.title,
        "author": product.author,
        "publisher": product.publisher or "",
        "publication_date": product.publication_date or "",
        "cover_url": gallery[0] if gallery else cover,
        "gallery": gallery,
        "price": float(product.price or 0),
        "original_price": float(product.original_price) if product.original_price is not None else None,
        "average_rating": float(product.average_rating or 0.0),
        "ratings_count": int(product.ratings_count or 0),
        "view_count": int(product.view_count or 0),
        "units_sold": int(product.units_sold or 0),
        "stock_quantity": int(product.stock_quantity or 0),
        "in_stock": in_stock,
        "is_available": in_stock,
        "status": product.status,
        "category": genres[0] if genres else "Khác",
        "genres": genres,
        "tags": tags,
        "description": product.description or "",
        "is_featured": bool(product.is_featured),
        "is_new": bool(product.is_new),
        "chapter_count": len(product.chapters) if product.chapters is not None else 0,
    }


def find_store_matches(db: Session, title: str | None) -> list[dict[str, Any]]:
    if not title or not title.strip():
        return []
    normalized = title.replace("\u00D7", "x").strip()
    core_phrase = _extract_core_keyword(normalized)
    terms = _build_search_terms(normalized, core_phrase)
    if not terms:
        return []

    base_opts = (
        selectinload(Product.genres),
        selectinload(Product.tags),
        selectinload(Product.assets),
        selectinload(Product.chapters),
    )

    primary = terms[0]
    matched = list(
        db.scalars(
            select(Product)
            .options(*base_opts)
            .where(Product.title.ilike(f"%{primary}%"))
            .order_by(Product.units_sold.desc(), Product.id.asc())
            .limit(12)
        ).all()
    )

    if not matched and len(terms) > 1:
        secondary = terms[1:4]
        candidates = list(
            db.scalars(
                select(Product)
                .options(*base_opts)
                .where(or_(*[Product.title.ilike(f"%{tok}%") for tok in secondary]))
                .limit(20)
            ).all()
        )
        min_score = 1 if len(secondary) == 1 else min(2, len(secondary))
        scored: list[tuple[int, int, Product]] = []
        for prod in candidates:
            tl = (prod.title or "").lower()
            score = sum(1 for tok in secondary if tok.lower() in tl)
            if score >= min_score:
                scored.append((score, int(prod.units_sold or 0), prod))
        scored.sort(key=lambda x: (-x[0], -x[1]))
        matched = [x[2] for x in scored[:6]]

    return [_map_store_product(p) for p in matched[:6]]


async def get_sources(db: Session, *, probe_external: bool = True) -> list[dict[str, Any]]:
    if not probe_external:
        results: list[dict[str, Any]] = []
        for p in PROVIDERS:
            if isinstance(p, LocalDbProvider):
                results.append(await p.get_source_info(db))
            elif isinstance(p, (WpComicsProvider, TruyenQqProvider)):
                results.append(p._source_info(is_available=True))
            else:
                results.append(await p.get_source_info(db))
        return results

    async def _get_info(provider: MangaSourceProvider) -> dict[str, Any]:
        if isinstance(provider, LocalDbProvider):
            return await provider.get_source_info(db)
        if isinstance(provider, (WpComicsProvider, TruyenQqProvider)):
            try:
                return await asyncio.wait_for(provider.get_source_info(db), timeout=2.5)
            except asyncio.TimeoutError:
                return provider._source_info(
                    is_available=False,
                    status_message=f"Kết nối tới {provider.source_id} quá thời gian chờ.",
                )
        return await provider.get_source_info(db)

    infos = await asyncio.gather(*[_get_info(p) for p in PROVIDERS])
    return list(infos)


async def get_dual_tags(db: Session) -> dict[str, Any]:
    reader_tags: list[dict[str, Any]] = [
        {
            "id": demo_id,
            "name": demo_name,
            "display_name": demo_name,
            "vietnamese_name": demo_name,
            "group": "Đối tượng",
            "raw_group": "demographic",
            "domain": "reader",
            "target_url": "",
        }
        for demo_id, demo_name in READER_DEMOGRAPHICS
    ]

    group_map = {
        "demographic": "Đối tượng",
        "format": "Định dạng",
        "genre": "Thể loại",
        "theme": "Chủ đề",
        "content": "Nội dung",
    }
    try:
        md_tags = await _MANGADEX_VI_PROVIDER.get_tags(db)
        for t in md_tags:
            raw_grp = (t.get("group") or "").strip().lower()
            reader_tags.append(
                {
                    "id": t["id"],
                    "name": t["name"],
                    "display_name": t.get("vietnamese_name") or t["name"],
                    "vietnamese_name": t.get("vietnamese_name") or t["name"],
                    "group": group_map.get(raw_grp, raw_grp.title() if raw_grp else "Khác"),
                    "raw_group": raw_grp,
                    "domain": "reader",
                    "target_url": "",
                }
            )
    except Exception as exc:
        logger.debug("MangaDex tags unavailable: %s", exc)

    store_tags: list[dict[str, Any]] = []
    is_store_online = True
    store_msg: str | None = None
    try:
        genres = db.execute(
            select(Genre.id, Genre.name, func.count(ProductGenre.product_id))
            .outerjoin(ProductGenre, Genre.id == ProductGenre.genre_id)
            .group_by(Genre.id, Genre.name, Genre.display_order)
            .order_by(Genre.display_order.asc(), Genre.name.asc())
        ).all()
        for gid, gname, cnt in genres:
            if gname and gname.strip():
                store_tags.append(
                    {
                        "id": f"store-genre-{gid}",
                        "filter_id": f"genre:{gid}",
                        "name": gname,
                        "display_name": gname,
                        "group": "Thể loại cửa hàng",
                        "domain": "store",
                        "target_url": f"/products?categories={quote(gname, safe='')}",
                        "item_count": int(cnt or 0),
                    }
                )

        tags = db.execute(
            select(Tag.id, Tag.name, func.count(ProductTag.product_id))
            .outerjoin(ProductTag, Tag.id == ProductTag.tag_id)
            .group_by(Tag.id, Tag.name)
            .order_by(Tag.name.asc())
        ).all()
        for tid, tname, cnt in tags:
            if tname and tname.strip():
                store_tags.append(
                    {
                        "id": f"store-tag-{tid}",
                        "filter_id": f"tag:{tid}",
                        "name": tname,
                        "display_name": tname,
                        "group": "Nhãn cửa hàng",
                        "domain": "store",
                        "target_url": f"/products?tag={quote(tname, safe='')}",
                        "item_count": int(cnt or 0),
                    }
                )
    except Exception as exc:
        logger.warning("Load store classification failed: %s", exc)
        is_store_online = False
        store_msg = "Cửa hàng hiện tạm thời không khả dụng. Vui lòng thử lại sau."

    return {
        "reader_tags": reader_tags,
        "store_tags": store_tags,
        "is_store_db_online": is_store_online,
        "store_db_message": store_msg,
    }


async def browse_manga(
    db: Session,
    *,
    source: str = "mangadex-vi",
    q: str | None = None,
    tag: str | None = None,
    demographic: str | None = None,
    status_filter: str | None = None,
    sort: str = "popular",
    page: int = 1,
    page_size: int = 24,
    use_proxy: bool = True,
) -> dict[str, Any]:
    provider = resolve_provider(source)
    query = BrowseQuery(
        source_id=provider.source_id,
        keyword=q.strip() if q and q.strip() else None,
        tag_id=tag.strip() if tag and tag.strip() else None,
        demographic=demographic.strip() if demographic and demographic.strip() else None,
        status=status_filter.strip() if status_filter and status_filter.strip() else None,
        sort=(sort or "popular").strip(),
        page=max(1, page),
        page_size=max(1, page_size),
        use_proxy=use_proxy,
    )
    result = await provider.browse(query, db)
    merge_local_stats(db, provider.source_id, result.get("items") or [])
    return result


async def cross_search_manga(
    db: Session,
    q: str,
    *,
    limit: int = 8,
    use_proxy: bool = True,
) -> dict[str, Any]:
    clean_kw = (q or "").strip()
    if not clean_kw:
        return {"query": "", "groups": [], "items": [], "total_items": 0}
    per_source_limit = min(max(1, limit), 24)

    async def _search_one(provider: MangaSourceProvider) -> dict[str, Any]:
        info = (
            provider._source_info(is_available=True)
            if isinstance(provider, (WpComicsProvider, TruyenQqProvider))
            else await provider.get_source_info(db)
        )
        try:
            res = await asyncio.wait_for(
                provider.browse(
                    BrowseQuery(
                        source_id=provider.source_id,
                        keyword=clean_kw,
                        page=1,
                        page_size=per_source_limit,
                        use_proxy=use_proxy,
                    ),
                    db,
                ),
                timeout=5.0,
            )
            items = list(res.get("items") or [])[:per_source_limit]
            return {
                "source_id": provider.source_id,
                "source_name": info["display_name"],
                "items": items,
                "error_message": res.get("error_message"),
            }
        except asyncio.TimeoutError:
            return {
                "source_id": provider.source_id,
                "source_name": info["display_name"],
                "items": [],
                "error_message": "Hết thời gian chờ kết nối nguồn truyện.",
            }
        except Exception as exc:
            logger.debug("Cross-search (%s) error: %s", provider.source_id, exc)
            return {
                "source_id": provider.source_id,
                "source_name": info["display_name"],
                "items": [],
                "error_message": "Không thể tìm kiếm từ nguồn này lúc này.",
            }

    raw_groups = await asyncio.gather(*[_search_one(p) for p in PROVIDERS], return_exceptions=True)
    groups: list[dict[str, Any]] = []
    flat_items: list[dict[str, Any]] = []
    for grp in raw_groups:
        if isinstance(grp, BaseException) or not isinstance(grp, dict):
            continue
        items = grp.get("items") or []
        if items:
            merge_local_stats(db, grp["source_id"], items)
            groups.append(grp)
            flat_items.extend(items)

    return {
        "query": clean_kw,
        "groups": groups,
        "items": flat_items,
        "total_items": len(flat_items),
    }


def _filter_and_sort_chapters(
    chapters: list[dict[str, Any]], chapter_q: str | None, chapter_order: str
) -> list[dict[str, Any]]:
    filtered = list(chapters)
    if chapter_q and chapter_q.strip():
        needle = chapter_q.strip().lower()
        filtered = [
            ch
            for ch in filtered
            if needle in (ch.get("display_label") or "").lower()
            or needle in (ch.get("chapter_number") or "").lower()
            or needle in (ch.get("title") or "").lower()
            or needle in (ch.get("scanlation_group") or "").lower()
        ]
    if (chapter_order or "desc").strip().lower() == "asc":
        filtered.reverse()
    return filtered


def get_comments(
    db: Session,
    source_id: str,
    manga_id: str,
    *,
    current_user: User | None = None,
    limit: int = 60,
) -> list[dict[str, Any]]:
    norm_src = (source_id or "").strip().lower()
    norm_mid = (manga_id or "").strip()
    if not norm_src or not norm_mid:
        return []
    eff_limit = min(max(1, limit), 500)

    root_rows = db.execute(
        select(ReaderComment, User.username, User.avatar_url, User.role_id)
        .join(User, ReaderComment.user_id == User.id)
        .where(
            ReaderComment.source_id == norm_src,
            ReaderComment.manga_id == norm_mid,
            ReaderComment.parent_comment_id.is_(None),
        )
        .order_by(ReaderComment.created_at.desc(), ReaderComment.id.desc())
        .limit(eff_limit)
    ).all()

    if not root_rows:
        return []

    root_ids = [r[0].id for r in root_rows]
    reply_rows = db.execute(
        select(ReaderComment, User.username, User.avatar_url, User.role_id)
        .join(User, ReaderComment.user_id == User.id)
        .where(ReaderComment.parent_comment_id.in_(root_ids))
        .order_by(ReaderComment.created_at.asc(), ReaderComment.id.asc())
    ).all()

    is_mod = bool(current_user is not None and current_user.role_id in (1, 2))
    uid = current_user.id if current_user is not None else None

    def _serialize(comment: ReaderComment, uname: str, avatar: str | None, role_id: int) -> dict[str, Any]:
        return {
            "id": comment.id,
            "source_id": comment.source_id,
            "manga_id": comment.manga_id,
            "chapter_id": comment.chapter_id,
            "chapter_label": comment.chapter_label,
            "user_id": comment.user_id,
            "username": uname or "",
            "user_name": uname or "",
            "avatar_url": _normalize_avatar_url(avatar),
            "is_staff": role_id in (1, 2),
            "parent_comment_id": comment.parent_comment_id,
            "content": comment.content,
            "created_at": _iso_utc(comment.created_at),
            "can_delete": bool(is_mod or (uid is not None and uid == comment.user_id)),
            "replies": [],
        }

    replies_by_parent: dict[int, list[dict[str, Any]]] = {}
    for c, uname, avatar, rid in reply_rows:
        if c.parent_comment_id is not None:
            replies_by_parent.setdefault(c.parent_comment_id, []).append(
                _serialize(c, uname, avatar, int(rid or 3))
            )

    roots: list[dict[str, Any]] = []
    for c, uname, avatar, rid in root_rows:
        dto = _serialize(c, uname, avatar, int(rid or 3))
        dto["replies"] = replies_by_parent.get(c.id, [])
        roots.append(dto)
    return roots


def _sync_comment_count(db: Session, source_id: str, manga_id: str) -> int:
    total = (
        db.scalar(
            select(func.count(ReaderComment.id)).where(
                ReaderComment.source_id == source_id,
                ReaderComment.manga_id == manga_id,
            )
        )
        or 0
    )
    stat = _get_or_create_stat(db, source_id, manga_id)
    stat.comment_count = int(total)
    stat.updated_at = utc_now()
    return int(total)


def add_comment(
    db: Session,
    *,
    source_id: str,
    manga_id: str,
    user: User,
    content: str,
    parent_comment_id: int | None = None,
    chapter_id: str | None = None,
    chapter_label: str | None = None,
) -> dict[str, Any]:
    norm_src, norm_mid = _normalize_keys(source_id, manga_id)
    trimmed = (content or "").strip()
    if not trimmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nội dung bình luận không được để trống.",
        )
    if len(trimmed) > MAX_COMMENT_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Nội dung bình luận tối đa {MAX_COMMENT_LENGTH} ký tự.",
        )

    resolved_parent_id: int | None = None
    if parent_comment_id is not None:
        if parent_comment_id <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bình luận gốc không hợp lệ.")
        parent = db.scalar(
            select(ReaderComment).where(
                ReaderComment.id == parent_comment_id,
                ReaderComment.source_id == norm_src,
                ReaderComment.manga_id == norm_mid,
            )
        )
        if parent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Bình luận bạn đang trả lời không tồn tại hoặc đã bị xóa.",
            )
        resolved_parent_id = parent.parent_comment_id if parent.parent_comment_id is not None else parent.id

    clean_chap_id = chapter_id.strip()[:255] if chapter_id and chapter_id.strip() else None
    clean_chap_label = chapter_label.strip()[:120] if chapter_label and chapter_label.strip() else None

    comment = ReaderComment(
        source_id=norm_src,
        manga_id=norm_mid,
        chapter_id=clean_chap_id,
        chapter_label=clean_chap_label,
        user_id=user.id,
        parent_comment_id=resolved_parent_id,
        content=trimmed,
    )
    db.add(comment)
    db.flush()
    total_comments = _sync_comment_count(db, norm_src, norm_mid)
    db.commit()
    db.refresh(comment)

    return {
        "comment": {
            "id": comment.id,
            "source_id": comment.source_id,
            "manga_id": comment.manga_id,
            "chapter_id": comment.chapter_id,
            "chapter_label": comment.chapter_label,
            "user_id": comment.user_id,
            "username": user.username,
            "user_name": user.username,
            "avatar_url": _normalize_avatar_url(user.avatar_url),
            "is_staff": user.role_id in (1, 2),
            "parent_comment_id": comment.parent_comment_id,
            "content": comment.content,
            "created_at": _iso_utc(comment.created_at),
            "can_delete": True,
            "replies": [],
        },
        "comment_count": total_comments,
        "message": "Đã đăng bình luận.",
    }


def delete_comment(db: Session, *, comment_id: int, current_user: User) -> dict[str, Any]:
    comment = db.scalar(select(ReaderComment).where(ReaderComment.id == comment_id))
    if comment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bình luận không tồn tại hoặc đã bị xóa.",
        )
    is_mod = current_user.role_id in (1, 2)
    if not is_mod and comment.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền xóa bình luận này.",
        )

    src = comment.source_id
    mid = comment.manga_id
    db.delete(comment)
    db.flush()
    total_comments = _sync_comment_count(db, src, mid)
    db.commit()
    return {"message": "Đã xóa bình luận.", "comment_count": total_comments}


def upsert_rating(
    db: Session, *, source_id: str, manga_id: str, user: User, score: int
) -> dict[str, Any]:
    norm_src, norm_mid = _normalize_keys(source_id, manga_id)
    if score < 1 or score > 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Điểm đánh giá phải từ 1 đến 5 sao.",
        )

    existing = db.scalar(
        select(ReaderRating).where(
            ReaderRating.source_id == norm_src,
            ReaderRating.manga_id == norm_mid,
            ReaderRating.user_id == user.id,
        )
    )
    if existing is None:
        db.add(
            ReaderRating(
                source_id=norm_src,
                manga_id=norm_mid,
                user_id=user.id,
                score=score,
            )
        )
    else:
        existing.score = score
        existing.updated_at = utc_now()
    db.flush()

    agg_row = db.execute(
        select(func.avg(ReaderRating.score), func.count(ReaderRating.id)).where(
            ReaderRating.source_id == norm_src,
            ReaderRating.manga_id == norm_mid,
        )
    ).one()
    avg_val = round(float(agg_row[0] or 0.0), 2)
    cnt_val = int(agg_row[1] or 0)

    stat = _get_or_create_stat(db, norm_src, norm_mid)
    stat.average_rating = avg_val
    stat.ratings_count = cnt_val
    stat.updated_at = utc_now()
    db.commit()

    return {
        "message": "Đã lưu đánh giá của bạn.",
        "source_id": norm_src,
        "manga_id": norm_mid,
        "user_rating": score,
        "average_rating": avg_val,
        "ratings_count": cnt_val,
    }


def get_user_rating(db: Session, source_id: str, manga_id: str, user_id: int) -> int | None:
    norm_src = (source_id or "").strip().lower()
    norm_mid = (manga_id or "").strip()
    if not norm_src or not norm_mid:
        return None
    val = db.scalar(
        select(ReaderRating.score).where(
            ReaderRating.source_id == norm_src,
            ReaderRating.manga_id == norm_mid,
            ReaderRating.user_id == user_id,
        )
    )
    return int(val) if val is not None else None


def _parse_read_chapters_json(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(x) for x in parsed if str(x).strip()]
    except (ValueError, TypeError):
        pass
    return []


def _serialize_history(row: ReaderHistory) -> dict[str, Any]:
    return {
        "source_id": row.source_id,
        "manga_id": row.manga_id,
        "title": row.title,
        "cover_url": row.cover_url or DEFAULT_COVER_URL,
        "chapter_id": row.chapter_id,
        "chapter_label": row.chapter_label,
        "current_page": int(row.current_page or 1),
        "total_pages": int(row.total_pages or 0),
        "language": row.language,
        "read_chapters": _parse_read_chapters_json(row.read_chapters_json),
        "updated_at": _iso_utc(row.updated_at),
    }


def _serialize_bookmark(row: ReaderBookmark) -> dict[str, Any]:
    return {
        "source_id": row.source_id,
        "manga_id": row.manga_id,
        "title": row.title,
        "cover_url": row.cover_url or DEFAULT_COVER_URL,
        "author": row.author,
        "status_label": row.status_label,
        "category": row.category,
        "updated_at": _iso_utc(row.updated_at),
    }


def _merge_read_chapter(existing_json: str | None, chapter_id: str) -> str:
    chapters = _parse_read_chapters_json(existing_json)
    clean_cid = chapter_id.strip()
    if clean_cid:
        chapters = [clean_cid] + [c for c in chapters if c.lower() != clean_cid.lower()]
    return json.dumps(chapters[:40], ensure_ascii=False)


def upsert_reading_history(
    db: Session,
    *,
    user_id: int,
    source_id: str,
    manga_id: str,
    title: str,
    cover_url: str,
    chapter_id: str,
    chapter_label: str,
    current_page: int,
    total_pages: int,
    language: str,
) -> dict[str, Any]:
    norm_src = source_id.strip().lower()[:64]
    norm_mid = manga_id.strip()[:255]
    norm_cid = chapter_id.strip()[:255]

    row = db.scalar(
        select(ReaderHistory).where(
            ReaderHistory.user_id == user_id,
            ReaderHistory.source_id == norm_src,
            ReaderHistory.manga_id == norm_mid,
        )
    )
    resolved_cover = (
        cover_url.strip()[:500]
        if cover_url and cover_url.strip()
        else (row.cover_url if row and row.cover_url else DEFAULT_COVER_URL)
    )
    resolved_title = (
        title.strip()[:255]
        if title and title.strip()
        else (row.title if row and row.title else "Đọc truyện")
    )
    resolved_label = (
        chapter_label.strip()[:200]
        if chapter_label and chapter_label.strip()
        else (row.chapter_label if row else "")
    )
    safe_page = max(1, current_page)
    safe_total = max(0, total_pages)
    if safe_total > 0:
        safe_page = min(safe_page, safe_total)

    if row is None:
        row = ReaderHistory(
            user_id=user_id,
            source_id=norm_src,
            manga_id=norm_mid,
            title=resolved_title,
            cover_url=resolved_cover,
            chapter_id=norm_cid,
            chapter_label=resolved_label,
            current_page=safe_page,
            total_pages=safe_total,
            language=(language or "vi").strip()[:16],
            read_chapters_json=_merge_read_chapter("[]", norm_cid),
        )
        db.add(row)
    else:
        row.title = resolved_title
        row.cover_url = resolved_cover
        row.chapter_id = norm_cid
        row.chapter_label = resolved_label
        row.current_page = safe_page
        row.total_pages = safe_total
        row.language = (language or row.language or "vi").strip()[:16]
        row.read_chapters_json = _merge_read_chapter(row.read_chapters_json, norm_cid)
        row.updated_at = utc_now()

    db.commit()
    db.refresh(row)
    return _serialize_history(row)


def update_reading_progress(
    db: Session,
    *,
    user_id: int,
    source_id: str,
    manga_id: str,
    chapter_id: str,
    page: int,
    total_pages: int | None = None,
    title: str | None = None,
    chapter_label: str | None = None,
    cover_url: str | None = None,
    language: str | None = None,
) -> dict[str, Any]:
    norm_src, norm_mid = _normalize_keys(source_id, manga_id)
    norm_cid = chapter_id.strip()[:255]
    if not norm_cid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mã chương không hợp lệ.")

    row = db.scalar(
        select(ReaderHistory).where(
            ReaderHistory.user_id == user_id,
            ReaderHistory.source_id == norm_src,
            ReaderHistory.manga_id == norm_mid,
        )
    )
    if row is None:
        return upsert_reading_history(
            db,
            user_id=user_id,
            source_id=norm_src,
            manga_id=norm_mid,
            title=title or "Đọc truyện",
            cover_url=cover_url or DEFAULT_COVER_URL,
            chapter_id=norm_cid,
            chapter_label=chapter_label or norm_cid,
            current_page=max(1, page),
            total_pages=max(0, total_pages or 0),
            language=language or ("en" if norm_src == "mangadex-en" else "vi"),
        )

    eff_total = max(0, total_pages) if total_pages is not None else int(row.total_pages or 0)
    is_same_chap = row.chapter_id.lower() == norm_cid.lower()
    clamped = min(max(1, page), eff_total) if (is_same_chap and eff_total > 0) else max(1, page)

    row.chapter_id = norm_cid
    row.current_page = clamped
    if total_pages is not None:
        row.total_pages = eff_total
    if title and title.strip():
        row.title = title.strip()[:255]
    if chapter_label and chapter_label.strip():
        row.chapter_label = chapter_label.strip()[:200]
    if cover_url and cover_url.strip():
        row.cover_url = cover_url.strip()[:500]
    if language and language.strip():
        row.language = language.strip()[:16]
    row.read_chapters_json = _merge_read_chapter(row.read_chapters_json, norm_cid)
    row.updated_at = utc_now()

    db.commit()
    db.refresh(row)
    return _serialize_history(row)


def get_shelf(db: Session, user_id: int, *, category: str | None = None) -> dict[str, Any]:
    history_rows = db.scalars(
        select(ReaderHistory)
        .where(ReaderHistory.user_id == user_id)
        .order_by(ReaderHistory.updated_at.desc(), ReaderHistory.id.desc())
        .limit(100)
    ).all()

    all_bookmarks = db.scalars(
        select(ReaderBookmark)
        .where(ReaderBookmark.user_id == user_id)
        .order_by(ReaderBookmark.updated_at.desc(), ReaderBookmark.id.desc())
        .limit(120)
    ).all()

    cat = (category or "all").strip().lower()
    if cat and cat != "all":
        filtered_bookmarks = [b for b in all_bookmarks if b.category.lower() == cat]
    else:
        filtered_bookmarks = list(all_bookmarks)

    return {
        "history": [_serialize_history(h) for h in history_rows],
        "bookmarks": [_serialize_bookmark(b) for b in filtered_bookmarks],
        "total_bookmarks": len(all_bookmarks),
    }


def set_bookmark(
    db: Session,
    *,
    user_id: int,
    source_id: str,
    manga_id: str,
    category: str,
    title: str = "",
    cover_url: str = "",
    author: str = "",
    status_label: str = "",
) -> dict[str, Any]:
    norm_src, norm_mid = _normalize_keys(source_id, manga_id)
    norm_cat = (category or "").strip().lower()

    existing = db.scalar(
        select(ReaderBookmark).where(
            ReaderBookmark.user_id == user_id,
            ReaderBookmark.source_id == norm_src,
            ReaderBookmark.manga_id == norm_mid,
        )
    )
    if not norm_cat or norm_cat == "none":
        if existing is not None:
            db.delete(existing)
            db.commit()
        return {"message": "Đã bỏ đánh dấu truyện.", "bookmark": None, "category": ""}

    if norm_cat not in ALLOWED_BOOKMARK_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Danh mục tủ truyện không hợp lệ (reading, plan, favorite, completed, none).",
        )

    clean_title = (title or "").strip()[:255] or (existing.title if existing else "Đọc truyện")
    clean_cover = (cover_url or "").strip()[:500] or (existing.cover_url if existing else DEFAULT_COVER_URL)
    clean_author = (author or "").strip()[:150] or (existing.author if existing else "")
    clean_status = (status_label or "").strip()[:80] or (existing.status_label if existing else "")

    if existing is None:
        existing = ReaderBookmark(
            user_id=user_id,
            source_id=norm_src,
            manga_id=norm_mid,
            title=clean_title,
            cover_url=clean_cover,
            author=clean_author,
            status_label=clean_status,
            category=norm_cat,
        )
        db.add(existing)
    else:
        existing.title = clean_title
        existing.cover_url = clean_cover
        existing.author = clean_author
        existing.status_label = clean_status
        existing.category = norm_cat
        existing.updated_at = utc_now()

    db.commit()
    db.refresh(existing)
    return {
        "message": "Đã cập nhật tủ truyện.",
        "bookmark": _serialize_bookmark(existing),
        "category": existing.category,
    }


def remove_history_item(db: Session, *, user_id: int, source_id: str, manga_id: str) -> dict[str, str]:
    norm_src, norm_mid = _normalize_keys(source_id, manga_id)
    row = db.scalar(
        select(ReaderHistory).where(
            ReaderHistory.user_id == user_id,
            ReaderHistory.source_id == norm_src,
            ReaderHistory.manga_id == norm_mid,
        )
    )
    if row is not None:
        db.delete(row)
        db.commit()
    return {"message": "Đã xóa khỏi lịch sử đọc."}


def clear_user_history(db: Session, *, user_id: int) -> dict[str, str]:
    rows = db.scalars(select(ReaderHistory).where(ReaderHistory.user_id == user_id)).all()
    for r in rows:
        db.delete(r)
    db.commit()
    return {"message": "Đã xóa toàn bộ lịch sử đọc."}


async def get_manga_detail(
    db: Session,
    *,
    source: str = "mangadex-vi",
    manga_id: str,
    lang: str = "vi",
    chapter_order: str = "desc",
    chapter_q: str | None = None,
    proxy: bool = True,
    current_user: User | None = None,
) -> dict[str, Any]:
    provider = resolve_provider(source)
    detail = await provider.get_manga_detail(manga_id, lang, db, use_proxy=proxy)
    manga = detail.get("manga")
    canonical_id = str(manga["id"]).strip() if manga and manga.get("id") else manga_id.strip()

    if manga is not None:
        merge_local_stats(db, provider.source_id, [manga])
        if not detail.get("error_message"):
            increment_read_count(db, provider.source_id, canonical_id)
            manga["view_count"] = int(manga.get("view_count") or 0) + 1

    primary_title = (manga or {}).get("title") or ""
    matched_products = find_store_matches(db, primary_title)
    if not matched_products and manga and manga.get("alt_title"):
        matched_products = find_store_matches(db, manga["alt_title"])

    filtered_chapters = _filter_and_sort_chapters(detail.get("chapters") or [], chapter_q, chapter_order)
    comments = get_comments(db, provider.source_id, canonical_id, current_user=current_user, limit=60)
    local_stats = get_single_stats(db, provider.source_id, canonical_id)

    user_rating: int | None = None
    bookmark_category = ""
    last_history: dict[str, Any] | None = None
    read_chapter_ids: list[str] = []

    if current_user is not None and canonical_id:
        user_rating = get_user_rating(db, provider.source_id, canonical_id, current_user.id)
        bm = db.scalar(
            select(ReaderBookmark).where(
                ReaderBookmark.user_id == current_user.id,
                ReaderBookmark.source_id == provider.source_id,
                ReaderBookmark.manga_id == canonical_id,
            )
        )
        bookmark_category = bm.category if bm is not None else ""
        hist = db.scalar(
            select(ReaderHistory).where(
                ReaderHistory.user_id == current_user.id,
                ReaderHistory.source_id == provider.source_id,
                ReaderHistory.manga_id == canonical_id,
            )
        )
        if hist is not None:
            last_history = _serialize_history(hist)
            read_chapter_ids = last_history["read_chapters"]

    return {
        "source_id": provider.source_id,
        "manga": manga,
        "description": detail.get("description") or "",
        "chapters": filtered_chapters,
        "all_chapters_count": len(detail.get("chapters") or []),
        "available_languages": detail.get("available_languages") or [],
        "selected_language": detail.get("selected_language") or lang,
        "matched_store_products": matched_products,
        "is_store_db_online": True,
        "local_stats": local_stats,
        "comments": comments,
        "user_rating": user_rating,
        "bookmark_category": bookmark_category,
        "last_history": last_history,
        "read_chapter_ids": read_chapter_ids,
        "error_message": detail.get("error_message"),
    }


async def _resolve_cover_for_history(
    db: Session,
    provider: MangaSourceProvider,
    user_id: int,
    manga_id: str,
    lang: str,
    *,
    use_proxy: bool = True,
) -> str:
    hist = db.scalar(
        select(ReaderHistory).where(
            ReaderHistory.user_id == user_id,
            ReaderHistory.source_id == provider.source_id,
            ReaderHistory.manga_id == manga_id,
        )
    )
    if hist and hist.cover_url:
        return hist.cover_url
    bm = db.scalar(
        select(ReaderBookmark).where(
            ReaderBookmark.user_id == user_id,
            ReaderBookmark.source_id == provider.source_id,
            ReaderBookmark.manga_id == manga_id,
        )
    )
    if bm and bm.cover_url:
        return bm.cover_url
    try:
        detail = await provider.get_manga_detail(manga_id, lang, db, use_proxy=use_proxy)
        cover = (detail.get("manga") or {}).get("cover_url")
        if cover:
            return str(cover)
    except Exception:
        pass
    return DEFAULT_COVER_URL


async def get_chapter_pages(
    db: Session,
    *,
    source: str = "mangadex-vi",
    manga_id: str = "",
    chapter_id: str,
    lang: str = "vi",
    quality: str = "saver",
    proxy: bool = True,
    page: int | None = None,
    current_user: User | None = None,
) -> dict[str, Any]:
    provider = resolve_provider(source)
    chapter_data = await provider.get_chapter_pages(
        manga_id,
        chapter_id,
        lang,
        db,
        quality=quality,
        use_proxy=proxy,
    )

    effective_manga_id = (chapter_data.get("manga_id") or manga_id or "").strip()
    effective_chap_id = (chapter_data.get("chapter_id") or chapter_id or "").strip()
    active_pages = chapter_data.get("pages") or []
    total_pages = len(active_pages)

    requested_page = 1
    if page is not None:
        requested_page = page
    elif current_user is not None and effective_manga_id:
        existing_hist = db.scalar(
            select(ReaderHistory).where(
                ReaderHistory.user_id == current_user.id,
                ReaderHistory.source_id == provider.source_id,
                ReaderHistory.manga_id == effective_manga_id,
            )
        )
        if (
            existing_hist is not None
            and existing_hist.chapter_id.lower() == effective_chap_id.lower()
            and existing_hist.current_page > 1
        ):
            requested_page = existing_hist.current_page

    resolved_page = max(1, min(requested_page, total_pages)) if total_pages > 0 else 1

    has_valid_content = (
        not chapter_data.get("error_message")
        and (
            total_pages > 0
            or (chapter_data.get("is_text_content") and bool((chapter_data.get("text_content") or "").strip()))
        )
    )

    if has_valid_content and effective_manga_id:
        if page is None or page <= 1:
            increment_read_count(db, provider.source_id, effective_manga_id)
        if current_user is not None:
            cover_url = await _resolve_cover_for_history(
                db, provider, current_user.id, effective_manga_id, lang, use_proxy=proxy
            )
            upsert_reading_history(
                db,
                user_id=current_user.id,
                source_id=provider.source_id,
                manga_id=effective_manga_id,
                title=chapter_data.get("manga_title") or "",
                cover_url=cover_url,
                chapter_id=effective_chap_id,
                chapter_label=chapter_data.get("chapter_label") or "",
                current_page=resolved_page,
                total_pages=total_pages,
                language=lang or ("en" if provider.source_id == "mangadex-en" else "vi"),
            )

    comments = (
        get_comments(db, provider.source_id, effective_manga_id, current_user=current_user, limit=40)
        if effective_manga_id
        else []
    )
    local_stats = (
        get_single_stats(db, provider.source_id, effective_manga_id)
        if effective_manga_id
        else {"read_count": 0, "average_rating": 0.0, "ratings_count": 0, "comment_count": 0}
    )
    loaded_total = sum(1 + len(c.get("replies") or []) for c in comments)

    return {
        **chapter_data,
        "current_page": resolved_page,
        "total_pages": total_pages,
        "selected_language": lang or ("en" if provider.source_id == "mangadex-en" else "vi"),
        "comments": comments,
        "total_comment_count": max(local_stats["comment_count"], loaded_total),
        "local_stats": local_stats,
    }
