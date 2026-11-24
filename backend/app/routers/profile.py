from pathlib import Path
import secrets
from typing import Any

from fastapi import APIRouter, Body, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from app.config import ensure_upload_dirs
from app.database import get_db
from app.models import (
    Order,
    OrderItem,
    OrderShipment,
    OrderStatusHistory,
    Product,
    Promotion,
    PromotionUsage,
    Review,
    ShippingAddress,
    User,
    UserNotification,
    WishlistItem,
)
from app.security import (
    get_current_session_id,
    get_current_user,
    hash_password,
    log_user_activity,
    revoke_all_user_sessions,
    verify_password,
)

router = APIRouter(prefix="/api/profile", tags=["profile"])

_MAX_AVATAR_BYTES = 2 * 1024 * 1024
_EXCLUDED_PURCHASED_STATUSES = (
    "huy",
    "da_huy",
    "cancelled",
    "cho_thanh_toan",
    "pending",
)
_CANCELLABLE_STATUSES = ("cho_thanh_toan", "cho_xu_ly")
_DELIVERED_STATUSES = (
    "delivered",
    "da_giao",
    "da_giao_hang",
    "da_thu_tien",
    "cod_paid",
    "da_thanh_toan",
)


class UpdateProfileRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    phone: str | None = Field(default=None, max_length=20)

    @field_validator("username")
    @classmethod
    def _clean_username(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 3:
            raise ValueError("Tên hiển thị phải có ít nhất 3 ký tự.")
        return cleaned

    @field_validator("phone")
    @classmethod
    def _clean_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned[:20] or None


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=6, max_length=128)
    confirm_password: str | None = Field(default=None, max_length=128)


class CancelOrderRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=255)

    @field_validator("reason")
    @classmethod
    def _clean_reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned[:255] or None


