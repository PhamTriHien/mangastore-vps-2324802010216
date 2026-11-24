from datetime import datetime, timezone
import json
import logging
import math
import secrets
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.database import get_db
from app.models import (
    CartItem,
    Order,
    OrderItem,
    OrderPayment,
    OrderShipment,
    OrderStatusHistory,
    Product,
    Promotion,
    PromotionUsage,
    ShippingAddress,
    User,
    UserNotification,
    utc_now,
)
from app.security import ensure_utc, get_current_user, get_optional_user, log_user_activity
from app.services import email_service, momo_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["cart-orders"])

_FREE_SHIPPING_THRESHOLD = 150_000.0
_DEFAULT_SHIPPING_FEE = 30_000.0


class AddToCartRequest(BaseModel):
    product_id: int = Field(..., gt=0)
    quantity: int = Field(default=1, ge=1, le=999)


class UpdateCartRequest(BaseModel):
    quantity: int = Field(..., ge=0, le=999)


class PlaceOrderRequest(BaseModel):
    selected_product_ids: list[int] = Field(..., min_length=1)
    payment_method: Literal["cod", "momo"] = "cod"
    coupon_code: str | None = Field(default=None, max_length=50)
    full_name: str = Field(..., min_length=1, max_length=150)
    phone: str = Field(..., min_length=1, max_length=20)
    email: str | None = Field(default=None, max_length=150)
    address: str = Field(..., min_length=1, max_length=500)
    province: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    ward: str | None = Field(default=None, max_length=100)
    lat: float | None = None
    lng: float | None = None
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="before")
    @classmethod
    def _unpack_nested_shipping(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        merged = dict(data)
        shipping = merged.get("shipping_address")
        if isinstance(shipping, dict):
            for key in (
                "full_name",
                "phone",
                "email",
                "address",
                "province",
                "district",
                "ward",
                "lat",
                "lng",
            ):
                if key not in merged and key in shipping:
                    merged[key] = shipping[key]
            if "phone" not in merged and "phone_number" in shipping:
                merged["phone"] = shipping["phone_number"]
            if "address" not in merged and "address_line" in shipping:
                merged["address"] = shipping["address_line"]
        if "notes" not in merged and "note" in merged:
            merged["notes"] = merged["note"]
        return merged

    @field_validator("selected_product_ids")
    @classmethod
    def _dedupe_product_ids(cls, values: list[int]) -> list[int]:
        deduped: list[int] = []
        seen: set[int] = set()
        for pid in values:
            if pid <= 0:
                raise ValueError("Mã sản phẩm trong đơn hàng không hợp lệ.")
            if pid not in seen:
                seen.add(pid)
                deduped.append(pid)
        if not deduped:
            raise ValueError("Vui lòng chọn ít nhất một sản phẩm để đặt hàng.")
        return deduped

    @field_validator("full_name", "phone", "address")
    @classmethod
    def _clean_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Thông tin giao hàng không được để trống.")
        return cleaned

    @field_validator("lat", "lng")
    @classmethod
    def _validate_coord(cls, value: float | None) -> float | None:
        if value is None:
            return None
        if not math.isfinite(value):
            return None
        return value


def _compute_shipping_fee(sub_total: float) -> float:
    if sub_total <= 0 or sub_total >= _FREE_SHIPPING_THRESHOLD:
        return 0.0
    return _DEFAULT_SHIPPING_FEE


def _build_cart_summary(db: Session, user_id: int | None) -> dict[str, Any]:
    if user_id is None:
        return {
            "items": [],
            "total_items": 0,
            "sub_total": 0.0,
            "shipping_fee": 0.0,
            "grand_total": 0.0,
        }

    rows = db.execute(
        select(CartItem, Product)
        .join(Product, CartItem.product_id == Product.id)
        .where(CartItem.user_id == user_id)
        .order_by(CartItem.added_at.desc(), CartItem.id.desc())
    ).all()

    items: list[dict[str, Any]] = []
    sub_total = 0.0
    total_items = 0
    for cart_item, product in rows:
        live_price = float(product.price)
        qty = int(cart_item.quantity)
        line_total = round(live_price * qty, 2)
        is_available = product.status == "dang_ban" and product.stock_quantity > 0
        items.append(
            {
                "product_id": product.id,
                "title": product.title,
                "author": product.author,
                "cover_url": product.cover_url or "/covers/default-manga.svg",
                "price": live_price,
                "unit_price": live_price,
                "quantity": qty,
                "subtotal": line_total,
                "max_stock": int(product.stock_quantity),
                "stock_quantity": int(product.stock_quantity),
                "status": product.status,
                "is_available": is_available,
            }
        )
        sub_total += line_total
        total_items += qty

    shipping_fee = _compute_shipping_fee(sub_total)
    grand_total = round(sub_total + shipping_fee, 2)
    return {
        "items": items,
        "total_items": total_items,
        "sub_total": round(sub_total, 2),
        "shipping_fee": shipping_fee,
        "grand_total": grand_total,
    }


def _validate_and_compute_coupon(
    db: Session,
    raw_code: str,
    user: User,
    sub_total: float,
    lock_for_update: bool = False,
) -> tuple[bool, Promotion | None, float, str]:
    trimmed = raw_code.strip()
    if not trimmed:
        return False, None, 0.0, "Vui lòng nhập mã giảm giá."

    stmt = select(Promotion).where(func.lower(Promotion.code) == trimmed.lower())
    if lock_for_update:
        stmt = stmt.with_for_update()
    promo = db.scalar(stmt)
    if promo is None:
        return False, None, 0.0, "Mã giảm giá không tồn tại."

    now = datetime.now(timezone.utc)
    starts_at = ensure_utc(promo.starts_at)
    ends_at = ensure_utc(promo.ends_at)
    if now < starts_at:
        return False, promo, 0.0, "Mã giảm giá chưa đến thời gian áp dụng."
    if now > ends_at:
        return False, promo, 0.0, "Mã giảm giá đã hết hạn."

    if promo.total_quantity is not None and promo.used_quantity >= promo.total_quantity:
        return False, promo, 0.0, "Mã giảm giá đã hết lượt sử dụng."

    if promo.min_order_amount is not None and sub_total < float(promo.min_order_amount):
        min_amt = float(promo.min_order_amount)
        return (
            False,
            promo,
            0.0,
            f"Đơn hàng cần tối thiểu {min_amt:,.0f}đ để áp dụng mã này.",
        )

    if promo.applicable_role_id is not None and user.role_id != promo.applicable_role_id:
        return False, promo, 0.0, "Mã giảm giá không áp dụng cho tài khoản của bạn."

    already_used = db.scalar(
        select(PromotionUsage.id).where(
            PromotionUsage.promotion_code == promo.code,
            PromotionUsage.user_id == user.id,
        )
    )
    if already_used is not None:
        return False, promo, 0.0, "Bạn đã sử dụng mã giảm giá này rồi."

    dtype = (promo.discount_type or "").strip().lower()
    dval = float(promo.discount_value)
    if dtype in ("phan_tram", "percent"):
        discount = float(round(sub_total * (dval / 100.0)))
    else:
        discount = dval

    if promo.max_discount is not None and float(promo.max_discount) > 0:
        discount = min(discount, float(promo.max_discount))

    discount = max(0.0, min(discount, sub_total))
    return True, promo, discount, f"Áp dụng mã {promo.code} thành công (-{discount:,.0f}đ)."


def _generate_unique_order_code(db: Session) -> str:
    prefix = f"MG{datetime.now(timezone.utc).strftime('%Y%m%d')}"
    for _ in range(10):
        candidate = f"{prefix}{100000 + secrets.randbelow(900000):06d}"
        if db.scalar(select(Order.id).where(Order.order_code == candidate)) is None:
            return candidate
    return f"{prefix}{secrets.token_hex(3).upper()}"


def _resolve_shipping_address_id(
    db: Session,
    user_id: int,
    address: str,
    phone: str,
) -> int | None:
    exact = db.scalar(
        select(ShippingAddress.id)
        .where(
            ShippingAddress.user_id == user_id,
            func.lower(ShippingAddress.address_line) == address.strip().lower(),
            ShippingAddress.phone_number == phone.strip(),
        )
        .order_by(ShippingAddress.id.desc())
        .limit(1)
    )
    if exact is not None:
        return int(exact)

    default_id = db.scalar(
        select(ShippingAddress.id)
        .where(ShippingAddress.user_id == user_id, ShippingAddress.is_default.is_(True))
        .order_by(ShippingAddress.id.desc())
        .limit(1)
    )
    return int(default_id) if default_id is not None else None


def _resolve_base_url(request: Request) -> str:
    configured = get_settings().app_base_url.strip().rstrip("/")
    if configured:
        return configured
    return str(request.base_url).rstrip("/")


def _send_order_email_best_effort(db: Session, order: Order) -> None:
    if not order.email:
        return
    try:
        items = db.scalars(
            select(OrderItem).where(OrderItem.order_id == order.id)
        ).all()
        email_items = [
            {
                "product_name": item.product_name,
                "quantity": item.quantity,
                "subtotal": float(item.total_price),
            }
            for item in items
        ]
        email_service.send_order_confirmation_email(
            to_email=order.email,
            customer_name=order.full_name,
            order_code=order.order_code,
            items=email_items,
            sub_total=float(order.sub_total),
            discount=float(order.discount_amount),
            shipping_fee=float(order.shipping_fee),
            grand_total=float(order.grand_total),
            payment_method=order.payment_method,
        )
    except Exception as exc:
        logger.warning("Failed sending order email for %s: %s", order.order_code, exc)


def _compensate_failed_momo_order(
    db: Session,
    order_id: int,
    user_id: int,
    momo_response: dict[str, Any],
) -> None:
    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None:
        return

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
                PromotionUsage.user_id == user_id,
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
    order.payment_status = "thanh_toan_that_bai"

    payment_row = db.scalar(
        select(OrderPayment).where(OrderPayment.order_id == order.id)
    )
    if payment_row is not None:
        payment_row.status = "that_bai"
        payment_row.response_data = json.dumps(momo_response, ensure_ascii=False)

    shipment_row = db.scalar(
        select(OrderShipment).where(OrderShipment.order_id == order.id)
    )
    if shipment_row is not None:
        shipment_row.shipping_status = "da_huy"

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            previous_status=prev_status,
            new_status="huy",
            notes="Khởi tạo cổng thanh toán MoMo thất bại",
            actor_id=user_id,
        )
    )
    db.commit()


