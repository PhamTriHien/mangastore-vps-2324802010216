import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { StoreLayout } from "../components/layout/StoreLayout";
import { MangaCard3D } from "../components/ui/MangaCard3D";
import { MangaIcon } from "../components/ui/MangaIcon";
import { PanelBadge } from "../components/ui/PanelBadge";
import { use3DParallax, use3DTilt } from "../hooks/use3DTilt";
import { useDragScroll } from "../hooks/useDragScroll";
import { apiClient } from "../lib/api";
import { formatCompactNumber, formatCurrency } from "../lib/format";
import type {
  ClassifiedTagItem,
  HomeResponse,
  ProductCardDto,
  ReaderMangaSummary,
} from "../types/api";

interface HeroSlide {
  image: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaTo: string;
  variant: "crimson" | "cyan";
}

const HERO_SLIDES: readonly HeroSlide[] = [
  {
    image: "/content/banners/hero-manga-collection.png",
    title: "Bộ Sưu Tập Manga Mới Nhất",
    subtitle: "Các tập manga mới cập nhật tại cửa hàng",
    ctaLabel: "Khám Phá Ngay",
    ctaTo: "/products",
    variant: "crimson",
  },
  {
    image: "/content/banners/hero-light-novel.png",
    title: "Light Novel Bán Chạy Nhất",
    subtitle: "Các bộ light novel nổi bật",
    ctaLabel: "Xem Thêm",
    ctaTo: "/products",
    variant: "crimson",
  },
  {
    image: "/content/banners/hero-special-sale.png",
    title: "Giảm Giá Đặc Biệt",
    subtitle: "Nhiều đầu truyện đang có giá ưu đãi",
    ctaLabel: "Mua Ngay",
    ctaTo: "/products",
    variant: "crimson",
  },
  {
    image: "/content/banners/hero-online-reader.png",
    title: "Series Mới Ra Mắt",
    subtitle: "Đọc truyện tranh trực tuyến ngay trên trình duyệt",
    ctaLabel: "Đọc Ngay",
    ctaTo: "/doc-truyen",
    variant: "cyan",
  },
];

const LEFT_COLLAGE_COVERS = [
  { src: "/covers/frieren.jpg", animClass: "ms-collage-card-a" },
  { src: "/covers/blue-lock.jpg", animClass: "ms-collage-card-b translate-y-6" },
  { src: "/covers/berserk.jpg", animClass: "ms-collage-card-a" },
  { src: "/covers/vagabond.jpg", animClass: "ms-collage-card-b translate-y-6" },
];

const RIGHT_COLLAGE_COVERS = [
  { src: "/covers/chainsaw-man.jpg", animClass: "ms-collage-card-b translate-y-6" },
  { src: "/covers/spy-family.jpg", animClass: "ms-collage-card-a" },
  { src: "/covers/conan.jpg", animClass: "ms-collage-card-b translate-y-6" },
  { src: "/covers/vinland-saga.jpg", animClass: "ms-collage-card-a" },
];

interface SuggestionItem {
  id: number;
  title: string;
  author: string;
  cover_url: string;
  price: number;
  category: string;
}

type FeaturedReaderItem = Partial<ReaderMangaSummary> & {
  manga_id?: string;
  product_id?: number;
  source_id?: string;
  title: string;
  author?: string;
  cover_url?: string;
  read_count?: number;
  average_rating?: number;
};

function resolveStoreTagHref(tag: ClassifiedTagItem): string {
  if (tag.target_url) return tag.target_url;
  if (tag.group === "Thể loại cửa hàng") {
    return `/products?categories=${encodeURIComponent(tag.name)}`;
  }
  return `/products?tag=${encodeURIComponent(tag.name)}`;
}

function resolveReaderTagHref(tag: ClassifiedTagItem): string {
  if (tag.target_url) return tag.target_url;
  if (tag.group === "Đối tượng") {
    return `/doc-truyen?demographic=${encodeURIComponent(tag.id)}`;
  }
  if (tag.id.startsWith("reader-genre-")) {
    return `/doc-truyen?source=local-db&q=${encodeURIComponent(tag.name)}`;
  }
  return `/doc-truyen?tag=${encodeURIComponent(tag.id)}`;
}

