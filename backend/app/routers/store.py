import json
import logging
import math
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
import httpx
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import (
    Chapter,
    Genre,
    Order,
    OrderItem,
    Product,
    ProductGenre,
    ProductTag,
    ReaderStat,
    Review,
    SearchHistory,
    Tag,
    User,
    WishlistItem,
    utc_now,
)
from app.security import get_current_user, get_optional_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["store"])

_PRICE_BOUNDS: dict[str, tuple[float | None, float | None]] = {
    "all": (None, None),
    "under-50k": (0.0, 50_000.0),
    "50k-100k": (50_000.0, 100_000.0),
    "100k-200k": (100_000.0, 200_000.0),
    "200k-500k": (200_000.0, 500_000.0),
    "over-500k": (500_000.0, None),
}

_VERIFIED_ORDER_EXCLUDED_STATUSES = (
    "huy",
    "da_huy",
    "cancelled",
    "cho_thanh_toan",
    "pending",
)
_VERIFIED_ORDER_DELIVERED_STATUSES = (
    "delivered",
    "da_giao",
    "da_giao_hang",
    "da_thu_tien",
    "cod_paid",
    "da_thanh_toan",
)

_VIETNAMESE_TYPE_LABELS: dict[str, str] = {
    "city": "Thành phố",
    "town": "Thị trấn",
    "village": "Làng/Xã",
    "suburb": "Phường",
    "quarter": "Khu phố",
    "district": "Quận/Huyện",
    "province": "Tỉnh",
    "state": "Tỉnh/Thành",
    "administrative": "Hành chính",
    "street": "Đường",
    "road": "Đường",
    "residential": "Đường",
    "tertiary": "Đường",
    "secondary": "Đường lớn",
    "primary": "Đường chính",
    "trunk": "Quốc lộ",
    "motorway": "Cao tốc",
    "house": "Nhà",
    "building": "Tòa nhà",
    "apartments": "Chung cư",
    "commercial": "Thương mại",
    "retail": "Cửa hàng",
    "industrial": "Khu công nghiệp",
    "school": "Trường học",
    "university": "Đại học",
    "college": "Cao đẳng",
    "kindergarten": "Mẫu giáo",
    "hospital": "Bệnh viện",
    "clinic": "Phòng khám",
    "pharmacy": "Nhà thuốc",
    "restaurant": "Nhà hàng",
    "cafe": "Quán cà phê",
    "fast_food": "Thức ăn nhanh",
    "hotel": "Khách sạn",
    "cinema": "Rạp chiếu phim",
    "park": "Công viên",
    "supermarket": "Siêu thị",
    "mall": "Trung tâm TM",
    "market": "Chợ",
    "bus_station": "Bến xe",
    "train_station": "Ga tàu",
    "aerodrome": "Sân bay",
    "airport": "Sân bay",
    "place_of_worship": "Nhà thờ/Chùa",
    "temple": "Đền/Chùa",
    "church": "Nhà thờ",
    "bank": "Ngân hàng",
    "atm": "ATM",
    "post_office": "Bưu điện",
    "police": "Công an",
    "fire_station": "Cứu hỏa",
}


