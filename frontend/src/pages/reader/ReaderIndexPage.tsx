import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { use3DTilt } from "../../hooks/use3DTilt";
import { ApiError, apiClient, request } from "../../lib/api";
import { formatCompactNumber, formatDateTime } from "../../lib/format";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { PanelBadge } from "../../components/ui/PanelBadge";
import { StoreLayout } from "../../components/layout/StoreLayout";
import type {
  ClassifiedTagItem,
  ReaderBookmarkDto,
  ReaderHistoryDto,
  ReaderMangaSummary,
  ReaderSourceInfo,
  ReaderTagDto,
} from "../../types/api";

const DEFAULT_COVER_URL = "/covers/default-manga.svg";

type ReaderTab = "explore" | "history" | "bookmarks" | "cross-search";
type TagDomainTab = "reader" | "store";
type ShelfCategory = "all" | "reading" | "plan" | "favorite" | "completed";

interface BrowseResponsePayload {
  source?: ReaderSourceInfo;
  items: ReaderMangaSummary[];
  available_tags?: ReaderTagDto[];
  page?: number;
  current_page?: number;
  page_size?: number;
  total_items?: number;
  has_next_page?: boolean;
  error_message?: string | null;
}

interface DualTagsResponsePayload {
  reader_tags?: Array<
    ClassifiedTagItem & {
      vietnamese_name?: string;
      raw_group?: string;
    }
  >;
  store_tags?: Array<
    ClassifiedTagItem & {
      filter_id?: string;
    }
  >;
  is_store_db_online?: boolean;
  store_db_message?: string | null;
}

interface ShelfResponsePayload {
  history: ReaderHistoryDto[];
  bookmarks: ReaderBookmarkDto[];
  total_bookmarks: number;
}

interface CrossSearchGroup {
  source_id: string;
  source_name: string;
  items: ReaderMangaSummary[];
  error_message?: string | null;
}

interface CrossSearchResponsePayload {
  query: string;
  groups: CrossSearchGroup[];
  items: ReaderMangaSummary[];
  total_items: number;
}

const DEMOGRAPHICS = [
  { value: "", label: "Tất cả" },
  { value: "shounen", label: "Shounen" },
  { value: "seinen", label: "Seinen" },
  { value: "shoujo", label: "Shoujo" },
  { value: "josei", label: "Josei" },
] as const;

const STATUS_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "ongoing", label: "Đang tiến hành" },
  { value: "completed", label: "Hoàn thành" },
] as const;

const SORT_OPTIONS = [
  { value: "popular", label: "Phổ biến" },
  { value: "latest", label: "Mới cập nhật" },
  { value: "rating", label: "Đánh giá cao" },
] as const;

const BOOKMARK_CATEGORIES: ReadonlyArray<{ value: ShelfCategory; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "reading", label: "Đang đọc" },
  { value: "plan", label: "Dự định đọc" },
  { value: "favorite", label: "Yêu thích" },
  { value: "completed", label: "Hoàn thành" },
];

const BOOKMARK_CATEGORY_LABELS: Record<string, string> = {
  reading: "Đang đọc",
  plan: "Dự định đọc",
  favorite: "Yêu thích",
  completed: "Hoàn thành",
};

const READER_GROUP_ORDER = ["Đối tượng", "Định dạng", "Thể loại", "Chủ đề"];

function resolveSourceAssetKey(sourceId: string): string {
  switch (sourceId.trim().toLowerCase()) {
    case "mangadex-vi":
    case "mangadex-en":
      return "src-mangadex";
    case "nettruyen":
      return "src-nettruyen";
    case "nhattruyen":
      return "src-nhattruyen";
    case "truyenqq":
      return "src-truyenqq";
    case "archive-manga":
      return "src-archive";
    case "local-db":
      return "src-local-store";
    default:
      return "src-mangadex";
  }
}

function buildMangaKey(sourceId: string, mangaId: string): string {
  return `${sourceId.trim().toLowerCase()}|${mangaId.trim()}`;
}

function normalizeTab(raw: string | null): ReaderTab {
  switch ((raw || "").trim().toLowerCase()) {
    case "history":
      return "history";
    case "bookmarks":
      return "bookmarks";
    case "cross-search":
      return "cross-search";
    default:
      return "explore";
  }
}

function normalizeShelfCategory(raw: string | null): ShelfCategory {
  switch ((raw || "").trim().toLowerCase()) {
    case "reading":
      return "reading";
    case "plan":
      return "plan";
    case "favorite":
      return "favorite";
    case "completed":
      return "completed";
    default:
      return "all";
  }
}

function formatReaderRating(rating: number | null | undefined, ratingMax = 5): string {
  if (rating === null || rating === undefined || !Number.isFinite(rating) || rating <= 0) {
    return "—";
  }
  const formatted = rating.toFixed(1);
  return ratingMax === 10 ? `${formatted}/10` : formatted;
}

function normalizeTagDisplay(rawTag: unknown): { id: string; label: string } | null {
  if (typeof rawTag === "string") {
    const clean = rawTag.trim();
    return clean ? { id: clean, label: clean } : null;
  }
  if (rawTag && typeof rawTag === "object") {
    const obj = rawTag as Record<string, unknown>;
    const id = String(obj.id ?? obj.name ?? "").trim();
    const label = String(obj.vietnamese_name ?? obj.display_name ?? obj.name ?? id).trim();
    if (!label) return null;
    return { id: id || label, label };
  }
  return null;
}

function resolveStoreTagHref(tag: ClassifiedTagItem): string {
  if (tag.target_url && tag.target_url.trim()) {
    return tag.target_url.trim();
  }
  if (tag.group === "Nhãn cửa hàng" || tag.id.startsWith("store-tag-")) {
    return `/products?tag=${encodeURIComponent(tag.name)}`;
  }
  return `/products?categories=${encodeURIComponent(tag.name)}`;
}

interface ReaderMangaCardProps {
  item: ReaderMangaSummary;
  fallbackSourceId: string;
  historyItem?: ReaderHistoryDto;
}

