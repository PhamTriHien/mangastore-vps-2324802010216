import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { StoreLayout } from "../components/layout/StoreLayout";
import { MangaCard3D } from "../components/ui/MangaCard3D";
import { MangaIcon } from "../components/ui/MangaIcon";
import { PanelBadge } from "../components/ui/PanelBadge";
import { apiClient } from "../lib/api";
import { formatCurrency } from "../lib/format";
import type {
  ClassifiedTagItem,
  ProductsListResponse,
  ReaderTagDto,
} from "../types/api";

interface PriceRangeOption {
  id: string;
  label: string;
}

const PRICE_RANGE_OPTIONS: readonly PriceRangeOption[] = [
  { id: "all", label: "Tất cả mức giá" },
  { id: "under-50k", label: "Dưới 50.000đ" },
  { id: "50k-100k", label: "50.000đ – 100.000đ" },
  { id: "100k-200k", label: "100.000đ – 200.000đ" },
  { id: "200k-500k", label: "200.000đ – 500.000đ" },
  { id: "over-500k", label: "Trên 500.000đ" },
];

const PAGE_SIZE_OPTIONS = [6, 12, 24, 48] as const;

interface ProductSuggestion {
  id: number;
  title: string;
  author: string;
  cover_url: string;
  price: number;
  category: string;
}

interface ReaderTagsPayload {
  reader_tags?: Array<
    ReaderTagDto & { display_name?: string; group?: string; target_url?: string }
  >;
}

function normalizeStoreTagNames(
  rawTags: Array<string | ClassifiedTagItem> | undefined
): string[] {
  if (!Array.isArray(rawTags)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of rawTags) {
    const label = typeof item === "string" ? item.trim() : item.name.trim();
    if (label && !seen.has(label.toLowerCase())) {
      seen.add(label.toLowerCase());
      names.push(label);
    }
  }
  return names;
}

