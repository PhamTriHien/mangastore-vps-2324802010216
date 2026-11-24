from __future__ import annotations

from dataclasses import dataclass
import logging
import re
import threading
import time
from typing import Any, Callable

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import Genre, Product, ProductGenre

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant"
GROQ_TIMEOUT_SECONDS = 15.0
MAX_HISTORY_MESSAGES = 20
MAX_MESSAGE_CHARS = 2000
CATALOG_CACHE_TTL_SECONDS = 300.0
DEFAULT_COVER_URL = "/covers/default-manga.svg"

_CATALOG_CACHE_LOCK = threading.Lock()
_CATALOG_CACHE: dict[str, tuple[float, str]] = {}

_FRANCHISE_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("one piece", ("one piece", "luffy", "zoro", "sanji", "chopper")),
    ("naruto", ("naruto", "sasuke", "sakura", "kakashi", "hokage")),
    ("attack on titan", ("attack on titan", "eren", "mikasa", "levi", "titan")),
    ("demon slayer", ("demon slayer", "tanjiro", "nezuko", "inosuke", "zenitsu")),
    ("jujutsu kaisen", ("jujutsu kaisen", "yuji", "megumi", "nobara", "gojo")),
    ("chainsaw man", ("chainsaw man", "denji", "makima", "power")),
    ("spy x family", ("spy x family", "anya", "loid", "yor")),
    ("my hero academia", ("my hero academia", "deku", "bakugo", "todoroki")),
    ("dragon ball", ("dragon ball", "goku", "vegeta", "piccolo", "gohan")),
    ("death note", ("death note", "light", "ryuk", "l", "misa")),
)

_PRODUCT_TRIGGERS: tuple[str, ...] = (
    "manga",
    "truyện",
    "bộ truyện",
    "series",
    "tập",
    "chapter",
    "mua",
    "giá",
    "bán",
    "sản phẩm",
    "book",
    "comic",
    "gợi ý",
    "recommend",
    "đề xuất",
    "tư vấn",
    "phổ biến",
    "hot",
    "thể loại",
)

_RECOMMENDATION_TRIGGERS: tuple[str, ...] = (
    "gợi ý",
    "recommend",
    "đề xuất",
    "tư vấn",
    "phổ biến",
    "hot",
    "trending",
    "nổi tiếng",
    "hay",
    "tốt",
    "mới",
    "bán chạy",
    "manga",
    "truyện",
)

_TOKEN_STOPWORDS = frozenset(
    {
        "mua",
        "giá",
        "bán",
        "truyện",
        "manga",
        "cho",
        "tôi",
        "bạn",
        "nào",
        "của",
        "được",
        "không",
        "với",
        "một",
        "những",
        "các",
        "đang",
        "tìm",
        "gợi",
        "hay",
        "phổ",
        "biến",
        "sản",
        "phẩm",
        "cửa",
        "hàng",
        "hiện",
        "the",
        "and",
        "for",
        "book",
        "comic",
        "want",
        "buy",
        "recommend",
        "suggestion",
    }
)

_DEFAULT_SUGGESTED_QUESTIONS: list[str] = [
    "Cửa hàng hiện có những bộ truyện manga phổ biến nào?",
    "Chính sách giao hàng của MangaStore là gì?",
    "Tôi muốn đọc truyện online trên website.",
]

_DEFAULT_FALLBACK_TEXT = (
    "Xin lỗi, tôi chưa hiểu rõ câu hỏi của bạn. Bạn có thể hỏi về giao hàng, đổi trả, "
    "thanh toán COD/MoMo, mã giảm giá, đọc truyện online hoặc tìm đầu truyện mong muốn nhé."
)


@dataclass(frozen=True)
class _RuleIntent:
    name: str
    matcher: Callable[[str], bool]
    response: str
    follow_ups: tuple[str, ...]


def _contains_any(text: str, phrases: tuple[str, ...]) -> bool:
    for phrase in phrases:
        if len(phrase) <= 3 and phrase.isascii():
            if re.search(rf"\b{re.escape(phrase)}\b", text):
                return True
        elif phrase in text:
            return True
    return False


def _match_greeting(text: str) -> bool:
    if _match_thanks(text):
        return False
    return _contains_any(
        text,
        ("hello", "hi", "xin chào", "chào", "hey", "greeting", "good morning", "good afternoon", "good evening"),
    )


