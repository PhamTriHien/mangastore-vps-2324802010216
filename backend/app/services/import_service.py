from __future__ import annotations

from dataclasses import dataclass, field
import io
import json
import math
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time
from typing import Any
from uuid import uuid4
import zipfile

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.config import ensure_upload_dirs
from app.models import (
    CartItem,
    Chapter,
    Genre,
    ImportHistory,
    OrderItem,
    Product,
    ProductAsset,
    ProductGenre,
    ProductTag,
    Review,
    Tag,
    WishlistItem,
    utc_now,
)

MAX_ZIP_ENTRIES = 5000
MAX_ZIP_UNCOMPRESSED = 100 * 1024 * 1024
MAX_STAGING_ENTRIES = 100
STAGING_TTL_SECONDS = 1800
DEFAULT_COVER_URL = "/covers/default-manga.svg"
SUPPORTED_IMAGE_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".gif", ".webp"})
_PROTECTED_COVER_NAMES = frozenset({"default-manga.svg", "placeholder.jpg", "placeholder.svg"})
_IMAGE_FOLDER_NAMES = ("images", "anh", "covers", "hinh", "img")
_TRUTHY_BOOL_VALUES = frozenset({"1", "true", "có", "yes"})
_ZIP_COPY_CHUNK_SIZE = 65536


class ImportValidationError(ValueError):
    """Raised when an uploaded import file fails validation or safety checks."""


class ImportNotFoundError(LookupError):
    """Raised when a staged token or import batch cannot be found."""


@dataclass
class ImportProductRow:
    row_number: int
    name: str = ""
    category: str = ""
    price: float = 0.0
    original_price: float | None = None
    stock_quantity: int = 0
    author: str = ""
    publisher: str | None = None
    description: str = ""
    tags: str = ""
    is_featured: bool = False
    cover_image_file: str = ""
    gallery_image_files: str = ""
    is_valid: bool = True
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "row_number": self.row_number,
            "name": self.name,
            "category": self.category,
            "price": self.price,
            "original_price": self.original_price,
            "stock_quantity": self.stock_quantity,
            "author": self.author or "Không rõ",
            "publisher": self.publisher,
            "description": self.description,
            "tags": self.tags,
            "is_featured": self.is_featured,
            "cover_image_file": self.cover_image_file,
            "gallery_image_files": self.gallery_image_files,
            "is_valid": self.is_valid,
            "errors": list(self.errors),
        }


@dataclass
class _StagedImportEntry:
    token: str
    path: Path
    is_zip: bool
    file_name: str
    created_at: float
    expires_at: float


_STAGING_ROOT = Path(tempfile.gettempdir()) / "mangastore_import_staging"
_STAGING_LOCK = threading.Lock()
_STAGING_CACHE: dict[str, _StagedImportEntry] = {}


def has_valid_image_magic_bytes(data: bytes, extension: str) -> bool:
    """Verify binary file header magic bytes match the declared image extension."""
    ext = extension.lower().strip()
    if ext not in SUPPORTED_IMAGE_EXTENSIONS or len(data) < 6:
        return False

    if ext in (".jpg", ".jpeg"):
        return data[:3] == b"\xff\xd8\xff"
    if ext == ".png":
        return len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n"
    if ext == ".gif":
        return data[:6] in (b"GIF87a", b"GIF89a")
    if ext == ".webp":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False


def is_valid_image_file(file_path: Path) -> bool:
    ext = file_path.suffix.lower()
    if ext not in SUPPORTED_IMAGE_EXTENSIONS:
        return False
    try:
        with file_path.open("rb") as fh:
            header = fh.read(16)
        return has_valid_image_magic_bytes(header, ext)
    except OSError:
        return False


def _remove_path_safely(path: Path) -> None:
    try:
        resolved_root = _STAGING_ROOT.resolve()
        resolved_target = path.resolve()
        if not resolved_target.is_relative_to(resolved_root) or resolved_target == resolved_root:
            return
        if resolved_target.is_dir():
            shutil.rmtree(resolved_target, ignore_errors=True)
        elif resolved_target.exists():
            resolved_target.unlink(missing_ok=True)
    except OSError:
        pass


def _purge_expired_staging_locked(now: float) -> None:
    expired_tokens = [tok for tok, entry in _STAGING_CACHE.items() if entry.expires_at <= now]
    for tok in expired_tokens:
        entry = _STAGING_CACHE.pop(tok, None)
        if entry is not None:
            _remove_path_safely(entry.path)