def _mark_order_paid(
    db: Session,
    order: Order,
    trans_id: str | None = None,
    raw_response: str | None = None,
) -> bool:
    if order.payment_status == "da_thanh_toan":
        return False

    previous_status = order.status
    order.status = "da_thanh_toan"
    order.payment_status = "da_thanh_toan"
    if trans_id and trans_id != "0":
        order.momo_trans_id = trans_id[:100]
    if order.paid_at is None:
        order.paid_at = utc_now()

    payment_row = db.scalar(
        select(OrderPayment).where(OrderPayment.order_id == order.id)
    )
    if payment_row is not None:
        payment_row.status = "thanh_cong"
        if trans_id and trans_id != "0":
            payment_row.reference_code = trans_id[:120]
        if raw_response:
            payment_row.response_data = raw_response

    note = (
        f"Thanh toán MoMo thành công (TransId: {trans_id})"
        if trans_id and trans_id != "0"
        else "Thanh toán MoMo thành công"
    )
    db.add(
        OrderStatusHistory(
            order_id=order.id,
            previous_status=previous_status,
            new_status="da_thanh_toan",
            notes=note,
            actor_id=order.user_id,
        )
    )
    db.add(
        UserNotification(
            user_id=order.user_id,
            title=f"Thanh toán đơn hàng #{order.order_code} thành công",
            content=f"Đơn hàng #{order.order_code} đã được thanh toán qua MoMo.",
            notification_type="thanh_toan",
            level="thanh_cong",
        )
    )

    ordered_pids = list(
        db.scalars(
            select(OrderItem.product_id).where(OrderItem.order_id == order.id)
        ).all()
    )
    if ordered_pids:
        db.execute(
            delete(CartItem).where(
                CartItem.user_id == order.user_id,
                CartItem.product_id.in_(ordered_pids),
            )
        )

    db.commit()
    return True