class CreateAddressRequest(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=150)
    phone_number: str = Field(..., min_length=1, max_length=20)
    address_line: str = Field(..., min_length=1, max_length=255)
    ward: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    province: str | None = Field(default=None, max_length=100)
    country: str = Field(default="Việt Nam", max_length=100)
    is_default: bool = False

    @model_validator(mode="before")
    @classmethod
    def _accept_aliases(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        copied = dict(data)
        if "phone_number" not in copied and "phone" in copied:
            copied["phone_number"] = copied["phone"]
        if "address_line" not in copied and "address" in copied:
            copied["address_line"] = copied["address"]
        return copied

    @field_validator("full_name", "phone_number", "address_line")
    @classmethod
    def _clean_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Vui lòng nhập đầy đủ thông tin địa chỉ.")
        return cleaned

    @field_validator("ward", "district", "province", "country")
    @classmethod
    def _clean_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


def _serialize_user(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "avatar_url": user.avatar_url,
        "role_id": user.role_id,
        "role": user.role,
        "status": user.status,
        "last_login_at": user.last_login_at,
        "created_at": user.created_at,
    }


def _serialize_favorite_product(product: Product, in_wishlist: bool) -> dict[str, Any]:
    genres = [g.name for g in product.genres if g.name]
    is_available = product.status == "dang_ban" and product.stock_quantity > 0
    return {
        "id": product.id,
        "title": product.title,
        "author": product.author,
        "cover_url": product.cover_url or "/covers/default-manga.svg",
        "price": float(product.price),
        "original_price": float(product.original_price)
        if product.original_price is not None
        else None,
        "category": genres[0] if genres else "Khác",
        "average_rating": float(product.average_rating),
        "ratings_count": int(product.ratings_count),
        "stock_quantity": int(product.stock_quantity),
        "status": product.status,
        "is_available": is_available,
        "is_in_wishlist": in_wishlist,
    }


def _serialize_address(address: ShippingAddress) -> dict[str, Any]:
    return {
        "id": address.id,
        "user_id": address.user_id,
        "full_name": address.full_name,
        "phone_number": address.phone_number,
        "address_line": address.address_line,
        "ward": address.ward,
        "district": address.district,
        "province": address.province,
        "country": address.country,
        "is_default": bool(address.is_default),
        "created_at": address.created_at,
        "updated_at": address.updated_at,
    }


def _detect_image_extension(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return ".gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


@router.get("")
def get_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    wishlist_products = list(
        db.scalars(
            select(Product)
            .join(WishlistItem, WishlistItem.product_id == Product.id)
            .options(selectinload(Product.genres))
            .where(WishlistItem.user_id == current_user.id)
            .order_by(WishlistItem.created_at.desc(), WishlistItem.id.desc())
            .limit(4)
        ).all()
    )

    favorites: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for prod in wishlist_products:
        if prod.id not in seen_ids:
            seen_ids.add(prod.id)
            favorites.append(_serialize_favorite_product(prod, in_wishlist=True))

    if len(favorites) < 4:
        purchased_rows = db.execute(
            select(OrderItem.product_id, func.max(Order.created_at).label("last_ordered"))
            .join(Order, OrderItem.order_id == Order.id)
            .where(
                Order.user_id == current_user.id,
                func.lower(func.coalesce(Order.status, "")).notin_(
                    _EXCLUDED_PURCHASED_STATUSES
                ),
            )
            .group_by(OrderItem.product_id)
            .order_by(func.max(Order.created_at).desc())
            .limit(4 + len(seen_ids))
        ).all()

        backfill_ids = [
            int(pid) for pid, _ in purchased_rows if int(pid) not in seen_ids
        ][: 4 - len(favorites)]
        if backfill_ids:
            backfill_map = {
                p.id: p
                for p in db.scalars(
                    select(Product)
                    .options(selectinload(Product.genres))
                    .where(Product.id.in_(backfill_ids))
                ).all()
            }
            for pid in backfill_ids:
                prod = backfill_map.get(pid)
                if prod is not None:
                    seen_ids.add(pid)
                    favorites.append(_serialize_favorite_product(prod, in_wishlist=False))

    recent_order_entities = list(
        db.scalars(
            select(Order)
            .options(selectinload(Order.items))
            .where(Order.user_id == current_user.id)
            .order_by(Order.created_at.desc(), Order.id.desc())
            .limit(5)
        ).all()
    )

    recent_orders = [
        {
            "id": order.id,
            "order_code": order.order_code,
            "created_at": order.created_at,
            "status": order.status,
            "payment_status": order.payment_status,
            "payment_method": order.payment_method,
            "total_items": sum(item.quantity for item in order.items),
            "grand_total": float(order.grand_total),
        }
        for order in recent_order_entities
    ]

    return {
        "user": _serialize_user(current_user),
        "favorites": favorites,
        "recent_orders": recent_orders,
    }


@router.put("")
def update_profile(
    payload: UpdateProfileRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    duplicate = db.scalar(
        select(User.id).where(
            func.lower(User.username) == payload.username.lower(),
            User.id != current_user.id,
        )
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tên hiển thị này đã được sử dụng. Vui lòng chọn tên khác.",
        )

    current_user.username = payload.username
    current_user.phone = payload.phone
    log_user_activity(
        db, current_user.id, "update_profile", "Cập nhật thông tin hồ sơ", request
    )
    db.commit()
    db.refresh(current_user)

    return {"ok": True, "user": _serialize_user(current_user)}


@router.post("/avatar")
async def upload_avatar(
    request: Request,
    file: UploadFile | None = File(default=None),
    avatar: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    upload = file or avatar
    if upload is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vui lòng chọn một ảnh để tải lên.",
        )

    raw_bytes = await upload.read(_MAX_AVATAR_BYTES + 1)
    if not raw_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tệp ảnh đại diện rỗng.",
        )
    if len(raw_bytes) > _MAX_AVATAR_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ảnh quá lớn. Vui lòng chọn ảnh có dung lượng tối đa 2MB.",
        )

    ext = _detect_image_extension(raw_bytes)
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Định dạng ảnh không hợp lệ. Chỉ chấp nhận JPEG, PNG, GIF hoặc WEBP.",
        )

    avatars_dir = ensure_upload_dirs() / "avatars"
    filename = f"avatar_{current_user.id}_{secrets.token_hex(6)}{ext}"
    target_path = avatars_dir / filename
    target_path.write_bytes(raw_bytes)

    old_url = current_user.avatar_url or ""
    if old_url.startswith("/uploads/avatars/"):
        old_name = Path(old_url).name
        old_path = avatars_dir / old_name
        if old_path.is_file() and old_path != target_path:
            try:
                old_path.unlink()
            except OSError:
                pass

    avatar_url = f"/uploads/avatars/{filename}"
    current_user.avatar_url = avatar_url
    log_user_activity(db, current_user.id, "update_avatar", "Cập nhật ảnh đại diện", request)
    db.commit()
    db.refresh(current_user)

    return {
        "ok": True,
        "avatar_url": avatar_url,
        "user": _serialize_user(current_user),
    }


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    session_id: str | None = Depends(get_current_session_id),
) -> dict[str, Any]:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mật khẩu hiện tại không đúng.",
        )

    if len(payload.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mật khẩu mới phải có ít nhất 6 ký tự.",
        )

    if payload.confirm_password is not None and payload.new_password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mật khẩu xác nhận không khớp.",
        )

    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mật khẩu mới phải khác mật khẩu hiện tại.",
        )

    current_user.password_hash = hash_password(payload.new_password)
    log_user_activity(
        db, current_user.id, "change_password", "Đổi mật khẩu tài khoản", request
    )
    revoke_all_user_sessions(db, current_user.id, except_session_id=session_id)

    return {
        "ok": True,
        "message": "Đổi mật khẩu thành công! Các phiên đăng nhập trên thiết bị khác đã được đăng xuất.",
    }


