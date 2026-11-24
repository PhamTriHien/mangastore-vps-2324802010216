from __future__ import annotations

from datetime import datetime, time as dt_time, timedelta, timezone
import json
import math
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from app.config import ensure_upload_dirs
from app.database import get_db
from app.models import (
    CartItem,
    Chapter,
    Genre,
    ImportHistory,
    Order,
    OrderItem,
    OrderShipment,
    OrderStatusHistory,
    PasswordResetToken,
    Product,
    ProductAsset,
    ProductGenre,
    ProductTag,
    PromotionUsage,
    ReaderBookmark,
    ReaderComment,
    ReaderHistory,
    ReaderRating,
    Review,
    Role,
    SearchHistory,
    ShippingAddress,
    User,
    UserActivity,
    UserNotification,
    UserSession,
    WishlistItem,
    utc_now,
)
from app.security import (
    create_user_session,
    ensure_utc,
    log_user_activity,
    require_full_admin,
    require_staff,
    verify_password,
)
from app.services.email_service import send_order_status_update_email
from app.services.import_service import (
    DEFAULT_COVER_URL,
    ImportNotFoundError,
    ImportValidationError,
    SUPPORTED_IMAGE_EXTENSIONS,
    build_excel_template_bytes,
    build_zip_template_bytes,
    cancel_staged_import,
    cleanup_unreferenced_cover_files,
    execute_import,
    get_or_create_genre,
    get_or_create_tag,
    has_valid_image_magic_bytes,
    restore_batch,
    split_delimited_names,
    stage_and_preview_upload,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])

MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMPORT_UPLOAD_BYTES = 120 * 1024 * 1024
_CATEGORY_HEX_COLORS = ("#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b")

_PAID_OR_DELIVERED_STATUSES = frozenset(
    {"delivered", "da_giao", "da_giao_hang", "da_thanh_toan", "da_thu_tien", "cod_paid"}
)
_DELIVERED_STATUSES = frozenset({"delivered", "da_giao", "da_giao_hang"})
_CANCELLED_STATUSES = frozenset({"cancelled", "huy", "da_huy"})
_COD_DB_STATUSES = frozenset(
    {"cho_xu_ly", "cod_pending", "xac_nhan", "cod_confirmed", "da_thu_tien", "cod_paid"}
)
_ALLOWED_ACCOUNT_STATUSES = frozenset(
    {"hoat_dong", "bi_khoa", "tam_khoa", "khoa_vinh_vien"}
)
_ROLE_CODE_BY_ID = {
    1: "quan_tri_vien",
    2: "nhan_vien",
    3: "khach_hang",
}

_STATUS_TO_DB: dict[str, tuple[str, str, str]] = {
    "pending": ("cho_thanh_toan", "pending", "Chờ thanh toán"),
    "cho_thanh_toan": ("cho_thanh_toan", "pending", "Chờ thanh toán"),
    "processing": ("da_thanh_toan", "processing", "Đang xử lý"),
    "da_thanh_toan": ("da_thanh_toan", "processing", "Đang xử lý"),
    "cod_pending": ("cho_xu_ly", "cod_pending", "Chờ xử lý (COD)"),
    "cho_xu_ly": ("cho_xu_ly", "cod_pending", "Chờ xử lý (COD)"),
    "cod_confirmed": ("xac_nhan", "cod_confirmed", "Đã xác nhận (COD)"),
    "xac_nhan": ("xac_nhan", "cod_confirmed", "Đã xác nhận (COD)"),
    "cod_paid": ("da_thu_tien", "cod_paid", "Đã thu tiền (COD)"),
    "da_thu_tien": ("da_thu_tien", "cod_paid", "Đã thu tiền (COD)"),
    "shipped": ("shipping", "shipped", "Đang giao hàng"),
    "shipping": ("shipping", "shipped", "Đang giao hàng"),
    "dang_giao": ("shipping", "shipped", "Đang giao hàng"),
    "delivered": ("delivered", "delivered", "Đã giao hàng"),
    "da_giao": ("delivered", "delivered", "Đã giao hàng"),
    "da_giao_hang": ("delivered", "delivered", "Đã giao hàng"),
    "cancelled": ("huy", "cancelled", "Đã hủy"),
    "huy": ("huy", "cancelled", "Đã hủy"),
    "da_huy": ("huy", "cancelled", "Đã hủy"),
}

_NORMALIZE_STATUS_MAP: dict[str, str] = {
    "cho_thanh_toan": "pending",
    "pending": "pending",
    "da_thanh_toan": "processing",
    "confirmed": "processing",
    "processing": "processing",
    "cho_xu_ly": "cod_pending",
    "cod_pending": "cod_pending",
    "xac_nhan": "cod_confirmed",
    "cod_confirmed": "cod_confirmed",
    "da_thu_tien": "cod_paid",
    "cod_paid": "cod_paid",
    "dang_xu_ly": "shipped",
    "dang_giao": "shipped",
    "shipping": "shipped",
    "shipped": "shipped",
    "da_giao": "delivered",
    "da_giao_hang": "delivered",
    "delivered": "delivered",
    "da_huy": "cancelled",
    "huy": "cancelled",
    "cancelled": "cancelled",
}

_SHIPPING_STATUS_MAP: dict[str, str] = {
    "cho_thanh_toan": "cho_lay_hang",
    "cho_xu_ly": "cho_lay_hang",
    "xac_nhan": "cho_lay_hang",
    "da_thanh_toan": "cho_lay_hang",
    "shipping": "dang_giao",
    "dang_giao": "dang_giao",
    "da_thu_tien": "da_giao",
    "delivered": "da_giao",
    "da_giao": "da_giao",
    "da_giao_hang": "da_giao",
    "huy": "da_huy",
    "da_huy": "da_huy",
    "cancelled": "da_huy",
}


class AdminLoginRequest(BaseModel):
    identifier: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=128)
    remember_me: bool = False


class StockUpdateRequest(BaseModel):
    quantity: int


class OrderStatusUpdateRequest(BaseModel):
    status: str = Field(..., min_length=1, max_length=50)


class ReviewReplyRequest(BaseModel):
    reply: str = Field(..., min_length=1, max_length=2000)


class CustomerUpdateRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=20)
    role_id: int
    status: str = Field(..., min_length=1, max_length=30)


class ImportTokenRequest(BaseModel):
    import_token: str = Field(..., min_length=1, max_length=128)


def _extract_client_info(request: Request) -> tuple[str | None, str | None]:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    ip = forwarded or (request.client.host if request.client else None)
    ua = request.headers.get("user-agent")
    return ip, ua


def _is_order_paid_or_delivered(order: Order) -> bool:
    return (
        (order.status or "").strip().lower() in _PAID_OR_DELIVERED_STATUSES
        or (order.payment_status or "").strip().lower() == "da_thanh_toan"
    )