def _mark_order_payment_failed(
    db: Session,
    order: Order,
    trans_id: str | None = None,
    raw_response: str | None = None,
) -> None:
    if order.payment_status == "da_thanh_toan":
        return

    order.payment_status = "thanh_toan_that_bai"
    if trans_id and trans_id != "0":
        order.momo_trans_id = trans_id[:100]

    payment_row = db.scalar(
        select(OrderPayment).where(OrderPayment.order_id == order.id)
    )
    if payment_row is not None:
        payment_row.status = "that_bai"
        if raw_response:
            payment_row.response_data = raw_response

    db.commit()


@router.get("/cart")
def get_cart(
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> dict[str, Any]:
    return _build_cart_summary(db, current_user.id if current_user else None)


@router.post("/cart")
def add_to_cart(
    payload: AddToCartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    product = db.scalar(select(Product).where(Product.id == payload.product_id))
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy sản phẩm.",
        )

    if product.status != "dang_ban" or product.stock_quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sản phẩm hiện tạm hết hàng hoặc đã ngừng bán.",
        )

    existing = db.scalar(
        select(CartItem).where(
            CartItem.user_id == current_user.id,
            CartItem.product_id == product.id,
        )
    )
    requested_total = (existing.quantity if existing else 0) + payload.quantity
    if requested_total > product.stock_quantity:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Số lượng yêu cầu vượt quá tồn kho hiện có ({product.stock_quantity}).",
        )

    if existing is not None:
        existing.quantity = requested_total
        existing.unit_price = product.price
        existing.updated_at = utc_now()
    else:
        db.add(
            CartItem(
                user_id=current_user.id,
                product_id=product.id,
                quantity=payload.quantity,
                unit_price=product.price,
            )
        )

    db.commit()
    summary = _build_cart_summary(db, current_user.id)
    return {
        "ok": True,
        "message": "Đã thêm vào giỏ hàng!",
        "cart_count": summary["total_items"],
        **summary,
    }


