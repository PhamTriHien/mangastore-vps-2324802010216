import { useState } from "react";
import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import { Heart, ShoppingBag, ShoppingCart, Star } from "lucide-react";
import { useCartWishlist } from "../../contexts/CartWishlistContext";
import { use3DTilt } from "../../hooks/use3DTilt";
import { formatCompactNumber, formatCurrency } from "../../lib/format";
import type { ProductCardDto } from "../../types/api";

const DEFAULT_COVER_URL = "/covers/default-manga.svg";

export interface MangaCard3DProps {
  product: ProductCardDto;
  compact?: boolean;
}

export function MangaCard3D({ product, compact = false }: MangaCard3DProps) {
  const { ref, onPointerEnter, onPointerMove, onPointerLeave } =
    use3DTilt<HTMLElement>({ maxTilt: 6, liftY: -4 });
  const { wishlistIds, addToCart, toggleWishlist } = useCartWishlist();

  const normalizedSrc = product.cover_url?.trim()
    ? product.cover_url.trim()
    : DEFAULT_COVER_URL;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [togglingWish, setTogglingWish] = useState(false);
  const [addingCart, setAddingCart] = useState(false);

  const displaySrc =
    failedSrc === normalizedSrc ? DEFAULT_COVER_URL : normalizedSrc;

  const hasDiscount =
    product.original_price !== null && product.original_price > product.price;
  const discountPercent =
    hasDiscount && product.original_price
      ? Math.round(
          ((product.original_price - product.price) / product.original_price) *
            100
        )
      : 0;

  const isWishlisted = wishlistIds.includes(product.id);
  const detailPath = `/products/${product.id}`;

  const handleToggleWishlist = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (togglingWish) return;
    setTogglingWish(true);
    try {
      await toggleWishlist(product.id);
    } finally {
      setTogglingWish(false);
    }
  };

  const handleAddToCart = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!product.is_available || addingCart) return;
    setAddingCart(true);
    try {
      await addToCart(product.id, 1);
    } finally {
      setAddingCart(false);
    }
  };

  return (
    <article
      ref={ref}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="ms-card-3d ms-card-3d-crimson group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#131722]/90 shadow-lg"
    >
      <div className="ms-3d-glare" aria-hidden="true" />

      <Link
        to={detailPath}
        draggable={false}
        className="relative block aspect-[5/6] w-full overflow-hidden bg-[#1B2130]"
      >
        <img
          src={displaySrc}
          alt={product.title}
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => {
            if (displaySrc !== DEFAULT_COVER_URL) {
              setFailedSrc(normalizedSrc);
            }
          }}
          className="pointer-events-none h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {hasDiscount && discountPercent > 0 ? (
          <span className="absolute left-2.5 top-2.5 z-10 rounded-md bg-gradient-to-r from-[#E63946] to-rose-600 px-2 py-0.5 text-xs font-bold text-white shadow-lg">
            -{discountPercent}%
          </span>
        ) : null}

        {product.category ? (
          <span className="absolute right-2.5 top-2.5 z-10 max-w-[55%] truncate rounded-full border border-white/15 bg-[#0B0D14]/80 px-2.5 py-0.5 text-[11px] font-medium text-slate-200 backdrop-blur-sm">
            {product.category}
          </span>
        ) : null}

        {!product.is_available ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0B0D14]/75 backdrop-blur-sm">
            <span className="rounded-md bg-[#E63946] px-2.5 py-1 text-xs font-semibold text-white">
              Hết hàng
            </span>
          </div>
        ) : null}
      </Link>

      <div
        className={`flex flex-1 flex-col justify-between ${
          compact ? "gap-2 p-3.5" : "gap-2.5 p-4"
        }`}
      >
        <div className="space-y-1.5">
          <Link to={detailPath} draggable={false} className="block">
            <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-white transition-colors group-hover:text-[#FF6B77]">
              {product.title}
            </h3>
          </Link>

          {!compact && product.description ? (
            <p className="line-clamp-1 text-xs text-slate-400">
              {product.description}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              <span className="font-medium text-amber-300">
                {product.average_rating.toFixed(1)}
              </span>
              <span className="text-slate-500">({product.ratings_count})</span>
            </span>

            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              <ShoppingBag className="h-3.5 w-3.5 text-slate-400" />
              <span>{formatCompactNumber(product.units_sold)} đã bán</span>
            </span>
          </div>
        </div>

        <div className="flex items-end justify-between gap-2 pt-1">
          <div className="min-w-0">
            {hasDiscount && product.original_price !== null ? (
              <div className="flex flex-col">
                <span className="text-xs text-slate-500 line-through">
                  {formatCurrency(product.original_price)}
                </span>
                <span className="text-base font-bold text-[#F59E0B]">
                  {formatCurrency(product.price)}
                </span>
              </div>
            ) : (
              <span className="text-base font-bold text-[#F59E0B]">
                {formatCurrency(product.price)}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={handleToggleWishlist}
              disabled={togglingWish}
              aria-pressed={isWishlisted}
              aria-label={
                isWishlisted ? "Bỏ khỏi yêu thích" : "Thêm vào yêu thích"
              }
              title={isWishlisted ? "Bỏ khỏi yêu thích" : "Thêm vào yêu thích"}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-all hover:scale-105 disabled:opacity-60 ${
                isWishlisted
                  ? "border-[#E63946]/70 bg-[#E63946]/20 text-[#FF6B77]"
                  : "border-white/15 bg-[#1B2130] text-slate-400 hover:border-[#E63946]/60 hover:bg-[#E63946]/15 hover:text-[#E63946]"
              }`}
            >
              <Heart
                className={`h-4 w-4 ${isWishlisted ? "fill-[#E63946] text-[#E63946]" : ""}`}
              />
            </button>

            <button
              type="button"
              onClick={handleAddToCart}
              disabled={!product.is_available || addingCart}
              aria-label="Thêm vào giỏ hàng"
              title={
                product.is_available ? "Thêm vào giỏ hàng" : "Sản phẩm đã hết hàng"
              }
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-[#E63946] to-rose-600 text-white shadow transition-all hover:scale-105 hover:from-[#FF4D5A] hover:to-rose-500 disabled:pointer-events-none disabled:opacity-45"
            >
              <ShoppingCart className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