@router.get("/wishlist")
def get_wishlist(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    products = list(
        db.scalars(
            select(Product)
            .join(WishlistItem, WishlistItem.product_id == Product.id)
            .options(selectinload(Product.genres))
            .where(WishlistItem.user_id == current_user.id)
            .order_by(WishlistItem.created_at.desc(), WishlistItem.id.desc())
        ).all()
    )
    items = [_serialize_favorite_product(p, in_wishlist=True) for p in products]
    return {
        "items": items,
        "product_ids": [p.id for p in products],
        "count": len(items),
    }


@router.post("/wishlist/{product_id}")
def toggle_wishlist(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    product_exists = db.scalar(select(Product.id).where(Product.id == product_id))
    if product_exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy sản phẩm.",
        )

    existing = db.scalar(
        select(WishlistItem).where(
            WishlistItem.user_id == current_user.id,
            WishlistItem.product_id == product_id,
        )
    )
    if existing is not None:
        db.delete(existing)
        added = False
    else:
        db.add(WishlistItem(user_id=current_user.id, product_id=product_id))
        added = True

    db.commit()
    count = int(
        db.scalar(
            select(func.count(WishlistItem.id)).where(
                WishlistItem.user_id == current_user.id
            )
        )
        or 0
    )
    return {"added": added, "count": count}


@router.get("/orders")
def get_user_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    orders = list(
        db.scalars(
            select(Order)
            .options(selectinload(Order.items))
            .where(Order.user_id == current_user.id)
            .order_by(Order.created_at.desc(), Order.id.desc())
        ).all()
    )

    reviewed_pids = set(
        db.scalars(
            select(Review.product_id).where(Review.user_id == current_user.id)
        ).all()
    )

    result_orders: list[dict[str, Any]] = []
    for order in orders:
        status_lower = (order.status or "").strip().lower()
        pay_lower = (order.payment_status or "").strip().lower()
        is_delivered = status_lower not in _EXCLUDED_PURCHASED_STATUSES and (
            status_lower in _DELIVERED_STATUSES or pay_lower == "da_thanh_toan"
        )
        result_orders.append(
            {
                "id": order.id,
                "order_code": order.order_code,
                "created_at": order.created_at,
                "updated_at": order.updated_at,
                "status": order.status,
                "payment_status": order.payment_status,
                "payment_method": order.payment_method,
                "sub_total": float(order.sub_total),
                "promotion_code": order.promotion_code,
                "discount_amount": float(order.discount_amount),
                "shipping_fee": float(order.shipping_fee),
                "grand_total": float(order.grand_total),
                "full_name": order.full_name,
                "phone": order.phone,
                "address": order.address,
                "notes": order.notes,
                "can_cancel": status_lower in _CANCELLABLE_STATUSES,
                "items": [
                    {
                        "id": item.id,
                        "product_id": item.product_id,
                        "product_name": item.product_name,
                        "cover_url": item.cover_url,
                        "quantity": item.quantity,
                        "unit_price": float(item.unit_price),
                        "total_price": float(item.total_price),
                        "has_reviewed": (item.product_id in reviewed_pids)
                        if is_delivered
                        else False,
                    }
                    for item in order.items
                ],
            }
        )

    return {"orders": result_orders}


@router.post("/orders/{order_id}/cancel")
def cancel_order(
    order_id: int,
    request: Request,
    payload: CancelOrderRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    order = db.scalar(
        select(Order).where(Order.id == order_id).with_for_update()
    )
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy đơn hàng.",
        )

    if order.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền hủy đơn hàng này.",
        )

    if order.status not in _CANCELLABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Đơn hàng hiện tại không thể hủy.",
        )

    order_items = list(
        db.scalars(select(OrderItem).where(OrderItem.order_id == order.id)).all()
    )
    sorted_pids = sorted({item.product_id for item in order_items})
    if sorted_pids:
        products = {
            p.id: p
            for p in db.scalars(
                select(Product)
                .where(Product.id.in_(sorted_pids))
                .order_by(Product.id.asc())
                .with_for_update()
            ).all()
        }
        for item in order_items:
            prod = products.get(item.product_id)
            if prod is not None:
                prod.stock_quantity += item.quantity
                if prod.status == "het_hang" and prod.stock_quantity > 0:
                    prod.status = "dang_ban"

    if order.promotion_code:
        del_result = db.execute(
            delete(PromotionUsage).where(
                PromotionUsage.order_id == order.id,
                PromotionUsage.user_id == current_user.id,
                PromotionUsage.promotion_code == order.promotion_code,
            )
        )
        if del_result.rowcount:
            promo = db.scalar(
                select(Promotion)
                .where(Promotion.code == order.promotion_code)
                .with_for_update()
            )
            if promo is not None and promo.used_quantity > 0:
                promo.used_quantity -= 1

    prev_status = order.status
    order.status = "huy"

    reason = payload.reason if payload else None
    shipment = db.scalar(
        select(OrderShipment).where(OrderShipment.order_id == order.id)
    )
    if shipment is not None:
        shipment.shipping_status = "da_huy"
        if reason:
            shipment.notes = reason

    note_text = (
        f"Khách hàng hủy đơn: {reason}"[:255]
        if reason
        else "Khách hàng hủy đơn hàng"
    )
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            previous_status=prev_status,
            new_status="huy",
            notes=note_text,
            actor_id=current_user.id,
        )
    )
    db.add(
        UserNotification(
            user_id=current_user.id,
            title=f"Đơn hàng #{order.order_code} đã được hủy",
            content=f"Bạn đã hủy đơn hàng #{order.order_code}. Tồn kho và mã giảm giá (nếu có) đã được hoàn lại.",
            notification_type="don_hang",
            level="canh_bao",
        )
    )
    log_user_activity(
        db,
        current_user.id,
        "cancel_order",
        f"Hủy đơn hàng #{order.order_code}",
        request,
    )
    db.commit()

    return {
        "ok": True,
        "order_id": order.id,
        "order_code": order.order_code,
        "status": order.status,
    }