def _register_staged_entry(path: Path, is_zip: bool, file_name: str) -> str:
    now = time.monotonic()
    token = uuid4().hex
    entry = _StagedImportEntry(
        token=token,
        path=path,
        is_zip=is_zip,
        file_name=file_name,
        created_at=now,
        expires_at=now + STAGING_TTL_SECONDS,
    )
    with _STAGING_LOCK:
        _purge_expired_staging_locked(now)
        while len(_STAGING_CACHE) >= MAX_STAGING_ENTRIES:
            oldest_token = min(_STAGING_CACHE, key=lambda key: _STAGING_CACHE[key].created_at)
            evicted = _STAGING_CACHE.pop(oldest_token, None)
            if evicted is not None:
                _remove_path_safely(evicted.path)
        _STAGING_CACHE[token] = entry
    return token


def _pop_staged_entry(import_token: str) -> _StagedImportEntry:
    token = (import_token or "").strip()
    if not token:
        raise ImportNotFoundError("Phiên nhập dữ liệu không hợp lệ hoặc đã hết hạn. Vui lòng tải tệp lên lại.")

    now = time.monotonic()
    with _STAGING_LOCK:
        _purge_expired_staging_locked(now)
        entry = _STAGING_CACHE.pop(token, None)

    if entry is None:
        raise ImportNotFoundError("Phiên nhập dữ liệu không hợp lệ hoặc đã hết hạn. Vui lòng tải tệp lên lại.")

    resolved_root = _STAGING_ROOT.resolve()
    resolved_path = entry.path.resolve()
    if not resolved_path.is_relative_to(resolved_root) or not resolved_path.exists():
        _remove_path_safely(entry.path)
        raise ImportNotFoundError("Dữ liệu tạm không còn tồn tại. Vui lòng tải tệp lên lại.")

    return entry


def cancel_staged_import(import_token: str) -> bool:
    token = (import_token or "").strip()
    if not token:
        return False

    now = time.monotonic()
    with _STAGING_LOCK:
        _purge_expired_staging_locked(now)
        entry = _STAGING_CACHE.pop(token, None)

    if entry is None:
        return False
    _remove_path_safely(entry.path)
    return True


def _validate_zip_entry_relpath(raw_name: str) -> Path | None:
    if not raw_name:
        return None
    if "\x00" in raw_name:
        raise ImportValidationError("Tệp ZIP chứa đường dẫn không hợp lệ.")
    if raw_name.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", raw_name):
        raise ImportValidationError("Tệp ZIP chứa đường dẫn gốc không an toàn.")

    parts = [part for part in raw_name.replace("\\", "/").split("/") if part]
    if not parts:
        return None
    if any(part in (".", "..") for part in parts):
        raise ImportValidationError("Tệp ZIP chứa đường dẫn không hợp lệ (..).")

    candidate = Path(*parts)
    if candidate.is_absolute():
        raise ImportValidationError("Tệp ZIP chứa đường dẫn tuyệt đối không an toàn.")
    return candidate


def extract_zip_safely(zip_bytes: bytes, dest_root: Path) -> None:
    """Extract ZIP archive into dest_root with zip-slip, entry count, and zip-bomb protections."""
    resolved_root = dest_root.resolve()
    total_uncompressed = 0

    try:
        zf_ctx = zipfile.ZipFile(io.BytesIO(zip_bytes), mode="r")
    except zipfile.BadZipFile as exc:
        raise ImportValidationError("Tệp ZIP không hợp lệ hoặc bị hỏng.") from exc

    with zf_ctx as zf:
        infos = zf.infolist()
        if len(infos) > MAX_ZIP_ENTRIES:
            raise ImportValidationError(
                f"Tệp ZIP chứa quá nhiều mục (tối đa {MAX_ZIP_ENTRIES} tệp)."
            )

        for info in infos:
            # Reject POSIX symlinks stored in external_attr
            if ((info.external_attr >> 16) & 0o170000) == 0o120000:
                raise ImportValidationError("Tệp ZIP chứa liên kết tượng trưng không an toàn.")

            rel_path = _validate_zip_entry_relpath(info.filename)
            if rel_path is None:
                continue

            target_path = (resolved_root / rel_path).resolve()
            if not target_path.is_relative_to(resolved_root):
                raise ImportValidationError("Tệp ZIP chứa đường dẫn vượt khỏi thư mục tạm.")

            if info.is_dir():
                target_path.mkdir(parents=True, exist_ok=True)
                continue

            if info.file_size < 0 or info.file_size > MAX_ZIP_UNCOMPRESSED:
                raise ImportValidationError(
                    "Tổng dung lượng giải nén của tệp ZIP vượt quá giới hạn 100MB."
                )
            if total_uncompressed + info.file_size > MAX_ZIP_UNCOMPRESSED:
                raise ImportValidationError(
                    "Tổng dung lượng giải nén của tệp ZIP vượt quá giới hạn 100MB."
                )

            target_path.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info, mode="r") as src, target_path.open("wb") as dst:
                while True:
                    chunk = src.read(_ZIP_COPY_CHUNK_SIZE)
                    if not chunk:
                        break
                    total_uncompressed += len(chunk)
                    if total_uncompressed > MAX_ZIP_UNCOMPRESSED:
                        raise ImportValidationError(
                            "Tổng dung lượng giải nén của tệp ZIP vượt quá giới hạn 100MB."
                        )
                    dst.write(chunk)