def _match_online_reader(text: str) -> bool:
    return _contains_any(text, ("đọc truyện", "đọc online", "doc-truyen", "chapter", "chương", "reader"))


def _match_cancel_order(text: str) -> bool:
    return _contains_any(text, ("hủy đơn", "cancel order", "xóa đơn", "hủy", "cancel"))


def _match_track_order(text: str) -> bool:
    return _contains_any(text, ("theo dõi", "track", "kiểm tra đơn", "trạng thái đơn", "đơn hàng", "order", "status"))


def _match_reviews(text: str) -> bool:
    if _contains_any(text, ("đánh giá", "review", "rating", "star", "bình luận", "comment", "mấy sao", "số sao")):
        return True
    return bool(re.search(r"(?<!làm )(?<!tại )(?<!thế )\bsao\b", text))


def _match_loyalty(text: str) -> bool:
    if _contains_any(text, ("tích điểm", "loyalty", "reward", "điểm thưởng", "points", "vip")):
        return True
    return bool(re.search(r"(?<!địa )\bđiểm\b", text))


def _match_shipping(text: str) -> bool:
    return _contains_any(text, ("giao hàng", "vận chuyển", "ship", "shipping", "delivery"))


def _match_returns(text: str) -> bool:
    if _contains_any(text, ("đổi trả", "đổi hàng", "trả hàng", "bảo hành", "return", "exchange", "refund", "warranty")):
        return True
    cleaned = text.replace("trả lời", " ").replace("trả góp", " ")
    return bool(re.search(r"\b(đổi|trả)\b", cleaned))


def _match_promotions(text: str) -> bool:
    return _contains_any(text, ("khuyến mãi", "ưu đãi", "giảm giá", "mã giảm", "promotion", "discount", "sale", "coupon", "voucher"))


def _match_payment(text: str) -> bool:
    return _contains_any(text, ("thanh toán", "payment", "mua hàng", "purchase", "pay", "checkout", "cod", "momo"))


def _match_login(text: str) -> bool:
    return _contains_any(text, ("đăng nhập", "đăng ký", "tài khoản", "profile", "account", "login", "sign in", "register"))


def _match_wishlist(text: str) -> bool:
    return _contains_any(text, ("yêu thích", "favorite", "wishlist", "danh sách", "lưu", "save", "bookmark"))


def _match_contact(text: str) -> bool:
    if _contains_any(
        text,
        ("liên hệ", "hỗ trợ", "support", "contact", "help", "customer service", "giờ mở cửa", "offline", "store", "opening hours", "location", "địa chỉ", "address"),
    ):
        return True
    if "cửa hàng" in text and not _contains_any(text, ("manga", "truyện", "bộ truyện", "thể loại", "gợi ý", "đề xuất")):
        return True
    return False


def _match_genres(text: str) -> bool:
    return _contains_any(
        text,
        ("thể loại", "genre", "category", "loại", "kiểu", "shounen", "shonen", "shoujo", "seinen", "isekai", "romance", "action", "comedy"),
    )


def _match_new_releases(text: str) -> bool:
    return _contains_any(text, ("mới ra", "vừa ra", "latest", "recent", "mới nhất", "mới", "new"))


def _match_recommendations(text: str) -> bool:
    if _contains_any(
        text,
        ("manga", "light novel", "truyện", "đề xuất", "gợi ý", "recommend", "recommendation", "suggestion"),
    ):
        return True
    return any(_contains_any(text, kw_list) for _, kw_list in _FRANCHISE_KEYWORDS)


def _match_pricing(text: str) -> bool:
    return _contains_any(text, ("giá", "price", "cost", "bao nhiêu", "chi phí", "phí", "fee"))


def _match_thanks(text: str) -> bool:
    return _contains_any(
        text,
        ("cảm ơn", "cám ơn", "thanks", "thank you", "tạm biệt", "bye", "goodbye", "chào tạm biệt"),
    )