@router.put("/cart/{product_id}")
def update_cart_item(
    product_id: int,
    payload: UpdateCartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    if payload.quantity <= 0:
        db.execute(
            delete(CartItem).where(
                CartItem.user_id == current_user.id,
                CartItem.product_id == product_id,
            )
        )
        db.commit()
        summary = _build_cart_summary(db, current_user.id)
        return {"ok": True, "cart_count": summary["total_items"], **summary}

    product = db.scalar(select(Product).where(Product.id == product_id))
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy sản phẩm.",
        )

    if product.status != "dang_ban" or product.stock_quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sản phẩm hiện tạm hết hàng hoặc đã ngừng bán.",
        )

    if payload.quantity > product.stock_quantity:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Số lượng tối đa hiện có trong kho là {product.stock_quantity}.",
        )

    cart_item = db.scalar(
        select(CartItem).where(
            CartItem.user_id == current_user.id,
            CartItem.product_id == product_id,
        )
    )
    if cart_item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sản phẩm không có trong giỏ hàng.",
        )

    cart_item.quantity = payload.quantity
    cart_item.unit_price = product.price
    cart_item.updated_at = utc_now()
    db.commit()
    summary = _build_cart_summary(db, current_user.id)
    return {
        "ok": True,
        "message": "Đã cập nhật số lượng.",
        "cart_count": summary["total_items"],
        **summary,
    }


