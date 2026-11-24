from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    role_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False, default=3
    )
    role: Mapped[str] = mapped_column(
        String(30), nullable=False, default="khach_hang", server_default="khach_hang"
    )
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="hoat_dong", server_default="hoat_dong"
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
    )

    role_rel: Mapped["Role"] = relationship("Role")


class UserSession(Base):
    __tablename__ = "user_sessions"

    session_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    is_persistent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(400), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    otp_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class ShippingAddress(Base):
    __tablename__ = "shipping_addresses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(20), nullable=False)
    address_line: Mapped[str] = mapped_column(String(255), nullable=False)
    ward: Mapped[str | None] = mapped_column(String(100), nullable=True)
    district: Mapped[str | None] = mapped_column(String(100), nullable=True)
    province: Mapped[str | None] = mapped_column(String(100), nullable=True)
    country: Mapped[str] = mapped_column(String(100), nullable=False, default="Việt Nam")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
    )


class UserActivity(Base):
    __tablename__ = "user_activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    activity_type: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(400), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class UserNotification(Base):
    __tablename__ = "user_notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    notification_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="thong_tin")
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SearchHistory(Base):
    __tablename__ = "search_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    keyword: Mapped[str] = mapped_column(String(200), index=True, nullable=False)
    filters_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    results_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class Genre(Base):
    __tablename__ = "genres"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class ProductGenre(Base):
    __tablename__ = "product_genres"

    product_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("products.id", ondelete="CASCADE"), primary_key=True
    )
    genre_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True
    )


class ProductTag(Base):
    __tablename__ = "product_tags"

    product_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("products.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )


class ProductAsset(Base):
    __tablename__ = "product_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False
    )
    asset_type: Mapped[str] = mapped_column(String(50), nullable=False, default="gallery")
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), index=True, nullable=False)
    author: Mapped[str] = mapped_column(String(120), nullable=False, default="Không rõ")
    publisher: Mapped[str | None] = mapped_column(String(120), nullable=True)
    publication_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dimensions: Mapped[str | None] = mapped_column(String(60), nullable=True)
    weight: Mapped[str | None] = mapped_column(String(40), nullable=True)
    language: Mapped[str] = mapped_column(String(50), nullable=False, default="Tiếng Việt")
    isbn: Mapped[str | None] = mapped_column(String(40), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    full_description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    cover_url: Mapped[str] = mapped_column(
        String(500), nullable=False, default="/covers/default-manga.svg"
    )
    price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    original_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    average_rating: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    ratings_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    units_sold: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    stock_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="dang_ban", server_default="dang_ban", index=True
    )
    is_featured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_new: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    import_batch_id: Mapped[str | None] = mapped_column(String(50), index=True, nullable=True)
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
    )

    genres: Mapped[list["Genre"]] = relationship("Genre", secondary="product_genres")
    tags: Mapped[list["Tag"]] = relationship("Tag", secondary="product_tags")
    assets: Mapped[list["ProductAsset"]] = relationship(
        "ProductAsset",
        cascade="all, delete-orphan",
        order_by="ProductAsset.display_order.asc()",
    )
    chapters: Mapped[list["Chapter"]] = relationship(
        "Chapter",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="Chapter.chapter_number.asc()",
    )