function FeaturedReaderCard({ manga }: { manga: FeaturedReaderItem }) {
  const tilt = use3DTilt<HTMLElement>({ maxTilt: 6, liftY: -4 });
  const [imgFailed, setImgFailed] = useState(false);

  const sourceId = manga.source_id || "local-db";
  const mangaId = manga.id || manga.manga_id || String(manga.product_id ?? "");
  const coverUrl =
    imgFailed || !manga.cover_url?.trim()
      ? "/covers/default-manga.svg"
      : manga.cover_url.trim();
  const rating = Number(manga.rating ?? manga.average_rating ?? 0);
  const views = Number(manga.view_count ?? manga.read_count ?? 0);
  const comments = Number(manga.comment_count ?? 0);
  const languageLabel = (manga.language || "VI").toUpperCase();
  const detailUrl = `/doc-truyen/chi-tiet?source=${encodeURIComponent(
    sourceId
  )}&id=${encodeURIComponent(mangaId)}`;

  return (
    <article
      ref={tilt.ref}
      onPointerEnter={tilt.onPointerEnter}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      className="ms-card-3d ms-card-3d-cyan group rounded-2xl border border-cyan-400/20 bg-[#0B0D14]/85 shadow-lg"
    >
      <div className="ms-3d-glare" aria-hidden="true" />
      <Link to={detailUrl} className="block">
        <div className="relative aspect-[2/3] overflow-hidden rounded-t-2xl bg-[#1B2130]">
          <img
            src={coverUrl}
            alt={manga.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute left-2 top-2 rounded-md bg-cyan-600/90 px-2 py-0.5 text-[11px] font-semibold uppercase text-white">
            {languageLabel}
          </div>
          {manga.status_label ? (
            <div className="absolute bottom-2 right-2 rounded-full bg-[#0B0D14]/85 px-2.5 py-0.5 text-[11px] font-medium text-slate-200 backdrop-blur-sm">
              {manga.status_label}
            </div>
          ) : null}
        </div>
        <div className="space-y-1.5 p-3.5">
          <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold text-white transition-colors group-hover:text-cyan-300">
            {manga.title}
          </h3>
          <p className="truncate text-xs text-slate-400">
            {manga.author?.trim() || manga.source_name || "MangaStore"}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-300">
            <span className="inline-flex items-center gap-1 font-medium text-amber-300">
              <MangaIcon name="star" className="h-3.5 w-3.5 text-amber-400" />
              <span>{rating > 0 ? rating.toFixed(1) : "—"}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-cyan-200/90">
              <MangaIcon name="eye" className="h-3.5 w-3.5 text-cyan-400" />
              <span>{formatCompactNumber(views)}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-slate-400">
              <MangaIcon name="message-circle" className="h-3.5 w-3.5 text-slate-400" />
              <span>{formatCompactNumber(comments)}</span>
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function ProductShelfSection({
  title,
  products,
  loading,
  error,
  emptyText,
  borderedSurface = false,
}: {
  title: string;
  products: ProductCardDto[];
  loading: boolean;
  error: string | null;
  emptyText: string;
  borderedSurface?: boolean;
}) {
  const dragScroll = useDragScroll<HTMLDivElement>();

  return (
    <section
      className={`px-4 py-16 sm:px-6 lg:px-8 ${
        borderedSurface ? "border-y border-white/10 bg-[#131722]/50" : ""
      }`}
    >
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="text-center">
          <h2 className="font-display text-3xl font-bold text-white md:text-4xl">{title}</h2>
        </div>

        {loading ? (
          <div className="flex gap-4 overflow-hidden py-2">
            {Array.from({ length: 5 }, (_, idx) => (
              <div
                key={idx}
                className="w-52 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[#131722] sm:w-56 md:w-60"
              >
                <div className="aspect-[5/6] w-full animate-pulse bg-[#1B2130]" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-4/5 animate-pulse rounded bg-[#1B2130]" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-[#1B2130]" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-white/10 bg-[#131722]/90 p-10 text-center shadow-lg">
            <p className="text-slate-300">{error}</p>
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-[#131722]/90 p-10 text-center shadow-lg">
            <p className="text-slate-300">{emptyText}</p>
          </div>
        ) : (
          <div className="relative">
            <div
              ref={dragScroll.ref}
              onMouseDown={dragScroll.onMouseDown}
              onMouseMove={dragScroll.onMouseMove}
              onMouseUp={dragScroll.onMouseUp}
              onMouseLeave={dragScroll.onMouseLeave}
              data-drag-scroll="true"
              className="ms-no-scrollbar -my-2 cursor-grab select-none overflow-x-auto overflow-y-hidden py-4 active:cursor-grabbing"
            >
              <div className="flex w-max gap-4">
                {products.map((product) => (
                  <div key={product.id} className="w-52 shrink-0 sm:w-56 md:w-60">
                    <MangaCard3D product={product} compact />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const heroParallax = use3DParallax<HTMLDivElement>(14);
  const searchParallax = use3DParallax<HTMLElement>(10);

  const [homeData, setHomeData] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentSlide, setCurrentSlide] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    apiClient
      .get<HomeResponse>("/api/home")
      .then((res) => {
        if (!active) return;
        setHomeData(res);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(
          err instanceof Error
            ? err.message
            : "Cửa hàng hiện tạm thời không khả dụng. Vui lòng thử lại sau."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (carouselPaused) return;
    const timer = window.setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [carouselPaused]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setLoadingSuggestions(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoadingSuggestions(true);
      fetch(`/api/products/suggestions?query=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Fetch error"))))
        .then((data: { suggestions?: SuggestionItem[] }) => {
          setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
          setShowSuggestions(true);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setShowSuggestions(false);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoadingSuggestions(false);
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchWrapRef.current &&
        !searchWrapRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleStoreSearch = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const q = searchQuery.trim();
    setShowSuggestions(false);
    navigate(q ? `/products?search=${encodeURIComponent(q)}` : "/products");
  };

  const handleReaderSearch = () => {
    const q = searchQuery.trim();
    setShowSuggestions(false);
    navigate(q ? `/doc-truyen?q=${encodeURIComponent(q)}` : "/doc-truyen");
  };

  const storeTags = homeData?.store_tags ?? [];
  const trendingTags = homeData?.trending_tags ?? [];
  const readerTags = homeData?.reader_tags ?? [];
  const featuredReader = (homeData?.featured_reader_manga ?? []) as FeaturedReaderItem[];
  const popularProducts = homeData?.popular_products ?? [];
  const hotProducts = homeData?.hot_products ?? [];
  const newProducts = homeData?.new_products ?? [];

  return (
    <StoreLayout>
      {/* Hero Banner Carousel */}
      <section className="relative w-full overflow-hidden border-b border-white/10">
        <div
          ref={heroParallax.ref}
          onPointerMove={heroParallax.onPointerMove}
          onPointerLeave={heroParallax.onPointerLeave}
          onMouseEnter={() => setCarouselPaused(true)}
          onMouseLeave={() => setCarouselPaused(false)}
          className="relative h-[300px] md:h-[400px] lg:h-[500px]"
        >
          {HERO_SLIDES.map((slide, index) => {
            const active = index === currentSlide;
            return (
              <div
                key={slide.image}
                className={`absolute inset-0 transition-opacity duration-1000 ${
                  active ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"
                }`}
              >
                <div className="absolute inset-0 overflow-hidden">
                  <img
                    src={slide.image}
                    alt={slide.title}
                    className="ms-hero-bg-layer h-full w-full object-cover"
                  />
                  <div className="ms-manga-banner-overlay absolute inset-0" />
                </div>
                <div className="relative flex h-full items-center">
                  <div className="container mx-auto px-16 md:px-20 lg:px-24">
                    <div
                      className={`ms-hero-fg-layer max-w-2xl transition-all duration-700 ${
                        active ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
                      }`}
                    >
                      <h2 className="font-display mb-4 text-3xl font-bold text-white transition-all delay-75 duration-700 md:text-4xl lg:text-5xl">
                        {slide.title}
                      </h2>
                      <p className="mb-6 text-lg text-slate-200/90 transition-all delay-150 duration-700 md:mb-8 md:text-xl">
                        {slide.subtitle}
                      </p>
                      <Link
                        to={slide.ctaTo}
                        className={`ms-btn-2d ${
                          slide.variant === "cyan" ? "ms-btn-2d-cyan" : "ms-btn-2d-crimson"
                        } inline-flex items-center justify-center rounded-xl border px-8 py-4 text-base font-semibold text-white transition-all delay-200 duration-700`}
                      >
                        {slide.ctaLabel}
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() =>
            setCurrentSlide((prev) => (prev - 1 + HERO_SLIDES.length) % HERO_SLIDES.length)
          }
          aria-label="Slide trước"
          className="absolute left-4 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#0B0D14]/70 text-white backdrop-blur-sm transition-all duration-300 hover:bg-[#E63946]/80"
        >
          <MangaIcon name="chevron-left" className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={() => setCurrentSlide((prev) => (prev + 1) % HERO_SLIDES.length)}
          aria-label="Slide tiếp theo"
          className="absolute right-4 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#0B0D14]/70 text-white backdrop-blur-sm transition-all duration-300 hover:bg-[#E63946]/80"
        >
          <MangaIcon name="chevron-right" className="h-6 w-6" />
        </button>

        <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 gap-2">
          {HERO_SLIDES.map((slide, index) => (
            <button
              key={slide.title}
              type="button"
              onClick={() => setCurrentSlide(index)}
              aria-label={`Slide ${index + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                index === currentSlide
                  ? "w-8 bg-white"
                  : "w-2 bg-white/50 hover:bg-white/75"
              }`}
            />
          ))}
        </div>
      </section>

      {/* Hero Search Section */}
      <section
        ref={searchParallax.ref}
        onPointerMove={searchParallax.onPointerMove}
        onPointerLeave={searchParallax.onPointerLeave}
        className="relative z-20 overflow-x-clip overflow-y-visible px-4 pb-28 pt-16 sm:px-6 lg:px-8"
      >
        <div
          className="ms-collage-3d pointer-events-none absolute inset-0 select-none overflow-hidden"
          aria-hidden="true"
        >
          <div className="ms-collage-plane-left absolute -left-8 top-4 hidden w-64 grid-cols-2 gap-3 opacity-25 md:grid lg:w-80">
            {LEFT_COLLAGE_COVERS.map((item) => (
              <div
                key={item.src}
                className={`${item.animClass} aspect-[2/3] overflow-hidden rounded-xl border border-white/15 shadow-2xl`}
              >
                <img
                  src={item.src}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.src = "/covers/default-manga.svg";
                  }}
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </div>

          <div className="ms-collage-plane-right absolute -right-8 top-4 hidden w-64 grid-cols-2 gap-3 opacity-25 md:grid lg:w-80">
            {RIGHT_COLLAGE_COVERS.map((item) => (
              <div
                key={item.src}
                className={`${item.animClass} aspect-[2/3] overflow-hidden rounded-xl border border-white/15 shadow-2xl`}
              >
                <img
                  src={item.src}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.src = "/covers/default-manga.svg";
                  }}
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </div>

          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(11,13,20,0.4)_0%,rgba(11,13,20,0.9)_62%,#0B0D14_100%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0B0D14]/65 via-transparent to-[#0B0D14]" />
        </div>

        <div className="pointer-events-none absolute -left-10 -top-16 h-64 w-64 rounded-full bg-[#E63946]/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -right-10 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <h1 className="font-display mb-8 bg-gradient-to-r from-white via-rose-200 to-amber-200 bg-clip-text text-3xl font-extrabold text-transparent md:text-4xl lg:text-5xl">
            Tìm kiếm truyện bạn yêu thích
          </h1>

          <form
            onSubmit={handleStoreSearch}
            className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row"
          >
            <div ref={searchWrapRef} className="relative flex-1">
              <MangaIcon
                name="search"
                className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                placeholder="Nhập tên truyện, tác giả hoặc thể loại..."
                autoComplete="off"
                className="h-14 w-full rounded-xl border border-white/15 bg-[#131722]/90 pl-12 pr-4 text-white shadow-lg backdrop-blur-md transition-all placeholder:text-slate-400 focus:border-[#E63946] focus:bg-[#131722] focus:outline-none focus:ring-2 focus:ring-[#E63946]/40"
              />

              {showSuggestions && (
                <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-[#0B0D14]/95 text-left shadow-2xl backdrop-blur-lg">
                  {loadingSuggestions ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-sm text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin text-[#E63946]" />
                      <span>Đang tìm kiếm...</span>
                    </div>
                  ) : suggestions.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-slate-400">
                      Không tìm thấy truyện nào phù hợp.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/10">
                      {suggestions.map((item) => (
                        <Link
                          key={item.id}
                          to={`/products/${item.id}`}
                          onClick={() => setShowSuggestions(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-100 transition-colors hover:bg-[#1B2130]"
                        >
                          <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-[#1B2130]">
                            <img
                              src={item.cover_url || "/covers/default-manga.svg"}
                              alt={item.title}
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.src = "/covers/default-manga.svg";
                              }}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold">{item.title}</div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                              {item.author ? (
                                <span className="truncate">Tác giả: {item.author}</span>
                              ) : null}
                              {item.category ? (
                                <span className="inline-flex items-center rounded-full bg-[#1B2130] px-2 py-0.5 text-[11px] text-slate-300">
                                  {item.category}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="ml-3 whitespace-nowrap text-xs font-semibold text-rose-400">
                            {formatCurrency(item.price)}
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="submit"
                className="ms-btn-2d ms-btn-2d-crimson inline-flex h-14 items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-6 text-sm font-semibold text-white"
              >
                <PanelBadge asset="mode-store" className="h-5 w-5" />
                <span>Tìm mua truyện</span>
              </button>
              <button
                type="button"
                onClick={handleReaderSearch}
                className="ms-btn-2d ms-btn-2d-cyan inline-flex h-14 items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-6 text-sm font-semibold text-white"
              >
                <PanelBadge asset="mode-reader" className="h-5 w-5" />
                <span>Tìm đọc online</span>
              </button>
            </div>
          </form>

          <div className="mt-7 space-y-3 text-left sm:text-center">
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs md:text-sm">
              <span className="inline-flex items-center gap-1.5 font-semibold text-rose-300">
                <MangaIcon name="shopping-bag" className="h-3.5 w-3.5" />
                Cửa hàng:
              </span>
              {storeTags.length > 0 ? (
                storeTags.slice(0, 12).map((sTag) => (
                  <Link
                    key={sTag.id}
                    to={resolveStoreTagHref(sTag)}
                    className="ms-pill-2d rounded-full border border-rose-500/40 bg-[#E63946]/15 px-3 py-1 text-xs text-rose-100 transition-all hover:border-rose-400 hover:bg-[#E63946]/30"
                  >
                    {sTag.display_name || sTag.name}
                  </Link>
                ))
              ) : trendingTags.length > 0 ? (
                trendingTags.map((tag) => (
                  <Link
                    key={tag}
                    to={`/products?tag=${encodeURIComponent(tag)}`}
                    className="ms-pill-2d rounded-full border border-rose-500/40 bg-[#E63946]/15 px-3 py-1 text-xs text-rose-100 transition-all hover:border-rose-400 hover:bg-[#E63946]/30"
                  >
                    #{tag}
                  </Link>
                ))
              ) : (
                <span className="text-xs text-slate-400">
                  Chưa có nhãn sản phẩm trong cửa hàng.
                </span>
              )}
            </div>

            {readerTags.length > 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-2 text-xs md:text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-cyan-300">
                  <MangaIcon name="book-open-check" className="h-3.5 w-3.5" />
                  Đọc online:
                </span>
                {readerTags.slice(0, 12).map((rTag) => (
                  <Link
                    key={rTag.id}
                    to={resolveReaderTagHref(rTag)}
                    className="ms-pill-2d rounded-full border border-cyan-400/40 bg-cyan-500/15 px-3 py-1 text-xs text-cyan-100 transition-all hover:border-cyan-300 hover:bg-cyan-500/30"
                  >
                    {rTag.display_name || rTag.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Featured Online Manga Section */}
      {featuredReader.length > 0 ? (
        <section className="border-y border-cyan-400/20 bg-[#131722]/60 px-4 py-12 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-2xl font-bold text-white md:text-3xl">
                  Đọc truyện nổi bật
                </h2>
              </div>
              <Link
                to="/doc-truyen"
                className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 self-start rounded-xl border px-4 py-2.5 text-sm font-semibold text-white sm:self-auto"
              >
                <PanelBadge asset="mode-reader" className="h-5 w-5" />
                <span>Mở kho đọc truyện</span>
                <MangaIcon name="arrow-right" className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {featuredReader.map((manga, idx) => (
                <FeaturedReaderCard
                  key={`${manga.source_id || "local-db"}-${manga.id || manga.manga_id || idx}`}
                  manga={manga}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* 3 Horizontal Drag-Scroll Store Shelves */}
      <ProductShelfSection
        title="Sản phẩm phổ biến"
        products={popularProducts}
        loading={loading}
        error={loadError}
        emptyText="Chưa có dữ liệu sản phẩm phổ biến."
      />

      <ProductShelfSection
        title="Sản phẩm bán chạy"
        products={hotProducts}
        loading={loading}
        error={loadError}
        emptyText="Chưa có dữ liệu sản phẩm bán chạy."
        borderedSurface
      />

      <ProductShelfSection
        title="Truyện mới cập nhật"
        products={newProducts}
        loading={loading}
        error={loadError}
        emptyText="Chưa có dữ liệu truyện mới cập nhật."
      />
    </StoreLayout>
  );
}

export default HomePage;