@router.delete("/cart/{product_id}")
def remove_cart_item(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    db.execute(
        delete(CartItem).where(
            CartItem.user_id == current_user.id,
            CartItem.product_id == product_id,
        )
    )
    db.commit()
    summary = _build_cart_summary(db, current_user.id)
    return {
        "ok": True,
        "message": "Đã xóa sản phẩm khỏi giỏ hàng.",
        "cart_count": summary["total_items"],
        **summary,
    }


@router.delete("/cart")
def clear_cart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    db.execute(delete(CartItem).where(CartItem.user_id == current_user.id))
    db.commit()
    summary = _build_cart_summary(db, current_user.id)
    return {
        "ok": True,
        "message": "Đã xóa toàn bộ giỏ hàng.",
        "cart_count": summary["total_items"],
        **summary,
    }


@router.get("/coupons/validate")
def validate_coupon(
    code: str = Query(default=""),
    sub_total: float = Query(..., ge=0.0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    shipping_fee = _compute_shipping_fee(sub_total)
    if not code.strip() or sub_total <= 0:
        return {
            "valid": False,
            "code": "",
            "discount": 0.0,
            "discount_amount": 0.0,
            "shipping_fee": shipping_fee,
            "grand_total": round(sub_total + shipping_fee, 2),
            "message": "Vui lòng nhập mã giảm giá hợp lệ.",
        }

    valid, promo, discount, message = _validate_and_compute_coupon(
        db,
        code,
        current_user,
        sub_total,
        lock_for_update=False,
    )
    grand_total = round(max(0.0, sub_total - discount + shipping_fee), 2)
    rounded_discount = round(discount, 2)
    return {
        "valid": valid,
        "code": promo.code if promo else "",
        "display_name": promo.display_name if promo and valid else "",
        "discount": rounded_discount,
        "discount_amount": rounded_discount,
        "shipping_fee": shipping_fee,
        "grand_total": grand_total,
        "message": message,
    }


@router.post("/orders", status_code=status.HTTP_201_CREATED)
def place_order(
    payload: PlaceOrderRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    cart_rows = db.scalars(
        select(CartItem).where(
            CartItem.user_id == current_user.id,
            CartItem.product_id.in_(payload.selected_product_ids),
        )
    ).all()
    cart_by_pid = {item.product_id: item for item in cart_rows}

    for pid in payload.selected_product_ids:
        ci = cart_by_pid.get(pid)
        if ci is None or ci.quantity <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sản phẩm đã chọn không còn trong giỏ hàng. Vui lòng kiểm tra lại.",
            )

    sorted_pids = sorted(payload.selected_product_ids)
    locked_products = db.scalars(
        select(Product)
        .where(Product.id.in_(sorted_pids))
        .order_by(Product.id.asc())
        .with_for_update()
    ).all()
    products_by_id = {p.id: p for p in locked_products}

    sub_total = 0.0
    resolved_items: list[tuple[Product, int]] = []
    for pid in sorted_pids:
        prod = products_by_id.get(pid)
        if prod is None:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sản phẩm đã chọn không còn tồn tại.",
            )
        qty = cart_by_pid[pid].quantity
        if prod.status != "dang_ban" or prod.stock_quantity < qty:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f'Sản phẩm "{prod.title}" chỉ còn {max(0, prod.stock_quantity)} cuốn hoặc đã ngừng bán.',
            )
        sub_total += float(prod.price) * qty
        resolved_items.append((prod, qty))

    applied_promo: Promotion | None = None
    discount_amount = 0.0
    if payload.coupon_code and payload.coupon_code.strip():
        valid, promo, discount, coupon_msg = _validate_and_compute_coupon(
            db,
            payload.coupon_code,
            current_user,
            sub_total,
            lock_for_update=True,
        )
        if not valid or promo is None:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=coupon_msg)
        applied_promo = promo
        discount_amount = discount

    shipping_fee = _compute_shipping_fee(sub_total)
    grand_total = round(max(0.0, sub_total - discount_amount + shipping_fee), 2)
    order_code = _generate_unique_order_code(db)
    initial_status = "cho_thanh_toan" if payload.payment_method == "momo" else "cho_xu_ly"
    shipping_address_id = _resolve_shipping_address_id(
        db, current_user.id, payload.address, payload.phone
    )
    customer_email = (payload.email or current_user.email or "").strip()[:150] or None

    order = Order(
        order_code=order_code,
        user_id=current_user.id,
        sub_total=round(sub_total, 2),
        promotion_code=applied_promo.code if applied_promo else None,
        discount_amount=round(discount_amount, 2),
        shipping_fee=shipping_fee,
        tax_amount=0.0,
        grand_total=grand_total,
        status=initial_status,
        payment_status="cho_thanh_toan",
        payment_method=payload.payment_method,
        shipping_address_id=shipping_address_id,
        full_name=payload.full_name,
        phone=payload.phone,
        email=customer_email,
        address=payload.address,
        province=(payload.province or "").strip()[:100] or None,
        district=(payload.district or "").strip()[:100] or None,
        ward=(payload.ward or "").strip()[:100] or None,
        lat=payload.lat,
        lng=payload.lng,
        notes=(payload.notes or "").strip()[:500] or None,
    )
    db.add(order)
    db.flush()

    for prod, qty in resolved_items:
        unit_price = float(prod.price)
        db.add(
            OrderItem(
                order_id=order.id,
                product_id=prod.id,
                product_name=prod.title[:200],
                cover_url=prod.cover_url or "/covers/default-manga.svg",
                quantity=qty,
                unit_price=unit_price,
                total_price=round(unit_price * qty, 2),
            )
        )
        prod.stock_quantity -= qty
        if prod.stock_quantity <= 0:
            prod.stock_quantity = 0
            prod.status = "het_hang"

    if applied_promo is not None:
        db.add(
            PromotionUsage(
                promotion_code=applied_promo.code,
                user_id=current_user.id,
                order_id=order.id,
            )
        )
        applied_promo.used_quantity += 1

    db.add(
        OrderStatusHistory(
            order_id=order.id,
            previous_status=None,
            new_status=initial_status,
            notes=(
                "Khởi tạo đơn hàng thanh toán MoMo"
                if payload.payment_method == "momo"
                else "Đặt hàng COD mới"
            ),
            actor_id=current_user.id,
        )
    )
    db.add(
        OrderPayment(
            order_id=order.id,
            payment_method=payload.payment_method,
            reference_code=order_code,
            amount=grand_total,
            status="khoi_tao" if payload.payment_method == "momo" else "cho_xu_ly",
            content=f"Thanh toán đơn hàng {order_code}",
        )
    )
    db.add(
        OrderShipment(
            order_id=order.id,
            carrier="MangaExpress",
            shipping_status="cho_lay_hang",
            notes=(payload.notes or "").strip()[:255] or None,
        )
    )
    db.add(
        UserNotification(
            user_id=current_user.id,
            title=f"Đơn hàng #{order_code} đã được tạo",
            content=f"Đơn hàng #{order_code} trị giá {grand_total:,.0f}đ đang chờ xử lý.",
            notification_type="don_hang",
            level="thong_tin",
        )
    )

    if payload.payment_method == "cod":
        db.execute(
            delete(CartItem).where(
                CartItem.user_id == current_user.id,
                CartItem.product_id.in_(sorted_pids),
            )
        )
        log_user_activity(
            db,
            current_user.id,
            "create_order",
            f"Đặt đơn hàng COD #{order_code}",
            request,
        )
        db.commit()
        _send_order_email_best_effort(db, order)
        return {
            "ok": True,
            "order_id": order.id,
            "order_code": order_code,
            "payment_method": "cod",
            "status": order.status,
            "payment_status": order.payment_status,
            "sub_total": float(order.sub_total),
            "discount_amount": float(order.discount_amount),
            "shipping_fee": float(order.shipping_fee),
            "grand_total": float(order.grand_total),
        }

    log_user_activity(
        db,
        current_user.id,
        "create_order_momo",
        f"Khởi tạo đơn hàng MoMo #{order_code}",
        request,
    )
    db.commit()

    base_url = _resolve_base_url(request)
    momo_res = momo_service.create_payment(
        order_id=order_code,
        amount=int(round(grand_total)),
        order_info=f"Thanh toán đơn hàng {order_code} - MangaStore",
        redirect_url=f"{base_url}/api/orders/momo-return",
        ipn_url=f"{base_url}/api/orders/momo-ipn",
        extra_data=str(order.id),
    )

    if momo_res.get("success") and momo_res.get("pay_url"):
        return {
            "ok": True,
            "order_id": order.id,
            "order_code": order_code,
            "payment_method": "momo",
            "status": order.status,
            "payment_status": order.payment_status,
            "sub_total": float(order.sub_total),
            "discount_amount": float(order.discount_amount),
            "shipping_fee": float(order.shipping_fee),
            "grand_total": float(order.grand_total),
            "pay_url": momo_res["pay_url"],
            "qr_code_url": momo_res.get("qr_code_url", ""),
            "deeplink": momo_res.get("deeplink", ""),
        }

    _compensate_failed_momo_order(db, order.id, current_user.id, momo_res)
    detail_msg = str(
        momo_res.get("message")
        or "Không thể kết nối cổng thanh toán MoMo lúc này. Vui lòng thử lại hoặc chọn COD."
    )
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={
            "detail": detail_msg,
            "momo_error": True,
            "order_code": order_code,
        },
    )


