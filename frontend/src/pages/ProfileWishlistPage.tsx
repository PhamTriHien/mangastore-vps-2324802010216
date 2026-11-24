import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StoreLayout } from "../components/layout/StoreLayout";
import { MangaCard3D } from "../components/ui/MangaCard3D";
import { MangaIcon } from "../components/ui/MangaIcon";
import { useAuth } from "../contexts/AuthContext";
import { useCartWishlist } from "../contexts/CartWishlistContext";
import { useToast } from "../contexts/ToastContext";
import { ApiError, apiClient } from "../lib/api";
import type { ProductCardDto } from "../types/api";

interface RawWishlistProduct {
  id: number;
  title: string;
  author?: string | null;
  category?: string | null;
  genres?: string[];
  tags?: string[];
  price?: number;
  original_price?: number | null;
  average_rating?: number;
  ratings_count?: number;
  rating_avg?: number;
  review_count?: number;
  view_count?: number;
  units_sold?: number;
  stock_quantity?: number;
  status?: string;
  is_new?: boolean;
  is_featured?: boolean;
  in_stock?: boolean;
  is_available?: boolean;
  cover_url?: string | null;
  description?: string | null;
}

interface WishlistApiResponse {
  items: RawWishlistProduct[];
  product_ids: number[];
  count: number;
}

function normalizeWishlistItem(raw: RawWishlistProduct): ProductCardDto {
  const stock = Number(raw.stock_quantity ?? 1);
  return {
    id: raw.id,
    title: raw.title,
    author: raw.author ?? "",
    category: raw.category ?? "",
    genres: raw.genres ?? [],
    tags: raw.tags ?? [],
    price: Number(raw.price ?? 0),
    original_price: raw.original_price ?? null,
    average_rating: Number(raw.average_rating ?? raw.rating_avg ?? 0),
    ratings_count: Number(raw.ratings_count ?? raw.review_count ?? 0),
    view_count: Number(raw.view_count ?? 0),
    units_sold: Number(raw.units_sold ?? 0),
    stock_quantity: stock,
    status: raw.status ?? (stock > 0 ? "con_hang" : "het_hang"),
    in_stock: raw.in_stock ?? stock > 0,
    is_available: raw.is_available ?? stock > 0,
    is_featured: Boolean(raw.is_featured),
    is_new: Boolean(raw.is_new),
    is_in_wishlist: true,
    cover_url: raw.cover_url || "/covers/default-manga.svg",
    description: raw.description ?? "",
  };
}

export function ProfileWishlistPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { wishlistIds, refreshCounts } = useCartWishlist();
  const { showToast } = useToast();

  const [items, setItems] = useState<ProductCardDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [wishlistSynced, setWishlistSynced] = useState(false);

  const loadWishlist = useCallback(async () => {
    setLoading(true);
    try {
      const [res] = await Promise.all([
        apiClient.get<WishlistApiResponse>("/api/profile/wishlist"),
        refreshCounts(),
      ]);
      setItems((res.items ?? []).map(normalizeWishlistItem));
      setWishlistSynced(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate("/auth", {
          replace: true,
          state: { from: "/profile/wishlist" },
        });
        return;
      }
      showToast(
        err instanceof Error
          ? err.message
          : "Không thể tải danh sách yêu thích.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [navigate, refreshCounts, showToast]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth", {
        replace: true,
        state: { from: "/profile/wishlist" },
      });
      return;
    }
    void loadWishlist();
  }, [authLoading, user, navigate, loadWishlist]);

  const visibleItems = useMemo(() => {
    if (!wishlistSynced) return items;
    return items.filter((item) => wishlistIds.includes(item.id));
  }, [items, wishlistIds, wishlistSynced]);

  return (
    <StoreLayout>
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            <Link
              to="/profile"
              className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs"
            >
              <MangaIcon name="user" className="h-3.5 w-3.5" />
              Tổng quan
            </Link>
            <Link
              to="/profile/orders"
              className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs"
            >
              <MangaIcon name="package" className="h-3.5 w-3.5" />
              Đơn hàng
            </Link>
            <Link
              to="/profile/wishlist"
              className="ms-btn-2d ms-btn-2d-crimson px-4 py-2 text-xs"
            >
              <MangaIcon name="heart" className="h-3.5 w-3.5" />
              Yêu thích ({visibleItems.length})
            </Link>
            <Link
              to="/profile/settings"
              className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs"
            >
              <MangaIcon name="settings" className="h-3.5 w-3.5" />
              Cài đặt & Địa chỉ
            </Link>
          </div>
        </div>

        <h1 className="font-display mb-6 flex items-center gap-3 text-2xl font-extrabold text-white">
          <MangaIcon name="heart" className="text-crimson-400 h-6 w-6" />
          Tủ truyện yêu thích
        </h1>

        {loading || authLoading ? (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {[1, 2, 3, 4, 5].map((idx) => (
              <div
                key={idx}
                className="ms-panel-2d aspect-[2/3] animate-pulse bg-slate-900/70"
              />
            ))}
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="ms-panel-2d mx-auto max-w-xl px-6 py-12 text-center">
            <img
              src="/content/icons/spots/spot-empty-shelf.svg"
              alt="Danh sách yêu thích trống"
              className="mx-auto mb-5 h-44 w-44 object-contain"
            />
            <h2 className="font-display mb-2 text-xl font-bold text-white">
              Chưa có truyện nào trong mục yêu thích
            </h2>
            <p className="mb-6 text-sm text-slate-400">
              Nhấn vào biểu tượng trái tim trên các đầu truyện để lưu lại và
              theo dõi nhanh khi mua sắm.
            </p>
            <Link
              to="/products"
              className="ms-btn-2d ms-btn-2d-crimson px-6 py-3 text-sm"
            >
              <MangaIcon name="compass" className="h-4 w-4" />
              Khám phá cửa hàng
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visibleItems.map((product) => (
              <MangaCard3D key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </StoreLayout>
  );
}

export default ProfileWishlistPage;