@router.get("/addresses")
def list_addresses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, list[dict[str, Any]]]:
    addresses = list(
        db.scalars(
            select(ShippingAddress)
            .where(ShippingAddress.user_id == current_user.id)
            .order_by(
                ShippingAddress.is_default.desc(),
                ShippingAddress.updated_at.desc(),
                ShippingAddress.id.desc(),
            )
        ).all()
    )
    return {"addresses": [_serialize_address(a) for a in addresses]}


@router.post("/addresses", status_code=status.HTTP_201_CREATED)
def create_address(
    payload: CreateAddressRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    existing_count = int(
        db.scalar(
            select(func.count(ShippingAddress.id)).where(
                ShippingAddress.user_id == current_user.id
            )
        )
        or 0
    )
    make_default = payload.is_default or existing_count == 0

    if make_default:
        existing_defaults = db.scalars(
            select(ShippingAddress).where(
                ShippingAddress.user_id == current_user.id,
                ShippingAddress.is_default.is_(True),
            )
        ).all()
        for addr in existing_defaults:
            addr.is_default = False

    new_addr = ShippingAddress(
        user_id=current_user.id,
        full_name=payload.full_name,
        phone_number=payload.phone_number,
        address_line=payload.address_line,
        ward=payload.ward,
        district=payload.district,
        province=payload.province,
        country=payload.country or "Việt Nam",
        is_default=make_default,
    )
    db.add(new_addr)
    db.commit()
    db.refresh(new_addr)

    return {"ok": True, "address": _serialize_address(new_addr)}


@router.post("/addresses/{address_id}/default")
def set_default_address(
    address_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    target = db.scalar(
        select(ShippingAddress).where(
            ShippingAddress.id == address_id,
            ShippingAddress.user_id == current_user.id,
        )
    )
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy địa chỉ giao hàng.",
        )

    user_addrs = db.scalars(
        select(ShippingAddress).where(ShippingAddress.user_id == current_user.id)
    ).all()
    for addr in user_addrs:
        addr.is_default = addr.id == target.id

    db.commit()
    db.refresh(target)
    return {"ok": True, "address": _serialize_address(target)}


@router.delete("/addresses/{address_id}")
def delete_address(
    address_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    target = db.scalar(
        select(ShippingAddress).where(
            ShippingAddress.id == address_id,
            ShippingAddress.user_id == current_user.id,
        )
    )
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy địa chỉ giao hàng.",
        )

    was_default = target.is_default
    db.delete(target)
    db.flush()

    if was_default:
        replacement = db.scalar(
            select(ShippingAddress)
            .where(ShippingAddress.user_id == current_user.id)
            .order_by(ShippingAddress.updated_at.desc(), ShippingAddress.id.desc())
            .limit(1)
        )
        if replacement is not None:
            replacement.is_default = True

    db.commit()
    return {"ok": True}