@router.post("/orders/momo-ipn")
async def momo_ipn(
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        payload = await request.json()
    except ValueError:
        return {"resultCode": 1, "message": "Invalid JSON payload"}

    if not isinstance(payload, dict) or not str(payload.get("orderId") or "").strip():
        return {"resultCode": 1, "message": "Invalid request"}

    if not momo_service.verify_signature(payload):
        return {"resultCode": 1, "message": "Invalid signature"}

    settings = get_settings()
    if str(payload.get("partnerCode") or "").strip() != settings.momo_partner_code.strip():
        return {"resultCode": 1, "message": "Invalid partnerCode"}

    order_code = str(payload["orderId"]).strip()
    order = db.scalar(
        select(Order).where(Order.order_code == order_code).with_for_update()
    )
    if order is None:
        return {"resultCode": 1, "message": "Order not found"}

    expected_amount = int(round(float(order.grand_total)))
    try:
        ipn_amount = int(payload.get("amount", -1))
    except (TypeError, ValueError):
        ipn_amount = -1
    if ipn_amount != expected_amount:
        return {"resultCode": 1, "message": "Invalid amount"}

    raw_json = json.dumps(payload, ensure_ascii=False)
    trans_id = str(payload.get("transId") or "")
    try:
        result_code = int(payload.get("resultCode", -1))
    except (TypeError, ValueError):
        result_code = -1

    if result_code == 0:
        transitioned = _mark_order_paid(db, order, trans_id=trans_id, raw_response=raw_json)
        if transitioned:
            _send_order_email_best_effort(db, order)
    else:
        _mark_order_payment_failed(db, order, trans_id=trans_id, raw_response=raw_json)

    return {"resultCode": 0, "message": "OK"}


@router.get("/orders/momo-return")
def momo_return(
    request: Request,
    db: Session = Depends(get_db),
) -> Any:
    params = dict(request.query_params)
    order_code = str(params.get("orderId") or "").strip()
    accept_header = (request.headers.get("accept") or "").lower()
    wants_html = "text/html" in accept_header and "application/json" not in accept_header
    base_url = _resolve_base_url(request)

    def _respond(ok: bool, paid: bool, msg: str, status_code: int = 200) -> Any:
        if wants_html:
            target = (
                f"{base_url}/orders/{order_code}?payment={'success' if paid else 'failed'}"
                if order_code
                else f"{base_url}/profile?payment=error"
            )
            return RedirectResponse(url=target, status_code=status.HTTP_302_FOUND)
        return JSONResponse(
            status_code=status_code,
            content={
                "ok": ok,
                "paid": paid,
                "order_code": order_code,
                "message": msg,
            },
        )

    if not order_code:
        return _respond(False, False, "Thông tin phản hồi thanh toán không hợp lệ.", 400)

    settings = get_settings()
    if (
        not momo_service.verify_signature(params)
        or str(params.get("partnerCode") or "").strip() != settings.momo_partner_code.strip()
    ):
        return _respond(False, False, "Chữ ký xác thực thanh toán MoMo không hợp lệ.", 400)

    order = db.scalar(
        select(Order).where(Order.order_code == order_code).with_for_update()
    )
    if order is None:
        return _respond(False, False, "Không tìm thấy đơn hàng cần xác nhận.", 404)

    expected_amount = int(round(float(order.grand_total)))
    try:
        param_amount = int(params.get("amount", -1))
        result_code = int(params.get("resultCode", -1))
    except (TypeError, ValueError):
        return _respond(False, False, "Dữ liệu giao dịch MoMo không hợp lệ.", 400)

    if result_code != 0:
        _mark_order_payment_failed(
            db,
            order,
            trans_id=str(params.get("transId") or ""),
            raw_response=json.dumps(params, ensure_ascii=False),
        )
        msg = str(params.get("message") or "Thanh toán MoMo không thành công.")
        return _respond(False, False, msg, 200)

    if order.payment_status == "da_thanh_toan":
        return _respond(True, True, "Thanh toán MoMo thành công!", 200)

    query_res = momo_service.query_transaction(
        order_code,
        request_id=str(params.get("requestId") or ""),
    )
    if (
        query_res.get("is_paid")
        and query_res.get("amount") == expected_amount
        and param_amount == expected_amount
    ):
        trans_id = str(query_res.get("trans_id") or params.get("transId") or "")
        transitioned = _mark_order_paid(
            db,
            order,
            trans_id=trans_id,
            raw_response=json.dumps(query_res.get("raw") or query_res, ensure_ascii=False),
        )
        if transitioned:
            _send_order_email_best_effort(db, order)
        return _respond(True, True, "Thanh toán MoMo thành công!", 200)

    return _respond(
        False,
        False,
        str(query_res.get("message") or "Giao dịch MoMo chưa được xác nhận thanh toán hợp lệ."),
        200,
    )


@router.get("/orders/{order_code}/payment-status")
def check_order_payment_status(
    order_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    clean_code = order_code.strip()
    order = db.scalar(
        select(Order).where(
            Order.order_code == clean_code,
            Order.user_id == current_user.id,
        )
    )
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy đơn hàng.",
        )

    if order.payment_status == "da_thanh_toan":
        return {
            "ok": True,
            "paid": True,
            "pending": False,
            "order_code": order.order_code,
            "status": order.status,
            "payment_status": order.payment_status,
            "trans_id": order.momo_trans_id,
            "message": "Thanh toán thành công!",
        }

    if order.payment_method != "momo":
        return {
            "ok": True,
            "paid": False,
            "pending": order.status in ("cho_xu_ly", "xac_nhan", "shipping"),
            "order_code": order.order_code,
            "status": order.status,
            "payment_status": order.payment_status,
            "trans_id": None,
            "message": "Đơn hàng thanh toán khi nhận hàng (COD).",
        }

    query_res = momo_service.query_transaction(order.order_code)
    expected_amount = int(round(float(order.grand_total)))
    if query_res.get("is_paid") and query_res.get("amount") == expected_amount:
        locked_order = db.scalar(
            select(Order).where(Order.id == order.id).with_for_update()
        )
        if locked_order is not None:
            trans_id = str(query_res.get("trans_id") or "")
            transitioned = _mark_order_paid(
                db,
                locked_order,
                trans_id=trans_id,
                raw_response=json.dumps(query_res.get("raw") or query_res, ensure_ascii=False),
            )
            if transitioned:
                _send_order_email_best_effort(db, locked_order)
            db.refresh(locked_order)
            order = locked_order
        return {
            "ok": True,
            "paid": True,
            "pending": False,
            "order_code": order.order_code,
            "status": order.status,
            "payment_status": order.payment_status,
            "trans_id": order.momo_trans_id,
            "message": "Thanh toán thành công!",
        }

    if query_res.get("is_pending"):
        return {
            "ok": True,
            "paid": False,
            "pending": True,
            "order_code": order.order_code,
            "status": order.status,
            "payment_status": order.payment_status,
            "trans_id": None,
            "message": "Đang chờ thanh toán...",
        }

    return {
        "ok": bool(query_res.get("success")),
        "paid": False,
        "pending": False,
        "order_code": order.order_code,
        "status": order.status,
        "payment_status": order.payment_status,
        "trans_id": None,
        "message": str(query_res.get("message") or "Chưa hoàn tất thanh toán."),
    }


@router.get("/orders/{order_code}")
def get_order_detail(
    order_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    clean_code = order_code.strip()
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.items))
        .where(Order.order_code == clean_code)
    )
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy đơn hàng.",
        )

    if order.user_id != current_user.id and current_user.role_id not in (1, 2):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền xem đơn hàng này.",
        )

    histories = db.scalars(
        select(OrderStatusHistory)
        .where(OrderStatusHistory.order_id == order.id)
        .order_by(OrderStatusHistory.created_at.asc(), OrderStatusHistory.id.asc())
    ).all()
    payment = db.scalar(
        select(OrderPayment)
        .where(OrderPayment.order_id == order.id)
        .order_by(OrderPayment.id.desc())
    )
    shipment = db.scalar(
        select(OrderShipment).where(OrderShipment.order_id == order.id)
    )

    return {
        "id": order.id,
        "order_code": order.order_code,
        "user_id": order.user_id,
        "sub_total": float(order.sub_total),
        "promotion_code": order.promotion_code,
        "discount_amount": float(order.discount_amount),
        "shipping_fee": float(order.shipping_fee),
        "tax_amount": float(order.tax_amount),
        "grand_total": float(order.grand_total),
        "status": order.status,
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "momo_trans_id": order.momo_trans_id,
        "full_name": order.full_name,
        "phone": order.phone,
        "email": order.email,
        "address": order.address,
        "province": order.province,
        "district": order.district,
        "ward": order.ward,
        "lat": order.lat,
        "lng": order.lng,
        "notes": order.notes,
        "paid_at": order.paid_at,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
        "items": [
            {
                "id": item.id,
                "product_id": item.product_id,
                "product_name": item.product_name,
                "cover_url": item.cover_url,
                "quantity": item.quantity,
                "unit_price": float(item.unit_price),
                "total_price": float(item.total_price),
            }
            for item in order.items
        ],
        "status_history": [
            {
                "id": h.id,
                "previous_status": h.previous_status,
                "new_status": h.new_status,
                "notes": h.notes,
                "created_at": h.created_at,
            }
            for h in histories
        ],
        "payment": {
            "payment_method": payment.payment_method,
            "reference_code": payment.reference_code,
            "amount": float(payment.amount),
            "status": payment.status,
            "content": payment.content,
            "updated_at": payment.updated_at,
        }
        if payment
        else None,
        "shipment": {
            "carrier": shipment.carrier,
            "tracking_number": shipment.tracking_number,
            "shipping_status": shipment.shipping_status,
            "shipped_at": shipment.shipped_at,
            "estimated_delivery_at": shipment.estimated_delivery_at,
            "notes": shipment.notes,
        }
        if shipment
        else None,
    }