def _find_excel_in_folder(root: Path) -> Path:
    xlsx_files = sorted(
        p
        for p in root.rglob("*.xlsx")
        if p.is_file()
        and "__MACOSX" not in p.parts
        and not p.name.startswith("~$")
    )
    if xlsx_files:
        return xlsx_files[0]

    xls_files = sorted(
        p
        for p in root.rglob("*.xls")
        if p.is_file()
        and "__MACOSX" not in p.parts
        and not p.name.startswith("~$")
    )
    if xls_files:
        raise ImportValidationError("Hệ thống chỉ hỗ trợ định dạng Excel .xlsx.")
    raise ImportValidationError("Không tìm thấy file Excel (.xlsx) trong file ZIP.")


def _find_images_folder(root: Path) -> Path:
    all_dirs = [
        d for d in root.rglob("*") if d.is_dir() and "__MACOSX" not in d.parts
    ]
    for target_name in _IMAGE_FOLDER_NAMES:
        for d in all_dirs:
            if d.name.lower() == target_name:
                return d
    return root


def _collect_valid_images(root: Path) -> dict[str, Path]:
    images_folder = _find_images_folder(root)
    image_map: dict[str, Path] = {}
    for item in sorted(images_folder.rglob("*")):
        if not item.is_file() or "__MACOSX" in item.parts:
            continue
        if is_valid_image_file(item):
            key = item.name.lower()
            if key not in image_map:
                image_map[key] = item
    return image_map


def _cell_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _parse_float(value: Any) -> tuple[float | None, bool]:
    if value is None:
        return None, True
    if isinstance(value, bool):
        return None, False
    if isinstance(value, (int, float)):
        num = float(value)
        return (num, True) if math.isfinite(num) else (None, False)
    text = str(value).strip().replace(" ", "")
    if not text:
        return None, True
    try:
        num = float(text)
    except ValueError:
        return None, False
    return (num, True) if math.isfinite(num) else (None, False)


def _parse_int(value: Any) -> tuple[int, bool]:
    if value is None:
        return 0, True
    if isinstance(value, bool):
        return 0, False
    if isinstance(value, int):
        return value, True
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            return 0, False
        return int(value), True
    text = str(value).strip()
    if not text:
        return 0, True
    try:
        parsed = float(text)
        if not math.isfinite(parsed) or not parsed.is_integer():
            return 0, False
        return int(parsed), True
    except ValueError:
        return 0, False


def _parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = _cell_str(value).lower()
    return text in _TRUTHY_BOOL_VALUES


def split_delimited_names(raw: str) -> list[str]:
    if not raw.strip():
        return []
    seen: set[str] = set()
    items: list[str] = []
    for part in re.split(r"[,;]+", raw):
        cleaned = part.strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key not in seen:
            seen.add(key)
            items.append(cleaned)
    return items