class ReviewPayload(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    content: str | None = Field(default=None, max_length=2000)

    @field_validator("content")
    @classmethod
    def _clean_content(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


def _get_wishlist_product_ids(db: Session, user: User | None) -> set[int]:
    if user is None:
        return set()
    rows = db.scalars(
        select(WishlistItem.product_id).where(WishlistItem.user_id == user.id)
    ).all()
    return set(rows)


def _get_chapter_counts(db: Session, product_ids: list[int]) -> dict[int, int]:
    if not product_ids:
        return {}
    rows = db.execute(
        select(Chapter.product_id, func.count(Chapter.id))
        .where(Chapter.product_id.in_(product_ids))
        .group_by(Chapter.product_id)
    ).all()
    return {int(pid): int(cnt) for pid, cnt in rows}


def _product_gallery(product: Product) -> list[str]:
    gallery = [
        asset.url.strip()
        for asset in sorted(product.assets, key=lambda a: (a.display_order, a.id))
        if asset.url and asset.url.strip()
    ]
    cover = (product.cover_url or "").strip() or "/covers/default-manga.svg"
    if cover not in gallery:
        gallery.insert(0, cover)
    return gallery


def _serialize_product(
    product: Product,
    chapter_count: int = 0,
    wishlist_ids: set[int] | None = None,
) -> dict[str, Any]:
    genres = [g.name for g in product.genres if g.name]
    tags = [t.name for t in product.tags if t.name]
    gallery = _product_gallery(product)
    cover = gallery[0] if gallery else "/covers/default-manga.svg"
    is_available = product.status == "dang_ban" and product.stock_quantity > 0
    return {
        "id": product.id,
        "title": product.title,
        "author": product.author,
        "publisher": product.publisher,
        "publication_date": product.publication_date,
        "pages": product.pages,
        "dimensions": product.dimensions,
        "weight": product.weight,
        "language": product.language,
        "isbn": product.isbn,
        "description": product.description,
        "full_description": product.full_description or product.description,
        "cover_url": cover,
        "gallery": gallery,
        "price": float(product.price),
        "original_price": float(product.original_price)
        if product.original_price is not None
        else None,
        "average_rating": float(product.average_rating),
        "ratings_count": int(product.ratings_count),
        "view_count": int(product.view_count),
        "units_sold": int(product.units_sold),
        "stock_quantity": int(product.stock_quantity),
        "status": product.status,
        "is_featured": bool(product.is_featured),
        "is_new": bool(product.is_new),
        "is_popular": product.units_sold > 100,
        "is_available": is_available,
        "in_stock": is_available,
        "category": genres[0] if genres else "Khác",
        "genres": genres,
        "tags": tags,
        "chapter_count": int(chapter_count),
        "is_in_wishlist": product.id in (wishlist_ids or set()),
        "created_at": product.created_at,
        "updated_at": product.updated_at,
    }


def _serialize_products_batch(
    db: Session,
    products: list[Product],
    wishlist_ids: set[int] | None = None,
) -> list[dict[str, Any]]:
    pids = [p.id for p in products]
    chapter_counts = _get_chapter_counts(db, pids)
    return [
        _serialize_product(
            product,
            chapter_count=chapter_counts.get(product.id, 0),
            wishlist_ids=wishlist_ids,
        )
        for product in products
    ]


def _product_base_query():
    return select(Product).options(
        selectinload(Product.genres),
        selectinload(Product.tags),
        selectinload(Product.assets),
    )


def _has_verified_purchase(db: Session, user_id: int, product_id: int) -> bool:
    stmt = (
        select(func.count(OrderItem.id))
        .join(Order, OrderItem.order_id == Order.id)
        .where(
            Order.user_id == user_id,
            OrderItem.product_id == product_id,
            func.lower(func.coalesce(Order.status, "")).notin_(
                _VERIFIED_ORDER_EXCLUDED_STATUSES
            ),
            or_(
                func.lower(func.coalesce(Order.status, "")).in_(
                    _VERIFIED_ORDER_DELIVERED_STATUSES
                ),
                func.lower(func.coalesce(Order.payment_status, "")) == "da_thanh_toan",
            ),
        )
    )
    return (db.scalar(stmt) or 0) > 0


def _serialize_review(review: Review, username: str, avatar_url: str | None) -> dict[str, Any]:
    return {
        "id": review.id,
        "product_id": review.product_id,
        "user_id": review.user_id,
        "username": username,
        "avatar_url": avatar_url,
        "rating": int(review.rating),
        "content": review.content or "",
        "is_purchased": bool(review.is_purchased),
        "admin_reply": review.admin_reply,
        "admin_replied_by": review.admin_replied_by,
        "admin_replied_at": review.admin_replied_at,
        "created_at": review.created_at,
        "updated_at": review.updated_at,
    }


def _load_product_reviews(db: Session, product_id: int) -> list[dict[str, Any]]:
    rows = db.execute(
        select(Review, User.username, User.avatar_url)
        .join(User, Review.user_id == User.id)
        .where(Review.product_id == product_id)
        .order_by(Review.created_at.desc(), Review.id.desc())
    ).all()
    return [_serialize_review(r, uname, avatar) for r, uname, avatar in rows]


def _recalculate_product_rating(db: Session, product: Product) -> None:
    count_val, avg_val = db.execute(
        select(func.count(Review.id), func.avg(Review.rating)).where(
            Review.product_id == product.id
        )
    ).one()
    count_int = int(count_val or 0)
    product.ratings_count = count_int
    product.average_rating = round(float(avg_val), 2) if count_int > 0 and avg_val is not None else 0.0


def _build_classified_tags(db: Session) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    genre_rows = db.execute(
        select(Genre.id, Genre.name, func.count(ProductGenre.product_id))
        .outerjoin(ProductGenre, Genre.id == ProductGenre.genre_id)
        .group_by(Genre.id, Genre.name, Genre.display_order)
        .order_by(Genre.display_order.asc(), Genre.name.asc())
    ).all()

    tag_rows = db.execute(
        select(Tag.id, Tag.name, func.count(ProductTag.product_id))
        .outerjoin(ProductTag, Tag.id == ProductTag.tag_id)
        .group_by(Tag.id, Tag.name)
        .order_by(func.count(ProductTag.product_id).desc(), Tag.name.asc())
    ).all()

    store_tags: list[dict[str, Any]] = []
    for gid, gname, cnt in genre_rows:
        if gname and gname.strip():
            store_tags.append(
                {
                    "id": f"store-genre-{gid}",
                    "name": gname,
                    "display_name": gname,
                    "group": "Thể loại cửa hàng",
                    "domain": "store",
                    "item_count": int(cnt or 0),
                }
            )
    for tid, tname, cnt in tag_rows[:10]:
        if tname and tname.strip():
            store_tags.append(
                {
                    "id": f"store-tag-{tid}",
                    "name": tname,
                    "display_name": tname,
                    "group": "Nhãn cửa hàng",
                    "domain": "store",
                    "item_count": int(cnt or 0),
                }
            )

    reader_genre_rows = db.execute(
        select(Genre.id, Genre.name, func.count(func.distinct(Product.id)))
        .join(ProductGenre, Genre.id == ProductGenre.genre_id)
        .join(Product, ProductGenre.product_id == Product.id)
        .join(Chapter, Chapter.product_id == Product.id)
        .group_by(Genre.id, Genre.name, Genre.display_order)
        .order_by(func.count(func.distinct(Product.id)).desc(), Genre.name.asc())
    ).all()

    reader_tags: list[dict[str, Any]] = [
        {
            "id": f"reader-genre-{gid}",
            "name": gname,
            "display_name": gname,
            "group": "Thể loại đọc truyện",
            "domain": "reader",
            "item_count": int(cnt or 0),
        }
        for gid, gname, cnt in reader_genre_rows
        if gname and gname.strip()
    ]
    return store_tags, reader_tags


@router.get("/home")
def get_home(
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> dict[str, Any]:
    wishlist_ids = _get_wishlist_product_ids(db, current_user)

    popular_entities = list(
        db.scalars(
            _product_base_query()
            .where(Product.status != "ngung_ban", Product.is_featured.is_(True))
            .order_by(
                Product.average_rating.desc(),
                Product.ratings_count.desc(),
                Product.id.asc(),
            )
            .limit(25)
        ).all()
    )

    hot_entities = list(
        db.scalars(
            _product_base_query()
            .where(Product.status != "ngung_ban", Product.units_sold > 0)
            .order_by(
                Product.units_sold.desc(),
                Product.average_rating.desc(),
                Product.id.asc(),
            )
            .limit(12)
        ).all()
    )

    new_entities = list(
        db.scalars(
            _product_base_query()
            .where(Product.status == "dang_ban", Product.is_new.is_(True))
            .order_by(
                Product.publication_date.desc(),
                Product.created_at.desc(),
                Product.id.desc(),
            )
            .limit(12)
        ).all()
    )

    all_referenced = {p.id: p for p in (*popular_entities, *hot_entities, *new_entities)}
    chapter_counts = _get_chapter_counts(db, list(all_referenced.keys()))

    popular_products = [
        _serialize_product(p, chapter_counts.get(p.id, 0), wishlist_ids)
        for p in popular_entities
    ]
    hot_products = [
        _serialize_product(p, chapter_counts.get(p.id, 0), wishlist_ids)
        for p in hot_entities
    ]
    new_products = [
        _serialize_product(p, chapter_counts.get(p.id, 0), wishlist_ids)
        for p in new_entities
    ]

    trending_tags = list(
        db.scalars(
            select(Tag.name)
            .join(ProductTag, Tag.id == ProductTag.tag_id)
            .group_by(Tag.id, Tag.name)
            .order_by(func.count(ProductTag.product_id).desc(), Tag.name.asc())
            .limit(5)
        ).all()
    )

    store_tags, reader_tags = _build_classified_tags(db)

    chapter_subq = (
        select(
            Chapter.product_id.label("product_id"),
            func.count(Chapter.id).label("chapter_count"),
        )
        .group_by(Chapter.product_id)
        .subquery()
    )
    reader_rows = db.execute(
        select(Product, chapter_subq.c.chapter_count)
        .join(chapter_subq, Product.id == chapter_subq.c.product_id)
        .options(selectinload(Product.genres))
        .where(Product.status != "ngung_ban")
        .order_by(Product.view_count.desc(), Product.average_rating.desc(), Product.id.asc())
        .limit(8)
    ).all()

    reader_ids = [str(prod.id) for prod, _ in reader_rows]
    stats_map: dict[str, ReaderStat] = {}
    if reader_ids:
        stats = db.scalars(
            select(ReaderStat).where(
                ReaderStat.source_id == "local-db",
                ReaderStat.manga_id.in_(reader_ids),
            )
        ).all()
        stats_map = {s.manga_id: s for s in stats}

    featured_reader_manga = []
    for prod, ch_count in reader_rows:
        stat = stats_map.get(str(prod.id))
        featured_reader_manga.append(
            {
                "source_id": "local-db",
                "manga_id": str(prod.id),
                "product_id": prod.id,
                "title": prod.title,
                "author": prod.author,
                "cover_url": prod.cover_url,
                "description": prod.description,
                "genres": [g.name for g in prod.genres if g.name],
                "chapter_count": int(ch_count or 0),
                "read_count": int(stat.read_count) if stat else int(prod.view_count),
                "average_rating": float(stat.average_rating)
                if stat and stat.ratings_count > 0
                else float(prod.average_rating),
                "ratings_count": int(stat.ratings_count)
                if stat and stat.ratings_count > 0
                else int(prod.ratings_count),
                "comment_count": int(stat.comment_count) if stat else 0,
            }
        )

    return {
        "popular_products": popular_products,
        "hot_products": hot_products,
        "new_products": new_products,
        "trending_tags": trending_tags,
        "store_tags": store_tags,
        "reader_tags": reader_tags,
        "featured_reader_manga": featured_reader_manga,
    }


@router.get("/products")
def list_products(
    search: str | None = Query(default=None),
    categories: list[str] | None = Query(default=None),
    price_range: str = Query(default="all"),
    sort: str = Query(default="default"),
    tag: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> dict[str, Any]:
    clamped_page_size = max(6, min(page_size, 48))
    search_term = (search or "").strip()
    tag_term = (tag or "").strip()
    price_key = (price_range or "all").strip().lower()
    sort_key = (sort or "default").strip().lower()

    selected_categories: list[str] = []
    seen_cats: set[str] = set()
    for raw_entry in categories or []:
        for part in raw_entry.split(","):
            cleaned = part.strip()
            if not cleaned or cleaned.lower() in ("all", "tất cả"):
                continue
            key = cleaned.lower()
            if key not in seen_cats:
                seen_cats.add(key)
                selected_categories.append(cleaned)

    conditions = [Product.status != "ngung_ban"]

    if search_term:
        pattern = f"%{search_term}%"
        conditions.append(
            or_(
                Product.title.ilike(pattern),
                Product.author.ilike(pattern),
                Product.description.ilike(pattern),
                Product.genres.any(Genre.name.ilike(pattern)),
                Product.tags.any(Tag.name.ilike(pattern)),
            )
        )

    if tag_term:
        conditions.append(Product.tags.any(func.lower(Tag.name) == tag_term.lower()))

    if selected_categories:
        lower_cats = [c.lower() for c in selected_categories]
        conditions.append(Product.genres.any(func.lower(Genre.name).in_(lower_cats)))

    min_price, max_price = _PRICE_BOUNDS.get(price_key, (None, None))
    if min_price is not None:
        conditions.append(Product.price >= min_price)
    if max_price is not None:
        conditions.append(Product.price < max_price)

    total = int(
        db.scalar(select(func.count(Product.id)).where(*conditions)) or 0
    )

    if current_user is not None and search_term and page == 1:
        db.add(
            SearchHistory(
                user_id=current_user.id,
                keyword=search_term[:200],
                filters_json=json.dumps(
                    {
                        "categories": selected_categories,
                        "price_range": price_key,
                        "tag": tag_term,
                        "sort": sort_key,
                    },
                    ensure_ascii=False,
                ),
                results_count=total,
            )
        )
        db.commit()

    total_pages = max(1, math.ceil(total / clamped_page_size)) if total > 0 else 1
    current_page = max(1, min(page, total_pages))
    offset = (current_page - 1) * clamped_page_size

    stmt = _product_base_query().where(*conditions)
    if sort_key == "price-asc":
        stmt = stmt.order_by(Product.price.asc(), Product.id.asc())
    elif sort_key == "price-desc":
        stmt = stmt.order_by(Product.price.desc(), Product.id.asc())
    elif sort_key == "rating":
        stmt = stmt.order_by(
            Product.average_rating.desc(),
            Product.ratings_count.desc(),
            Product.id.asc(),
        )
    elif sort_key == "name":
        stmt = stmt.order_by(Product.title.asc(), Product.id.asc())
    else:
        stmt = stmt.order_by(Product.id.asc())

    products = list(db.scalars(stmt.offset(offset).limit(clamped_page_size)).all())
    wishlist_ids = _get_wishlist_product_ids(db, current_user)
    items = _serialize_products_batch(db, products, wishlist_ids)

    all_categories = list(
        db.scalars(
            select(Genre.name).order_by(Genre.display_order.asc(), Genre.name.asc())
        ).all()
    )
    all_tags = list(db.scalars(select(Tag.name).order_by(Tag.name.asc())).all())

    return {
        "items": items,
        "total": total,
        "page": current_page,
        "page_size": clamped_page_size,
        "total_pages": total_pages,
        "categories": all_categories,
        "store_tags": all_tags,
    }


@router.get("/products/suggestions")
def search_product_suggestions(
    query: str = Query(default=""),
    db: Session = Depends(get_db),
) -> dict[str, list[dict[str, Any]]]:
    term = query.strip()
    if len(term) < 2:
        return {"suggestions": []}

    pattern = f"%{term}%"
    products = list(
        db.scalars(
            select(Product)
            .options(selectinload(Product.genres))
            .where(
                Product.status != "ngung_ban",
                or_(Product.title.ilike(pattern), Product.author.ilike(pattern)),
            )
            .order_by(Product.units_sold.desc(), Product.id.asc())
            .limit(6)
        ).all()
    )

    suggestions = [
        {
            "id": p.id,
            "title": p.title,
            "author": p.author,
            "cover_url": p.cover_url or "/covers/default-manga.svg",
            "price": float(p.price),
            "category": p.genres[0].name if p.genres else "Khác",
        }
        for p in products
    ]
    return {"suggestions": suggestions}


@router.get("/products/{product_id}")
def get_product_detail(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> dict[str, Any]:
    inc_result = db.execute(
        update(Product)
        .where(Product.id == product_id)
        .values(view_count=Product.view_count + 1)
    )
    if inc_result.rowcount == 0:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy sản phẩm.",
        )
    db.commit()

    product = db.scalar(_product_base_query().where(Product.id == product_id))
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy sản phẩm.",
        )

    wishlist_ids = _get_wishlist_product_ids(db, current_user)
    chapter_counts = _get_chapter_counts(db, [product.id])
    product_data = _serialize_product(
        product,
        chapter_count=chapter_counts.get(product.id, 0),
        wishlist_ids=wishlist_ids,
    )

    genre_ids = [g.id for g in product.genres]
    related_entities: list[Product] = []
    if genre_ids:
        related_entities = list(
            db.scalars(
                _product_base_query()
                .where(
                    Product.id != product.id,
                    Product.status != "ngung_ban",
                    Product.genres.any(Genre.id.in_(genre_ids)),
                )
                .order_by(Product.units_sold.desc(), Product.average_rating.desc())
                .limit(5)
            ).all()
        )
    related_products = _serialize_products_batch(db, related_entities, wishlist_ids)

    reviews = _load_product_reviews(db, product_id)

    can_review = False
    has_reviewed = False
    user_review: dict[str, Any] | None = None
    if current_user is not None:
        can_review = _has_verified_purchase(db, current_user.id, product_id)
        for rev in reviews:
            if rev["user_id"] == current_user.id:
                has_reviewed = True
                user_review = rev
                break

    return {
        "product": product_data,
        "related_products": related_products,
        "reviews": reviews,
        "can_review": can_review,
        "has_reviewed": has_reviewed,
        "user_review": user_review,
        "is_in_wishlist": product_id in wishlist_ids,
    }


@router.get("/products/{product_id}/reviews")
def get_product_reviews(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),
) -> dict[str, Any]:
    exists = db.scalar(select(Product.id).where(Product.id == product_id))
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy sản phẩm.",
        )

    reviews = _load_product_reviews(db, product_id)
    can_review = False
    has_reviewed = False
    user_review: dict[str, Any] | None = None
    if current_user is not None:
        can_review = _has_verified_purchase(db, current_user.id, product_id)
        for rev in reviews:
            if rev["user_id"] == current_user.id:
                has_reviewed = True
                user_review = rev
                break

    return {
        "reviews": reviews,
        "can_review": can_review,
        "has_reviewed": has_reviewed,
        "user_review": user_review,
    }


@router.post("/products/{product_id}/reviews", status_code=status.HTTP_201_CREATED)
def create_product_review(
    product_id: int,
    payload: ReviewPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    product = db.scalar(select(Product).where(Product.id == product_id))
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy sản phẩm.",
        )

    if not _has_verified_purchase(db, current_user.id, product_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn cần mua và thanh toán/nhận hàng sản phẩm này trước khi đánh giá.",
        )

    existing = db.scalar(
        select(Review.id).where(
            Review.user_id == current_user.id,
            Review.product_id == product_id,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bạn đã đánh giá sản phẩm này rồi.",
        )

    review = Review(
        product_id=product_id,
        user_id=current_user.id,
        rating=payload.rating,
        content=payload.content,
        is_purchased=True,
    )
    db.add(review)
    db.flush()

    _recalculate_product_rating(db, product)
    db.commit()
    db.refresh(review)

    return {
        "ok": True,
        "review": _serialize_review(review, current_user.username, current_user.avatar_url),
        "average_rating": float(product.average_rating),
        "ratings_count": int(product.ratings_count),
    }


@router.put("/products/{product_id}/reviews")
def update_product_review(
    product_id: int,
    payload: ReviewPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    product = db.scalar(select(Product).where(Product.id == product_id))
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy sản phẩm.",
        )

    review = db.scalar(
        select(Review).where(
            Review.user_id == current_user.id,
            Review.product_id == product_id,
        )
    )
    if review is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy đánh giá để cập nhật.",
        )

    review.rating = payload.rating
    review.content = payload.content
    review.updated_at = utc_now()
    db.flush()

    _recalculate_product_rating(db, product)
    db.commit()
    db.refresh(review)

    return {
        "ok": True,
        "review": _serialize_review(review, current_user.username, current_user.avatar_url),
        "average_rating": float(product.average_rating),
        "ratings_count": int(product.ratings_count),
    }


@router.delete("/products/{product_id}/reviews")
def delete_product_review(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    product = db.scalar(select(Product).where(Product.id == product_id))
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy sản phẩm.",
        )

    review = db.scalar(
        select(Review).where(
            Review.user_id == current_user.id,
            Review.product_id == product_id,
        )
    )
    if review is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy đánh giá để xóa.",
        )

    db.delete(review)
    db.flush()

    _recalculate_product_rating(db, product)
    db.commit()

    return {
        "ok": True,
        "average_rating": float(product.average_rating),
        "ratings_count": int(product.ratings_count),
    }