function ReaderMangaCard({ item, fallbackSourceId, historyItem }: ReaderMangaCardProps) {
  const { ref, onPointerEnter, onPointerMove, onPointerLeave } =
    use3DTilt<HTMLElement>({ maxTilt: 6, liftY: -4 });
  const normalizedCover = item.cover_url?.trim() || DEFAULT_COVER_URL;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const coverSrc = failedSrc === normalizedCover ? DEFAULT_COVER_URL : normalizedCover;

  const cardSourceId = item.source_id?.trim() || fallbackSourceId;
  const statusText = (item.status_label || item.status || "").trim();
  const detailHref = `/doc-truyen/chi-tiet?source=${encodeURIComponent(cardSourceId)}&id=${encodeURIComponent(item.id)}`;

  const parsedTags = useMemo(() => {
    const rawList = (item.tags ?? []) as unknown[];
    const list: Array<{ id: string; label: string }> = [];
    for (const raw of rawList) {
      const parsed = normalizeTagDisplay(raw);
      if (parsed) list.push(parsed);
      if (list.length >= 2) break;
    }
    return list;
  }, [item.tags]);

  return (
    <article
      ref={ref}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="ms-card-3d ms-card-3d-cyan group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#131722]/85 shadow-lg backdrop-blur-xl"
    >
      <div className="ms-3d-glare" aria-hidden="true" />
      <Link
        to={detailHref}
        className="relative block aspect-[2/3] overflow-hidden rounded-t-2xl bg-[#1B2130]"
      >
        <img
          src={coverSrc}
          alt={item.title}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            if (coverSrc !== DEFAULT_COVER_URL) {
              setFailedSrc(normalizedCover);
            }
          }}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#0B0D14]/90 via-[#0B0D14]/40 to-transparent"
          aria-hidden="true"
        />

        {item.language ? (
          <span className="absolute left-2.5 top-2.5 rounded-lg border border-white/15 bg-[#0B0D14]/85 px-2 py-0.5 text-[10px] font-bold uppercase text-cyan-200 backdrop-blur-sm">
            {item.language}
          </span>
        ) : null}

        {statusText ? (
          <span className="absolute right-2.5 top-2.5 max-w-[58%] truncate rounded-lg bg-sky-500/80 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            {statusText}
          </span>
        ) : null}

        {historyItem?.chapter_label ? (
          <span className="absolute bottom-2.5 left-2.5 max-w-[85%] truncate rounded-lg bg-emerald-500/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
            Đọc tiếp: {historyItem.chapter_label}
          </span>
        ) : null}
      </Link>

      <div className="flex flex-1 flex-col justify-between gap-2 p-3.5">
        <div>
          <Link to={detailHref} className="block">
            <h3 className="line-clamp-2 text-sm font-semibold text-white transition-colors group-hover:text-cyan-300">
              {item.title}
            </h3>
          </Link>
          {item.author ? (
            <p className="mt-1 truncate text-xs text-slate-400">{item.author}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-300">
            <span className="inline-flex items-center gap-1 font-medium text-amber-300" title="Đánh giá">
              <MangaIcon name="star" className="h-3.5 w-3.5 text-amber-400" />
              <span>{formatReaderRating(item.rating, item.rating_max)}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-cyan-200/90" title="Lượt đọc">
              <MangaIcon name="eye" className="h-3.5 w-3.5 text-cyan-400" />
              <span>{formatCompactNumber(item.view_count)}</span>
            </span>
            {item.follow_count && item.follow_count > 0 ? (
              <span className="inline-flex items-center gap-1 text-rose-300" title="Theo dõi">
                <MangaIcon name="heart" className="h-3.5 w-3.5 text-rose-400" />
                <span>{formatCompactNumber(item.follow_count)}</span>
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 text-slate-400" title="Bình luận">
              <MangaIcon name="message-circle" className="h-3.5 w-3.5 text-slate-400" />
              <span>{formatCompactNumber(item.comment_count)}</span>
            </span>
          </div>
        </div>

        {parsedTags.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {parsedTags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300"
              >
                {tag.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ReaderIndexPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { showToast } = useToast();

  const activeSourceId = (searchParams.get("source") || "mangadex-vi").trim() || "mangadex-vi";
  const activeTab = normalizeTab(searchParams.get("tab"));
  const activeTagTab: TagDomainTab =
    searchParams.get("tagTab")?.toLowerCase() === "store" ? "store" : "reader";
  const selectedShelfCategory = normalizeShelfCategory(searchParams.get("shelfCategory"));
  const activeKeyword = (searchParams.get("q") || "").trim();
  const activeTagId = (searchParams.get("tag") || "").trim();
  const activeDemographic = (searchParams.get("demographic") || "").trim();
  const activeStatus = (searchParams.get("status") || "").trim();
  const activeSort = (searchParams.get("sort") || "popular").trim() || "popular";
  const rawPage = Number.parseInt(searchParams.get("page") || "1", 10);
  const currentPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const [searchInput, setSearchInput] = useState(activeKeyword);
  const [showAllTags, setShowAllTags] = useState(false);

  const [sources, setSources] = useState<ReaderSourceInfo[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);

  const [readerTags, setReaderTags] = useState<ClassifiedTagItem[]>([]);
  const [storeTags, setStoreTags] = useState<ClassifiedTagItem[]>([]);
  const [isStoreOnline, setIsStoreOnline] = useState(true);
  const [storeDbMsg, setStoreDbMsg] = useState<string | null>(null);
  const [tagsLoading, setTagsLoading] = useState(true);

  const [browseResult, setBrowseResult] = useState<BrowseResponsePayload | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browseTick, setBrowseTick] = useState(0);

  const [crossSearchData, setCrossSearchData] = useState<CrossSearchResponsePayload | null>(null);
  const [crossSearchLoading, setCrossSearchLoading] = useState(false);
  const [crossSearchError, setCrossSearchError] = useState<string | null>(null);

  const [historyItems, setHistoryItems] = useState<ReaderHistoryDto[]>([]);
  const [allBookmarks, setAllBookmarks] = useState<ReaderBookmarkDto[]>([]);
  const [shelfLoading, setShelfLoading] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    setSearchInput(activeKeyword);
  }, [activeKeyword]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>, replace = false) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === "") {
              next.delete(key);
            } else {
              next.set(key, value);
            }
          }
          return next;
        },
        { replace }
      );
    },
    [setSearchParams]
  );

  // Live debounce search only on Explore tab
  useEffect(() => {
    if (activeTab !== "explore") return;
    const trimmed = searchInput.trim();
    if (trimmed === activeKeyword) return;

    const timer = window.setTimeout(() => {
      updateParams({ q: trimmed || null, page: null }, true);
    }, 450);

    return () => window.clearTimeout(timer);
  }, [searchInput, activeKeyword, activeTab, updateParams]);

  // Load sources
  useEffect(() => {
    const controller = new AbortController();
    setSourcesLoading(true);
    request<ReaderSourceInfo[] | { sources?: ReaderSourceInfo[] }>("/api/reader/sources", {
      method: "GET",
      signal: controller.signal,
    })
      .then((res) => {
        const list = Array.isArray(res) ? res : res.sources ?? [];
        setSources(list);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSources([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSourcesLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  // Load dual tag classification
  useEffect(() => {
    const controller = new AbortController();
    setTagsLoading(true);
    request<DualTagsResponsePayload>("/api/reader/tags", {
      method: "GET",
      signal: controller.signal,
    })
      .then((res) => {
        setReaderTags(res.reader_tags ?? []);
        setStoreTags(res.store_tags ?? []);
        setIsStoreOnline(res.is_store_db_online !== false);
        setStoreDbMsg(res.store_db_message ?? null);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setReaderTags([]);
        setStoreTags([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setTagsLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  const loadShelf = useCallback(async () => {
    if (!user) {
      setHistoryItems([]);
      setAllBookmarks([]);
      return;
    }
    setShelfLoading(true);
    try {
      const data = await apiClient.get<ShelfResponsePayload>("/api/reader/shelf");
      setHistoryItems(data.history ?? []);
      setAllBookmarks(data.bookmarks ?? []);
    } catch {
      // Keep prior state or empty on transient errors
    } finally {
      setShelfLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadShelf();
  }, [loadShelf]);

  const activeSourceInfo = useMemo(() => {
    return (
      browseResult?.source ||
      sources.find((s) => s.id.toLowerCase() === activeSourceId.toLowerCase()) ||
      null
    );
  }, [browseResult?.source, sources, activeSourceId]);

  const supportsDemographic = Boolean(activeSourceInfo?.supports_demographic);
  const supportsStatus = Boolean(activeSourceInfo?.supports_status);
  const supportsSort = activeSourceInfo ? activeSourceInfo.supports_sort : true;

  // Browse Explore
  useEffect(() => {
    if (activeTab !== "explore") return;
    const controller = new AbortController();
    setBrowseLoading(true);
    setBrowseError(null);

    const params = new URLSearchParams();
    params.set("source", activeSourceId);
    params.set("sort", activeSort);
    params.set("page", String(currentPage));
    params.set("page_size", "24");
    if (activeKeyword) params.set("q", activeKeyword);
    if (activeTagId) params.set("tag", activeTagId);
    if (activeDemographic) params.set("demographic", activeDemographic);
    if (activeStatus) params.set("status", activeStatus);

    request<BrowseResponsePayload>(`/api/reader/browse?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
    })
      .then((res) => {
        setBrowseResult(res);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setBrowseResult(null);
        setBrowseError(
          err instanceof ApiError
            ? err.message
            : "Không thể kết nối tới nguồn truyện. Vui lòng thử lại hoặc chuyển sang Kho nội bộ."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBrowseLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    activeTab,
    activeSourceId,
    activeKeyword,
    activeTagId,
    activeDemographic,
    activeStatus,
    activeSort,
    currentPage,
    browseTick,
  ]);

  // Cross-search
  useEffect(() => {
    if (activeTab !== "cross-search") return;
    if (!activeKeyword) {
      setCrossSearchData(null);
      setCrossSearchError(null);
      setCrossSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    setCrossSearchLoading(true);
    setCrossSearchError(null);

    request<CrossSearchResponsePayload>(
      `/api/reader/cross-search?q=${encodeURIComponent(activeKeyword)}&limit=8`,
      {
        method: "GET",
        signal: controller.signal,
      }
    )
      .then((res) => {
        setCrossSearchData(res);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setCrossSearchData(null);
        setCrossSearchError(
          err instanceof ApiError ? err.message : "Tìm kiếm đa nguồn thất bại. Vui lòng thử lại."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setCrossSearchLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeTab, activeKeyword]);

  const sourceNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sources) {
      map.set(s.id.toLowerCase(), s.display_name || s.id);
    }
    return map;
  }, [sources]);

  const historyByKey = useMemo(() => {
    const map = new Map<string, ReaderHistoryDto>();
    for (const item of historyItems) {
      const key = buildMangaKey(item.source_id, item.manga_id);
      if (!map.has(key)) {
        map.set(key, item);
      }
    }
    return map;
  }, [historyItems]);

  const filteredBookmarks = useMemo(() => {
    if (selectedShelfCategory === "all") return allBookmarks;
    return allBookmarks.filter((b) => b.category.toLowerCase() === selectedShelfCategory);
  }, [allBookmarks, selectedShelfCategory]);

  const groupedReaderTags = useMemo(() => {
    const groups = new Map<string, ClassifiedTagItem[]>();
    for (const tag of readerTags) {
      const grp = (tag.group || "Khác").trim() || "Khác";
      const list = groups.get(grp) ?? [];
      list.push(tag);
      groups.set(grp, list);
    }
    const orderedKeys: string[] = [];
    for (const preferred of READER_GROUP_ORDER) {
      if (groups.has(preferred)) orderedKeys.push(preferred);
    }
    for (const key of groups.keys()) {
      if (!orderedKeys.includes(key)) orderedKeys.push(key);
    }
    return orderedKeys.map((key) => ({ group: key, items: groups.get(key) ?? [] }));
  }, [readerTags]);

  const groupedStoreTags = useMemo(() => {
    const groups = new Map<string, ClassifiedTagItem[]>();
    for (const tag of storeTags) {
      const grp = (tag.group || "Danh mục").trim() || "Danh mục";
      const list = groups.get(grp) ?? [];
      list.push(tag);
      groups.set(grp, list);
    }
    return Array.from(groups.entries()).map(([group, items]) => ({ group, items }));
  }, [storeTags]);

  const availableTags = browseResult?.available_tags ?? [];
  const { primaryTags, overflowTags } = useMemo(() => {
    const primary: ReaderTagDto[] = [];
    const overflow: ReaderTagDto[] = [];
    for (const t of availableTags) {
      if (primary.length < 12 || (activeTagId && t.id.toLowerCase() === activeTagId.toLowerCase())) {
        primary.push(t);
      } else {
        overflow.push(t);
      }
    }
    return { primaryTags: primary, overflowTags: overflow };
  }, [availableTags, activeTagId]);

  const hasAnyFilter = Boolean(
    activeKeyword ||
      activeTagId ||
      (supportsDemographic && activeDemographic) ||
      (supportsStatus && activeStatus)
  );

  const handleHeaderSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleaned = searchInput.trim();
    updateParams({
      q: cleaned || null,
      tab: activeTab === "cross-search" ? "cross-search" : "explore",
      page: null,
    });
  };

  const handleRemoveHistoryItem = async (sourceId: string, mangaId: string) => {
    const key = buildMangaKey(sourceId, mangaId);
    setBusyKey(key);
    try {
      await apiClient.del<{ message: string }>(
        `/api/reader/history?source=${encodeURIComponent(sourceId)}&manga_id=${encodeURIComponent(mangaId)}`
      );
      setHistoryItems((prev) =>
        prev.filter((h) => buildMangaKey(h.source_id, h.manga_id) !== key)
      );
      showToast("Đã xóa truyện khỏi lịch sử đọc.", "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể xóa mục lịch sử.", "error");
    } finally {
      setBusyKey(null);
    }
  };

  const handleConfirmClearHistory = async () => {
    setClearingHistory(true);
    try {
      await apiClient.del<{ message: string }>("/api/reader/history/clear");
      setHistoryItems([]);
      setClearDialogOpen(false);
      showToast("Đã xóa toàn bộ lịch sử đọc.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể xóa toàn bộ lịch sử.", "error");
    } finally {
      setClearingHistory(false);
    }
  };

  const handleRemoveBookmark = async (bm: ReaderBookmarkDto) => {
    const key = buildMangaKey(bm.source_id, bm.manga_id);
    setBusyKey(key);
    try {
      await apiClient.post("/api/reader/bookmarks", {
        source_id: bm.source_id,
        manga_id: bm.manga_id,
        title: bm.title,
        cover_url: bm.cover_url,
        author: bm.author,
        status_label: bm.status_label,
        category: "none",
      });
      setAllBookmarks((prev) =>
        prev.filter((item) => buildMangaKey(item.source_id, item.manga_id) !== key)
      );
      showToast("Đã gỡ truyện khỏi kệ sách.", "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể gỡ khỏi kệ sách.", "error");
    } finally {
      setBusyKey(null);
    }
  };

  const items = browseResult?.items ?? [];
  const effectiveError = browseError || browseResult?.error_message || null;
  const resolvedPage = browseResult?.page ?? browseResult?.current_page ?? currentPage;

  return (
    <StoreLayout>
      <section className="min-h-screen bg-transparent pb-16">
        {/* Top Hero Banner + Dual Switcher + Live Search */}
        <div className="relative overflow-hidden border-b border-white/10 bg-[#0B0D14]/90 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0">
            <img
              src="/content/banners/hero-online-reader.png"
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover object-center opacity-30"
            />
            <div className="ms-manga-banner-overlay absolute inset-0" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0B0D14]/85 via-[#0B0D14]/50 to-cyan-950/35" />
          </div>

          <div className="relative z-10 mx-auto max-w-7xl px-4 py-5 sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => updateParams({ tab: "explore", page: null })}
                  className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2.5 rounded-2xl border px-4 py-2 text-sm font-semibold text-white"
                >
                  <PanelBadge asset="mode-reader" className="h-6 w-6" />
                  <span>Đọc truyện Online</span>
                </button>
                <Link
                  to="/products"
                  className="ms-btn-2d ms-btn-2d-dark inline-flex items-center gap-2.5 rounded-2xl border px-4 py-2 text-sm font-semibold text-rose-100 hover:border-[#E63946]/60"
                >
                  <PanelBadge asset="mode-store" className="h-6 w-6" />
                  <span>Cửa hàng Mua truyện</span>
                </Link>
              </div>

              <form onSubmit={handleHeaderSearchSubmit} className="w-full lg:max-w-lg">
                <div className="relative flex items-center">
                  <MangaIcon
                    name="search"
                    className="pointer-events-none absolute left-4 h-4 w-4 text-cyan-300/80"
                  />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Tìm truyện đọc online, tên tác giả..."
                    aria-label="Tìm truyện đọc online"
                    autoComplete="off"
                    className="h-11 w-full rounded-2xl border border-white/15 bg-[#0B0D14]/85 pl-11 pr-32 text-sm text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                  />
                  {searchInput ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchInput("");
                        updateParams({ q: null, page: null });
                      }}
                      aria-label="Xóa từ khóa"
                      className="absolute right-24 rounded-lg p-1 text-slate-400 hover:text-white"
                    >
                      <MangaIcon name="x" className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    className="ms-btn-2d ms-btn-2d-cyan absolute right-1.5 inline-flex h-8 items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold text-white"
                  >
                    <MangaIcon name="search" className="h-3.5 w-3.5" />
                    <span>Tìm kiếm</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* 2-Column 3:9 Layout */}
        <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Sticky Sidebar */}
            <aside className="lg:col-span-3">
              <div className="space-y-5 lg:sticky lg:top-24">
                {/* 1. Kệ sách cá nhân */}
                <div className="ms-panel-2d rounded-2xl border border-white/10 bg-[#131722]/85 p-4 shadow-xl backdrop-blur-xl">
                  <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-300">
                    <MangaIcon name="library" className="h-4 w-4" />
                    <span>Kệ sách cá nhân</span>
                  </h2>
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                    <button
                      type="button"
                      onClick={() => updateParams({ tab: "explore", page: null })}
                      className={`ms-btn-2d flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                        activeTab === "explore"
                          ? "ms-btn-2d-cyan font-semibold text-white"
                          : "ms-btn-2d-dark font-medium text-slate-200 hover:border-cyan-400/50"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <PanelBadge asset="shelf-explore" className="h-7 w-7" />
                        <span>Khám phá nguồn</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => updateParams({ tab: "history" })}
                      className={`ms-btn-2d flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                        activeTab === "history"
                          ? "ms-btn-2d-cyan font-semibold text-white"
                          : "ms-btn-2d-dark font-medium text-slate-200 hover:border-cyan-400/50"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <PanelBadge asset="shelf-history" className="h-7 w-7" />
                        <span>Lịch sử đọc</span>
                      </span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">
                        {historyItems.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => updateParams({ tab: "bookmarks" })}
                      className={`ms-btn-2d flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                        activeTab === "bookmarks"
                          ? "ms-btn-2d-cyan font-semibold text-white"
                          : "ms-btn-2d-dark font-medium text-slate-200 hover:border-cyan-400/50"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <PanelBadge asset="shelf-bookmarks" className="h-7 w-7" />
                        <span>Kệ sách đã lưu</span>
                      </span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">
                        {allBookmarks.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => updateParams({ tab: "cross-search" })}
                      className={`ms-btn-2d flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                        activeTab === "cross-search"
                          ? "ms-btn-2d-cyan font-semibold text-white"
                          : "ms-btn-2d-dark font-medium text-slate-200 hover:border-cyan-400/50"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <PanelBadge asset="shelf-cross-search" className="h-7 w-7" />
                        <span>Tìm đa nguồn</span>
                      </span>
                    </button>
                  </div>

                  {!user ? (
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0B0D14]/65 px-3 py-2 text-[11px] text-slate-400">
                      <span>Đăng nhập để lưu kệ sách &amp; lịch sử</span>
                      <Link to="/auth" className="shrink-0 font-semibold text-cyan-300 hover:text-cyan-200">
                        Đăng nhập
                      </Link>
                    </div>
                  ) : null}
                </div>

                {/* 2. Nguồn truyện tranh */}
                <div className="ms-panel-2d rounded-2xl border border-white/10 bg-[#131722]/85 p-4 shadow-xl backdrop-blur-xl">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-300">
                      <MangaIcon name="layers" className="h-4 w-4" />
                      <span>Nguồn truyện tranh</span>
                    </h2>
                    {activeSourceId !== "local-db" ? (
                      <button
                        type="button"
                        onClick={() =>
                          updateParams({
                            source: "local-db",
                            tag: null,
                            demographic: null,
                            status: null,
                            page: null,
                            tab: "explore",
                          })
                        }
                        className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/20"
                      >
                        Kho nội bộ
                      </button>
                    ) : null}
                  </div>

                  {sourcesLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3, 4].map((idx) => (
                        <div
                          key={idx}
                          className="h-12 animate-pulse rounded-xl border border-white/10 bg-[#0B0D14]/60"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sources.map((src) => {
                        const isActiveSrc =
                          src.id.toLowerCase() === activeSourceId.toLowerCase();
                        return (
                          <button
                            key={src.id}
                            type="button"
                            onClick={() =>
                              updateParams({
                                source: src.id,
                                tag: null,
                                demographic: null,
                                status: null,
                                page: null,
                                tab: "explore",
                              })
                            }
                            className={`ms-btn-2d block w-full rounded-xl border px-3 py-2.5 text-left ${
                              isActiveSrc
                                ? "ms-btn-2d-cyan"
                                : "ms-btn-2d-dark hover:border-cyan-400/45"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span className="ms-source-emblem-wrap">
                                  <PanelBadge
                                    asset={resolveSourceAssetKey(src.id)}
                                    className="h-7 w-7"
                                  />
                                  <span
                                    className={`ms-source-dot ${
                                      src.is_available ? "bg-emerald-400" : "bg-rose-500"
                                    }`}
                                  />
                                </span>
                                <span
                                  className={`truncate text-sm font-semibold ${
                                    isActiveSrc ? "text-cyan-100" : "text-slate-100"
                                  }`}
                                >
                                  {src.display_name}
                                </span>
                              </div>
                              {src.language_badge ? (
                                <span className="shrink-0 rounded-md border border-white/15 bg-slate-950/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-300">
                                  {src.language_badge}
                                </span>
                              ) : null}
                            </div>
                            {!src.is_available || src.status_message ? (
                              <p
                                className={`mt-1 text-xs ${
                                  src.is_available ? "text-slate-400" : "text-rose-300"
                                }`}
                              >
                                {src.status_message || "Nguồn hiện tạm ngoại tuyến"}
                              </p>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 3. Bảng Phân Loại Tag */}
                <div className="ms-panel-2d rounded-2xl border border-white/10 bg-[#131722]/85 p-4 shadow-xl backdrop-blur-xl">
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => updateParams({ tagTab: "reader" }, true)}
                      className={`ms-btn-2d inline-flex items-center justify-center gap-2 rounded-xl border px-2.5 py-2 text-xs font-semibold ${
                        activeTagTab === "reader"
                          ? "ms-btn-2d-cyan text-white"
                          : "ms-btn-2d-dark text-slate-300 hover:border-cyan-400/45 hover:text-white"
                      }`}
                    >
                      <PanelBadge asset="tab-reader-tags" className="h-5 w-5" />
                      <span>Thể loại đọc</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateParams({ tagTab: "store" }, true)}
                      className={`ms-btn-2d inline-flex items-center justify-center gap-2 rounded-xl border px-2.5 py-2 text-xs font-semibold ${
                        activeTagTab === "store"
                          ? "ms-btn-2d-crimson text-white"
                          : "ms-btn-2d-dark text-slate-300 hover:border-[#E63946]/50 hover:text-white"
                      }`}
                    >
                      <PanelBadge asset="tab-store-tags" className="h-5 w-5" />
                      <span>Danh mục cửa hàng</span>
                    </button>
                  </div>

                  {tagsLoading ? (
                    <div className="space-y-2 py-2">
                      <div className="h-6 w-24 animate-pulse rounded bg-white/10" />
                      <div className="flex flex-wrap gap-1.5">
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                          <div key={n} className="h-6 w-16 animate-pulse rounded-lg bg-white/5" />
                        ))}
                      </div>
                    </div>
                  ) : activeTagTab === "reader" ? (
                    <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
                      {groupedReaderTags.length === 0 ? (
                        <p className="text-xs text-slate-400">
                          Chưa có danh sách thể loại cho nguồn này.
                        </p>
                      ) : (
                        groupedReaderTags.map((grp) => (
                          <div key={grp.group}>
                            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                              {grp.group}
                            </h3>
                            <div className="flex flex-wrap gap-1.5">
                              {grp.items.map((t) => {
                                const label = t.display_name || t.name;
                                const isDemoItem =
                                  grp.group.toLowerCase() === "đối tượng";
                                const isSelected = isDemoItem
                                  ? t.id.toLowerCase() === activeDemographic.toLowerCase()
                                  : t.id.toLowerCase() === activeTagId.toLowerCase();
                                return (
                                  <button
                                    key={t.id}
                                    type="button"
                                    onClick={() =>
                                      updateParams({
                                        tab: "explore",
                                        tagTab: "reader",
                                        page: null,
                                        demographic: isDemoItem
                                          ? isSelected
                                            ? null
                                            : t.id
                                          : activeDemographic || null,
                                        tag: isDemoItem
                                          ? activeTagId || null
                                          : isSelected
                                            ? null
                                            : t.id,
                                      })
                                    }
                                    className={`ms-pill-2d inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs ${
                                      isSelected
                                        ? "ms-pill-2d-active-cyan font-semibold text-cyan-100"
                                        : "border-white/10 text-slate-300 hover:border-cyan-400/50 hover:text-white"
                                    }`}
                                  >
                                    <span>{label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
                      {!isStoreOnline ? (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                          <p className="font-medium">
                            {storeDbMsg || "Cửa hàng tạm thời không khả dụng."}
                          </p>
                          <Link
                            to="/products"
                            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-rose-300 hover:text-rose-200"
                          >
                            <span>Mở trang Cửa hàng</span>
                            <MangaIcon name="arrow-right" className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      ) : groupedStoreTags.length === 0 ? (
                        <p className="text-xs text-slate-400">
                          Hiện chưa có danh mục thể loại từ cửa hàng.
                        </p>
                      ) : (
                        groupedStoreTags.map((grp) => (
                          <div key={grp.group}>
                            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                              {grp.group}
                            </h3>
                            <div className="flex flex-wrap gap-1.5">
                              {grp.items.map((sTag) => (
                                <Link
                                  key={sTag.id}
                                  to={resolveStoreTagHref(sTag)}
                                  className="ms-pill-2d inline-flex items-center gap-1.5 rounded-lg border border-[#E63946]/35 px-2.5 py-1 text-xs text-rose-200 hover:border-[#E63946]/65 hover:text-white"
                                >
                                  <span>{sTag.display_name || sTag.name}</span>
                                  {sTag.item_count && sTag.item_count > 0 ? (
                                    <span className="rounded bg-white/10 px-1 text-[10px] text-rose-100">
                                      {sTag.item_count}
                                    </span>
                                  ) : null}
                                </Link>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </aside>

            {/* Right Main Area */}
            <div className="space-y-5 lg:col-span-9">
              {activeTab === "history" ? (
                <div className="space-y-4">
                  <div className="ms-panel-2d flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#131722]/85 p-4 backdrop-blur-xl">
                    <h2 className="text-lg font-bold text-white">
                      Lịch sử đọc gần đây ({historyItems.length})
                    </h2>
                    {user && historyItems.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setClearDialogOpen(true)}
                        className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold text-rose-100"
                      >
                        <MangaIcon name="trash-2" className="h-3.5 w-3.5" />
                        <span>Xóa toàn bộ lịch sử</span>
                      </button>
                    ) : null}
                  </div>

                  {!user ? (
                    <div className="ms-panel-2d space-y-4 rounded-2xl border border-white/10 bg-[#131722]/85 p-10 text-center backdrop-blur-xl">
                      <MangaIcon name="lock" className="mx-auto h-10 w-10 text-cyan-300" />
                      <h3 className="text-base font-bold text-white">
                        Đăng nhập để xem lịch sử đọc
                      </h3>
                      <p className="mx-auto max-w-md text-sm text-slate-400">
                        Lịch sử đọc truyện của bạn được đồng bộ trong cơ sở dữ liệu tài khoản.
                      </p>
                      <Link
                        to="/auth"
                        className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold text-white"
                      >
                        <MangaIcon name="log-in" className="h-4 w-4" />
                        <span>Đăng nhập ngay</span>
                      </Link>
                    </div>
                  ) : shelfLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="h-24 animate-pulse rounded-2xl border border-white/10 bg-[#131722]/85"
                        />
                      ))}
                    </div>
                  ) : historyItems.length === 0 ? (
                    <div className="ms-panel-2d space-y-4 rounded-2xl border border-white/10 bg-[#131722]/85 p-10 text-center backdrop-blur-xl">
                      <img
                        src="/content/icons/spots/spot-empty-shelf.svg"
                        alt=""
                        aria-hidden="true"
                        className="ms-float-3d mx-auto h-28 w-36 object-contain"
                      />
                      <p className="text-sm text-slate-400">
                        Bạn chưa đọc bộ truyện nào gần đây.
                      </p>
                      <button
                        type="button"
                        onClick={() => updateParams({ tab: "explore" })}
                        className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold text-white"
                      >
                        <span>Khám phá truyện ngay</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {historyItems.map((h) => {
                        const key = buildMangaKey(h.source_id, h.manga_id);
                        const hTitle = h.title?.trim() || "Chưa rõ tên truyện";
                        const hPage = h.current_page > 0 ? h.current_page : 1;
                        const detailHref = `/doc-truyen/chi-tiet?source=${encodeURIComponent(h.source_id)}&id=${encodeURIComponent(h.manga_id)}${h.language ? `&lang=${encodeURIComponent(h.language)}` : ""}`;
                        const readHref = `/doc-truyen/doc?source=${encodeURIComponent(h.source_id)}&mangaId=${encodeURIComponent(h.manga_id)}&chapterId=${encodeURIComponent(h.chapter_id)}${h.language ? `&lang=${encodeURIComponent(h.language)}` : ""}&page=${hPage}`;
                        const sourceLabel =
                          sourceNameMap.get(h.source_id.toLowerCase()) || h.source_id;

                        return (
                          <div
                            key={key}
                            className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#131722]/85 p-3.5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex min-w-0 items-center gap-3.5">
                              <Link
                                to={detailHref}
                                className="h-20 w-14 shrink-0 overflow-hidden rounded-xl bg-[#1B2130]"
                              >
                                <img
                                  src={h.cover_url || DEFAULT_COVER_URL}
                                  alt={hTitle}
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    e.currentTarget.onerror = null;
                                    e.currentTarget.src = DEFAULT_COVER_URL;
                                  }}
                                  className="h-full w-full object-cover"
                                />
                              </Link>
                              <div className="min-w-0 space-y-1">
                                <Link
                                  to={detailHref}
                                  className="block truncate text-sm font-semibold text-white hover:text-cyan-300"
                                >
                                  {hTitle}
                                </Link>
                                <p className="text-xs text-cyan-200">
                                  {h.chapter_label || "Đã mở chương"}
                                  {h.total_pages > 0
                                    ? ` • Trang ${hPage}/${h.total_pages}`
                                    : hPage > 1
                                      ? ` • Trang ${hPage}`
                                      : ""}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                  {sourceLabel}
                                  {h.updated_at ? ` • ${formatDateTime(h.updated_at)}` : ""}
                                </p>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                              {h.chapter_id ? (
                                <Link
                                  to={readHref}
                                  className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold text-white"
                                >
                                  <MangaIcon name="play" className="h-3.5 w-3.5" />
                                  <span>Đọc tiếp (Trang {hPage})</span>
                                </Link>
                              ) : null}
                              <button
                                type="button"
                                disabled={busyKey === key}
                                onClick={() => void handleRemoveHistoryItem(h.source_id, h.manga_id)}
                                title="Xóa khỏi lịch sử"
                                aria-label={`Xóa ${hTitle} khỏi lịch sử`}
                                className="ms-btn-2d ms-btn-2d-dark inline-flex items-center justify-center rounded-xl border p-2 text-slate-300 hover:border-rose-400/50 hover:text-rose-300 disabled:opacity-50"
                              >
                                <MangaIcon name="x" className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : activeTab === "bookmarks" ? (
                <div className="space-y-4">
                  <div className="ms-panel-2d space-y-3 rounded-2xl border border-white/10 bg-[#131722]/85 p-4 backdrop-blur-xl">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-lg font-bold text-white">Kệ sách đã lưu</h2>
                      <span className="text-xs text-slate-400">
                        {filteredBookmarks.length} truyện
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {BOOKMARK_CATEGORIES.map((cat) => {
                        const active = cat.value === selectedShelfCategory;
                        return (
                          <button
                            key={cat.value}
                            type="button"
                            onClick={() => updateParams({ shelfCategory: cat.value }, true)}
                            className={`ms-pill-2d rounded-xl border px-3 py-1.5 text-xs ${
                              active
                                ? "ms-pill-2d-active-cyan font-semibold text-cyan-100"
                                : "border-white/10 font-medium text-slate-300 hover:border-white/25 hover:text-white"
                            }`}
                          >
                            {cat.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {!user ? (
                    <div className="ms-panel-2d space-y-4 rounded-2xl border border-white/10 bg-[#131722]/85 p-10 text-center backdrop-blur-xl">
                      <MangaIcon name="lock" className="mx-auto h-10 w-10 text-cyan-300" />
                      <h3 className="text-base font-bold text-white">
                        Đăng nhập để sử dụng kệ sách cá nhân
                      </h3>
                      <p className="mx-auto max-w-md text-sm text-slate-400">
                        Lưu danh sách truyện yêu thích, đang đọc hoặc dự định đọc vào tài khoản của bạn.
                      </p>
                      <Link
                        to="/auth"
                        className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold text-white"
                      >
                        <MangaIcon name="log-in" className="h-4 w-4" />
                        <span>Đăng nhập ngay</span>
                      </Link>
                    </div>
                  ) : shelfLoading ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {[1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="h-32 animate-pulse rounded-2xl border border-white/10 bg-[#131722]/85"
                        />
                      ))}
                    </div>
                  ) : filteredBookmarks.length === 0 ? (
                    <div className="ms-panel-2d space-y-4 rounded-2xl border border-white/10 bg-[#131722]/85 p-10 text-center backdrop-blur-xl">
                      <img
                        src="/content/icons/spots/spot-empty-shelf.svg"
                        alt=""
                        aria-hidden="true"
                        className="ms-float-3d mx-auto h-28 w-36 object-contain"
                      />
                      <p className="text-sm text-slate-400">
                        Chưa có truyện nào trong mục này.
                      </p>
                      <button
                        type="button"
                        onClick={() => updateParams({ tab: "explore" })}
                        className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold text-white"
                      >
                        <span>Khám phá nguồn truyện</span>
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {filteredBookmarks.map((bm) => {
                        const key = buildMangaKey(bm.source_id, bm.manga_id);
                        const bmTitle = bm.title?.trim() || "Chưa rõ tên truyện";
                        const detailHref = `/doc-truyen/chi-tiet?source=${encodeURIComponent(bm.source_id)}&id=${encodeURIComponent(bm.manga_id)}`;
                        const bmHist = historyByKey.get(key);
                        const catLabel = BOOKMARK_CATEGORY_LABELS[bm.category] || "Đã lưu";

                        return (
                          <div
                            key={key}
                            className="flex gap-3 rounded-2xl border border-white/10 bg-[#131722]/85 p-3 backdrop-blur-xl"
                          >
                            <Link
                              to={detailHref}
                              className="h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-[#1B2130]"
                            >
                              <img
                                src={bm.cover_url || DEFAULT_COVER_URL}
                                alt={bmTitle}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  e.currentTarget.onerror = null;
                                  e.currentTarget.src = DEFAULT_COVER_URL;
                                }}
                                className="h-full w-full object-cover"
                              />
                            </Link>
                            <div className="flex min-w-0 flex-1 flex-col justify-between">
                              <div>
                                <Link
                                  to={detailHref}
                                  className="line-clamp-2 text-sm font-semibold text-white hover:text-cyan-300"
                                >
                                  {bmTitle}
                                </Link>
                                {bm.author ? (
                                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                    {bm.author}
                                  </p>
                                ) : null}
                                <span className="mt-1.5 inline-block rounded-md bg-cyan-500/20 px-2 py-0.5 text-[11px] font-medium text-cyan-200">
                                  {catLabel}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                                {bmHist?.chapter_id ? (
                                  <Link
                                    to={`/doc-truyen/doc?source=${encodeURIComponent(bm.source_id)}&mangaId=${encodeURIComponent(bm.manga_id)}&chapterId=${encodeURIComponent(bmHist.chapter_id)}${bmHist.language ? `&lang=${encodeURIComponent(bmHist.language)}` : ""}&page=${bmHist.current_page > 0 ? bmHist.current_page : 1}`}
                                    className="text-xs font-semibold text-emerald-300 hover:text-emerald-200"
                                  >
                                    Đọc tiếp
                                  </Link>
                                ) : (
                                  <Link
                                    to={detailHref}
                                    className="text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                                  >
                                    Mở truyện
                                  </Link>
                                )}

                                <button
                                  type="button"
                                  disabled={busyKey === key}
                                  onClick={() => void handleRemoveBookmark(bm)}
                                  className="text-xs text-slate-400 transition-colors hover:text-rose-300 disabled:opacity-50"
                                >
                                  Gỡ khỏi kệ
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : activeTab === "cross-search" ? (
                <div className="space-y-4">
                  <div className="ms-panel-2d space-y-3 rounded-2xl border border-white/10 bg-[#131722]/85 p-5 backdrop-blur-xl">
                    <h2 className="text-lg font-bold text-white">Tìm kiếm đa nguồn</h2>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const cleaned = searchInput.trim();
                        updateParams({ q: cleaned || null, tab: "cross-search" });
                      }}
                      className="flex flex-col gap-2.5 sm:flex-row"
                    >
                      <div className="relative flex-1">
                        <MangaIcon
                          name="globe"
                          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300"
                        />
                        <input
                          type="text"
                          value={searchInput}
                          onChange={(e) => setSearchInput(e.target.value)}
                          placeholder="Nhập tên truyện muốn tìm trên mọi nguồn..."
                          className="h-11 w-full rounded-xl border border-white/15 bg-[#0B0D14]/80 pl-10 pr-4 text-sm text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                        />
                      </div>
                      <button
                        type="submit"
                        className="ms-btn-2d ms-btn-2d-cyan inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-6 text-sm font-semibold text-white"
                      >
                        <MangaIcon name="search" className="h-4 w-4" />
                        <span>Tìm tất cả nguồn</span>
                      </button>
                    </form>
                  </div>

                  {!activeKeyword ? (
                    <div className="rounded-2xl border border-white/10 bg-[#131722]/85 p-8 text-center text-sm text-slate-400 backdrop-blur-xl">
                      Nhập từ khóa để tìm truyện đồng thời trên tất cả nguồn.
                    </div>
                  ) : crossSearchLoading ? (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                      {[1, 2, 3, 4].map((idx) => (
                        <div
                          key={idx}
                          className="aspect-[2/3] animate-pulse rounded-2xl border border-white/10 bg-[#131722]/85"
                        />
                      ))}
                    </div>
                  ) : crossSearchError ? (
                    <div className="rounded-2xl border border-rose-500/30 bg-rose-950/35 p-6 text-center backdrop-blur-xl">
                      <MangaIcon name="wifi-off" className="mx-auto mb-3 h-10 w-10 text-rose-400" />
                      <p className="text-sm text-rose-200">{crossSearchError}</p>
                    </div>
                  ) : !crossSearchData || crossSearchData.groups.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-[#131722]/85 p-8 text-center text-sm text-slate-300 backdrop-blur-xl">
                      Không tìm thấy kết quả phù hợp cho &ldquo;{activeKeyword}&rdquo; trên các nguồn.
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {crossSearchData.groups.map((grp) => (
                        <div
                          key={grp.source_id}
                          className="space-y-3 rounded-2xl border border-white/10 bg-[#131722]/85 p-4 backdrop-blur-xl"
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
                            <div className="flex items-center gap-2">
                              <PanelBadge
                                asset={resolveSourceAssetKey(grp.source_id)}
                                className="h-5 w-5"
                              />
                              <h3 className="text-sm font-bold text-cyan-200">
                                {grp.source_name || grp.source_id} ({grp.items.length})
                              </h3>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                updateParams({
                                  source: grp.source_id,
                                  tab: "explore",
                                  page: null,
                                })
                              }
                              className="text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                            >
                              Mở nguồn này
                            </button>
                          </div>

                          {grp.items.length === 0 ? (
                            <p className="text-xs text-slate-400">
                              Không có kết quả ở nguồn này.
                            </p>
                          ) : (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                              {grp.items.map((item) => {
                                const cSourceId = item.source_id || grp.source_id;
                                const hist = historyByKey.get(buildMangaKey(cSourceId, item.id));
                                return (
                                  <ReaderMangaCard
                                    key={`${cSourceId}-${item.id}`}
                                    item={item}
                                    fallbackSourceId={cSourceId}
                                    historyItem={hist}
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Explore Tab */
                <div className="space-y-5">
                  <div className="ms-panel-2d space-y-4 rounded-2xl border border-white/10 bg-[#131722]/85 p-4 shadow-xl backdrop-blur-xl">
                    {supportsDemographic || supportsStatus ? (
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        {supportsDemographic ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Đối tượng:
                            </span>
                            {DEMOGRAPHICS.map((demo) => {
                              const active =
                                demo.value.toLowerCase() === activeDemographic.toLowerCase();
                              return (
                                <button
                                  key={demo.value || "all"}
                                  type="button"
                                  onClick={() =>
                                    updateParams({
                                      demographic: demo.value || null,
                                      page: null,
                                    })
                                  }
                                  className={`ms-pill-2d rounded-xl border px-3 py-1.5 text-xs font-medium ${
                                    active
                                      ? "ms-pill-2d-active-cyan text-cyan-100"
                                      : "border-white/10 text-slate-300 hover:border-white/25 hover:text-white"
                                  }`}
                                >
                                  {demo.label}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}

                        {supportsStatus ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Trạng thái:
                            </span>
                            {STATUS_OPTIONS.map((st) => {
                              const active =
                                st.value.toLowerCase() === activeStatus.toLowerCase();
                              return (
                                <button
                                  key={st.value || "all"}
                                  type="button"
                                  onClick={() =>
                                    updateParams({ status: st.value || null, page: null })
                                  }
                                  className={`ms-pill-2d rounded-xl border px-3 py-1.5 text-xs font-medium ${
                                    active
                                      ? "ms-pill-2d-active-cyan text-cyan-100"
                                      : "border-white/10 text-slate-300 hover:border-white/25 hover:text-white"
                                  }`}
                                >
                                  {st.label}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {supportsSort || hasAnyFilter ? (
                      <div
                        className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
                          supportsDemographic || supportsStatus ? "border-t border-white/10 pt-3" : ""
                        }`}
                      >
                        {supportsSort ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Sắp xếp:
                            </span>
                            {SORT_OPTIONS.map((srt) => {
                              const active =
                                srt.value.toLowerCase() === activeSort.toLowerCase();
                              return (
                                <button
                                  key={srt.value}
                                  type="button"
                                  onClick={() => updateParams({ sort: srt.value, page: null })}
                                  className={`ms-pill-2d rounded-xl border px-3 py-1.5 text-xs font-medium ${
                                    active
                                      ? "ms-pill-2d-active-cyan text-cyan-100"
                                      : "border-white/10 text-slate-300 hover:border-white/25 hover:text-white"
                                  }`}
                                >
                                  {srt.label}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div />
                        )}

                        {hasAnyFilter ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSearchInput("");
                              updateParams({
                                q: null,
                                tag: null,
                                demographic: null,
                                status: null,
                                page: null,
                              });
                            }}
                            className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-1.5 self-start rounded-xl border px-3 py-1.5 text-xs font-medium text-rose-100 sm:self-auto"
                          >
                            <MangaIcon name="rotate-ccw" className="h-3.5 w-3.5" />
                            <span>Xóa bộ lọc</span>
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {availableTags.length > 0 ? (
                      <div className="border-t border-white/10 pt-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Thể loại:
                          </span>
                          {primaryTags.map((chip) => {
                            const active = chip.id.toLowerCase() === activeTagId.toLowerCase();
                            return (
                              <button
                                key={chip.id}
                                type="button"
                                onClick={() =>
                                  updateParams({ tag: active ? null : chip.id, page: null })
                                }
                                className={`ms-pill-2d rounded-full border px-3 py-1 text-xs ${
                                  active
                                    ? "ms-pill-2d-active-cyan font-semibold text-cyan-100"
                                    : "border-white/10 text-slate-300 hover:border-cyan-400/50 hover:text-white"
                                }`}
                              >
                                {chip.vietnamese_name || chip.name}
                              </button>
                            );
                          })}
                        </div>

                        {overflowTags.length > 0 ? (
                          <div className="mt-2.5">
                            <button
                              type="button"
                              onClick={() => setShowAllTags((prev) => !prev)}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                            >
                              <MangaIcon
                                name={showAllTags ? "chevron-up" : "chevron-down"}
                                className="h-3.5 w-3.5"
                              />
                              <span>
                                {showAllTags
                                  ? "Thu gọn thể loại"
                                  : `Xem thêm ${overflowTags.length} thể loại`}
                              </span>
                            </button>

                            {showAllTags ? (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                {overflowTags.map((chip) => {
                                  const active =
                                    chip.id.toLowerCase() === activeTagId.toLowerCase();
                                  return (
                                    <button
                                      key={chip.id}
                                      type="button"
                                      onClick={() =>
                                        updateParams({
                                          tag: active ? null : chip.id,
                                          page: null,
                                        })
                                      }
                                      className={`ms-pill-2d rounded-full border px-3 py-1 text-xs ${
                                        active
                                          ? "ms-pill-2d-active-cyan font-semibold text-cyan-100"
                                          : "border-white/10 text-slate-300 hover:border-cyan-400/50 hover:text-white"
                                      }`}
                                    >
                                      {chip.vietnamese_name || chip.name}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {browseLoading ? (
                    <div
                      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
                      aria-label="Đang tải danh sách truyện"
                    >
                      {Array.from({ length: 8 }, (_, idx) => (
                        <div
                          key={idx}
                          className="overflow-hidden rounded-2xl border border-white/10 bg-[#131722]/85"
                        >
                          <div className="aspect-[2/3] w-full animate-pulse bg-[#1B2130]" />
                          <div className="space-y-2 p-3.5">
                            <div className="h-4 w-4/5 animate-pulse rounded bg-white/10" />
                            <div className="h-3 w-1/2 animate-pulse rounded bg-white/5" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : effectiveError ? (
                    <div className="rounded-2xl border border-rose-500/30 bg-rose-950/35 p-6 text-center backdrop-blur-xl">
                      <MangaIcon name="wifi-off" className="mx-auto mb-3 h-10 w-10 text-rose-400" />
                      <h3 className="text-base font-semibold text-rose-100">
                        Không thể tải dữ liệu từ nguồn truyện
                      </h3>
                      <p className="mt-1 text-sm text-rose-200/90">{effectiveError}</p>
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => setBrowseTick((t) => t + 1)}
                          className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold text-rose-100"
                        >
                          <MangaIcon name="refresh-cw" className="h-3.5 w-3.5" />
                          <span>Thử lại</span>
                        </button>
                        {activeSourceId !== "local-db" ? (
                          <button
                            type="button"
                            onClick={() =>
                              updateParams({
                                source: "local-db",
                                tag: null,
                                demographic: null,
                                status: null,
                                page: null,
                              })
                            }
                            className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold text-white"
                          >
                            <PanelBadge asset="src-local-store" className="h-4 w-4" />
                            <span>Chuyển sang Kho nội bộ</span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : items.length === 0 ? (
                    <div className="ms-panel-2d rounded-2xl border border-white/10 bg-[#131722]/85 p-12 text-center backdrop-blur-xl">
                      <img
                        src="/content/icons/spots/spot-empty-search.svg"
                        alt=""
                        aria-hidden="true"
                        className="ms-float-3d mx-auto mb-4 h-28 w-36 object-contain"
                      />
                      <h3 className="text-lg font-semibold text-white">
                        Không tìm thấy truyện phù hợp
                      </h3>
                      <p className="mt-1 text-sm text-slate-400">
                        Hãy thử thay đổi từ khóa, chọn nguồn khác hoặc bỏ bớt bộ lọc đang áp dụng.
                      </p>
                      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSearchInput("");
                            updateParams({
                              q: null,
                              tag: null,
                              demographic: null,
                              status: null,
                              page: null,
                            });
                          }}
                          className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold text-white"
                        >
                          <MangaIcon name="rotate-ccw" className="h-4 w-4" />
                          <span>Xem toàn bộ nguồn này</span>
                        </button>
                        {activeSourceId !== "local-db" ? (
                          <button
                            type="button"
                            onClick={() =>
                              updateParams({
                                source: "local-db",
                                q: null,
                                tag: null,
                                demographic: null,
                                status: null,
                                page: null,
                              })
                            }
                            className="ms-btn-2d ms-btn-2d-dark inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold text-cyan-200"
                          >
                            <PanelBadge asset="src-local-store" className="h-4 w-4" />
                            <span>Mở Kho nội bộ</span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                        {items.map((item) => {
                          const cardSourceId = item.source_id?.trim() || activeSourceId;
                          const hist = historyByKey.get(buildMangaKey(cardSourceId, item.id));
                          return (
                            <ReaderMangaCard
                              key={`${cardSourceId}-${item.id}`}
                              item={item}
                              fallbackSourceId={activeSourceId}
                              historyItem={hist}
                            />
                          );
                        })}
                      </div>

                      {/* Pagination */}
                      <div className="flex items-center justify-center gap-3 pt-2">
                        {resolvedPage > 1 ? (
                          <button
                            type="button"
                            onClick={() => updateParams({ page: String(resolvedPage - 1) })}
                            className="ms-btn-2d ms-btn-2d-dark inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium text-slate-200 hover:border-cyan-400/50 hover:text-white"
                          >
                            <MangaIcon name="chevron-left" className="h-4 w-4" />
                            <span>Trang trước</span>
                          </button>
                        ) : (
                          <span className="ms-pill-2d inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-slate-500 opacity-60">
                            <MangaIcon name="chevron-left" className="h-4 w-4" />
                            <span>Trang trước</span>
                          </span>
                        )}

                        <span className="ms-pill-2d ms-pill-2d-active-cyan rounded-xl border px-4 py-2 text-sm font-semibold text-cyan-100">
                          Trang {resolvedPage}
                        </span>

                        {browseResult?.has_next_page ? (
                          <button
                            type="button"
                            onClick={() => updateParams({ page: String(resolvedPage + 1) })}
                            className="ms-btn-2d ms-btn-2d-dark inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium text-slate-200 hover:border-cyan-400/50 hover:text-white"
                          >
                            <span>Trang sau</span>
                            <MangaIcon name="chevron-right" className="h-4 w-4" />
                          </button>
                        ) : (
                          <span className="ms-pill-2d inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-slate-500 opacity-60">
                            <span>Trang sau</span>
                            <MangaIcon name="chevron-right" className="h-4 w-4" />
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={clearDialogOpen}
        title="Xóa toàn bộ lịch sử đọc"
        message="Bạn có chắc chắn muốn xóa toàn bộ lịch sử đọc truyện trong tài khoản của mình? Thao tác này không thể hoàn tác."
        confirmLabel="Xóa toàn bộ"
        danger
        busy={clearingHistory}
        onConfirm={() => void handleConfirmClearHistory()}
        onCancel={() => {
          if (!clearingHistory) setClearDialogOpen(false);
        }}
      />
    </StoreLayout>
  );
}

export default ReaderIndexPage;