def _parse_excel_rows(excel_path: Path) -> list[ImportProductRow]:
    wb = None
    try:
        wb = load_workbook(filename=excel_path, read_only=True, data_only=True)
    except Exception as exc:
        raise ImportValidationError(
            "Không thể đọc tệp Excel. Vui lòng kiểm tra lại định dạng .xlsx."
        ) from exc

    try:
        if not wb.worksheets:
            raise ImportValidationError("Tệp Excel không có trang tính nào.")
        ws = wb.worksheets[0]

        rows: list[ImportProductRow] = []
        for row_idx, raw_cells in enumerate(ws.iter_rows(min_row=2, max_col=12, values_only=True), start=2):
            cells = list(raw_cells) + [None] * max(0, 12 - len(raw_cells))
            if all(cell is None or (isinstance(cell, str) and not cell.strip()) for cell in cells):
                continue

            name = _cell_str(cells[0])
            category = _cell_str(cells[1])
            price_val, price_ok = _parse_float(cells[2])
            orig_val, orig_ok = _parse_float(cells[3])
            stock_val, stock_ok = _parse_int(cells[4])
            author = _cell_str(cells[5])
            publisher = _cell_str(cells[6]) or None
            description = _cell_str(cells[7])
            tags = _cell_str(cells[8])
            is_featured = _parse_bool(cells[9])
            cover_image_file = _cell_str(cells[10])
            gallery_image_files = _cell_str(cells[11])

            errors: list[str] = []
            if not name:
                errors.append("Tên sản phẩm không được để trống")
            if not category:
                errors.append("Danh mục không được để trống")
            if not price_ok or price_val is None or price_val <= 0:
                errors.append("Giá bán phải lớn hơn 0")
            if not orig_ok or (orig_val is not None and orig_val < 0):
                errors.append("Giá gốc không hợp lệ")
            if not stock_ok:
                errors.append("Số lượng tồn kho phải là số nguyên >= 0")
            elif stock_val < 0:
                errors.append("Số lượng tồn kho không được âm")

            normalized_orig = orig_val if (orig_val is not None and orig_val > 0) else None
            rows.append(
                ImportProductRow(
                    row_number=row_idx,
                    name=name,
                    category=category,
                    price=float(price_val) if (price_ok and price_val is not None) else 0.0,
                    original_price=normalized_orig,
                    stock_quantity=stock_val if stock_ok else -1,
                    author=author,
                    publisher=publisher,
                    description=description,
                    tags=tags,
                    is_featured=is_featured,
                    cover_image_file=cover_image_file,
                    gallery_image_files=gallery_image_files,
                    is_valid=len(errors) == 0,
                    errors=errors,
                )
            )

        return rows
    finally:
        if wb is not None:
            wb.close()


def _validate_zip_row_images(row: ImportProductRow, image_map: dict[str, Path]) -> None:
    if row.cover_image_file:
        cover_key = Path(row.cover_image_file).name.lower()
        if cover_key not in image_map:
            row.is_valid = False
            row.errors.append(f"Không tìm thấy file ảnh hợp lệ: {row.cover_image_file}")
    if row.gallery_image_files:
        for gallery_name in split_delimited_names(row.gallery_image_files):
            g_key = Path(gallery_name).name.lower()
            if g_key not in image_map:
                row.is_valid = False
                row.errors.append(f"Không tìm thấy file ảnh phụ hợp lệ: {gallery_name}")