_RULE_INTENTS: tuple[_RuleIntent, ...] = (
    _RuleIntent(
        name="greeting",
        matcher=_match_greeting,
        response=(
            "Xin chào! Tôi là trợ lý của MangaStore. Tôi có thể hỗ trợ bạn về giao hàng, "
            "đổi trả sản phẩm lỗi, thanh toán COD/MoMo, áp dụng mã giảm giá, đọc truyện online "
            "hoặc tìm bộ truyện phù hợp."
        ),
        follow_ups=(
            "Cửa hàng hiện có những bộ truyện manga phổ biến nào?",
            "Chính sách giao hàng của MangaStore là gì?",
            "Tôi muốn đọc truyện online trên website.",
        ),
    ),
    _RuleIntent(
        name="online_reader",
        matcher=_match_online_reader,
        response=(
            "Bạn có thể đọc truyện trực tuyến tại mục Đọc truyện (/doc-truyen) để xem các đầu truyện "
            "đang mở chương, theo dõi tiến độ đọc và tham gia bình luận."
        ),
        follow_ups=(
            "Cửa hàng hiện có những bộ truyện manga phổ biến nào?",
            "Làm sao để lưu truyện vào danh sách yêu thích?",
        ),
    ),
    _RuleIntent(
        name="cancel_order",
        matcher=_match_cancel_order,
        response=(
            "Bạn có thể theo dõi và hủy đơn hàng đang chờ xử lý tại Tài khoản > Đơn hàng của tôi (/orders). "
            "Nếu đơn hàng cần hỗ trợ thêm, vui lòng gửi yêu cầu qua trang Liên hệ (/contact) kèm mã đơn hàng."
        ),
        follow_ups=(
            "Làm sao để kiểm tra trạng thái đơn hàng?",
            "Chính sách đổi trả sản phẩm như thế nào?",
        ),
    ),
    _RuleIntent(
        name="track_order",
        matcher=_match_track_order,
        response=(
            "Bạn có thể kiểm tra trạng thái đơn hàng bất cứ lúc nào tại Tài khoản > Đơn hàng của tôi (/orders). "
            "Nếu cần hỗ trợ thêm, bạn hãy gửi thông tin qua trang Liên hệ (/contact) kèm mã đơn hàng."
        ),
        follow_ups=(
            "Tôi có thể hủy đơn hàng đang chờ xử lý không?",
            "Thời gian giao hàng dự kiến là bao lâu?",
        ),
    ),
    _RuleIntent(
        name="reviews",
        matcher=_match_reviews,
        response=(
            "Bạn có thể xem đánh giá và bình luận của độc giả khác ngay trên trang chi tiết sản phẩm. "
            "Sau khi hoàn tất đơn hàng, bạn cũng có thể gửi đánh giá của riêng mình."
        ),
        follow_ups=(
            "Cửa hàng hiện có những bộ truyện manga phổ biến nào?",
            "Làm sao để theo dõi trạng thái đơn hàng?",
        ),
    ),
    _RuleIntent(
        name="loyalty",
        matcher=_match_loyalty,
        response=(
            "Hiện tại MangaStore chưa hỗ trợ chương trình tích điểm thành viên. Tuy nhiên bạn có thể "
            "áp dụng mã giảm giá ngay tại trang Thanh toán (/checkout) và được miễn phí vận chuyển "
            "cho đơn từ 150.000 VNĐ."
        ),
        follow_ups=(
            "Đơn hàng từ bao nhiêu tiền được miễn phí ship?",
            "MangaStore hỗ trợ những hình thức thanh toán nào?",
        ),
    ),
    _RuleIntent(
        name="shipping",
        matcher=_match_shipping,
        response=(
            "MangaStore miễn phí vận chuyển toàn quốc cho đơn hàng từ 150.000 VNĐ "
            "(đơn dưới 150.000 VNĐ áp dụng phí vận chuyển 30.000 VNĐ). Thời gian giao dự kiến "
            "1-2 ngày trong nội thành và 3-5 ngày làm việc với các tỉnh thành khác."
        ),
        follow_ups=(
            "Phí vận chuyển với đơn dưới 150.000 VNĐ là bao nhiêu?",
            "Làm sao để kiểm tra trạng thái đơn hàng?",
        ),
    ),
    _RuleIntent(
        name="returns",
        matcher=_match_returns,
        response=(
            "Bạn có thể yêu cầu đổi hoặc trả hàng trong vòng 7 ngày kể từ khi nhận nếu sản phẩm gặp lỗi in ấn "
            "hoặc hư hỏng khi vận chuyển. Vui lòng giữ mã đơn hàng trong mục Đơn hàng của tôi (/orders) "
            "và gửi yêu cầu qua trang Liên hệ (/contact)."
        ),
        follow_ups=(
            "Tôi cần gửi thông tin gì khi yêu cầu đổi/trả hàng?",
            "Xem mã đơn hàng ở đâu?",
        ),
    ),
    _RuleIntent(
        name="promotions",
        matcher=_match_promotions,
        response=(
            "Bạn có thể nhập mã giảm giá trực tiếp tại trang Thanh toán (/checkout) để xem trước mức giảm "
            "được áp dụng cho đơn hàng, đồng thời được miễn phí vận chuyển cho đơn từ 150.000 VNĐ."
        ),
        follow_ups=(
            "Đơn hàng từ bao nhiêu tiền được miễn phí ship?",
            "MangaStore hỗ trợ những hình thức thanh toán nào?",
        ),
    ),
    _RuleIntent(
        name="payment",
        matcher=_match_payment,
        response=(
            "MangaStore hiện hỗ trợ thanh toán qua COD (thanh toán khi nhận hàng) và ví MoMo. "
            "Bạn có thể chọn phương thức thanh toán và nhập mã giảm giá tại trang Thanh toán (/checkout)."
        ),
        follow_ups=(
            "Làm thế nào để áp dụng mã giảm giá khi đặt hàng?",
            "Tôi có thể hủy đơn hàng đang chờ xử lý không?",
        ),
    ),
    _RuleIntent(
        name="login",
        matcher=_match_login,
        response=(
            "Bạn có thể đăng nhập hoặc tạo tài khoản mới trên website để quản lý đơn hàng (/orders), "
            "lưu danh sách yêu thích (/wishlist) và cập nhật địa chỉ giao hàng."
        ),
        follow_ups=(
            "Làm sao để theo dõi đơn hàng đã đặt?",
            "Tôi có thể đọc truyện online trên website không?",
        ),
    ),
    _RuleIntent(
        name="wishlist",
        matcher=_match_wishlist,
        response=(
            "Sau khi đăng nhập, bạn có thể lưu truyện vào Danh sách yêu thích (/wishlist) "
            "để xem lại và đặt mua nhanh hơn."
        ),
        follow_ups=(
            "Cửa hàng hiện có những bộ truyện manga phổ biến nào?",
            "Tôi muốn đọc truyện online trên website.",
        ),
    ),
    _RuleIntent(
        name="contact",
        matcher=_match_contact,
        response=(
            "MangaStore là nền tảng mua sắm và đọc truyện trực tuyến hoạt động 24/7 trên website, "
            "hiện chưa có cửa hàng bán lẻ trực tiếp. Nếu cần hỗ trợ đơn hàng hoặc góp ý, bạn hãy gửi tin "
            "qua trang Liên hệ (/contact) hoặc nhắn ngay tại khung chat này."
        ),
        follow_ups=(
            "Chính sách giao hàng toàn quốc như thế nào?",
            "Tôi muốn tìm mua một số bộ manga phổ biến.",
        ),
    ),
    _RuleIntent(
        name="genres",
        matcher=_match_genres,
        response=(
            "MangaStore phân loại truyện theo nhiều thể loại như Shounen, Seinen, Fantasy, Comedy, "
            "Action, Sports, Trinh thám... Bạn muốn tìm thể loại hoặc bộ truyện cụ thể nào?"
        ),
        follow_ups=(
            "Gợi ý giúp tôi vài bộ manga hành động đang có hàng.",
            "Làm sao để đọc thử truyện online?",
        ),
    ),
    _RuleIntent(
        name="new_releases",
        matcher=_match_new_releases,
        response=(
            "Bạn có thể xem các tập truyện mới cập nhật tại trang Sản phẩm (/products) "
            "hoặc khám phá các chương truyện mới ở mục Đọc truyện (/doc-truyen)."
        ),
        follow_ups=(
            "Bộ truyện nào đang bán chạy và còn hàng?",
            "Tôi muốn đọc truyện online trên website.",
        ),
    ),
    _RuleIntent(
        name="recommendations",
        matcher=_match_recommendations,
        response=(
            "Bạn có thể tìm truyện theo tên hoặc thể loại tại trang Sản phẩm (/products), "
            "ví dụ như One Piece, Chainsaw Man, Jujutsu Kaisen hay Spy x Family. "
            "Bạn đang quan tâm đến bộ nào?"
        ),
        follow_ups=(
            "Bạn có thể gợi ý manga theo thể loại không?",
            "Tôi muốn đọc truyện online tại /doc-truyen.",
        ),
    ),
    _RuleIntent(
        name="pricing",
        matcher=_match_pricing,
        response=(
            "Giá bán được hiển thị trực tiếp trên từng trang sản phẩm. Đơn hàng từ 150.000 VNĐ "
            "sẽ được miễn phí vận chuyển toàn quốc; đơn dưới 150.000 VNĐ có phí giao hàng 30.000 VNĐ."
        ),
        follow_ups=(
            "Làm thế nào để áp dụng mã giảm giá khi đặt hàng?",
            "MangaStore hỗ trợ những hình thức thanh toán nào?",
        ),
    ),
    _RuleIntent(
        name="thanks",
        matcher=_match_thanks,
        response=(
            "Không có gì! Rất vui được hỗ trợ bạn. Nếu cần tìm truyện hay hỗ trợ đặt hàng, "
            "bạn cứ nhắn cho tôi nhé."
        ),
        follow_ups=(),
    ),
)