export function ProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const searchTerm = (searchParams.get("search") ?? "").trim();
  const selectedTag = (searchParams.get("tag") ?? "").trim();
  const priceRange = (
    searchParams.get("price_range") ??
    searchParams.get("priceRange") ??
    "all"
  ).trim();
  const sortBy = (searchParams.get("sort") ?? "default").trim();

  const selectedCategories = useMemo(() => {
    const rawList = searchParams.getAll("categories");
    const parsed: string[] = [];
    const seen = new Set<string>();
    for (const entry of rawList) {
      for (const part of entry.split(",")) {
        const cleaned = part.trim();
        if (cleaned && !seen.has(cleaned.toLowerCase())) {
          seen.add(cleaned.toLowerCase());
          parsed.push(cleaned);
        }
      }
    }
    return parsed;
  }, [searchParams]);

  const rawPage = Number(searchParams.get("page") ?? "1");
  const currentPage = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const rawPageSize = Number(
    searchParams.get("page_size") ?? searchParams.get("pageSize") ?? "12"
  );
  const pageSize = PAGE_SIZE_OPTIONS.includes(rawPageSize as (typeof PAGE_SIZE_OPTIONS)[number])
    ? rawPageSize
    : 12;

  const [searchInput, setSearchInput] = useState(searchTerm);
  useEffect(() => {
    setSearchInput(searchTerm);
  }, [searchTerm]);

  const [data, setData] = useState<ProductsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [readerTags, setReaderTags] = useState<
    Array<ReaderTagDto & { display_name?: string; target_url?: string }>
  >([]);

  const [catOpen, setCatOpen] = useState(true);
  const [priceOpen, setPriceOpen] = useState(true);

  // Autocomplete suggestions
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(-1);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .get<ReaderTagsPayload>("/api/reader/tags")
      .then((res) => {
        if (!active) return;
        setReaderTags(Array.isArray(res?.reader_tags) ? res.reader_tags.slice(0, 16) : []);
      })
      .catch(() => {
        if (active) setReaderTags([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const apiParams = new URLSearchParams();
    if (searchTerm) apiParams.set("search", searchTerm);
    for (const cat of selectedCategories) {
      apiParams.append("categories", cat);
    }
    apiParams.set("price_range", priceRange || "all");
    apiParams.set("sort", sortBy || "default");
    if (selectedTag) apiParams.set("tag", selectedTag);
    apiParams.set("page", String(currentPage));
    apiParams.set("page_size", String(pageSize));

    apiClient
      .get<ProductsListResponse>(`/api/products?${apiParams.toString()}`)
      .then((res) => {
        if (!active) return;
        setData(res);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "Không thể tải danh sách sản phẩm lúc này. Vui lòng thử lại sau."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [searchTerm, selectedCategories, priceRange, sortBy, selectedTag, currentPage, pageSize]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      setSuggestionsLoading(false);
      setActiveSuggestionIdx(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSuggestionsLoading(true);
      setSuggestionsOpen(true);
      fetch(`/api/products/suggestions?query=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Fetch error"))))
        .then((payload: { suggestions?: ProductSuggestion[] }) => {
          setSuggestions(Array.isArray(payload?.suggestions) ? payload.suggestions : []);
          setActiveSuggestionIdx(-1);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setSuggestionsOpen(false);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSuggestionsLoading(false);
          }
        });
    }, 280);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchInput]);

  useEffect(() => {
    const onOutsideClick = (event: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  const updateFilters = (
    patch: {
      search?: string;
      categories?: string[];
      price_range?: string;
      sort?: string;
      tag?: string;
      page?: number;
      page_size?: number;
    },
    resetPage = true
  ) => {
    const next = new URLSearchParams();
    const nextSearch = patch.search !== undefined ? patch.search.trim() : searchTerm;
    const nextCats = patch.categories !== undefined ? patch.categories : selectedCategories;
    const nextPrice = patch.price_range !== undefined ? patch.price_range : priceRange;
    const nextSort = patch.sort !== undefined ? patch.sort : sortBy;
    const nextTag = patch.tag !== undefined ? patch.tag.trim() : selectedTag;
    const nextPageSize = patch.page_size !== undefined ? patch.page_size : pageSize;
    const nextPage =
      patch.page !== undefined ? Math.max(1, patch.page) : resetPage ? 1 : currentPage;

    if (nextSearch) next.set("search", nextSearch);
    for (const c of nextCats) {
      next.append("categories", c);
    }
    if (nextPrice && nextPrice !== "all") next.set("price_range", nextPrice);
    if (nextSort && nextSort !== "default") next.set("sort", nextSort);
    if (nextTag) next.set("tag", nextTag);
    if (nextPage > 1) next.set("page", String(nextPage));
    if (nextPageSize !== 12) next.set("page_size", String(nextPageSize));

    setSearchParams(next);
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuggestionsOpen(false);
    updateFilters({ search: searchInput });
  };

  const handleToggleCategory = (catName: string) => {
    const exists = selectedCategories.some(
      (c) => c.toLowerCase() === catName.toLowerCase()
    );
    const nextCats = exists
      ? selectedCategories.filter((c) => c.toLowerCase() !== catName.toLowerCase())
      : [...selectedCategories, catName];
    updateFilters({ categories: nextCats });
  };

  const handleResetAll = () => {
    setSearchInput("");
    setSearchParams(new URLSearchParams());
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;
  const apiPage = data?.page ?? currentPage;
  const showingFrom = total === 0 ? 0 : (apiPage - 1) * pageSize + 1;
  const showingTo = Math.min(apiPage * pageSize, total);

  const categories = data?.categories ?? [];
  const storeTagNames = useMemo(
    () =>
      normalizeStoreTagNames(
        data?.store_tags as Array<string | ClassifiedTagItem> | undefined
      ),
    [data?.store_tags]
  );

  const pageSequence = useMemo(() => {
    const seq: Array<number | null> = [];
    let lastAdded: number | null = null;
    for (let p = 1; p <= totalPages; p += 1) {
      const shouldShow =
        p === 1 || p === totalPages || (p >= apiPage - 1 && p <= apiPage + 1);
      if (!shouldShow) continue;
      if (lastAdded !== null && p - lastAdded > 1) {
        seq.push(null);
      }
      seq.push(p);
      lastAdded = p;
    }
    return seq;
  }, [apiPage, totalPages]);

  return (
    <StoreLayout>
      <section className="min-h-screen bg-transparent text-[#F5F6FA]">
        {/* Sticky Top Header + Search Autocomplete */}
        <div className="relative z-20 border-b border-white/10 bg-[#0B0D14]/90 backdrop-blur-xl md:sticky md:top-[73px]">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <img
              src="/content/banners/hero-manga-collection.png"
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover object-center opacity-20"
            />
            <div className="ms-manga-banner-overlay absolute inset-0" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0B0D14]/85 via-[#0B0D14]/65 to-[#E63946]/15" />
          </div>

          <div className="relative z-10 mx-auto max-w-7xl px-6 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <Link
                to="/"
                className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 transition-colors hover:text-white"
              >
                <MangaIcon name="arrow-left" className="h-4 w-4" />
                Quay lại
              </Link>

              <Link
                to={
                  searchTerm
                    ? `/doc-truyen?q=${encodeURIComponent(searchTerm)}`
                    : "/doc-truyen"
                }
                className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold text-white"
              >
                <PanelBadge asset="mode-reader" className="h-5 w-5" />
                <span>Đọc truyện Online</span>
              </Link>

              <h1 className="font-display text-lg font-semibold text-white">
                Danh sách sản phẩm
              </h1>
            </div>

            <div ref={searchContainerRef} className="w-full">
              <form onSubmit={handleSearchSubmit} className="relative w-full">
                <MangaIcon
                  name="search"
                  className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onFocus={() => {
                    if (searchInput.trim().length >= 2) {
                      setSuggestionsOpen(true);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (!suggestionsOpen || suggestions.length === 0) return;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActiveSuggestionIdx((prev) =>
                        Math.min(prev + 1, suggestions.length - 1)
                      );
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveSuggestionIdx((prev) => Math.max(prev - 1, 0));
                    } else if (e.key === "Escape") {
                      setSuggestionsOpen(false);
                    }
                  }}
                  placeholder="Tìm kiếm sản phẩm..."
                  autoComplete="off"
                  className="h-12 w-full rounded-xl border border-white/15 bg-[#131722]/90 pl-12 pr-24 text-base text-white placeholder:text-slate-400 backdrop-blur-md transition-all focus:border-[#E63946]/70 focus:bg-[#1B2130] focus:outline-none focus:ring-2 focus:ring-[#E63946]/25"
                />
                <button
                  type="submit"
                  className="absolute right-1.5 top-1/2 inline-flex h-9 -translate-y-1/2 items-center justify-center rounded-lg bg-gradient-to-r from-[#E63946] to-rose-600 px-4 text-sm font-semibold text-white shadow transition-all hover:from-[#FF4D5A] hover:to-rose-500"
                >
                  <MangaIcon name="search" className="mr-1 h-4 w-4" />
                  Tìm
                </button>

                {suggestionsOpen ? (
                  <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-white/15 bg-[#131722]/95 shadow-2xl backdrop-blur-xl">
                    {suggestionsLoading ? (
                      <div className="flex items-center justify-center gap-2 p-4 text-sm text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin text-[#E63946]" />
                        <span>Đang tìm kiếm...</span>
                      </div>
                    ) : suggestions.length === 0 ? (
                      <div className="p-4 text-center text-sm text-slate-400">
                        Không tìm thấy sản phẩm nào
                      </div>
                    ) : (
                      <div className="divide-y divide-white/10">
                        {suggestions.map((item, idx) => (
                          <Link
                            key={item.id}
                            to={`/products/${item.id}`}
                            onClick={() => setSuggestionsOpen(false)}
                            className={`flex items-center gap-3 p-3 transition-colors hover:bg-[#E63946]/10 ${
                              idx === activeSuggestionIdx ? "bg-[#E63946]/15" : ""
                            }`}
                          >
                            <img
                              src={item.cover_url || "/covers/default-manga.svg"}
                              alt={item.title}
                              onError={(e) => {
                                e.currentTarget.src = "/covers/default-manga.svg";
                              }}
                              className="h-12 w-10 rounded-lg object-cover shadow-sm"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-white">{item.title}</p>
                              <p className="text-sm font-semibold text-[#F59E0B]">
                                {formatCurrency(item.price)}
                              </p>
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </form>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
            {/* Left Sidebar */}
            <aside className="lg:col-span-1">
              <div className="ms-panel-2d space-y-6 rounded-2xl border border-white/10 bg-[#131722]/90 p-6 shadow-xl backdrop-blur-xl lg:sticky lg:top-[224px]">
                <header className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-semibold text-white">Bộ lọc</h2>
                  {(searchTerm ||
                    selectedCategories.length > 0 ||
                    priceRange !== "all" ||
                    selectedTag ||
                    sortBy !== "default") && (
                    <button
                      type="button"
                      onClick={handleResetAll}
                      className="text-xs font-semibold text-[#FF6B77] hover:underline"
                    >
                      Đặt lại
                    </button>
                  )}
                </header>

                <div className="space-y-6">
                  {/* Categories */}
                  <div className="rounded-xl border border-white/10 bg-[#0B0D14]/60 p-4">
                    <button
                      type="button"
                      onClick={() => setCatOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between text-sm font-semibold text-slate-100 transition-colors hover:text-[#FF6B77]"
                    >
                      <span>Thể loại</span>
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full bg-[#E63946]/15 text-[#FF6B77] transition-transform ${
                          catOpen ? "" : "rotate-180"
                        }`}
                      >
                        <MangaIcon name="chevron-up" className="h-4 w-4" />
                      </span>
                    </button>

                    {catOpen ? (
                      <div className="space-y-2.5 pt-3">
                        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-[#1B2130]/75 px-3 py-2 text-sm text-slate-200 transition-all hover:border-[#E63946]/50 hover:bg-[#1B2130]">
                          <input
                            type="checkbox"
                            checked={selectedCategories.length === 0}
                            onChange={() => updateFilters({ categories: [] })}
                            className="h-4 w-4 rounded border-white/20 bg-[#0B0D14] text-[#E63946] focus:ring-[#E63946]"
                          />
                          <span>Tất cả</span>
                        </label>
                        {categories.map((cat) => {
                          const checked = selectedCategories.some(
                            (c) => c.toLowerCase() === cat.toLowerCase()
                          );
                          return (
                            <label
                              key={cat}
                              className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-[#1B2130]/75 px-3 py-2 text-sm text-slate-200 transition-all hover:border-[#E63946]/50 hover:bg-[#1B2130]"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggleCategory(cat)}
                                className="h-4 w-4 rounded border-white/20 bg-[#0B0D14] text-[#E63946] focus:ring-[#E63946]"
                              />
                              <span>{cat}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div className="h-px bg-white/10" />

                  {/* Price Ranges */}
                  <div className="rounded-xl border border-white/10 bg-[#0B0D14]/60 p-4">
                    <button
                      type="button"
                      onClick={() => setPriceOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between text-sm font-semibold text-slate-100 transition-colors hover:text-[#FF6B77]"
                    >
                      <span>Khoảng giá</span>
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full bg-[#E63946]/15 text-[#FF6B77] transition-transform ${
                          priceOpen ? "" : "rotate-180"
                        }`}
                      >
                        <MangaIcon name="chevron-up" className="h-4 w-4" />
                      </span>
                    </button>

                    {priceOpen ? (
                      <div className="space-y-2.5 pt-3">
                        {PRICE_RANGE_OPTIONS.map((opt) => (
                          <label
                            key={opt.id}
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-[#1B2130]/75 px-3 py-2 text-sm text-slate-200 transition-all hover:border-[#E63946]/50 hover:bg-[#1B2130]"
                          >
                            <input
                              type="radio"
                              name="price_range"
                              checked={priceRange === opt.id}
                              onChange={() => updateFilters({ price_range: opt.id })}
                              className="h-4 w-4 border-white/20 bg-[#0B0D14] text-[#E63946] focus:ring-[#E63946]"
                            />
                            <span>{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="h-px bg-white/10" />

                  {/* Store Tag Pills */}
                  <div className="space-y-3 rounded-xl border border-[#E63946]/30 bg-[#E63946]/5 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-[#FF6B77]">
                        Nhãn cửa hàng
                      </span>
                      {selectedTag ? (
                        <button
                          type="button"
                          onClick={() => updateFilters({ tag: "" })}
                          className="text-xs font-medium text-amber-400 hover:underline"
                        >
                          Bỏ lọc
                        </button>
                      ) : null}
                    </div>
                    {storeTagNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {storeTagNames.map((tagName) => {
                          const active = selectedTag.toLowerCase() === tagName.toLowerCase();
                          return (
                            <button
                              key={tagName}
                              type="button"
                              onClick={() =>
                                updateFilters({ tag: active ? "" : tagName })
                              }
                              className={`ms-pill-2d rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                active
                                  ? "ms-pill-2d-active-crimson font-semibold text-white"
                                  : "border-[#E63946]/30 bg-[#1B2130]/80 text-rose-200 hover:border-rose-400/60 hover:bg-[#E63946]/20 hover:text-white"
                              }`}
                            >
                              #{tagName}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Chưa có nhãn sản phẩm.</p>
                    )}
                  </div>

                  {/* Reader Tag Pills */}
                  {readerTags.length > 0 ? (
                    <div className="space-y-3 rounded-xl border border-cyan-400/30 bg-cyan-500/5 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
                        Đọc online
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {readerTags.map((rTag) => {
                          const href = rTag.target_url
                            ? rTag.target_url
                            : rTag.group === "Đối tượng"
                              ? `/doc-truyen?demographic=${encodeURIComponent(rTag.id)}`
                              : `/doc-truyen?tag=${encodeURIComponent(rTag.id)}`;
                          return (
                            <Link
                              key={rTag.id}
                              to={href}
                              className="ms-pill-2d rounded-full border border-cyan-400/30 bg-[#1B2130]/80 px-2.5 py-1 text-xs font-medium text-cyan-200 transition-colors hover:border-cyan-300/60 hover:bg-cyan-500/20 hover:text-white"
                            >
                              {rTag.display_name || rTag.vietnamese_name || rTag.name}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </aside>

            {/* Main Catalog Column */}
            <div className="space-y-6 lg:col-span-3">
              {/* Sort & PageSize Toolbar */}
              <div className="rounded-2xl border border-white/10 bg-[#131722]/90 p-4 shadow-xl backdrop-blur-xl">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg border border-[#E63946]/30 bg-[#E63946]/15 px-3 py-1 text-xs font-semibold text-rose-200">
                      Đang hiển thị {showingFrom} – {showingTo} trong {total}
                    </span>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <label
                      htmlFor="itemsPerPageSelect"
                      className="text-xs font-semibold uppercase tracking-wide text-slate-400"
                    >
                      Số lượng / trang
                    </label>
                    <select
                      id="itemsPerPageSelect"
                      value={pageSize}
                      onChange={(e) =>
                        updateFilters({ page_size: Number(e.target.value) })
                      }
                      className="h-10 rounded-xl border border-white/15 bg-[#0B0D14]/85 px-4 text-sm text-white shadow-sm focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/30"
                    >
                      {PAGE_SIZE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>

                    <div className="hidden h-6 w-px bg-white/10 sm:block" />

                    <label
                      htmlFor="sortSelect"
                      className="text-xs font-semibold uppercase tracking-wide text-slate-400"
                    >
                      Sắp xếp
                    </label>
                    <select
                      id="sortSelect"
                      value={sortBy}
                      onChange={(e) => updateFilters({ sort: e.target.value })}
                      className="h-10 rounded-xl border border-white/15 bg-[#0B0D14]/85 px-4 text-sm text-white shadow-sm focus:border-[#E63946] focus:outline-none focus:ring-2 focus:ring-[#E63946]/30"
                    >
                      <option value="default">Mặc định</option>
                      <option value="name">Tên A–Z</option>
                      <option value="price-asc">Giá tăng dần</option>
                      <option value="price-desc">Giá giảm dần</option>
                      <option value="rating">Đánh giá cao nhất</option>
                    </select>
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
                  {Array.from({ length: Math.min(pageSize, 12) }, (_, idx) => (
                    <div
                      key={idx}
                      className="overflow-hidden rounded-2xl border border-white/10 bg-[#131722]/90"
                    >
                      <div className="aspect-[5/6] w-full animate-pulse bg-[#1B2130]" />
                      <div className="space-y-2.5 p-4">
                        <div className="h-4 w-4/5 animate-pulse rounded bg-[#1B2130]" />
                        <div className="h-3 w-1/2 animate-pulse rounded bg-[#1B2130]" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="rounded-3xl border border-amber-400/30 bg-[#131722]/90 p-10 text-center shadow-xl backdrop-blur-xl">
                  <MangaIcon
                    name="alert-circle"
                    className="mx-auto mb-4 h-14 w-14 text-amber-400"
                  />
                  <h2 className="font-display mb-2 text-2xl font-semibold text-white">
                    Cửa hàng hiện tạm thời không khả dụng
                  </h2>
                  <p className="mb-6 text-sm text-slate-300">{error}</p>
                  <Link
                    to={
                      searchTerm
                        ? `/doc-truyen?q=${encodeURIComponent(searchTerm)}`
                        : "/doc-truyen"
                    }
                    className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm font-semibold text-white"
                  >
                    <MangaIcon name="book-open-check" className="h-4 w-4" />
                    Chuyển sang Đọc truyện Online
                  </Link>
                </div>
              ) : items.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-[#131722]/90 p-12 text-center shadow-xl backdrop-blur-xl">
                  <img
                    src="/content/icons/spots/spot-empty-search.svg"
                    alt=""
                    aria-hidden="true"
                    className="ms-float-3d mx-auto mb-4 h-28 w-36 object-contain"
                  />
                  <h2 className="font-display mb-2 text-2xl font-semibold text-white">
                    Không tìm thấy sản phẩm
                  </h2>
                  <p className="mb-6 text-slate-400">
                    Vui lòng điều chỉnh lại bộ lọc hoặc thử một từ khóa khác.
                  </p>
                  <button
                    type="button"
                    onClick={handleResetAll}
                    className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm font-semibold text-white"
                  >
                    <MangaIcon name="rotate-ccw" className="h-4 w-4" />
                    Đặt lại bộ lọc
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
                    {items.map((product) => (
                      <MangaCard3D key={product.id} product={product} />
                    ))}
                  </div>

                  {totalPages > 1 ? (
                    <div className="flex justify-center pt-2">
                      <nav
                        aria-label="Phân trang sản phẩm"
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#131722]/90 p-2 shadow-xl backdrop-blur-xl"
                      >
                        <button
                          type="button"
                          disabled={apiPage <= 1}
                          onClick={() => updateFilters({ page: 1 }, false)}
                          aria-label="Trang đầu"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-slate-300 transition-all hover:bg-[#E63946]/15 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                        >
                          <MangaIcon name="chevrons-left" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={apiPage <= 1}
                          onClick={() => updateFilters({ page: apiPage - 1 }, false)}
                          aria-label="Trang trước"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-slate-300 transition-all hover:bg-[#E63946]/15 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                        >
                          <MangaIcon name="chevron-left" className="h-4 w-4" />
                        </button>

                        {pageSequence.map((entry, idx) =>
                          entry === null ? (
                            <span
                              key={`ellipsis-${idx}`}
                              className="inline-flex h-10 min-w-[2.5rem] items-center justify-center text-sm text-slate-500"
                            >
                              …
                            </span>
                          ) : (
                            <button
                              key={entry}
                              type="button"
                              onClick={() => updateFilters({ page: entry }, false)}
                              className={`inline-flex h-10 min-w-[2.5rem] items-center justify-center rounded-full px-3 text-sm font-semibold transition-all ${
                                entry === apiPage
                                  ? "bg-gradient-to-r from-[#E63946] to-rose-600 text-white shadow-lg shadow-[#E63946]/25"
                                  : "text-slate-300 hover:bg-[#E63946]/15 hover:text-white"
                              }`}
                            >
                              {entry}
                            </button>
                          )
                        )}

                        <button
                          type="button"
                          disabled={apiPage >= totalPages}
                          onClick={() => updateFilters({ page: apiPage + 1 }, false)}
                          aria-label="Trang tiếp"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-slate-300 transition-all hover:bg-[#E63946]/15 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                        >
                          <MangaIcon name="chevron-right" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={apiPage >= totalPages}
                          onClick={() => updateFilters({ page: totalPages }, false)}
                          aria-label="Trang cuối"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-slate-300 transition-all hover:bg-[#E63946]/15 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                        >
                          <MangaIcon name="chevrons-right" className="h-4 w-4" />
                        </button>
                      </nav>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </StoreLayout>
  );
}

export default ProductsPage;