@router.get("/address/search")
def search_address(q: str = Query(default="")) -> list[dict[str, Any]]:
    query_text = q.strip()
    if len(query_text) < 2:
        return []

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": query_text,
                    "countrycodes": "vn",
                    "format": "json",
                    "addressdetails": 1,
                    "limit": 15,
                    "accept-language": "vi",
                },
                headers={
                    "User-Agent": "MangaStore/1.0 (Contact: admin@mangastore.vn)",
                    "Accept": "application/json",
                },
            )
            resp.raise_for_status()
            raw_items = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Nominatim address search error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Không thể kết nối dịch vụ tìm kiếm địa chỉ Nominatim.",
        ) from None

    if not isinstance(raw_items, list):
        return []

    seen_coords: set[str] = set()
    results: list[dict[str, Any]] = []

    for item in raw_items:
        if not isinstance(item, dict):
            continue
        raw_lat = str(item.get("lat") or "").strip()
        raw_lon = str(item.get("lon") or "").strip()
        try:
            lat_num = float(raw_lat)
            lon_num = float(raw_lon)
        except ValueError:
            continue

        coord_key = f"{lat_num:.4f}|{lon_num:.4f}"
        if coord_key in seen_coords:
            continue
        seen_coords.add(coord_key)

        address = item.get("address") if isinstance(item.get("address"), dict) else {}
        house_number = str(address.get("house_number") or "").strip()
        road = str(address.get("road") or "").strip()
        suburb = str(
            address.get("suburb")
            or address.get("quarter")
            or address.get("village")
            or ""
        ).strip()
        district = str(
            address.get("city_district")
            or address.get("district")
            or address.get("county")
            or ""
        ).strip()
        city = str(
            address.get("city")
            or address.get("town")
            or address.get("province")
            or address.get("state")
            or ""
        ).strip()

        display_name = str(item.get("display_name") or "").strip()
        short_parts = [p for p in (house_number, road, suburb, district) if p]
        short_name = ", ".join(short_parts[:3]) if short_parts else display_name.split(",")[0].strip()

        place_type = str(item.get("type") or "").strip()
        category = str(item.get("class") or "").strip()
        type_label = (
            _VIETNAMESE_TYPE_LABELS.get(place_type)
            or _VIETNAMESE_TYPE_LABELS.get(category)
            or "Địa điểm"
        )

        try:
            importance = float(item.get("importance") or 0.0)
        except (TypeError, ValueError):
            importance = 0.0

        results.append(
            {
                "lat": raw_lat,
                "lon": raw_lon,
                "display_name": display_name,
                "short_name": short_name,
                "type": place_type,
                "type_label": type_label,
                "category": category,
                "house_number": house_number,
                "road": road,
                "suburb": suburb,
                "district": district,
                "city": city,
                "importance": importance,
            }
        )

    results.sort(key=lambda r: r["importance"], reverse=True)
    return results[:10]