def _normalize_order_status(raw_status: str | None) -> str:
    key = (raw_status or "").strip().lower()
    if not key:
        return "pending"
    return _NORMALIZE_STATUS_MAP.get(key, key)


def _serialize_order(order: Order) -> dict[str, Any]:
    items_count = sum(item.quantity for item in (order.items or []))
    return {
        "id": order.id,
        "order_code": order.order_code,
        "customer_name": order.full_name or "Khách lẻ",
        "email": order.email or "",
        "phone": order.phone or "",
        "status": _normalize_order_status(order.status),
        "raw_status": order.status,
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "grand_total": float(order.grand_total),
        "shipping_fee": float(order.shipping_fee),
        "items_count": items_count,
        "address": order.address or "",
        "created_at": order.created_at,
        "updated_at": order.updated_at,
    }


def _is_product_in_stock(product: Product) -> bool:
    return (product.status or "").lower() == "dang_ban" and product.stock_quantity > 0


def _compute_product_status(in_stock: bool, stock_quantity: int) -> str:
    if stock_quantity <= 0:
        return "het_hang"
    return "dang_ban" if in_stock else "tam_ngung"


def _serialize_product_list_item(product: Product) -> dict[str, Any]:
    category = product.genres[0].name if product.genres else "Khác"
    tags = [t.name for t in (product.tags or [])]
    return {
        "id": product.id,
        "title": product.title,
        "name": product.title,
        "author": product.author,
        "publisher": product.publisher,
        "category": category,
        "tags": tags,
        "price": float(product.price),
        "original_price": float(product.original_price) if product.original_price is not None else None,
        "stock_quantity": product.stock_quantity,
        "in_stock": _is_product_in_stock(product),
        "status": product.status,
        "is_featured": product.is_featured,
        "is_new": product.is_new,
        "cover_url": product.cover_url or DEFAULT_COVER_URL,
        "average_rating": float(product.average_rating),
        "ratings_count": product.ratings_count,
        "units_sold": product.units_sold,
        "view_count": product.view_count,
        "import_batch_id": product.import_batch_id,
        "created_at": product.created_at,
        "updated_at": product.updated_at,
    }


def _serialize_product_detail(product: Product) -> dict[str, Any]:
    data = _serialize_product_list_item(product)
    data.update(
        {
            "publication_date": product.publication_date,
            "pages": product.pages,
            "dimensions": product.dimensions,
            "weight": product.weight,
            "language": product.language,
            "isbn": product.isbn,
            "description": product.description,
            "full_description": product.full_description,
            "tags_input": ", ".join(data["tags"]),
            "gallery": [
                {
                    "id": asset.id,
                    "url": asset.url,
                    "asset_type": asset.asset_type,
                    "description": asset.description,
                    "display_order": asset.display_order,
                }
                for asset in sorted(product.assets or [], key=lambda a: (a.display_order, a.id))
            ],
        }
    )
    return data


async def _save_uploaded_image(upload: UploadFile) -> tuple[str, Path]:
    filename = (upload.filename or "").strip()
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Định dạng ảnh không hợp lệ. Chỉ chấp nhận JPG, JPEG, PNG, GIF hoặc WEBP.",
        )

    data = await upload.read(MAX_UPLOAD_IMAGE_BYTES + 1)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tệp ảnh tải lên trống.",
        )
    if len(data) > MAX_UPLOAD_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kích thước ảnh không được vượt quá 5MB.",
        )
    if not has_valid_image_magic_bytes(data[:16], ext):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nội dung tệp ảnh không khớp với định dạng JPG, PNG, GIF hoặc WEBP hợp lệ.",
        )

    covers_dir = ensure_upload_dirs() / "covers"
    covers_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid4().hex}{ext}"
    dest_path = covers_dir / stored_name
    dest_path.write_bytes(data)
    return f"/uploads/covers/{stored_name}", dest_path


def _parse_optional_float(raw: str | None, field_label: str) -> float | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        val = float(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_label} không hợp lệ.") from exc
    if not math.isfinite(val) or val <= 0:
        raise HTTPException(status_code=400, detail=f"{field_label} phải là số dương.")
    return val


def _parse_optional_int(raw: str | None, field_label: str, minimum: int = 0) -> int | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        val = int(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_label} phải là số nguyên.") from exc
    if val < minimum:
        raise HTTPException(status_code=400, detail=f"{field_label} phải lớn hơn hoặc bằng {minimum}.")
    return val


def _parse_optional_bool(raw: str | None) -> bool | None:
    if raw is None:
        return None
    text = raw.strip().lower()
    if not text:
        return None
    if text in {"1", "true", "yes", "on", "có"}:
        return True
    if text in {"0", "false", "no", "off", "không"}:
        return False
    raise HTTPException(status_code=400, detail="Giá trị boolean không hợp lệ.")


def _parse_tags_input(raw: str | None) -> list[str]:
    if raw is None:
        return []
    text = raw.strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                seen: set[str] = set()
                items: list[str] = []
                for elem in parsed:
                    tag_str = str(elem).strip()
                    if tag_str and tag_str.lower() not in seen:
                        seen.add(tag_str.lower())
                        items.append(tag_str)
                return items
        except json.JSONDecodeError:
            pass
    return split_delimited_names(text)


def _parse_id_list(raw: str | None) -> list[int]:
    if raw is None:
        return []
    text = raw.strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [int(item) for item in parsed]
        except (json.JSONDecodeError, ValueError, TypeError) as exc:
            raise HTTPException(status_code=400, detail="Danh sách remove_asset_ids không hợp lệ.") from exc
    try:
        return [int(part.strip()) for part in text.split(",") if part.strip()]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Danh sách remove_asset_ids không hợp lệ.") from exc


def _replace_product_genre(db: Session, product: Product, category_name: str) -> None:
    cleaned = category_name.strip()
    product.genres = [get_or_create_genre(db, cleaned)] if cleaned else []


def _replace_product_tags(db: Session, product: Product, tag_names: list[str]) -> None:
    product.tags = [get_or_create_tag(db, tag_name) for tag_name in tag_names]


def _load_product_or_404(db: Session, product_id: int) -> Product:
    product = db.scalar(
        select(Product)
        .options(
            selectinload(Product.genres),
            selectinload(Product.tags),
            selectinload(Product.assets),
        )
        .where(Product.id == product_id)
    )
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sản phẩm.")
    return product


def _is_order_status_valid_for_method(status_input: str, payment_method: str, current_db_status: str) -> bool:
    norm = status_input.strip().lower()
    mapped_norm = _normalize_order_status(norm)
    if mapped_norm in ("shipped", "delivered", "cancelled"):
        return True

    pm = (payment_method or "").strip().lower()
    if pm == "cod":
        return mapped_norm in ("cod_pending", "cod_confirmed", "cod_paid")
    if pm == "momo" or "online" in pm:
        return mapped_norm in ("pending", "processing")
    if mapped_norm in ("cod_pending", "cod_confirmed", "cod_paid"):
        return (current_db_status or "").strip().lower() in _COD_DB_STATUSES
    return mapped_norm in ("pending", "processing")