class Chapter(Base):
    __tablename__ = "chapters"
    __table_args__ = (UniqueConstraint("product_id", "chapter_number", name="uq_product_chapter_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False
    )
    chapter_number: Mapped[float] = mapped_column(Float, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )

    product: Mapped["Product"] = relationship("Product", back_populates="chapters")


class WishlistItem(Base):
    __tablename__ = "wishlists"
    __table_args__ = (UniqueConstraint("user_id", "product_id", name="uq_wishlist_user_product"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (UniqueConstraint("user_id", "product_id", name="uq_cart_user_product"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
    )


class Promotion(Base):
    __tablename__ = "promotions"

    code: Mapped[str] = mapped_column(String(50), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    discount_value: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    discount_type: Mapped[str] = mapped_column(String(20), nullable=False, default="phan_tram")
    max_discount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    min_order_amount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    total_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    used_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    applicable_role_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class PromotionUsage(Base):
    __tablename__ = "promotion_usages"
    __table_args__ = (UniqueConstraint("promotion_code", "user_id", name="uq_promo_usage_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    promotion_code: Mapped[str] = mapped_column(
        String(50), ForeignKey("promotions.code", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    order_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="SET NULL"), nullable=True
    )
    used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sub_total: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    promotion_code: Mapped[str | None] = mapped_column(
        String(50), ForeignKey("promotions.code", ondelete="SET NULL"), nullable=True
    )
    discount_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    shipping_fee: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    tax_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    grand_total: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(30), index=True, nullable=False, default="cho_xu_ly")
    payment_status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="cho_thanh_toan"
    )
    payment_method: Mapped[str] = mapped_column(String(30), nullable=False, default="cod")
    momo_trans_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    shipping_address_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("shipping_addresses.id", ondelete="SET NULL"), nullable=True
    )
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    address: Mapped[str] = mapped_column(String(500), nullable=False)
    province: Mapped[str | None] = mapped_column(String(100), nullable=True)
    district: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ward: Mapped[str | None] = mapped_column(String(100), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
    )

    items: Mapped[list["OrderItem"]] = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan"
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("products.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    product_name: Mapped[str] = mapped_column(String(200), nullable=False)
    cover_url: Mapped[str] = mapped_column(
        String(500), nullable=False, default="/covers/default-manga.svg"
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    total_price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)

    order: Mapped["Order"] = relationship("Order", back_populates="items")


class OrderStatusHistory(Base):
    __tablename__ = "order_status_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    previous_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    new_status: Mapped[str] = mapped_column(String(30), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    actor_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class OrderPayment(Base):
    __tablename__ = "order_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    payment_method: Mapped[str] = mapped_column(String(50), nullable=False)
    reference_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="cho_thanh_toan")
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
    )


class OrderShipment(Base):
    __tablename__ = "order_shipments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("orders.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    carrier: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tracking_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    shipping_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    estimated_delivery_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    additional_fee: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("user_id", "product_id", name="uq_review_user_product"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_purchased: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    admin_reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    admin_replied_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    admin_replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
    )


class ImportHistory(Base):
    __tablename__ = "import_histories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )
    imported_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    product_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_zip_import: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_restored: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    product_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_paths_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class ReaderStat(Base):
    __tablename__ = "reader_stats"
    __table_args__ = (UniqueConstraint("source_id", "manga_id", name="uq_reader_stat_source_manga"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    manga_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    read_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    average_rating: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    ratings_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    comment_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
    )


class ReaderComment(Base):
    __tablename__ = "reader_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    manga_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    chapter_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    chapter_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    parent_comment_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("reader_comments.id", ondelete="CASCADE"), index=True, nullable=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, server_default=func.now()
    )


class ReaderRating(Base):
    __tablename__ = "reader_ratings"
    __table_args__ = (
        UniqueConstraint("source_id", "manga_id", "user_id", name="uq_reader_rating_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[str] = mapped_column(String(64), nullable=False)
    manga_id: Mapped[str] = mapped_column(String(255), nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
    )


class ReaderBookmark(Base):
    __tablename__ = "reader_bookmarks"
    __table_args__ = (
        UniqueConstraint("user_id", "source_id", "manga_id", name="uq_reader_bookmark_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    source_id: Mapped[str] = mapped_column(String(64), nullable=False)
    manga_id: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    cover_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    author: Mapped[str] = mapped_column(String(150), nullable=False, default="")
    status_label: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    category: Mapped[str] = mapped_column(String(30), nullable=False, default="reading")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
    )


class ReaderHistory(Base):
    __tablename__ = "reader_history"
    __table_args__ = (
        UniqueConstraint("user_id", "source_id", "manga_id", name="uq_reader_history_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    source_id: Mapped[str] = mapped_column(String(64), nullable=False)
    manga_id: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    cover_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    chapter_id: Mapped[str] = mapped_column(String(255), nullable=False)
    chapter_label: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    current_page: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    total_pages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    language: Mapped[str] = mapped_column(String(16), nullable=False, default="vi")
    read_chapters_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
    )
