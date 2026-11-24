import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Heart, Loader2, Star } from "lucide-react";
import { StoreLayout } from "../components/layout/StoreLayout";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { MangaBook3D } from "../components/ui/MangaBook3D";
import { MangaCard3D } from "../components/ui/MangaCard3D";
import { MangaIcon } from "../components/ui/MangaIcon";
import { useAuth } from "../contexts/AuthContext";
import { useCartWishlist } from "../contexts/CartWishlistContext";
import { useToast } from "../contexts/ToastContext";
import { apiClient } from "../lib/api";
import { formatCurrency, formatDate, formatDateTime } from "../lib/format";
import type { ProductDetailResponse, ReviewDto } from "../types/api";

type DetailTab = "description" | "specs" | "reviews";

const SAFETY_BENEFITS = [
  {
    icon: "truck",
    title: "Miễn phí vận chuyển",
    subtitle: "Cho đơn hàng từ 150.000đ",
  },
  {
    icon: "shield-check",
    title: "Bản in chuẩn",
    subtitle: "100% xuất bản chính hãng",
  },
  {
    icon: "refresh-cw",
    title: "Đổi trả dễ dàng",
    subtitle: "Trong vòng 7 ngày",
  },
] as const;

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { wishlistIds, addToCart, toggleWishlist } = useCartWishlist();
  const { showToast } = useToast();

  const [detail, setDetail] = useState<ProductDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState<string | null>(null);

  const [activeCover, setActiveCover] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [addingCart, setAddingCart] = useState(false);
  const [buyingNow, setBuyingNow] = useState(false);
  const [togglingWishlist, setTogglingWishlist] = useState(false);

  const shouldFocusReviews =
    location.hash === "#reviews" || searchParams.get("review") === "true";
  const [activeTab, setActiveTab] = useState<DetailTab>(
    shouldFocusReviews ? "reviews" : "description"
  );

  // Review state
  const [reviewFormOpen, setReviewFormOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewContent, setReviewContent] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reviewDeleting, setReviewDeleting] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFoundError(null);
    try {
      const res = await apiClient.get<ProductDetailResponse>(`/api/products/${id}`);
      setDetail(res);
      const firstCover =
        res.product.gallery?.[0] || res.product.cover_url || "/covers/default-manga.svg";
      setActiveCover(firstCover);
      setQuantity(1);
      if (res.user_review) {
        setReviewRating(res.user_review.rating);
        setReviewContent(res.user_review.content ?? "");
        setReviewFormOpen(true);
      } else {
        setReviewRating(0);
        setReviewContent("");
        setReviewFormOpen(shouldFocusReviews && res.can_review);
      }
    } catch (err) {
      setDetail(null);
      setNotFoundError(
        err instanceof Error ? err.message : "Sản phẩm bạn yêu cầu không tồn tại hoặc đã bị xóa."
      );
    } finally {
      setLoading(false);
    }
  }, [id, shouldFocusReviews]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (shouldFocusReviews) {
      setActiveTab("reviews");
    }
  }, [shouldFocusReviews]);

  const product = detail?.product ?? null;
  const gallery = useMemo(() => {
    if (!product) return [];
    if (product.gallery && product.gallery.length > 0) return product.gallery;
    return [product.cover_url || "/covers/default-manga.svg"];
  }, [product]);

  const isInWishlist = product
    ? wishlistIds.includes(product.id) || Boolean(detail?.is_in_wishlist)
    : false;

  const handleDecreaseQty = () => {
    setQuantity((prev) => Math.max(1, prev - 1));
  };

  const handleIncreaseQty = () => {
    if (!product) return;
    const maxAllowed = Math.max(1, product.stock_quantity);
    setQuantity((prev) => Math.min(maxAllowed, prev + 1));
  };

  const handleAddToCart = async () => {
    if (!product || !product.in_stock || addingCart) return;
    if (!user) {
      showToast("Vui lòng đăng nhập để thêm truyện vào giỏ hàng.", "warning");
      navigate("/auth", { state: { from: location } });
      return;
    }
    setAddingCart(true);
    try {
      await addToCart(product.id, quantity);
    } finally {
      setAddingCart(false);
    }
  };

  const handleBuyNow = async () => {
    if (!product || !product.in_stock || buyingNow) return;
    if (!user) {
      showToast("Vui lòng đăng nhập để mua hàng.", "warning");
      navigate("/auth", { state: { from: location } });
      return;
    }
    setBuyingNow(true);
    try {
      const ok = await addToCart(product.id, quantity);
      if (ok) {
        navigate(`/checkout?items=${product.id}`);
      }
    } finally {
      setBuyingNow(false);
    }
  };

  const handleToggleWishlist = async () => {
    if (!product || togglingWishlist) return;
    if (!user) {
      showToast("Vui lòng đăng nhập để lưu truyện yêu thích.", "warning");
      navigate("/auth", { state: { from: location } });
      return;
    }
    setTogglingWishlist(true);
    try {
      const added = await toggleWishlist(product.id);
      if (added !== null) {
        setDetail((prev) => (prev ? { ...prev, is_in_wishlist: added } : prev));
      }
    } finally {
      setTogglingWishlist(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!product || reviewSubmitting) return;
    if (reviewRating < 1 || reviewRating > 5) {
      showToast("Vui lòng chọn điểm đánh giá từ 1 đến 5 sao.", "warning");
      return;
    }

    setReviewSubmitting(true);
    try {
      const payload = {
        rating: reviewRating,
        content: reviewContent.trim() || null,
      };
      const res = detail?.has_reviewed
        ? await apiClient.put<{
            ok: boolean;
            review: ReviewDto;
            average_rating: number;
            ratings_count: number;
          }>(`/api/products/${product.id}/reviews`, payload)
        : await apiClient.post<{
            ok: boolean;
            review: ReviewDto;
            average_rating: number;
            ratings_count: number;
          }>(`/api/products/${product.id}/reviews`, payload);

      showToast(
        detail?.has_reviewed ? "Đã cập nhật đánh giá!" : "Gửi đánh giá thành công!",
        "success"
      );
      setDetail((prev) => {
        if (!prev) return prev;
        const filtered = prev.reviews.filter((r) => r.id !== res.review.id);
        return {
          ...prev,
          has_reviewed: true,
          user_review: res.review,
          reviews: [res.review, ...filtered],
          product: {
            ...prev.product,
            average_rating: res.average_rating,
            ratings_count: res.ratings_count,
          },
        };
      });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Không thể gửi đánh giá lúc này.",
        "error"
      );
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleConfirmDeleteReview = async () => {
    if (!product || reviewDeleting) return;
    setReviewDeleting(true);
    try {
      const res = await apiClient.del<{
        ok: boolean;
        average_rating: number;
        ratings_count: number;
      }>(`/api/products/${product.id}/reviews`);
      showToast("Đã xóa đánh giá của bạn.", "success");
      setDeleteDialogOpen(false);
      setReviewRating(0);
      setReviewContent("");
      setReviewFormOpen(false);
      setDetail((prev) => {
        if (!prev) return prev;
        const removedId = prev.user_review?.id;
        return {
          ...prev,
          has_reviewed: false,
          user_review: null,
          reviews: removedId
            ? prev.reviews.filter((r) => r.id !== removedId)
            : prev.reviews,
          product: {
            ...prev.product,
            average_rating: res.average_rating,
            ratings_count: res.ratings_count,
          },
        };
      });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Không thể xóa đánh giá lúc này.",
        "error"
      );
    } finally {
      setReviewDeleting(false);
    }
  };

  if (loading) {
    return (
      <StoreLayout>
        <div className="mx-auto max-w-7xl px-6 py-14">
          <div className="grid grid-cols-1 gap-10 rounded-3xl border border-white/10 bg-[#131722]/85 p-6 lg:grid-cols-2">
            <div className="aspect-[3/4] w-full animate-pulse rounded-2xl bg-[#1B2130]" />
            <div className="space-y-4">
              <div className="h-9 w-3/4 animate-pulse rounded bg-[#1B2130]" />
              <div className="h-5 w-1/2 animate-pulse rounded bg-[#1B2130]" />
              <div className="h-10 w-1/3 animate-pulse rounded bg-[#1B2130]" />
              <div className="h-28 w-full animate-pulse rounded bg-[#1B2130]" />
            </div>
          </div>
        </div>
      </StoreLayout>
    );
  }

  if (!product) {
    return (
      <StoreLayout>
        <section className="px-6 py-24">
          <div className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-[#131722]/90 p-12 text-center shadow-2xl backdrop-blur-xl">
            <img
              src="/content/icons/spots/spot-empty-search.svg"
              alt=""
              aria-hidden="true"
              className="ms-float-3d mx-auto mb-5 h-32 w-40 object-contain"
            />
            <h1 className="font-display mb-2 text-3xl font-semibold text-white">
              Không tìm thấy sản phẩm
            </h1>
            <p className="mb-6 text-slate-400">
              {notFoundError || "Sản phẩm bạn yêu cầu không tồn tại hoặc đã bị xóa."}
            </p>
            <Link
              to="/products"
              className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm font-semibold text-white"
            >
              <MangaIcon name="arrow-left" className="h-4 w-4" />
              Quay lại cửa hàng
            </Link>
          </div>
        </section>
      </StoreLayout>
    );
  }

  const hasDiscount =
    product.original_price !== null && product.original_price > product.price;
  const discountPercent =
    hasDiscount && product.original_price
      ? Math.round(
          ((product.original_price - product.price) / product.original_price) * 100
        )
      : 0;
  const reviews = detail?.reviews ?? [];
  const relatedProducts = detail?.related_products ?? [];
  const canReview = Boolean(detail?.can_review);
  const hasReviewed = Boolean(detail?.has_reviewed);

  const specRows: Array<{ label: string; value: string | null | undefined }> = [
    { label: "Tác giả", value: product.author },
    { label: "Nhà xuất bản", value: product.publisher },
    { label: "Năm phát hành", value: product.publication_date },
    { label: "Số trang", value: product.pages ? `${product.pages} trang` : null },
    { label: "Kích thước", value: product.dimensions },
    { label: "Trọng lượng", value: product.weight },
    { label: "Ngôn ngữ", value: product.language },
    { label: "ISBN", value: product.isbn },
  ].filter((item) => Boolean(item.value && item.value.trim()));

  return (
    <StoreLayout>
      <section className="relative min-h-screen bg-transparent text-[#F5F6FA]">
        {/* Sticky Breadcrumb */}
        <div className="z-30 border-b border-white/10 bg-[#0B0D14]/90 backdrop-blur-xl md:sticky md:top-[73px]">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 text-sm">
            <Link
              to="/products"
              className="inline-flex items-center gap-2 text-slate-300 transition-colors hover:text-white"
            >
              <MangaIcon name="arrow-left" className="h-4 w-4" />
              Trở lại cửa hàng
            </Link>
            <nav className="flex items-center gap-2 text-slate-400">
              <Link to="/" className="transition-colors hover:text-white">
                Trang chủ
              </Link>
              <span>/</span>
              <Link
                to={`/products?categories=${encodeURIComponent(product.category)}`}
                className="transition-colors hover:text-white"
              >
                {product.category}
              </Link>
              <span>/</span>
              <span className="max-w-[14rem] truncate font-medium text-white sm:max-w-xs">
                {product.title}
              </span>
            </nav>
            <div className="hidden w-20 sm:block" />
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-6 py-10">
          {/* Blurred Cover Backdrop Hero */}
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#131722]/85 p-6 shadow-2xl backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-0">
              <img
                src={activeCover || "/covers/default-manga.svg"}
                alt=""
                aria-hidden="true"
                onError={(e) => {
                  e.currentTarget.src = "/covers/default-manga.svg";
                }}
                className="h-full w-full scale-110 object-cover opacity-15 blur-2xl"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0B0D14]/95 via-[#0B0D14]/85 to-[#0B0D14]/75" />
            </div>

            <div className="relative z-10 grid grid-cols-1 gap-10 lg:grid-cols-2">
              {/* Left Column: 3D Book + Gallery */}
              <div className="space-y-4">
                <div className="relative mx-auto w-full max-w-md">
                  <MangaBook3D
                    coverUrl={activeCover || "/covers/default-manga.svg"}
                    title={product.title}
                    variant="crimson"
                    size="lg"
                  />
                  {hasDiscount && discountPercent > 0 ? (
                    <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#E63946] to-rose-600 px-3 py-1.5 text-sm font-semibold text-white shadow-lg">
                      <MangaIcon name="tag" className="h-4 w-4" />
                      <span>-{discountPercent}%</span>
                    </div>
                  ) : null}
                  <div className="pointer-events-none absolute right-6 top-4 z-10 rounded-full border border-white/15 bg-[#0B0D14]/85 px-3 py-1 text-sm font-medium text-slate-100 backdrop-blur-sm">
                    {product.category}
                  </div>
                </div>

                {gallery.length > 1 ? (
                  <div className="grid grid-cols-4 gap-3">
                    {gallery.map((imgUrl) => {
                      const selected = imgUrl === activeCover;
                      return (
                        <button
                          key={imgUrl}
                          type="button"
                          onClick={() => setActiveCover(imgUrl)}
                          className={`overflow-hidden rounded-2xl border p-2 backdrop-blur-xl transition-all focus:outline-none ${
                            selected
                              ? "border-[#E63946] bg-[#E63946]/15"
                              : "border-white/10 bg-[#0B0D14]/75 hover:border-[#E63946]/50"
                          }`}
                        >
                          <img
                            src={imgUrl}
                            alt={`Hình ${product.title}`}
                            onError={(e) => {
                              e.currentTarget.src = "/covers/default-manga.svg";
                            }}
                            className="h-24 w-full rounded-xl object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              {/* Right Column: Info & Actions */}
              <div className="space-y-6">
                <header className="space-y-3">
                  <h1 className="font-display text-3xl font-bold text-white md:text-4xl">
                    {product.title}
                  </h1>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400">
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }, (_, idx) => {
                        const filled = idx < Math.floor(product.average_rating);
                        return (
                          <Star
                            key={idx}
                            className={`h-4 w-4 ${
                              filled
                                ? "fill-amber-400 text-amber-400"
                                : "text-slate-600"
                            }`}
                          />
                        );
                      })}
                    </div>
                    <span className="font-medium text-amber-300">
                      {product.average_rating.toFixed(1)} điểm
                    </span>
                    <span className="text-slate-600">•</span>
                    <span>{product.ratings_count} đánh giá</span>
                    <span className="text-slate-600">•</span>
                    <span>
                      Danh mục: <strong className="text-white">{product.category}</strong>
                    </span>
                  </div>
                </header>

                <div className="flex items-end gap-3">
                  <span className="text-4xl font-bold text-[#F59E0B]">
                    {formatCurrency(product.price)}
                  </span>
                  {hasDiscount && product.original_price !== null ? (
                    <span className="text-lg text-slate-500 line-through">
                      {formatCurrency(product.original_price)}
                    </span>
                  ) : null}
                </div>

                <div
                  className={`flex items-center gap-2 text-sm font-semibold ${
                    product.in_stock ? "text-emerald-400" : "text-[#FF6B77]"
                  }`}
                >
                  <MangaIcon name="check-circle" className="h-4 w-4" />
                  <span>
                    {product.in_stock
                      ? `Còn hàng (${product.stock_quantity} sản phẩm)`
                      : "Tạm hết hàng"}
                  </span>
                </div>

                {product.in_stock && product.stock_quantity <= 10 ? (
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-400">
                    <MangaIcon name="alert-triangle" className="h-4 w-4" />
                    <span>Chỉ còn {product.stock_quantity} sản phẩm cuối cùng!</span>
                  </div>
                ) : null}

                <p className="text-base leading-relaxed text-slate-300">
                  {product.description?.trim() || "Chưa có mô tả cho sản phẩm này."}
                </p>

                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-slate-400">Số lượng</span>
                    <div className="inline-flex items-center rounded-2xl border border-white/15 bg-[#0B0D14]/80 px-2 shadow-sm">
                      <button
                        type="button"
                        onClick={handleDecreaseQty}
                        disabled={!product.in_stock || quantity <= 1}
                        aria-label="Giảm số lượng"
                        className="flex h-10 w-10 items-center justify-center text-slate-300 transition-colors hover:text-[#FF6B77] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <MangaIcon name="minus" className="h-4 w-4" />
                      </button>
                      <span className="w-12 text-center text-sm font-semibold text-white">
                        {quantity}
                      </span>
                      <button
                        type="button"
                        onClick={handleIncreaseQty}
                        disabled={!product.in_stock || quantity >= product.stock_quantity}
                        aria-label="Tăng số lượng"
                        className="flex h-10 w-10 items-center justify-center text-slate-300 transition-colors hover:text-[#FF6B77] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <MangaIcon name="plus" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void handleAddToCart()}
                      disabled={!product.in_stock || addingCart}
                      className={`ms-btn-2d inline-flex items-center gap-2 rounded-2xl border px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                        product.in_stock
                          ? "ms-btn-2d-crimson border-rose-400/60"
                          : "ms-btn-2d-dark border-white/10 text-slate-400"
                      }`}
                    >
                      {addingCart ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MangaIcon name="shopping-cart" className="h-4 w-4" />
                      )}
                      <span>{product.in_stock ? "Thêm vào giỏ hàng" : "Hết hàng"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleBuyNow()}
                      disabled={!product.in_stock || buyingNow}
                      className={`ms-btn-2d inline-flex items-center gap-2 rounded-2xl border px-6 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                        product.in_stock
                          ? "ms-btn-2d-dark border-[#E63946]/55 text-rose-200 hover:border-[#E63946] hover:text-white"
                          : "ms-btn-2d-dark border-white/10 text-slate-500"
                      }`}
                    >
                      {buyingNow ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      <span>{product.in_stock ? "Mua ngay" : "Hết hàng"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleToggleWishlist()}
                      disabled={togglingWishlist}
                      className={`ms-btn-2d inline-flex items-center gap-2 rounded-2xl border px-6 py-3 text-sm font-semibold ${
                        isInWishlist
                          ? "ms-btn-2d-crimson border-[#E63946]/70 text-rose-100"
                          : "ms-btn-2d-dark border-white/15 text-slate-200 hover:border-[#E63946]/60 hover:text-rose-200"
                      }`}
                    >
                      <Heart
                        className={`h-4 w-4 ${
                          isInWishlist ? "fill-red-500 text-red-500" : ""
                        }`}
                      />
                      <span>{isInWishlist ? "Đã yêu thích" : "Yêu thích"}</span>
                    </button>

                    <Link
                      to={`/doc-truyen?q=${encodeURIComponent(product.title)}`}
                      className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-2xl border px-6 py-3 text-sm font-semibold text-white"
                    >
                      <MangaIcon name="book-open-check" className="h-4 w-4" />
                      <span>Tìm đọc online</span>
                    </Link>
                  </div>
                </div>

                {/* Policy Strip */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {SAFETY_BENEFITS.map((benefit) => (
                    <div
                      key={benefit.title}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0B0D14]/75 px-4 py-3 shadow-lg"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E63946]/25 bg-[#E63946]/15 text-[#FF6B77]">
                        <MangaIcon name={benefit.icon} className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{benefit.title}</p>
                        <p className="text-xs text-slate-400">{benefit.subtitle}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 3 Tabs: Mô tả, Thông tin chi tiết, Đánh giá */}
          <div
            id="reviews"
            className="mt-8 rounded-3xl border border-white/10 bg-[#131722]/90 p-6 shadow-xl backdrop-blur-xl sm:p-8"
          >
            <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-white/10 pb-4">
              <button
                type="button"
                onClick={() => setActiveTab("description")}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                  activeTab === "description"
                    ? "border border-[#E63946]/40 bg-[#E63946]/20 text-rose-200"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <MangaIcon name="align-left" className="h-4 w-4" />
                Mô tả
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("specs")}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                  activeTab === "specs"
                    ? "border border-[#E63946]/40 bg-[#E63946]/20 text-rose-200"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <MangaIcon name="info" className="h-4 w-4" />
                Thông tin chi tiết
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("reviews")}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                  activeTab === "reviews"
                    ? "border border-[#E63946]/40 bg-[#E63946]/20 text-rose-200"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <MangaIcon name="message-circle" className="h-4 w-4" />
                Đánh giá ({reviews.length})
              </button>
            </div>

            {activeTab === "description" ? (
              <div className="space-y-4">
                <h2 className="font-display text-lg font-semibold text-white">
                  Giới thiệu chi tiết
                </h2>
                <p className="whitespace-pre-line leading-relaxed text-slate-300">
                  {product.full_description?.trim() ||
                    product.description?.trim() ||
                    "Chưa có mô tả chi tiết cho sản phẩm này."}
                </p>
                {product.tags.length > 0 ? (
                  <div className="space-y-2 pt-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#FF6B77]">
                      Nhãn truyện
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {product.tags.map((tag) => (
                        <Link
                          key={tag}
                          to={`/products?tag=${encodeURIComponent(tag)}`}
                          className="rounded-full border border-[#E63946]/35 bg-[#E63946]/10 px-3 py-1 text-xs font-medium text-rose-200 transition-colors hover:bg-[#E63946]/25 hover:text-white"
                        >
                          #{tag}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeTab === "specs" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {specRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#0B0D14]/75 px-4 py-3 text-sm text-slate-300"
                  >
                    <span>{row.label}</span>
                    <strong className="text-white">{row.value}</strong>
                  </div>
                ))}
              </div>
            ) : null}

            {activeTab === "reviews" ? (
              <div className="space-y-4">
                {/* Summary Header */}
                <div className="rounded-2xl border border-white/10 bg-[#0B0D14]/75 p-5 shadow-lg">
                  <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-3xl font-bold text-[#F59E0B]">
                        <span>{product.average_rating.toFixed(1)}</span>
                        <span className="text-sm font-medium text-slate-400">
                          {reviews.length} đánh giá
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        {Array.from({ length: 5 }, (_, idx) => (
                          <Star
                            key={idx}
                            className={`h-5 w-5 ${
                              idx < Math.floor(product.average_rating)
                                ? "fill-amber-400 text-amber-400"
                                : "text-slate-600"
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    {canReview && !hasReviewed && !reviewFormOpen ? (
                      <button
                        type="button"
                        onClick={() => setReviewFormOpen(true)}
                        className="inline-flex items-center gap-2 rounded-full border border-[#E63946]/50 bg-[#E63946]/10 px-4 py-2 text-sm font-semibold text-rose-200 transition-all hover:bg-[#E63946]/20 hover:text-white"
                      >
                        <MangaIcon name="pen-line" className="h-4 w-4" />
                        Viết đánh giá
                      </button>
                    ) : !canReview ? (
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate-400">
                        <MangaIcon name="info" className="h-4 w-4" />
                        Mua sản phẩm để được đánh giá
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Review Form (Verified Buyers) */}
                {canReview && (reviewFormOpen || hasReviewed) ? (
                  <div className="rounded-2xl border border-[#E63946]/30 bg-[#0B0D14]/80 p-5">
                    <h4 className="mb-4 text-lg font-semibold text-white">
                      {hasReviewed ? "Đánh giá của bạn" : "Viết đánh giá"}
                    </h4>
                    <div className="space-y-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-300">
                          Điểm đánh giá
                        </label>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((starValue) => {
                            const selected = starValue <= reviewRating;
                            return (
                              <button
                                key={starValue}
                                type="button"
                                onClick={() => setReviewRating(starValue)}
                                aria-label={`Chọn ${starValue} sao`}
                                className="h-8 w-8 transition-transform hover:scale-110"
                              >
                                <Star
                                  className={`h-8 w-8 ${
                                    selected
                                      ? "fill-amber-400 text-amber-400"
                                      : "text-slate-600"
                                  }`}
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="reviewContentInput"
                          className="mb-2 block text-sm font-medium text-slate-300"
                        >
                          Nhận xét (tùy chọn)
                        </label>
                        <textarea
                          id="reviewContentInput"
                          rows={3}
                          value={reviewContent}
                          onChange={(e) => setReviewContent(e.target.value)}
                          placeholder="Chia sẻ trải nghiệm của bạn về sản phẩm này..."
                          className="w-full rounded-xl border border-white/15 bg-[#131722] px-4 py-3 text-sm text-white placeholder-slate-400 focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/25"
                        />
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => void handleSubmitReview()}
                          disabled={reviewSubmitting}
                          className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {reviewSubmitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MangaIcon name="send" className="h-4 w-4" />
                          )}
                          <span>
                            {reviewSubmitting
                              ? "Đang gửi..."
                              : hasReviewed
                                ? "Cập nhật đánh giá"
                                : "Gửi đánh giá"}
                          </span>
                        </button>

                        {hasReviewed ? (
                          <button
                            type="button"
                            onClick={() => setDeleteDialogOpen(true)}
                            disabled={reviewSubmitting}
                            className="inline-flex items-center gap-2 rounded-xl border border-[#E63946]/40 px-5 py-2.5 text-sm font-semibold text-rose-300 transition-all hover:bg-[#E63946]/15"
                          >
                            <MangaIcon name="trash-2" className="h-4 w-4" />
                            Xóa đánh giá
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setReviewFormOpen(false)}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-300 transition-all hover:bg-white/5"
                          >
                            Hủy
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Reviews List */}
                <div className="space-y-4">
                  {reviews.length > 0 ? (
                    reviews.map((review) => (
                      <div
                        key={review.id}
                        className="rounded-2xl border border-white/10 bg-[#0B0D14]/70 p-5 shadow-md"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-white">
                                {review.username}
                              </span>
                              {review.is_purchased ? (
                                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                                  Đã mua hàng
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 flex items-center gap-1">
                              {Array.from({ length: 5 }, (_, idx) => (
                                <Star
                                  key={idx}
                                  className={`h-4 w-4 ${
                                    idx < review.rating
                                      ? "fill-amber-400 text-amber-400"
                                      : "text-slate-600"
                                  }`}
                                />
                              ))}
                            </div>
                          </div>
                          <span className="text-xs text-slate-400">
                            {formatDate(review.created_at)}
                          </span>
                        </div>

                        {review.content ? (
                          <p className="mt-3 text-sm text-slate-300">{review.content}</p>
                        ) : null}

                        {review.admin_reply ? (
                          <div className="mt-4 rounded-xl border border-[#E63946]/30 bg-[#E63946]/10 p-4 text-sm">
                            <div className="flex flex-wrap items-center gap-2 text-rose-200">
                              <MangaIcon name="reply" className="h-4 w-4" />
                              <span className="font-semibold">
                                Phản hồi từ {review.admin_replied_by || "MangaStore"}
                              </span>
                              {review.admin_replied_at ? (
                                <span className="text-xs text-rose-200/80">
                                  ({formatDateTime(review.admin_replied_at)})
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 text-slate-200">{review.admin_reply}</p>
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-[#0B0D14]/70 p-8 text-center">
                      <MangaIcon
                        name="message-circle"
                        className="mx-auto mb-3 h-12 w-12 text-slate-600"
                      />
                      <p className="text-slate-400">
                        Chưa có đánh giá nào cho sản phẩm này.
                      </p>
                      {canReview && !hasReviewed ? (
                        <p className="mt-2 text-sm text-[#FF6B77]">
                          Hãy là người đầu tiên đánh giá!
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* Related Products (5 cols) */}
          {relatedProducts.length > 0 ? (
            <div className="mt-16">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="font-display text-2xl font-semibold text-white">
                  Sản phẩm liên quan
                </h2>
                <Link
                  to={`/products?categories=${encodeURIComponent(product.category)}`}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[#FF6B77] transition-all hover:gap-3 hover:text-rose-300"
                >
                  Xem thêm
                  <MangaIcon name="arrow-right" className="h-4 w-4" />
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {relatedProducts.map((rel) => (
                  <MangaCard3D key={rel.id} product={rel} compact />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Xóa đánh giá"
        message="Bạn có chắc chắn muốn xóa đánh giá của mình cho sản phẩm này?"
        confirmLabel="Xóa đánh giá"
        danger
        busy={reviewDeleting}
        onConfirm={() => void handleConfirmDeleteReview()}
        onCancel={() => {
          if (!reviewDeleting) setDeleteDialogOpen(false);
        }}
      />
    </StoreLayout>
  );
}

export default ProductDetailPage;