def sanitize_history(conversation_history: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    """Keep up to the last 20 valid user/assistant turns, truncated to 2000 chars each."""
    if not conversation_history:
        return []

    cleaned: list[dict[str, str]] = []
    for item in conversation_history:
        if isinstance(item, dict):
            raw_role = item.get("role")
            raw_content = item.get("content")
        else:
            raw_role = getattr(item, "role", None)
            raw_content = getattr(item, "content", None)

        if not isinstance(raw_role, str) or not isinstance(raw_content, str):
            continue

        role = raw_role.strip().lower()
        if role not in ("user", "assistant"):
            continue

        content = raw_content.strip()
        if not content:
            continue

        if len(content) > MAX_MESSAGE_CHARS:
            content = content[:MAX_MESSAGE_CHARS]

        cleaned.append({"role": role, "content": content})

    if len(cleaned) <= MAX_HISTORY_MESSAGES:
        return cleaned
    return cleaned[-MAX_HISTORY_MESSAGES:]


def should_include_products(message: str) -> bool:
    if not message or not message.strip():
        return False
    normalized = message.lower()
    if _contains_any(normalized, _PRODUCT_TRIGGERS):
        return True
    return any(_contains_any(normalized, kw_list) for _, kw_list in _FRANCHISE_KEYWORDS)


def _to_product_card(product: Product) -> dict[str, Any]:
    return {
        "id": product.id,
        "title": product.title,
        "image_url": product.cover_url or DEFAULT_COVER_URL,
        "price": float(product.price),
        "original_price": float(product.original_price) if product.original_price is not None else None,
        "detail_url": f"/products/{product.id}",
        "category": product.genres[0].name if product.genres else "Khác",
        "is_available": product.status == "dang_ban" and product.stock_quantity > 0,
        "rating": float(product.average_rating),
    }


def _find_product_by_franchise(products: list[Product], franchise_name: str) -> Product | None:
    target = franchise_name.lower()
    for product in products:
        if product.title.strip().lower() == target:
            return product
    for product in products:
        if target in product.title.lower():
            return product
    return None


def get_product_recommendations(db: Session, message: str, max_results: int = 3) -> list[dict[str, Any]]:
    """3-tier recommendation lookup: 10-franchise map -> fuzzy token overlap -> featured/popular fallback."""
    if not message or not message.strip() or max_results <= 0:
        return []

    normalized = message.strip().lower()
    products = list(
        db.scalars(
            select(Product)
            .options(selectinload(Product.genres))
            .where(Product.status != "ngung_ban")
            .order_by(Product.is_featured.desc(), Product.units_sold.desc(), Product.id.asc())
        ).all()
    )
    if not products:
        return []

    selected: list[Product] = []
    seen_ids: set[int] = set()

    # Tier 1: 10-franchise keyword map
    for franchise_key, keywords in _FRANCHISE_KEYWORDS:
        if _contains_any(normalized, keywords):
            matched = _find_product_by_franchise(products, franchise_key)
            if matched is not None and matched.id not in seen_ids:
                selected.append(matched)
                seen_ids.add(matched.id)
                if len(selected) >= max_results:
                    return [_to_product_card(p) for p in selected]

    # Tier 2: fuzzy token overlap against titles (and genres if title yields none)
    if not selected:
        msg_tokens = [
            tok
            for tok in re.findall(r"[^\W_]+", normalized, flags=re.UNICODE)
            if len(tok) > 2 and tok not in _TOKEN_STOPWORDS
        ]
        if msg_tokens:
            scored: list[tuple[int, Product]] = []
            for product in products:
                title_tokens = [
                    tok
                    for tok in re.findall(r"[^\W_]+", product.title.lower(), flags=re.UNICODE)
                    if len(tok) > 2
                ]
                hits = sum(
                    1
                    for mt in msg_tokens
                    if any(mt in tt or tt in mt for tt in title_tokens)
                )
                if hits > 0:
                    scored.append((hits, product))

            if not scored:
                for product in products:
                    genre_tokens = [
                        tok
                        for g in product.genres
                        for tok in re.findall(r"[^\W_]+", g.name.lower(), flags=re.UNICODE)
                        if len(tok) > 2
                    ]
                    hits = sum(
                        1
                        for mt in msg_tokens
                        if any(mt in gt or gt in mt for gt in genre_tokens)
                    )
                    if hits > 0:
                        scored.append((hits, product))

            scored.sort(
                key=lambda pair: (
                    pair[0],
                    1 if (pair[1].status == "dang_ban" and pair[1].stock_quantity > 0) else 0,
                    pair[1].units_sold,
                ),
                reverse=True,
            )
            for _, product in scored[:max_results]:
                selected.append(product)
                seen_ids.add(product.id)

    # Tier 3: featured/popular fallback
    if not selected and _contains_any(normalized, _RECOMMENDATION_TRIGGERS):
        popular = [
            p
            for p in products
            if (p.is_featured or p.units_sold > 100) and p.status == "dang_ban" and p.stock_quantity > 0
        ]
        if not popular:
            popular = [p for p in products if p.is_featured or p.units_sold > 100]
        if not popular:
            popular = products
        selected = popular[:max_results]

    return [_to_product_card(p) for p in selected[:max_results]]


def _personalize(text: str, visitor_name: str | None) -> str:
    cleaned_name = (visitor_name or "").strip()
    if not cleaned_name:
        return text
    return f"Xin chào {cleaned_name}! {text}"


def generate_rule_based_reply(
    db: Session,
    message: str,
    visitor_name: str | None = None,
) -> dict[str, Any]:
    """Match the 18-intent Vietnamese rule engine and attach product cards when relevant."""
    cleaned_msg = (message or "").strip()
    if not cleaned_msg:
        return {
            "text": _DEFAULT_FALLBACK_TEXT,
            "suggested_questions": list(_DEFAULT_SUGGESTED_QUESTIONS),
            "product_cards": [],
        }

    normalized = cleaned_msg.lower()
    product_cards = get_product_recommendations(db, cleaned_msg, max_results=3) if should_include_products(cleaned_msg) else []

    for intent in _RULE_INTENTS:
        if intent.matcher(normalized):
            return {
                "text": _personalize(intent.response, visitor_name),
                "suggested_questions": list(intent.follow_ups),
                "product_cards": product_cards,
            }

    return {
        "text": _DEFAULT_FALLBACK_TEXT,
        "suggested_questions": list(_DEFAULT_SUGGESTED_QUESTIONS),
        "product_cards": product_cards,
    }


def _format_vnd(amount: float) -> str:
    return f"{int(round(float(amount))):,}".replace(",", ".") + " VNĐ"


def get_live_catalog_context(db: Session) -> str:
    """Return 5-minute cached live inventory summary for the Groq system prompt."""
    cache_key = get_settings().database_url
    now = time.monotonic()
    with _CATALOG_CACHE_LOCK:
        cached = _CATALOG_CACHE.get(cache_key)
        if cached is not None and now < cached[0]:
            return cached[1]

    try:
        active_count = (
            db.scalar(
                select(func.count(Product.id)).where(
                    Product.status == "dang_ban",
                    Product.stock_quantity > 0,
                )
            )
            or 0
        )

        top_genres = db.execute(
            select(Genre.name, func.count(Product.id).label("cnt"))
            .join(ProductGenre, Genre.id == ProductGenre.genre_id)
            .join(Product, Product.id == ProductGenre.product_id)
            .where(Product.status == "dang_ban", Product.stock_quantity > 0)
            .group_by(Genre.id, Genre.name)
            .order_by(func.count(Product.id).desc(), Genre.name.asc())
            .limit(8)
        ).all()

        top_products = list(
            db.scalars(
                select(Product)
                .where(Product.status == "dang_ban", Product.stock_quantity > 0)
                .order_by(Product.units_sold.desc(), Product.average_rating.desc(), Product.id.asc())
                .limit(5)
            ).all()
        )

        lines = [f"DỮ LIỆU KHO HÀNG HIỆN TẠI: Hiện có {int(active_count)} đầu truyện đang mở bán và còn hàng."]
        if top_genres:
            genre_text = ", ".join(f"{name} ({int(cnt)})" for name, cnt in top_genres)
            lines.append(f"Thể loại tiêu biểu còn hàng: {genre_text}")
        if top_products:
            product_text = "; ".join(
                f"{p.title} ({_format_vnd(float(p.price))}, còn {p.stock_quantity})"
                for p in top_products
            )
            lines.append(f"Một số truyện bán chạy đang còn hàng: {product_text}")
        summary = "\n".join(lines)
    except Exception as exc:
        logger.warning("Failed building live catalog context: %s", exc)
        summary = "DỮ LIỆU KHO HÀNG: Hãy mời khách xem danh mục mới nhất tại trang Sản phẩm (/products)."

    with _CATALOG_CACHE_LOCK:
        _CATALOG_CACHE[cache_key] = (now + CATALOG_CACHE_TTL_SECONDS, summary)
    return summary


def build_system_prompt(db: Session) -> str:
    live_catalog = get_live_catalog_context(db)
    return (
        "Bạn là trợ lý hỗ trợ khách hàng trực tuyến thân thiện và chính xác của MangaStore - "
        "nền tảng mua sắm manga và đọc truyện trực tuyến.\n\n"
        "THÔNG TIN CHÍNH THỨC CỦA MANGASTORE:\n"
        "- Giao hàng: Miễn phí vận chuyển toàn quốc cho đơn hàng từ 150.000 VNĐ; đơn dưới 150.000 VNĐ "
        "áp dụng phí vận chuyển 30.000 VNĐ. Thời gian dự kiến 1-2 ngày trong nội thành và 3-5 ngày làm việc "
        "với các tỉnh thành khác.\n"
        "- Thanh toán: Chỉ hỗ trợ COD (thanh toán khi nhận hàng) và ví MoMo tại trang Thanh toán (/checkout). "
        "Không hỗ trợ ZaloPay, chuyển khoản ngân hàng trực tiếp hay trả góp.\n"
        "- Mã giảm giá & Khuyến mãi: Khách hàng có thể nhập mã giảm giá ở trang Thanh toán (/checkout) để xem trước "
        "mức giảm. Hiện chưa có chương trình tích điểm thành viên.\n"
        "- Đổi trả: Hỗ trợ đổi hoặc trả hàng trong 7 ngày kể từ khi nhận nếu sản phẩm có lỗi in ấn hoặc hư hỏng "
        "vận chuyển; giữ lại mã đơn hàng (/orders).\n"
        "- Đọc truyện online: Khách hàng có thể đọc các chương truyện mở khóa tại mục Đọc truyện (/doc-truyen).\n"
        "- Tài khoản & Đơn hàng: Quản lý đơn hàng và hủy đơn chờ xử lý tại /orders; lưu truyện yêu thích tại /wishlist.\n"
        "- Liên hệ & Vận hành: Website hoạt động trực tuyến 24/7, hiện chưa có cửa hàng bán lẻ trực tiếp. "
        "Khách hàng cần hỗ trợ có thể gửi thông tin qua trang Liên hệ (/contact) hoặc chat trực tiếp tại đây.\n\n"
        f"{live_catalog}\n\n"
        "QUY TẮC BẮT BUỘC:\n"
        "1. Luôn trả lời bằng tiếng Việt rõ ràng, ngắn gọn (2-4 câu), tự nhiên, dùng tối đa 1-2 emoji phù hợp khi cần.\n"
        "2. Chỉ cung cấp thông tin đúng với dữ liệu chính thức và dữ liệu kho hàng ở trên. "
        "Tuyệt đối không tự bịa địa chỉ cửa hàng, số điện thoại hotline, email hỗ trợ, phương thức thanh toán khác "
        "hoặc chương trình tích điểm.\n"
        "3. Ghi nhớ ngữ cảnh từ các lượt hỏi-đáp trước trong cuộc trò chuyện.\n"
        "4. Nếu câu hỏi vượt ngoài thông tin hiện có, hãy nói rõ và hướng dẫn khách gửi yêu cầu tại trang Liên hệ (/contact)."
    )


def _generate_suggested_questions(reply_text: str, user_message: str) -> list[str]:
    lower_resp = reply_text.lower()
    lower_msg = user_message.lower()

    if "giao hàng" in lower_resp or "vận chuyển" in lower_resp or "giao hàng" in lower_msg or "vận chuyển" in lower_msg:
        return [
            "Phí vận chuyển với đơn dưới 150.000 VNĐ là bao nhiêu?",
            "Làm sao để theo dõi trạng thái đơn hàng?",
        ]
    if "đổi" in lower_resp or "trả" in lower_resp or "đổi" in lower_msg or "trả" in lower_msg:
        return [
            "Tôi cần cung cấp thông tin gì khi đổi/trả hàng?",
            "Xem mã đơn hàng của tôi ở đâu?",
        ]
    if "mã giảm" in lower_resp or "khuyến mãi" in lower_resp or "giảm giá" in lower_resp or "giảm giá" in lower_msg:
        return [
            "Áp dụng mã giảm giá ở bước nào khi đặt hàng?",
            "Đơn hàng từ bao nhiêu tiền được miễn phí ship?",
        ]
    if "thanh toán" in lower_resp or "momo" in lower_resp or "cod" in lower_resp or "thanh toán" in lower_msg:
        return [
            "MangaStore hỗ trợ những phương thức thanh toán nào?",
            "Làm sao để áp dụng mã giảm giá khi thanh toán?",
            "Tôi có thể hủy đơn đang chờ xử lý không?",
        ]
    if "đọc truyện" in lower_resp or "/doc-truyen" in lower_resp or "đọc" in lower_msg or "chapter" in lower_msg:
        return [
            "Truy cập mục đọc truyện online ở đâu?",
            "Cửa hàng có những bộ manga phổ biến nào?",
        ]
    if "manga" in lower_resp or "truyện" in lower_resp or "manga" in lower_msg or "truyện" in lower_msg:
        return [
            "Bạn có thể gợi ý manga theo thể loại không?",
            "Bộ truyện nào đang bán chạy và còn hàng?",
            "Tôi có thể đọc truyện online trên web không?",
        ]
    if "tài khoản" in lower_resp or "đăng nhập" in lower_resp or "tài khoản" in lower_msg or "đăng nhập" in lower_msg:
        return [
            "Làm sao để kiểm tra đơn hàng đã đặt?",
            "Cách lưu truyện vào danh sách yêu thích?",
        ]
    return list(_DEFAULT_SUGGESTED_QUESTIONS)


async def generate_chatbot_reply(
    db: Session,
    message: str,
    visitor_name: str | None = None,
    conversation_history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Generate reply via Groq API with 5-minute catalog context, falling back to the 18-intent rule engine."""
    cleaned_message = (message or "").strip()
    sanitized_history = sanitize_history(conversation_history)
    if not cleaned_message:
        return generate_rule_based_reply(db, cleaned_message, visitor_name)

    settings = get_settings()
    api_key = (settings.groq_api_key or "").strip()
    model = (settings.groq_model or DEFAULT_GROQ_MODEL).strip() or DEFAULT_GROQ_MODEL

    if not api_key:
        return generate_rule_based_reply(db, cleaned_message, visitor_name)

    system_prompt = build_system_prompt(db)
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system_prompt},
        *sanitized_history,
        {"role": "user", "content": cleaned_message},
    ]
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 320,
        "top_p": 0.9,
        "frequency_penalty": 0.1,
        "presence_penalty": 0.1,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=GROQ_TIMEOUT_SECONDS) as client:
            response = await client.post(GROQ_API_URL, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()
        choices = data.get("choices") or []
        raw_reply = ""
        if choices and isinstance(choices[0], dict):
            msg_obj = choices[0].get("message") or {}
            if isinstance(msg_obj, dict):
                raw_reply = str(msg_obj.get("content") or "").strip()

        if raw_reply:
            should_greet = not sanitized_history and not raw_reply.lower().startswith("xin chào")
            final_text = _personalize(raw_reply, visitor_name) if should_greet else raw_reply
            product_cards = (
                get_product_recommendations(db, cleaned_message, max_results=3)
                if should_include_products(cleaned_message)
                else []
            )
            return {
                "text": final_text,
                "suggested_questions": _generate_suggested_questions(raw_reply, cleaned_message),
                "product_cards": product_cards,
            }
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        logger.warning("Groq API call failed (%s), falling back to rule engine: %s", model, exc)

    return generate_rule_based_reply(db, cleaned_message, visitor_name)