def stage_and_preview_upload(file_name: str, file_bytes: bytes) -> dict[str, Any]:
    """Validate, stage to temporary storage, and parse an uploaded Excel/ZIP import package."""
    clean_name = Path(file_name or "import.xlsx").name
    ext = Path(clean_name).suffix.lower()
    if ext not in (".xlsx", ".zip"):
        if ext == ".xls":
            raise ImportValidationError("Hệ thống chỉ hỗ trợ file Excel (.xlsx) hoặc ZIP.")
        raise ImportValidationError("Chỉ hỗ trợ file Excel (.xlsx) hoặc ZIP.")
    if not file_bytes:
        raise ImportValidationError("Tệp tải lên trống.")

    _STAGING_ROOT.mkdir(parents=True, exist_ok=True)
    is_zip = ext == ".zip"

    if is_zip:
        staged_dir = Path(tempfile.mkdtemp(prefix="zip_", dir=_STAGING_ROOT))
        try:
            extract_zip_safely(file_bytes, staged_dir)
            excel_path = _find_excel_in_folder(staged_dir)
            image_map = _collect_valid_images(staged_dir)
            rows = _parse_excel_rows(excel_path)
            if not rows:
                raise ImportValidationError("File Excel không có dữ liệu.")

            for row in rows:
                _validate_zip_row_images(row, image_map)
        except Exception:
            _remove_path_safely(staged_dir)
            raise

        token = _register_staged_entry(staged_dir, is_zip=True, file_name=clean_name)
        valid_count = sum(1 for row in rows if row.is_valid)
        return {
            "import_token": token,
            "file_name": clean_name,
            "is_zip_import": True,
            "total_rows": len(rows),
            "valid_rows": valid_count,
            "invalid_rows": len(rows) - valid_count,
            "images_found": len(image_map),
            "products": [row.to_dict() for row in rows],
        }

    staged_file = _STAGING_ROOT / f"{uuid4().hex}.xlsx"
    staged_file.write_bytes(file_bytes)
    try:
        rows = _parse_excel_rows(staged_file)
        if not rows:
            raise ImportValidationError("File Excel không có dữ liệu.")
    except Exception:
        _remove_path_safely(staged_file)
        raise

    token = _register_staged_entry(staged_file, is_zip=False, file_name=clean_name)
    valid_count = sum(1 for row in rows if row.is_valid)
    return {
        "import_token": token,
        "file_name": clean_name,
        "is_zip_import": False,
        "total_rows": len(rows),
        "valid_rows": valid_count,
        "invalid_rows": len(rows) - valid_count,
        "images_found": 0,
        "products": [row.to_dict() for row in rows],
    }


def get_or_create_genre(db: Session, name: str) -> Genre:
    cleaned = name.strip()
    existing = db.scalar(select(Genre).where(func.lower(Genre.name) == cleaned.lower()))
    if existing is not None:
        return existing
    genre = Genre(name=cleaned, description=cleaned)
    db.add(genre)
    db.flush()
    return genre


def get_or_create_tag(db: Session, name: str) -> Tag:
    cleaned = name.strip()
    existing = db.scalar(select(Tag).where(func.lower(Tag.name) == cleaned.lower()))
    if existing is not None:
        return existing
    tag = Tag(name=cleaned, description=cleaned)
    db.add(tag)
    db.flush()
    return tag