def _parse_filter_date(raw: str | None, is_end: bool = False) -> datetime | None:
    if raw is None or not raw.strip():
        return None
    text = raw.strip()
    try:
        if len(text) == 10 and text[4] == "-" and text[7] == "-":
            parsed_date = datetime.strptime(text, "%Y-%m-%d").date()
            t = dt_time.max if is_end else dt_time.min
            return datetime.combine(parsed_date, t, tzinfo=timezone.utc)
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return ensure_utc(dt)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Định dạng ngày không hợp lệ: {raw}") from exc


def _build_user_metrics(db: Session) -> dict[int, tuple[int, float]]:
    orders = list(db.scalars(select(Order)).all())
    metrics: dict[int, list[Any]] = {}
    for order in orders:
        count_and_spent = metrics.setdefault(order.user_id, [0, 0.0])
        count_and_spent[0] += 1
        if _is_order_paid_or_delivered(order):
            count_and_spent[1] += float(order.grand_total)
    return {uid: (vals[0], round(vals[1], 2)) for uid, vals in metrics.items()}


def _serialize_customer(user: User, metrics: dict[int, tuple[int, float]]) -> dict[str, Any]:
    total_orders, total_spent = metrics.get(user.id, (0, 0.0))
    role_name = user.role_rel.display_name if user.role_rel else (
        "Quản trị viên" if user.role_id == 1 else ("Nhân viên" if user.role_id == 2 else "Khách hàng")
    )
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "avatar_url": user.avatar_url,
        "role_id": user.role_id,
        "role": user.role,
        "role_name": role_name,
        "status": user.status,
        "last_login_at": user.last_login_at,
        "created_at": user.created_at,
        "total_orders": total_orders,
        "total_spent": total_spent,
    }


@router.post("/login")
def admin_login(
    payload: AdminLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    identifier = payload.identifier.strip()
    if not identifier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vui lòng nhập tên đăng nhập và mật khẩu.",
        )

    user = db.scalar(
        select(User)
        .options(selectinload(User.role_rel))
        .where(
            or_(
                func.lower(User.username) == identifier.lower(),
                func.lower(User.email) == identifier.lower(),
            )
        )
        .order_by(User.id.asc())
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập hoặc mật khẩu không đúng.",
        )
    if user.status != "hoat_dong":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản đã bị khóa hoặc ngừng hoạt động.",
        )
    if user.role_id not in (1, 2):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền truy cập khu vực quản trị.",
        )

    ip_addr, user_agent = _extract_client_info(request)
    token, session_id = create_user_session(
        db,
        user,
        remember_me=payload.remember_me,
        ip_address=ip_addr,
        user_agent=user_agent,
    )
    log_user_activity(db, user.id, "admin_login", "Đăng nhập khu vực quản trị", request)
    db.commit()

    role_name = user.role_rel.display_name if user.role_rel else (
        "Quản trị viên" if user.role_id == 1 else "Nhân viên"
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "session_id": session_id,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "phone": user.phone,
            "avatar_url": user.avatar_url,
            "role_id": user.role_id,
            "role": user.role,
            "role_name": role_name,
            "status": user.status,
            "last_login_at": user.last_login_at,
            "created_at": user.created_at,
        },
    }