def execute_import(
    db: Session,
    import_token: str,
    imported_by: str,
    actor_user_id: int | None = None,
) -> dict[str, Any]:
    """Commit staged Excel/ZIP products to DB, copy validated covers, and record ImportHistory."""
    entry = _pop_staged_entry(import_token)
    batch_id = uuid4().hex[:16].upper()
    imported_product_ids: list[int] = []
    imported_image_urls: list[str] = []
    errors: list[dict[str, Any]] = []
    total_processed = 0
    success_count = 0
    failed_count = 0

    try:
        if entry.is_zip:
            excel_path = _find_excel_in_folder(entry.path)
            image_map = _collect_valid_images(entry.path)
        else:
            excel_path = entry.path
            image_map = {}

        rows = _parse_excel_rows(excel_path)
        if not rows:
            raise ImportValidationError("File Excel không có dữ liệu.")

        covers_dir = ensure_upload_dirs() / "covers"
        covers_dir.mkdir(parents=True, exist_ok=True)

        for row in rows:
            total_processed += 1
            if entry.is_zip:
                _validate_zip_row_images(row, image_map)

            if not row.is_valid:
                failed_count += 1
                errors.append(
                    {
                        "row_number": row.row_number,
                        "product_name": row.name or "(Trống)",
                        "error_message": "; ".join(row.errors),
                    }
                )
                continue

            copied_files: list[Path] = []
            row_image_urls: list[str] = []
            try:
                cover_url = DEFAULT_COVER_URL
                if entry.is_zip and row.cover_image_file:
                    cover_key = Path(row.cover_image_file).name.lower()
                    src_cover = image_map.get(cover_key)
                    if src_cover is not None:
                        dest_name = f"{uuid4().hex}{src_cover.suffix.lower()}"
                        dest_path = covers_dir / dest_name
                        shutil.copy2(src_cover, dest_path)
                        copied_files.append(dest_path)
                        cover_url = f"/uploads/covers/{dest_name}"
                        row_image_urls.append(cover_url)

                gallery_urls: list[str] = []
                if entry.is_zip and row.gallery_image_files:
                    for gallery_name in split_delimited_names(row.gallery_image_files):
                        g_key = Path(gallery_name).name.lower()
                        src_gallery = image_map.get(g_key)
                        if src_gallery is not None:
                            dest_name = f"{uuid4().hex}{src_gallery.suffix.lower()}"
                            dest_path = covers_dir / dest_name
                            shutil.copy2(src_gallery, dest_path)
                            copied_files.append(dest_path)
                            g_url = f"/uploads/covers/{dest_name}"
                            gallery_urls.append(g_url)
                            row_image_urls.append(g_url)

                with db.begin_nested():
                    product = Product(
                        title=row.name.strip(),
                        author=row.author.strip() if row.author.strip() else "Không rõ",
                        publisher=row.publisher.strip() if row.publisher else None,
                        description=row.description.strip(),
                        full_description=row.description.strip(),
                        cover_url=cover_url,
                        price=row.price,
                        original_price=row.original_price,
                        stock_quantity=row.stock_quantity,
                        status="dang_ban" if row.stock_quantity > 0 else "het_hang",
                        is_featured=row.is_featured,
                        is_new=True,
                        import_batch_id=batch_id,
                        created_by=actor_user_id,
                    )
                    db.add(product)
                    db.flush()

                    genre = get_or_create_genre(db, row.category)
                    db.add(ProductGenre(product_id=product.id, genre_id=genre.id))

                    for tag_name in split_delimited_names(row.tags):
                        tag = get_or_create_tag(db, tag_name)
                        db.add(ProductTag(product_id=product.id, tag_id=tag.id))

                    for order_idx, g_url in enumerate(gallery_urls, start=1):
                        db.add(
                            ProductAsset(
                                product_id=product.id,
                                asset_type="gallery",
                                url=g_url,
                                display_order=order_idx,
                            )
                        )
                    db.flush()

                imported_product_ids.append(product.id)
                imported_image_urls.extend(row_image_urls)
                success_count += 1
            except Exception:
                for path in copied_files:
                    path.unlink(missing_ok=True)
                failed_count += 1
                errors.append(
                    {
                        "row_number": row.row_number,
                        "product_name": row.name or "(Trống)",
                        "error_message": "Không thể lưu dữ liệu dòng này.",
                    }
                )

        if imported_product_ids:
            db.add(
                ImportHistory(
                    batch_id=batch_id,
                    imported_by=imported_by or "Admin",
                    product_count=len(imported_product_ids),
                    is_zip_import=entry.is_zip,
                    file_name=entry.file_name,
                    is_restored=False,
                    product_ids_json=json.dumps(imported_product_ids),
                    image_paths_json=json.dumps(imported_image_urls),
                )
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        _remove_path_safely(entry.path)

    message = f"Đã nhập thành công {success_count}/{total_processed} sản phẩm (Mã đợt nhập: {batch_id})."
    if failed_count > 0:
        message += f" Có {failed_count} dòng bị lỗi."

    return {
        "success": success_count > 0,
        "batch_id": batch_id if imported_product_ids else None,
        "message": message,
        "total_processed": total_processed,
        "success_count": success_count,
        "failed_count": failed_count,
        "errors": errors,
    }


def cleanup_unreferenced_cover_files(db: Session, candidate_urls: set[str]) -> int:
    covers_dir = (ensure_upload_dirs() / "covers").resolve()
    if not covers_dir.exists():
        return 0

    deleted = 0
    for raw_url in candidate_urls:
        cleaned = (raw_url or "").strip()
        if not cleaned or cleaned.startswith(("http://", "https://")):
            continue
        file_name = Path(cleaned).name
        if not file_name or file_name.lower() in _PROTECTED_COVER_NAMES:
            continue

        candidate_path = (covers_dir / file_name).resolve()
        if not candidate_path.is_relative_to(covers_dir) or not candidate_path.is_file():
            continue

        normalized_url = f"/uploads/covers/{file_name}"
        still_used_cover = db.scalar(
            select(Product.id)
            .where(
                or_(
                    Product.cover_url == cleaned,
                    Product.cover_url == normalized_url,
                    Product.cover_url == file_name,
                )
            )
            .limit(1)
        )
        if still_used_cover is not None:
            continue

        still_used_asset = db.scalar(
            select(ProductAsset.id)
            .where(
                or_(
                    ProductAsset.url == cleaned,
                    ProductAsset.url == normalized_url,
                    ProductAsset.url == file_name,
                )
            )
            .limit(1)
        )
        if still_used_asset is not None:
            continue

        try:
            candidate_path.unlink(missing_ok=True)
            deleted += 1
        except OSError:
            pass
    return deleted


def restore_batch(db: Session, batch_id: str, restored_by: str) -> dict[str, Any]:
    """Transactionally roll back an import batch, archiving ordered products and deleting others."""
    cleaned_batch = (batch_id or "").strip()
    if not cleaned_batch:
        raise ImportValidationError("Mã đợt nhập không hợp lệ.")

    history = db.scalar(
        select(ImportHistory)
        .where(func.upper(ImportHistory.batch_id) == cleaned_batch.upper())
        .with_for_update()
    )
    if history is None:
        raise ImportNotFoundError("Không tìm thấy lịch sử đợt nhập với mã này.")
    if history.is_restored:
        raise ImportValidationError("Đợt nhập này đã được khôi phục trước đó.")

    products = list(
        db.scalars(select(Product).where(Product.import_batch_id == history.batch_id)).all()
    )
    if not products and history.product_ids_json:
        try:
            fallback_ids = [int(pid) for pid in json.loads(history.product_ids_json)]
        except (ValueError, TypeError):
            fallback_ids = []
        if fallback_ids:
            products = list(
                db.scalars(select(Product).where(Product.id.in_(fallback_ids))).all()
            )

    if not products:
        raise ImportNotFoundError("Không tìm thấy sản phẩm nào thuộc đợt nhập này.")

    product_ids = [p.id for p in products]
    ordered_ids = set(
        db.scalars(
            select(OrderItem.product_id)
            .where(OrderItem.product_id.in_(product_ids))
            .distinct()
        ).all()
    )

    candidate_image_urls: set[str] = set()
    if history.image_paths_json and not ordered_ids:
        try:
            for item in json.loads(history.image_paths_json):
                if isinstance(item, str) and item.strip():
                    candidate_image_urls.add(item.strip())
        except (ValueError, TypeError):
            pass

    now = utc_now()
    products_deleted = 0
    products_archived = 0

    for product in products:
        if product.id in ordered_ids:
            product.status = "ngung_ban"
            product.is_featured = False
            product.is_new = False
            product.updated_at = now
            products_archived += 1
            continue

        if product.cover_url:
            candidate_image_urls.add(product.cover_url)
        asset_urls = list(
            db.scalars(
                select(ProductAsset.url).where(ProductAsset.product_id == product.id)
            ).all()
        )
        for url in asset_urls:
            if url:
                candidate_image_urls.add(url)

        for model in (CartItem, WishlistItem, Review, ProductGenre, ProductTag, ProductAsset, Chapter):
            db.execute(delete(model).where(model.product_id == product.id))
        pid = product.id
        db.expunge(product)
        db.execute(delete(Product).where(Product.id == pid))
        products_deleted += 1

    history.is_restored = True
    history.restored_at = now
    history.restored_by = restored_by or "Admin"
    db.commit()

    images_deleted = cleanup_unreferenced_cover_files(db, candidate_image_urls)

    if products_archived > 0:
        message = (
            f"Đã khôi phục đợt nhập: xóa {products_deleted} sản phẩm ({images_deleted} ảnh) "
            f"và chuyển {products_archived} sản phẩm đã có đơn hàng sang trạng thái ngừng bán."
        )
    else:
        message = f"Đã khôi phục thành công! Đã xóa {products_deleted} sản phẩm và {images_deleted} ảnh."

    return {
        "success": True,
        "batch_id": history.batch_id,
        "products_deleted": products_deleted,
        "products_archived": products_archived,
        "images_deleted": images_deleted,
        "message": message,
    }


def build_excel_template_bytes() -> bytes:
    """Generate a 2-sheet Excel import template (`Products` and `Hướng dẫn`)."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Products"

    headers = [
        "Tên sản phẩm *",
        "Danh mục *",
        "Giá bán *",
        "Giá gốc",
        "Số lượng tồn kho",
        "Tác giả",
        "Nhà xuất bản",
        "Mô tả",
        "Tags (phân cách bởi dấu phẩy)",
        "Nổi bật (1=Có, 0=Không)",
        "Tên file ảnh bìa",
        "Tên file ảnh phụ (phân cách bởi dấu phẩy)",
    ]
    header_font = Font(bold=True, color="0F172A")
    header_fill = PatternFill(start_color="BFDBFE", end_color="BFDBFE", fill_type="solid")

    for col_idx, header_text in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header_text)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(vertical="center")

    sample_rows = [
        [
            "One Piece Tập 1",
            "Shounen",
            45000,
            55000,
            100,
            "Eiichiro Oda",
            "NXB Kim Đồng",
            "Bộ truyện huyền thoại về Luffy và các nakama",
            "hành động, phiêu lưu",
            1,
            "one-piece-1.jpg",
            "",
        ],
        [
            "Naruto Tập 1",
            "Shounen",
            42000,
            50000,
            80,
            "Masashi Kishimoto",
            "NXB Kim Đồng",
            "Câu chuyện về cậu bé ninja",
            "ninja, hành động",
            0,
            "naruto-1.jpg",
            "",
        ],
        [
            "Doraemon Tập 1",
            "Comedy",
            25000,
            None,
            150,
            "Fujiko F. Fujio",
            "NXB Kim Đồng",
            "Chú mèo máy đến từ tương lai",
            "hài hước, gia đình",
            1,
            "doraemon-1.jpg",
            "",
        ],
    ]
    for row_idx, row_values in enumerate(sample_rows, start=2):
        for col_idx, val in enumerate(row_values, start=1):
            ws.cell(row=row_idx, column=col_idx, value=val)

    column_widths = [26, 16, 14, 14, 18, 22, 18, 42, 28, 24, 22, 34]
    for idx, width in enumerate(column_widths, start=1):
        col_letter = ws.cell(row=1, column=idx).column_letter
        ws.column_dimensions[col_letter].width = width

    guide = wb.create_sheet(title="Hướng dẫn")
    title_cell = guide.cell(row=1, column=1, value="HƯỚNG DẪN IMPORT SẢN PHẨM")
    title_cell.font = Font(bold=True, size=14)

    instructions = [
        "",
        "1. Điền dữ liệu vào sheet 'Products'",
        "2. Các cột có dấu * là bắt buộc (Tên sản phẩm, Danh mục, Giá bán > 0)",
        "3. Giá bán và Giá gốc là số dương (VD: 45000)",
        "4. Số lượng tồn kho là số nguyên >= 0",
        "5. Tags phân cách bởi dấu phẩy (,) hoặc chấm phẩy (;)",
        "6. Nổi bật: nhập 1 / true / có / yes = Có; 0 hoặc để trống = Không",
        "",
        "HƯỚNG DẪN IMPORT KÈM ẢNH (ZIP):",
        "----------------------------------------",
        "1. Tạo thư mục 'images' chứa ảnh bìa/ảnh phụ (.jpg, .jpeg, .png, .gif, .webp)",
        "2. Điền tên file ảnh vào cột 'Tên file ảnh bìa' và 'Tên file ảnh phụ'",
        "3. Nén file Excel (.xlsx) + thư mục images thành file ZIP",
        "4. Tải file ZIP lên tại màn hình Import sản phẩm",
        "",
        "Cấu trúc ZIP mẫu:",
        "  - products.xlsx",
        "  - images/",
        "      - one-piece-1.jpg",
        "      - naruto-1.jpg",
        "      - doraemon-1.jpg",
    ]
    for row_idx, line in enumerate(instructions, start=2):
        guide.cell(row=row_idx, column=1, value=line)
    guide.column_dimensions["A"].width = 72

    buffer = io.BytesIO()
    wb.save(buffer)
    wb.close()
    return buffer.getvalue()


def build_zip_template_bytes() -> bytes:
    """Generate a ZIP template archive containing products.xlsx and images/README.txt."""
    excel_bytes = build_excel_template_bytes()
    readme_text = (
        "=== THƯ MỤC ẢNH SẢN PHẨM ===\n\n"
        "Đặt ảnh sản phẩm vào thư mục này.\n\n"
        "Lưu ý:\n"
        "- Tên file ảnh phải khớp với cột 'Tên file ảnh bìa' trong Excel\n"
        "- Định dạng hỗ trợ: JPG, JPEG, PNG, GIF, WEBP\n"
        "- Kích thước đề xuất: 300x450 pixels\n\n"
        "Ví dụ:\n"
        "  one-piece-1.jpg\n"
        "  naruto-1.jpg\n"
        "  doraemon-1.jpg\n"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("products.xlsx", excel_bytes)
        zf.writestr("images/README.txt", readme_text.encode("utf-8"))
    return buffer.getvalue()