@router.get("/dashboard")
def get_admin_dashboard(
    _staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    orders = list(
        db.scalars(
            select(Order)
            .options(selectinload(Order.items))
            .order_by(Order.created_at.desc(), Order.id.desc())
        ).all()
    )
    products = list(
        db.scalars(
            select(Product)
            .options(selectinload(Product.genres))
            .order_by(Product.updated_at.desc(), Product.id.desc())
        ).all()
    )
    total_customers = int(db.scalar(select(func.count(User.id)).where(User.role_id == 3)) or 0)

    paid_orders = [o for o in orders if _is_order_paid_or_delivered(o)]
    total_revenue = round(sum(float(o.grand_total) for o in paid_orders), 2)

    now = utc_now()
    cur_year, cur_month = now.year, now.month
    revenue_series: list[dict[str, Any]] = []
    for offset in range(5, -1, -1):
        total_months = cur_year * 12 + (cur_month - 1) - offset
        year_val = total_months // 12
        month_val = (total_months % 12) + 1
        month_start = datetime(year_val, month_val, 1, tzinfo=timezone.utc)
        next_year = year_val + (1 if month_val == 12 else 0)
        next_month = 1 if month_val == 12 else month_val + 1
        next_month_start = datetime(next_year, next_month, 1, tzinfo=timezone.utc)

        month_sum = sum(
            float(o.grand_total)
            for o in paid_orders
            if month_start <= ensure_utc(o.created_at) < next_month_start
        )
        revenue_series.append(
            {
                "month": f"T{month_val}",
                "year": year_val,
                "revenue": round(month_sum, 2),
            }
        )

    genre_counts: dict[str, int] = {}
    for product in products:
        cat_name = product.genres[0].name if product.genres else "Khác"
        genre_counts[cat_name] = genre_counts.get(cat_name, 0) + 1

    total_product_count = len(products)
    sorted_genres = sorted(genre_counts.items(), key=lambda kv: (-kv[1], kv[0]))[:4]
    category_share = [
        {
            "name": name,
            "count": count,
            "percentage": round((count / total_product_count) * 100) if total_product_count else 0,
            "color": _CATEGORY_HEX_COLORS[idx % len(_CATEGORY_HEX_COLORS)],
        }
        for idx, (name, count) in enumerate(sorted_genres)
    ]

    sales_by_product: dict[int, list[Any]] = {}
    product_title_map = {p.id: p.title for p in products}
    for order in paid_orders:
        for item in order.items or []:
            entry = sales_by_product.setdefault(item.product_id, [0, 0.0, item.product_name])
            line_rev = (
                float(item.total_price)
                if float(item.total_price) > 0
                else item.quantity * float(item.unit_price)
            )
            entry[0] += item.quantity
            entry[1] += line_rev

    top_products = [
        {
            "id": pid,
            "product_id": pid,
            "name": product_title_map.get(pid) or vals[2] or f"Sản phẩm #{pid}",
            "sold": vals[0],
            "revenue": round(vals[1], 2),
        }
        for pid, vals in sorted(
            sales_by_product.items(),
            key=lambda kv: (-kv[1][0], -kv[1][1], kv[0]),
        )[:5]
    ]

    recent_orders = [_serialize_order(o) for o in orders[:5]]
    product_table = [
        {
            "id": p.id,
            "title": p.title,
            "name": p.title,
            "category": p.genres[0].name if p.genres else "Khác",
            "price": float(p.price),
            "stock": p.stock_quantity,
            "stock_quantity": p.stock_quantity,
            "status": "active" if _is_product_in_stock(p) else "inactive",
            "raw_status": p.status,
            "updated_at": p.updated_at,
        }
        for p in products[:5]
    ]

    return {
        "stats": {
            "total_revenue": total_revenue,
            "total_orders": len(orders),
            "total_products": total_product_count,
            "total_customers": total_customers,
        },
        "total_revenue": total_revenue,
        "total_orders": len(orders),
        "total_products": total_product_count,
        "total_customers": total_customers,
        "revenue_series": revenue_series,
        "category_share": category_share,
        "top_products": top_products,
        "recent_orders": recent_orders,
        "product_table": product_table,
    }


@router.get("/products")
def list_admin_products(
    filter_key: str = Query(default="all", alias="filter"),
    search: str = Query(default=""),
    _staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    products = list(
        db.scalars(
            select(Product)
            .options(
                selectinload(Product.genres),
                selectinload(Product.tags),
                selectinload(Product.assets),
            )
            .order_by(Product.updated_at.desc(), Product.id.desc())
        ).all()
    )

    counts = {
        "all": len(products),
        "featured": sum(1 for p in products if p.is_featured),
        "new": sum(1 for p in products if p.is_new),
        "instock": sum(1 for p in products if _is_product_in_stock(p)),
        "outofstock": sum(1 for p in products if not _is_product_in_stock(p)),
    }

    normalized_filter = (filter_key or "all").strip().lower()
    if normalized_filter == "featured":
        filtered = [p for p in products if p.is_featured]
    elif normalized_filter == "new":
        filtered = [p for p in products if p.is_new]
    elif normalized_filter == "instock":
        filtered = [p for p in products if _is_product_in_stock(p)]
    elif normalized_filter == "outofstock":
        filtered = [p for p in products if not _is_product_in_stock(p)]
    else:
        filtered = products

    term = search.strip().lower()
    if term:
        filtered = [
            p
            for p in filtered
            if term in str(p.id)
            or term in p.title.lower()
            or term in (p.author or "").lower()
            or any(term in g.name.lower() for g in (p.genres or []))
        ]

    categories = list(
        db.scalars(select(Genre.name).distinct().order_by(Genre.name.asc())).all()
    )

    return {
        "items": [_serialize_product_list_item(p) for p in filtered],
        "counts": counts,
        "categories": [c for c in categories if c and c.strip()],
    }


@router.get("/products/{product_id}")
def get_admin_product_detail(
    product_id: int,
    _staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    product = _load_product_or_404(db, product_id)
    return _serialize_product_detail(product)


@router.post("/products", status_code=status.HTTP_201_CREATED)
async def create_admin_product(
    title: str | None = Form(default=None),
    name: str | None = Form(default=None),
    category: str = Form(...),
    price: float = Form(...),
    original_price: str | None = Form(default=None),
    stock_quantity: int = Form(default=0),
    in_stock: bool = Form(default=True),
    author: str = Form(default="Không rõ"),
    publisher: str | None = Form(default=None),
    publication_date: str | None = Form(default=None),
    pages: str | None = Form(default=None),
    dimensions: str | None = Form(default=None),
    weight: str | None = Form(default=None),
    language: str = Form(default="Tiếng Việt"),
    isbn: str | None = Form(default=None),
    description: str = Form(default=""),
    full_description: str | None = Form(default=None),
    tags: str | None = Form(default=None),
    is_featured: bool = Form(default=False),
    is_new: bool = Form(default=True),
    cover_url: str | None = Form(default=None),
    cover_file: UploadFile | None = File(default=None),
    gallery_files: list[UploadFile] | None = File(default=None),
    current_user: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    resolved_title = (title if title is not None else name or "").strip()
    if not resolved_title:
        raise HTTPException(status_code=400, detail="Tên sản phẩm không được để trống.")
    cleaned_category = category.strip()
    if not cleaned_category:
        raise HTTPException(status_code=400, detail="Danh mục không được để trống.")
    if not math.isfinite(price) or price <= 0:
        raise HTTPException(status_code=400, detail="Giá bán phải lớn hơn 0.")
    if stock_quantity < 0:
        raise HTTPException(status_code=400, detail="Số lượng tồn kho không được âm.")

    parsed_orig_price = _parse_optional_float(original_price, "Giá gốc")
    parsed_pages = _parse_optional_int(pages, "Số trang", minimum=1)

    saved_files: list[Path] = []
    try:
        resolved_cover_url = (cover_url or "").strip() or DEFAULT_COVER_URL
        if cover_file is not None and (cover_file.filename or "").strip():
            resolved_cover_url, cover_disk_path = await _save_uploaded_image(cover_file)
            saved_files.append(cover_disk_path)

        uploaded_gallery_urls: list[str] = []
        for g_file in gallery_files or []:
            if not (g_file.filename or "").strip():
                continue
            g_url, g_disk_path = await _save_uploaded_image(g_file)
            saved_files.append(g_disk_path)
            uploaded_gallery_urls.append(g_url)

        desc_text = description.strip()
        full_desc_text = (full_description or "").strip() or desc_text

        product = Product(
            title=resolved_title,
            author=author.strip() or "Không rõ",
            publisher=(publisher or "").strip() or None,
            publication_date=(publication_date or "").strip() or None,
            pages=parsed_pages,
            dimensions=(dimensions or "").strip() or None,
            weight=(weight or "").strip() or None,
            language=language.strip() or "Tiếng Việt",
            isbn=(isbn or "").strip() or None,
            description=desc_text,
            full_description=full_desc_text,
            cover_url=resolved_cover_url,
            price=price,
            original_price=parsed_orig_price,
            stock_quantity=stock_quantity,
            status=_compute_product_status(in_stock, stock_quantity),
            is_featured=is_featured,
            is_new=is_new,
            created_by=current_user.id,
        )
        db.add(product)
        db.flush()

        _replace_product_genre(db, product, cleaned_category)
        _replace_product_tags(db, product, _parse_tags_input(tags))

        for idx, g_url in enumerate(uploaded_gallery_urls, start=1):
            db.add(
                ProductAsset(
                    product_id=product.id,
                    asset_type="gallery",
                    url=g_url,
                    display_order=idx,
                )
            )

        db.commit()
    except Exception:
        db.rollback()
        for path in saved_files:
            path.unlink(missing_ok=True)
        raise

    db.expire_all()
    created = _load_product_or_404(db, product.id)
    return _serialize_product_detail(created)


@router.put("/products/{product_id}")
async def update_admin_product(
    product_id: int,
    title: str | None = Form(default=None),
    name: str | None = Form(default=None),
    category: str | None = Form(default=None),
    price: str | None = Form(default=None),
    original_price: str | None = Form(default=None),
    stock_quantity: str | None = Form(default=None),
    in_stock: str | None = Form(default=None),
    author: str | None = Form(default=None),
    publisher: str | None = Form(default=None),
    publication_date: str | None = Form(default=None),
    pages: str | None = Form(default=None),
    dimensions: str | None = Form(default=None),
    weight: str | None = Form(default=None),
    language: str | None = Form(default=None),
    isbn: str | None = Form(default=None),
    description: str | None = Form(default=None),
    full_description: str | None = Form(default=None),
    tags: str | None = Form(default=None),
    is_featured: str | None = Form(default=None),
    is_new: str | None = Form(default=None),
    cover_url: str | None = Form(default=None),
    remove_asset_ids: str | None = Form(default=None),
    cover_file: UploadFile | None = File(default=None),
    gallery_files: list[UploadFile] | None = File(default=None),
    _staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    product = _load_product_or_404(db, product_id)

    resolved_title = title if title is not None else name
    if resolved_title is not None:
        cleaned_title = resolved_title.strip()
        if not cleaned_title:
            raise HTTPException(status_code=400, detail="Tên sản phẩm không được để trống.")
        product.title = cleaned_title

    if category is not None:
        cleaned_cat = category.strip()
        if not cleaned_cat:
            raise HTTPException(status_code=400, detail="Danh mục không được để trống.")
        _replace_product_genre(db, product, cleaned_cat)

    parsed_price = _parse_optional_float(price, "Giá bán")
    if price is not None:
        if parsed_price is None:
            raise HTTPException(status_code=400, detail="Giá bán phải lớn hơn 0.")
        product.price = parsed_price

    if original_price is not None:
        product.original_price = _parse_optional_float(original_price, "Giá gốc")

    parsed_stock = _parse_optional_int(stock_quantity, "Số lượng tồn kho", minimum=0)
    if parsed_stock is not None:
        product.stock_quantity = parsed_stock

    parsed_in_stock = _parse_optional_bool(in_stock)
    if parsed_in_stock is not None or parsed_stock is not None:
        effective_in_stock = (
            parsed_in_stock
            if parsed_in_stock is not None
            else (product.status not in ("tam_ngung", "ngung_ban"))
        )
        product.status = _compute_product_status(effective_in_stock, product.stock_quantity)

    if author is not None:
        product.author = author.strip() or "Không rõ"
    if publisher is not None:
        product.publisher = publisher.strip() or None
    if publication_date is not None:
        product.publication_date = publication_date.strip() or None
    if pages is not None:
        product.pages = _parse_optional_int(pages, "Số trang", minimum=1)
    if dimensions is not None:
        product.dimensions = dimensions.strip() or None
    if weight is not None:
        product.weight = weight.strip() or None
    if language is not None:
        product.language = language.strip() or "Tiếng Việt"
    if isbn is not None:
        product.isbn = isbn.strip() or None
    if description is not None:
        product.description = description.strip()
        if full_description is None:
            product.full_description = product.description
    if full_description is not None:
        product.full_description = full_description.strip()
    if tags is not None:
        _replace_product_tags(db, product, _parse_tags_input(tags))

    parsed_featured = _parse_optional_bool(is_featured)
    if parsed_featured is not None:
        product.is_featured = parsed_featured

    parsed_is_new = _parse_optional_bool(is_new)
    if parsed_is_new is not None:
        product.is_new = parsed_is_new

    remove_ids = _parse_id_list(remove_asset_ids)

    saved_files: list[Path] = []
    candidate_cleanup_urls: set[str] = set()
    try:
        if cover_file is not None and (cover_file.filename or "").strip():
            old_cover = product.cover_url
            new_cover_url, cover_disk_path = await _save_uploaded_image(cover_file)
            saved_files.append(cover_disk_path)
            product.cover_url = new_cover_url
            if old_cover:
                candidate_cleanup_urls.add(old_cover)
        elif cover_url is not None and cover_url.strip():
            product.cover_url = cover_url.strip()

        if remove_ids:
            remove_set = set(remove_ids)
            assets_to_remove = [a for a in product.assets if a.id in remove_set]
            for asset in assets_to_remove:
                if asset.url:
                    candidate_cleanup_urls.add(asset.url)
                product.assets.remove(asset)

        existing_max_order = max(
            (a.display_order for a in product.assets),
            default=0,
        )
        for offset, g_file in enumerate(gallery_files or [], start=1):
            if not (g_file.filename or "").strip():
                continue
            g_url, g_disk_path = await _save_uploaded_image(g_file)
            saved_files.append(g_disk_path)
            db.add(
                ProductAsset(
                    product_id=product.id,
                    asset_type="gallery",
                    url=g_url,
                    display_order=existing_max_order + offset,
                )
            )

        product.updated_at = utc_now()
        db.commit()
    except Exception:
        db.rollback()
        for path in saved_files:
            path.unlink(missing_ok=True)
        raise

    if candidate_cleanup_urls:
        cleanup_unreferenced_cover_files(db, candidate_cleanup_urls)

    db.expire_all()
    updated = _load_product_or_404(db, product.id)
    return _serialize_product_detail(updated)


@router.delete("/products/{product_id}")
def delete_admin_product(
    product_id: int,
    _staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    product = _load_product_or_404(db, product_id)

    has_orders = (
        db.scalar(
            select(OrderItem.id).where(OrderItem.product_id == product_id).limit(1)
        )
        is not None
    )
    if has_orders:
        product.status = "ngung_ban"
        product.is_featured = False
        product.is_new = False
        product.updated_at = utc_now()
        db.commit()
        return {
            "archived": True,
            "deleted": False,
            "message": "Sản phẩm đã phát sinh đơn hàng nên đã được chuyển sang trạng thái ngừng bán.",
        }

    candidate_urls: set[str] = set()
    if product.cover_url:
        candidate_urls.add(product.cover_url)
    for asset in product.assets or []:
        if asset.url:
            candidate_urls.add(asset.url)

    for model in (CartItem, WishlistItem, Review, ProductGenre, ProductTag, ProductAsset, Chapter):
        db.execute(delete(model).where(model.product_id == product_id))
    db.expunge(product)
    db.execute(delete(Product).where(Product.id == product_id))
    db.commit()

    cleanup_unreferenced_cover_files(db, candidate_urls)
    return {
        "archived": False,
        "deleted": True,
        "message": "Sản phẩm đã được xóa thành công!",
    }


@router.post("/products/{product_id}/toggle-featured")
def toggle_product_featured(
    product_id: int,
    _staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    product = db.scalar(select(Product).where(Product.id == product_id))
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sản phẩm.")

    product.is_featured = not product.is_featured
    product.updated_at = utc_now()
    db.commit()
    action_text = "thêm vào" if product.is_featured else "bỏ khỏi"
    return {
        "id": product.id,
        "is_featured": product.is_featured,
        "message": f"Đã {action_text} kệ sản phẩm phổ biến!",
    }


@router.post("/products/{product_id}/unmark-new")
def unmark_product_new(
    product_id: int,
    _staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    product = db.scalar(select(Product).where(Product.id == product_id))
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sản phẩm.")

    product.is_new = False
    product.updated_at = utc_now()
    db.commit()
    return {
        "id": product.id,
        "is_new": False,
        "message": "Đã bỏ chọn 'sản phẩm mới' cho truyện.",
    }


@router.post("/products/{product_id}/stock")
def update_product_stock(
    product_id: int,
    payload: StockUpdateRequest,
    _staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if payload.quantity < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Số lượng tồn kho không được nhỏ hơn 0.",
        )

    product = db.scalar(select(Product).where(Product.id == product_id))
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy sản phẩm.")

    product.stock_quantity = payload.quantity
    product.updated_at = utc_now()
    if payload.quantity == 0:
        if (product.status or "").lower() not in ("ngung_ban", "tam_ngung"):
            product.status = "het_hang"
    elif (product.status or "").lower() == "het_hang":
        product.status = "dang_ban"

    db.commit()
    return {
        "id": product.id,
        "stock_quantity": product.stock_quantity,
        "status": product.status,
        "message": f"Đã cập nhật số lượng tồn kho thành {payload.quantity}!",
    }


@router.get("/orders")
def list_admin_orders(
    search: str = Query(default=""),
    status_filter: str = Query(default="", alias="status"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    _staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    parsed_from = _parse_filter_date(date_from, is_end=False)
    parsed_to = _parse_filter_date(date_to, is_end=True)

    orders = list(
        db.scalars(
            select(Order)
            .options(selectinload(Order.items))
            .order_by(Order.created_at.desc(), Order.id.desc())
        ).all()
    )

    term = search.strip().lower()
    st_filter = status_filter.strip().lower()
    if st_filter == "all":
        st_filter = ""

    filtered: list[dict[str, Any]] = []
    for order in orders:
        if term:
            haystack = (
                (order.order_code or "").lower(),
                (order.full_name or "").lower(),
                (order.email or "").lower(),
                (order.phone or "").lower(),
            )
            if not any(term in val for val in haystack):
                continue

        norm_st = _normalize_order_status(order.status)
        if st_filter and norm_st != st_filter and (order.status or "").strip().lower() != st_filter:
            continue

        order_dt = ensure_utc(order.created_at)
        if parsed_from is not None and order_dt < parsed_from:
            continue
        if parsed_to is not None and order_dt > parsed_to:
            continue

        filtered.append(_serialize_order(order))

    return {"items": filtered, "total": len(filtered)}


@router.post("/orders/{order_code}/status")
def update_admin_order_status(
    order_code: str,
    payload: OrderStatusUpdateRequest,
    current_user: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    cleaned_code = order_code.strip()
    requested_key = payload.status.strip().lower()
    status_meta = _STATUS_TO_DB.get(requested_key)
    if status_meta is None:
        raise HTTPException(status_code=400, detail="Trạng thái đơn hàng không hợp lệ.")
    db_status, normalized_status, status_label = status_meta

    order = db.scalar(
        select(Order)
        .options(selectinload(Order.items))
        .where(func.lower(Order.order_code) == cleaned_code.lower())
        .with_for_update()
    )
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy đơn hàng.")

    current_db_status = (order.status or "").strip()
    was_cancelled = current_db_status.lower() in _CANCELLED_STATUSES
    will_be_cancelled = db_status.lower() in _CANCELLED_STATUSES
    if was_cancelled and not will_be_cancelled:
        raise HTTPException(
            status_code=400,
            detail="Đơn hàng đã hủy không thể chuyển sang trạng thái khác.",
        )

    if not _is_order_status_valid_for_method(requested_key, order.payment_method, current_db_status):
        raise HTTPException(
            status_code=400,
            detail=f"Trạng thái '{payload.status}' không hợp lệ với phương thức thanh toán của đơn hàng.",
        )

    now = utc_now()
    if db_status.lower() in _PAID_OR_DELIVERED_STATUSES:
        order.payment_status = "da_thanh_toan"
        if order.paid_at is None:
            order.paid_at = now

    order.status = db_status
    order.updated_at = now

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            previous_status=current_db_status or None,
            new_status=db_status,
            notes=f"Cập nhật trạng thái đơn hàng sang {db_status}",
            actor_id=current_user.id,
            created_at=now,
        )
    )

    shipping_status = _SHIPPING_STATUS_MAP.get(db_status.lower())
    if shipping_status:
        shipped_at = now if shipping_status in ("dang_giao", "da_giao") else None
        shipment = db.scalar(
            select(OrderShipment).where(OrderShipment.order_id == order.id)
        )
        if shipment is not None:
            shipment.shipping_status = shipping_status
            if shipment.shipped_at is None and shipped_at is not None:
                shipment.shipped_at = shipped_at
            shipment.notes = f"Trạng thái vận chuyển: {shipping_status}"
        elif shipping_status in ("dang_giao", "da_giao"):
            db.add(
                OrderShipment(
                    order_id=order.id,
                    carrier="MangaExpress",
                    shipping_status=shipping_status,
                    shipped_at=shipped_at,
                    additional_fee=0,
                    notes=f"Trạng thái vận chuyển: {shipping_status}",
                )
            )

    qty_by_product: dict[int, int] = {}
    for item in order.items or []:
        qty_by_product[item.product_id] = qty_by_product.get(item.product_id, 0) + item.quantity

    if qty_by_product:
        products_map = {
            p.id: p
            for p in db.scalars(select(Product).where(Product.id.in_(list(qty_by_product.keys())))).all()
        }

        if will_be_cancelled and not was_cancelled:
            for pid, qty in qty_by_product.items():
                prod = products_map.get(pid)
                if prod is not None:
                    prod.stock_quantity = max(0, prod.stock_quantity) + qty
                    if (prod.status or "").lower() == "het_hang" and prod.stock_quantity > 0:
                        prod.status = "dang_ban"
                    prod.updated_at = now

        was_delivered = current_db_status.lower() in _DELIVERED_STATUSES
        will_be_delivered = db_status.lower() in _DELIVERED_STATUSES
        if will_be_delivered and not was_delivered:
            for pid, qty in qty_by_product.items():
                prod = products_map.get(pid)
                if prod is not None:
                    prod.units_sold = max(0, prod.units_sold) + qty
                    prod.updated_at = now
        elif not will_be_delivered and was_delivered:
            for pid, qty in qty_by_product.items():
                prod = products_map.get(pid)
                if prod is not None:
                    prod.units_sold = max(0, prod.units_sold - qty)
                    prod.updated_at = now

    db.commit()

    if order.email:
        try:
            send_order_status_update_email(
                order.email,
                order.full_name or "Quý khách",
                order.order_code,
                status_label,
            )
        except Exception:
            pass

    return {
        "success": True,
        "order_code": order.order_code,
        "status": normalized_status,
        "raw_status": order.status,
        "payment_status": order.payment_status,
        "message": "Trạng thái đơn hàng đã được cập nhật!",
    }


@router.get("/reviews")
def list_admin_reviews(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    product_id: int | None = Query(default=None),
    rating: int | None = Query(default=None),
    has_reply: bool | None = Query(default=None),
    search: str = Query(default=""),
    _staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    stmt = (
        select(Review, User.username, Product.title)
        .join(User, Review.user_id == User.id)
        .join(Product, Review.product_id == Product.id)
    )
    count_stmt = (
        select(func.count(Review.id))
        .join(User, Review.user_id == User.id)
        .join(Product, Review.product_id == Product.id)
    )

    conditions = []
    if product_id is not None and product_id > 0:
        conditions.append(Review.product_id == product_id)
    if rating is not None and 1 <= rating <= 5:
        conditions.append(Review.rating == rating)
    if has_reply is True:
        conditions.append(Review.admin_reply.is_not(None))
        conditions.append(func.length(func.trim(Review.admin_reply)) > 0)
    elif has_reply is False:
        conditions.append(
            or_(
                Review.admin_reply.is_(None),
                func.length(func.trim(Review.admin_reply)) == 0,
            )
        )

    term = search.strip()
    if term:
        pattern = f"%{term}%"
        conditions.append(
            or_(
                User.username.ilike(pattern),
                Product.title.ilike(pattern),
                Review.content.ilike(pattern),
            )
        )

    for cond in conditions:
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)

    total = int(db.scalar(count_stmt) or 0)
    offset = (page - 1) * page_size
    rows = db.execute(
        stmt.order_by(Review.created_at.desc(), Review.id.desc())
        .offset(offset)
        .limit(page_size)
    ).all()

    items = [
        {
            "id": review.id,
            "product_id": review.product_id,
            "product_name": product_title,
            "user_id": review.user_id,
            "username": username,
            "rating": review.rating,
            "content": review.content or "",
            "is_purchased": review.is_purchased,
            "admin_reply": review.admin_reply,
            "admin_replied_by": review.admin_replied_by,
            "admin_replied_at": review.admin_replied_at,
            "created_at": review.created_at,
        }
        for review, username, product_title in rows
    ]

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/reviews/{review_id}/reply")
def reply_to_review(
    review_id: int,
    payload: ReviewReplyRequest,
    current_user: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    cleaned_reply = payload.reply.strip()
    if not cleaned_reply:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nội dung phản hồi không được để trống.",
        )

    review = db.scalar(select(Review).where(Review.id == review_id))
    if review is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy đánh giá để phản hồi.",
        )

    now = utc_now()
    review.admin_reply = cleaned_reply
    review.admin_replied_by = current_user.username
    review.admin_replied_at = now
    review.updated_at = now
    db.commit()
    db.refresh(review)

    return {
        "id": review.id,
        "product_id": review.product_id,
        "admin_reply": review.admin_reply,
        "admin_replied_by": review.admin_replied_by,
        "admin_replied_at": review.admin_replied_at,
        "message": "Đã gửi phản hồi tới khách hàng.",
    }


@router.get("/customers")
def list_customers(
    search: str = Query(default=""),
    status_filter: str = Query(default="", alias="status"),
    _admin: User = Depends(require_full_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    users = list(
        db.scalars(
            select(User)
            .options(selectinload(User.role_rel))
            .order_by(User.created_at.desc(), User.id.desc())
        ).all()
    )
    roles = list(db.scalars(select(Role).order_by(Role.id.asc())).all())
    metrics = _build_user_metrics(db)

    total_count = len(users)
    active_count = sum(1 for u in users if (u.status or "").lower() == "hoat_dong")
    blocked_count = total_count - active_count

    term = search.strip().lower()
    st_filter = status_filter.strip().lower()
    if st_filter == "all":
        st_filter = ""

    filtered_users: list[User] = []
    for user in users:
        if term:
            if not (
                term in (user.username or "").lower()
                or term in (user.email or "").lower()
                or term in (user.phone or "").lower()
            ):
                continue

        if st_filter:
            if st_filter == "bi_khoa":
                if (user.status or "").lower() == "hoat_dong":
                    continue
            elif (user.status or "").lower() != st_filter:
                continue

        filtered_users.append(user)

    return {
        "items": [_serialize_customer(u, metrics) for u in filtered_users],
        "total": total_count,
        "active": active_count,
        "blocked": blocked_count,
        "roles": [
            {"id": r.id, "code": r.code, "display_name": r.display_name}
            for r in roles
        ],
    }


@router.get("/customers/{user_id}")
def get_customer_detail(
    user_id: int,
    _admin: User = Depends(require_full_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    user = db.scalar(
        select(User).options(selectinload(User.role_rel)).where(User.id == user_id)
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy khách hàng.")

    metrics = _build_user_metrics(db)
    roles = list(db.scalars(select(Role).order_by(Role.id.asc())).all())
    result = _serialize_customer(user, metrics)
    result["available_roles"] = [
        {"id": r.id, "code": r.code, "display_name": r.display_name}
        for r in roles
    ]
    return result


@router.put("/customers/{user_id}")
def update_customer(
    user_id: int,
    payload: CustomerUpdateRequest,
    current_admin: User = Depends(require_full_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    cleaned_username = payload.username.strip()
    cleaned_email = str(payload.email).strip().lower()
    cleaned_phone = (payload.phone or "").strip() or None
    cleaned_status = payload.status.strip().lower()

    if not cleaned_username:
        raise HTTPException(status_code=400, detail="Tên đăng nhập không được để trống.")
    if cleaned_status not in _ALLOWED_ACCOUNT_STATUSES:
        raise HTTPException(status_code=400, detail="Trạng thái tài khoản không hợp lệ.")

    target = db.scalar(
        select(User)
        .options(selectinload(User.role_rel))
        .where(User.id == user_id)
        .with_for_update()
    )
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy khách hàng để cập nhật.")

    if user_id == current_admin.id:
        if cleaned_status != "hoat_dong":
            raise HTTPException(status_code=400, detail="Không thể tự khóa tài khoản của chính mình.")
        if payload.role_id != target.role_id:
            raise HTTPException(status_code=400, detail="Không thể tự thay đổi vai trò của chính mình.")

    role_obj = db.scalar(select(Role).where(Role.id == payload.role_id))
    if role_obj is None:
        raise HTTPException(status_code=400, detail="Vai trò được chọn không tồn tại.")

    dup_username = db.scalar(
        select(User.id).where(
            User.id != user_id,
            func.lower(User.username) == cleaned_username.lower(),
        )
    )
    if dup_username is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tên đăng nhập đã được sử dụng bởi tài khoản khác.",
        )

    dup_email = db.scalar(
        select(User.id).where(
            User.id != user_id,
            func.lower(User.email) == cleaned_email,
        )
    )
    if dup_email is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email đã được sử dụng bởi tài khoản khác.",
        )

    target.username = cleaned_username
    target.email = cleaned_email
    target.phone = cleaned_phone
    target.role_id = role_obj.id
    target.role = _ROLE_CODE_BY_ID.get(role_obj.id, role_obj.code)
    target.status = cleaned_status
    target.updated_at = utc_now()

    if cleaned_status != "hoat_dong":
        db.execute(delete(UserSession).where(UserSession.user_id == user_id))

    db.commit()
    db.expire_all()
    target = db.scalar(
        select(User).options(selectinload(User.role_rel)).where(User.id == user_id)
    )
    assert target is not None
    metrics = _build_user_metrics(db)
    return _serialize_customer(target, metrics)


@router.post("/customers/{user_id}/toggle-status")
def toggle_customer_status(
    user_id: int,
    current_admin: User = Depends(require_full_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if user_id == current_admin.id:
        raise HTTPException(status_code=400, detail="Không thể tự khóa tài khoản của chính mình.")

    target = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy khách hàng.")

    if target.role_id == 1 and current_admin.role_id != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền thay đổi trạng thái tài khoản Quản trị viên.",
        )

    next_status = "bi_khoa" if (target.status or "").lower() == "hoat_dong" else "hoat_dong"
    target.status = next_status
    target.updated_at = utc_now()

    if next_status != "hoat_dong":
        db.execute(delete(UserSession).where(UserSession.user_id == user_id))

    db.commit()
    return {
        "id": target.id,
        "status": target.status,
        "message": "Đã cập nhật trạng thái tài khoản khách hàng!",
    }


@router.delete("/customers/{user_id}")
def delete_customer(
    user_id: int,
    current_admin: User = Depends(require_full_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if user_id == current_admin.id:
        raise HTTPException(status_code=400, detail="Không thể tự xóa tài khoản của chính mình.")

    target = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy khách hàng.")

    if target.role_id == 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Không thể xóa tài khoản Quản trị viên.",
        )

    order_count = int(
        db.scalar(select(func.count(Order.id)).where(Order.user_id == user_id)) or 0
    )
    if order_count >= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Khách hàng này đã có đơn hàng nên không thể xóa. Vui lòng sử dụng chức năng khóa tài khoản thay thế.",
        )

    user_comment_ids = list(
        db.scalars(select(ReaderComment.id).where(ReaderComment.user_id == user_id)).all()
    )
    if user_comment_ids:
        db.execute(
            update(ReaderComment)
            .where(ReaderComment.parent_comment_id.in_(user_comment_ids))
            .values(parent_comment_id=None)
        )
    db.execute(delete(ReaderComment).where(ReaderComment.user_id == user_id))

    for model in (
        ReaderRating,
        ReaderBookmark,
        ReaderHistory,
        Review,
        PromotionUsage,
        UserSession,
        UserActivity,
        WishlistItem,
        CartItem,
        ShippingAddress,
        UserNotification,
        SearchHistory,
        PasswordResetToken,
    ):
        db.execute(delete(model).where(model.user_id == user_id))

    db.execute(
        update(OrderStatusHistory)
        .where(OrderStatusHistory.actor_id == user_id)
        .values(actor_id=None)
    )
    db.execute(
        update(Product)
        .where(Product.created_by == user_id)
        .values(created_by=None)
    )

    db.delete(target)
    db.commit()
    return {
        "success": True,
        "deleted_id": user_id,
        "message": "Đã xóa khách hàng thành công!",
    }


@router.get("/import/template")
def download_import_template(
    template_type: str = Query(default="excel", alias="type"),
    _staff: User = Depends(require_staff),
) -> Response:
    if template_type.strip().lower() == "zip":
        data = build_zip_template_bytes()
        return Response(
            content=data,
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="Template_Import_SanPham.zip"'},
        )

    data = build_excel_template_bytes()
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="Template_Import_SanPham.xlsx"'},
    )


@router.post("/import/preview")
async def preview_bulk_import(
    file: UploadFile = File(...),
    _staff: User = Depends(require_staff),
) -> dict[str, Any]:
    file_bytes = await file.read(MAX_IMPORT_UPLOAD_BYTES + 1)
    if len(file_bytes) > MAX_IMPORT_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tệp tải lên vượt quá dung lượng cho phép.",
        )

    try:
        return stage_and_preview_upload(file.filename or "import.xlsx", file_bytes)
    except ImportValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/import/execute")
def execute_bulk_import(
    payload: ImportTokenRequest,
    current_user: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return execute_import(
            db,
            import_token=payload.import_token,
            imported_by=current_user.username,
            actor_user_id=current_user.id,
        )
    except ImportNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ImportValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/import/cancel")
def cancel_bulk_import(
    payload: ImportTokenRequest,
    _staff: User = Depends(require_staff),
) -> dict[str, Any]:
    cancelled = cancel_staged_import(payload.import_token)
    return {
        "success": True,
        "cancelled": cancelled,
        "message": "Đã hủy phiên nhập dữ liệu.",
    }


@router.get("/import/history")
def list_import_history(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    _staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    total = int(db.scalar(select(func.count(ImportHistory.id))) or 0)
    offset = (page - 1) * page_size
    rows = list(
        db.scalars(
            select(ImportHistory)
            .order_by(ImportHistory.imported_at.desc(), ImportHistory.id.desc())
            .offset(offset)
            .limit(page_size)
        ).all()
    )

    items = [
        {
            "id": h.id,
            "batch_id": h.batch_id,
            "imported_at": h.imported_at,
            "imported_by": h.imported_by,
            "product_count": h.product_count,
            "is_zip_import": h.is_zip_import,
            "file_name": h.file_name,
            "is_restored": h.is_restored,
            "restored_at": h.restored_at,
            "restored_by": h.restored_by,
        }
        for h in rows
    ]
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/import/history/{batch_id}")
def get_import_history_detail(
    batch_id: str,
    _staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    cleaned_batch = batch_id.strip()
    history = db.scalar(
        select(ImportHistory).where(func.upper(ImportHistory.batch_id) == cleaned_batch.upper())
    )
    if history is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy lịch sử import.",
        )

    products = list(
        db.scalars(
            select(Product)
            .where(Product.import_batch_id == history.batch_id)
            .order_by(Product.id.asc())
        ).all()
    )

    return {
        "id": history.id,
        "batch_id": history.batch_id,
        "imported_at": history.imported_at,
        "imported_by": history.imported_by,
        "product_count": history.product_count,
        "is_zip_import": history.is_zip_import,
        "file_name": history.file_name,
        "is_restored": history.is_restored,
        "restored_at": history.restored_at,
        "restored_by": history.restored_by,
        "products": [
            {
                "id": p.id,
                "title": p.title,
                "cover_url": p.cover_url,
                "price": float(p.price),
                "stock_quantity": p.stock_quantity,
                "status": p.status,
            }
            for p in products
        ],
    }


@router.post("/import/history/{batch_id}/restore")
def restore_import_history_batch(
    batch_id: str,
    current_admin: User = Depends(require_full_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return restore_batch(db, batch_id=batch_id, restored_by=current_admin.username)
    except ImportNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ImportValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
