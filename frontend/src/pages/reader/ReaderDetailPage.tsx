import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { ApiError, apiClient, request } from "../../lib/api";
import { formatCompactNumber, formatDate, formatDateTime } from "../../lib/format";
import { StoreLayout } from "../../components/layout/StoreLayout";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { MangaBook3D } from "../../components/ui/MangaBook3D";
import { MangaCard3D } from "../../components/ui/MangaCard3D";
import { MangaIcon } from "../../components/ui/MangaIcon";
import { PanelBadge } from "../../components/ui/PanelBadge";
import type {
  ProductCardDto,
  ReaderChapterDto,
  ReaderCommentDto,
  ReaderDetailResponse,
  ReaderSourceInfo,
} from "../../types/api";

const DEFAULT_COVER_URL = "/covers/default-manga.svg";
const DEFAULT_AVATAR_URL = "/content/icons/spots/avatar-default.svg";

type ReaderDetailPayload = ReaderDetailResponse & {
  source_id?: string;
  read_chapter_ids?: string[];
  is_store_db_online?: boolean;
};

type ReaderCommentWire = ReaderCommentDto & {
  user_name?: string;
  replies?: ReaderCommentWire[];
};

const BOOKMARK_OPTIONS: ReadonlyArray<{
  value: "reading" | "plan" | "favorite" | "completed";
  label: string;
  icon: string;
  colorClass: string;
  activeClass: string;
}> = [
  {
    value: "reading",
    label: "Đang đọc",
    icon: "book-open",
    colorClass: "text-cyan-300",
    activeClass: "bg-cyan-500/25 text-cyan-100",
  },
  {
    value: "plan",
    label: "Dự định đọc",
    icon: "clock",
    colorClass: "text-sky-300",
    activeClass: "bg-sky-500/25 text-sky-100",
  },
  {
    value: "favorite",
    label: "Yêu thích",
    icon: "heart",
    colorClass: "text-pink-400",
    activeClass: "bg-pink-500/25 text-pink-100",
  },
  {
    value: "completed",
    label: "Hoàn thành",
    icon: "check-circle-2",
    colorClass: "text-emerald-400",
    activeClass: "bg-emerald-500/25 text-emerald-100",
  },
];

const BOOKMARK_LABEL_MAP: Record<string, string> = {
  reading: "Đang đọc",
  plan: "Dự định đọc",
  favorite: "Yêu thích",
  completed: "Hoàn thành",
};

function formatReaderRating(rating: number | null | undefined, ratingMax = 5): string {
  if (rating === null || rating === undefined || !Number.isFinite(rating) || rating <= 0) {
    return "—";
  }
  const formatted = rating.toFixed(1);
  return ratingMax === 10 ? `${formatted}/10` : formatted;
}

function normalizeTagItem(rawTag: unknown): { id: string; label: string } | null {
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

function resolveCommentUsername(comment: ReaderCommentWire): string {
  return (comment.user_name || comment.username || "Độc giả").trim() || "Độc giả";
}

function resolveAvatar(raw: string | null | undefined): string {
  const cleaned = (raw || "").trim();
  if (!cleaned) return DEFAULT_AVATAR_URL;
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://") || cleaned.startsWith("/")) {
    return cleaned;
  }
  return `/${cleaned.replace(/^~?\/+/, "")}`;
}

function normalizeStoreProduct(p: ProductCardDto): ProductCardDto {
  const available = p.is_available ?? p.in_stock ?? true;
  return {
    ...p,
    in_stock: p.in_stock ?? available,
    is_available: available,
    average_rating: Number.isFinite(p.average_rating) ? p.average_rating : 0,
    ratings_count: Number.isFinite(p.ratings_count) ? p.ratings_count : 0,
    view_count: Number.isFinite(p.view_count) ? p.view_count : 0,
    units_sold: Number.isFinite(p.units_sold) ? p.units_sold : 0,
    cover_url: p.cover_url || DEFAULT_COVER_URL,
  };
}

export function ReaderDetailPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { showToast } = useToast();

  const activeSourceId = (searchParams.get("source") || "mangadex-vi").trim() || "mangadex-vi";
  const mangaId = (searchParams.get("id") || "").trim();
  const requestedLang = (searchParams.get("lang") || "").trim();

  const [sources, setSources] = useState<ReaderSourceInfo[]>([]);
  const [detail, setDetail] = useState<ReaderDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [descExpanded, setDescExpanded] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [savingBookmark, setSavingBookmark] = useState(false);
  const bookmarkMenuRef = useRef<HTMLDivElement | null>(null);

  const [chapterQuery, setChapterQuery] = useState("");
  const [chapterOrder, setChapterOrder] = useState<"desc" | "asc">("desc");

  const [savingRating, setSavingRating] = useState(false);
  const [hoverStar, setHoverStar] = useState<number | null>(null);

  const [commentInput, setCommentInput] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [activeReplyId, setActiveReplyId] = useState<number | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [postingReply, setPostingReply] = useState(false);

  const [commentToDelete, setCommentToDelete] = useState<ReaderCommentWire | null>(null);
  const [deletingComment, setDeletingComment] = useState(false);

  // Close bookmark menu on outside click or Escape
  useEffect(() => {
    if (!bookmarkOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        bookmarkMenuRef.current &&
        !bookmarkMenuRef.current.contains(event.target as Node)
      ) {
        setBookmarkOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBookmarkOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [bookmarkOpen]);

  // Fetch sources once without slow probes
  useEffect(() => {
    const controller = new AbortController();
    request<ReaderSourceInfo[] | { sources?: ReaderSourceInfo[] }>(
      "/api/reader/sources?probe=false",
      { method: "GET", signal: controller.signal }
    )
      .then((res) => {
        setSources(Array.isArray(res) ? res : res.sources ?? []);
      })
      .catch(() => {
        // Non-critical for detail view
      });
    return () => controller.abort();
  }, []);

  const loadDetail = useCallback(
    async (signal?: AbortSignal) => {
      if (!mangaId) {
        setDetail(null);
        setLoadError("Thiếu mã truyện cần xem chi tiết.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);

      const params = new URLSearchParams();
      params.set("source", activeSourceId);
      params.set("id", mangaId);
      if (requestedLang) {
        params.set("lang", requestedLang);
      } else {
        params.set("lang", activeSourceId === "mangadex-en" ? "en" : "vi");
      }

      try {
        const res = await request<ReaderDetailPayload>(
          `/api/reader/detail?${params.toString()}`,
          { method: "GET", signal }
        );
        setDetail(res);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setDetail(null);
        setLoadError(
          err instanceof ApiError
            ? err.message
            : "Không thể tải thông tin chi tiết truyện lúc này."
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [activeSourceId, mangaId, requestedLang]
  );

  useEffect(() => {
    setDescExpanded(false);
    setBookmarkOpen(false);
    setActiveReplyId(null);
    setReplyInput("");
    const controller = new AbortController();
    void loadDetail(controller.signal);
    return () => controller.abort();
  }, [loadDetail, reloadTick]);

  const manga = detail?.manga ?? null;
  const effectiveSourceId = detail?.source_id || manga?.source_id || activeSourceId;
  const sourceDisplayName = useMemo(() => {
    const matched = sources.find(
      (s) => s.id.toLowerCase() === effectiveSourceId.toLowerCase()
    );
    return matched?.display_name || manga?.source_name || effectiveSourceId;
  }, [sources, effectiveSourceId, manga?.source_name]);

  const selectedLanguage = (detail?.selected_language || requestedLang || "").trim();
  const allChapters = detail?.chapters ?? [];

  const { firstChapter, latestChapter } = useMemo(() => {
    if (allChapters.length === 0) {
      return { firstChapter: null as ReaderChapterDto | null, latestChapter: null as ReaderChapterDto | null };
    }
    let minNum = Number.POSITIVE_INFINITY;
    let maxNum = Number.NEGATIVE_INFINITY;
    let minChap: ReaderChapterDto | null = null;
    let maxChap: ReaderChapterDto | null = null;

    for (const ch of allChapters) {
      const parsed = Number.parseFloat((ch.chapter_number || "").trim());
      if (Number.isFinite(parsed)) {
        if (minChap === null || parsed <= minNum) {
          minNum = parsed;
          minChap = ch;
        }
        if (maxChap === null || parsed > maxNum) {
          maxNum = parsed;
          maxChap = ch;
        }
      }
    }

    return {
      firstChapter: minChap ?? allChapters[allChapters.length - 1],
      latestChapter: maxChap ?? allChapters[0],
    };
  }, [allChapters]);

  const filteredChapters = useMemo(() => {
    const q = chapterQuery.trim().toLowerCase();
    const list = q
      ? allChapters.filter(
          (ch) =>
            (ch.display_label || "").toLowerCase().includes(q) ||
            (ch.chapter_number || "").toLowerCase().includes(q) ||
            (ch.title || "").toLowerCase().includes(q) ||
            (ch.scanlation_group || "").toLowerCase().includes(q)
        )
      : [...allChapters];
    if (chapterOrder === "asc") {
      list.reverse();
    }
    return list;
  }, [allChapters, chapterQuery, chapterOrder]);

  const readChapterSet = useMemo(() => {
    const set = new Set<string>();
    for (const cid of detail?.last_history?.read_chapters ?? []) {
      if (cid) set.add(cid.toLowerCase());
    }
    for (const cid of detail?.read_chapter_ids ?? []) {
      if (cid) set.add(cid.toLowerCase());
    }
    return set;
  }, [detail?.last_history?.read_chapters, detail?.read_chapter_ids]);

  const mangaTags = useMemo(() => {
    const rawList = (manga?.tags ?? []) as unknown[];
    const list: Array<{ id: string; label: string }> = [];
    for (const raw of rawList) {
      const parsed = normalizeTagItem(raw);
      if (parsed) list.push(parsed);
    }
    return list;
  }, [manga?.tags]);

  const descriptionText = (detail?.description || "").trim();
  const { isLongDesc, headDesc, tailDesc } = useMemo(() => {
    if (descriptionText.length <= 350) {
      return { isLongDesc: false, headDesc: descriptionText, tailDesc: "" };
    }
    let splitIdx = descriptionText.lastIndexOf(" ", 350);
    if (splitIdx < 200) splitIdx = 350;
    const head = descriptionText.slice(0, splitIdx).trimEnd();
    const tail = descriptionText.slice(splitIdx).trimStart();
    if (!tail) {
      return { isLongDesc: false, headDesc: descriptionText, tailDesc: "" };
    }
    return { isLongDesc: true, headDesc: head, tailDesc: tail };
  }, [descriptionText]);

  const buildReadUrl = useCallback(
    (chapterId: string, page?: number) => {
      const p = new URLSearchParams();
      p.set("source", effectiveSourceId);
      p.set("mangaId", manga?.id || mangaId);
      p.set("chapterId", chapterId);
      if (selectedLanguage) p.set("lang", selectedLanguage);
      if (page && page > 1) p.set("page", String(page));
      return `/doc-truyen/doc?${p.toString()}`;
    },
    [effectiveSourceId, manga?.id, mangaId, selectedLanguage]
  );

  const handleLanguageChange = (langCode: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("lang", langCode);
      return next;
    });
  };

  const handleSaveBookmark = async (
    category: "reading" | "plan" | "favorite" | "completed" | "none"
  ) => {
    if (!manga) return;
    if (!user) {
      showToast("Vui lòng đăng nhập để lưu truyện vào kệ sách.", "warning");
      setBookmarkOpen(false);
      return;
    }
    setSavingBookmark(true);
    try {
      const res = await apiClient.post<{ message: string; category: string }>(
        "/api/reader/bookmarks",
        {
          source_id: effectiveSourceId,
          manga_id: manga.id,
          title: manga.title,
          cover_url: manga.cover_url || DEFAULT_COVER_URL,
          author: manga.author || "",
          status_label: manga.status_label || manga.status || "",
          category,
        }
      );
      setDetail((prev) =>
        prev ? { ...prev, bookmark_category: res.category || null } : prev
      );
      setBookmarkOpen(false);
      showToast(res.message || "Đã cập nhật kệ sách.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể cập nhật kệ sách.", "error");
    } finally {
      setSavingBookmark(false);
    }
  };

  const handleRate = async (score: number) => {
    if (!manga) return;
    if (!user) {
      showToast("Vui lòng đăng nhập để đánh giá truyện.", "warning");
      return;
    }
    setSavingRating(true);
    try {
      const res = await apiClient.post<{
        message: string;
        user_rating: number;
        average_rating: number;
        ratings_count: number;
      }>("/api/reader/rate", {
        source_id: effectiveSourceId,
        manga_id: manga.id,
        score,
      });
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              user_rating: res.user_rating,
              local_stats: {
                ...prev.local_stats,
                average_rating: res.average_rating,
                ratings_count: res.ratings_count,
              },
            }
          : prev
      );
      showToast(res.message || "Đã lưu đánh giá của bạn.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể lưu đánh giá.", "error");
    } finally {
      setSavingRating(false);
    }
  };

  const handlePostComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!manga) return;
    if (!user) {
      showToast("Vui lòng đăng nhập để bình luận.", "warning");
      return;
    }
    const content = commentInput.trim();
    if (!content) {
      showToast("Nội dung bình luận không được để trống.", "warning");
      return;
    }
    setPostingComment(true);
    try {
      const res = await apiClient.post<{
        comment: ReaderCommentWire;
        comment_count: number;
        message: string;
      }>("/api/reader/comments", {
        source_id: effectiveSourceId,
        manga_id: manga.id,
        content,
      });
      setCommentInput("");
      setDetail((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          comments: [res.comment, ...(prev.comments ?? [])],
          local_stats: {
            ...prev.local_stats,
            comment_count: res.comment_count,
          },
          manga: {
            ...prev.manga,
            comment_count: res.comment_count,
          },
        };
      });
      showToast(res.message || "Đã đăng bình luận.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể gửi bình luận.", "error");
    } finally {
      setPostingComment(false);
    }
  };

  const handlePostReply = async (
    event: FormEvent<HTMLFormElement>,
    parentCommentId: number
  ) => {
    event.preventDefault();
    if (!manga || !user) return;
    const content = replyInput.trim();
    if (!content) {
      showToast("Nội dung trả lời không được để trống.", "warning");
      return;
    }
    setPostingReply(true);
    try {
      const res = await apiClient.post<{
        comment: ReaderCommentWire;
        comment_count: number;
        message: string;
      }>("/api/reader/comments", {
        source_id: effectiveSourceId,
        manga_id: manga.id,
        content,
        parent_comment_id: parentCommentId,
      });
      setReplyInput("");
      setActiveReplyId(null);
      setDetail((prev) => {
        if (!prev) return prev;
        const nextComments = (prev.comments ?? []).map((root) => {
          if (root.id !== parentCommentId) return root;
          return {
            ...root,
            replies: [...(root.replies ?? []), res.comment],
          };
        });
        return {
          ...prev,
          comments: nextComments,
          local_stats: {
            ...prev.local_stats,
            comment_count: res.comment_count,
          },
          manga: {
            ...prev.manga,
            comment_count: res.comment_count,
          },
        };
      });
      showToast(res.message || "Đã gửi trả lời.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể gửi trả lời.", "error");
    } finally {
      setPostingReply(false);
    }
  };

  const handleConfirmDeleteComment = async () => {
    if (!commentToDelete) return;
    setDeletingComment(true);
    try {
      const res = await apiClient.del<{ message: string; comment_count: number }>(
        `/api/reader/comments/${commentToDelete.id}`
      );
      const deletedId = commentToDelete.id;
      setCommentToDelete(null);
      setDetail((prev) => {
        if (!prev) return prev;
        const nextComments = (prev.comments ?? [])
          .filter((c) => c.id !== deletedId)
          .map((c) => ({
            ...c,
            replies: (c.replies ?? []).filter((r) => r.id !== deletedId),
          }));
        return {
          ...prev,
          comments: nextComments,
          local_stats: {
            ...prev.local_stats,
            comment_count: res.comment_count,
          },
          manga: {
            ...prev.manga,
            comment_count: res.comment_count,
          },
        };
      });
      showToast(res.message || "Đã xóa bình luận.", "info");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể xóa bình luận.", "error");
    } finally {
      setDeletingComment(false);
    }
  };

  const comments = (detail?.comments ?? []) as ReaderCommentWire[];
  const localStats = detail?.local_stats;
  const currentUserRating = detail?.user_rating ?? 0;
  const activeBookmark = (detail?.bookmark_category || "").trim().toLowerCase();
  const isBookmarked = Boolean(activeBookmark);
  const bookmarkButtonLabel = isBookmarked
    ? `Đã lưu: ${BOOKMARK_LABEL_MAP[activeBookmark] || activeBookmark}`
    : "Lưu vào kệ sách";
  const matchedStoreProducts = useMemo(
    () => (detail?.matched_store_products ?? []).map(normalizeStoreProduct),
    [detail?.matched_store_products]
  );

  return (
    <StoreLayout>
      <section className="min-h-screen bg-transparent pb-16">
        {loading && !detail ? (
          <div className="mx-auto max-w-7xl space-y-6 px-4 pt-8 sm:px-6">
            <div className="h-8 w-72 animate-pulse rounded-xl bg-white/10" />
            <div className="grid grid-cols-1 gap-6 rounded-3xl border border-white/10 bg-[#131722]/90 p-6 md:grid-cols-12">
              <div className="aspect-[3/4] animate-pulse rounded-2xl bg-[#1B2130] md:col-span-4 lg:col-span-3" />
              <div className="space-y-4 md:col-span-8 lg:col-span-9">
                <div className="h-6 w-48 animate-pulse rounded-lg bg-white/10" />
                <div className="h-10 w-3/4 animate-pulse rounded-xl bg-white/10" />
                <div className="h-28 w-full animate-pulse rounded-2xl bg-[#0B0D14]/70" />
                <div className="flex gap-3">
                  <div className="h-11 w-40 animate-pulse rounded-2xl bg-cyan-500/20" />
                  <div className="h-11 w-40 animate-pulse rounded-2xl bg-white/10" />
                </div>
              </div>
            </div>
          </div>
        ) : !manga ? (
          <div className="mx-auto max-w-3xl px-4 pt-16 sm:px-6">
            <div className="rounded-3xl border border-white/10 bg-[#131722]/90 p-10 text-center shadow-2xl backdrop-blur-xl">
              <MangaIcon
                name="alert-triangle"
                className="mx-auto mb-4 h-14 w-14 text-amber-400"
              />
              <h1 className="text-2xl font-bold text-white">
                Không thể tải thông tin truyện
              </h1>
              <p className="mt-2 text-sm text-slate-300">
                {loadError ||
                  detail?.error_message ||
                  "Truyện không tồn tại hoặc nguồn truyện hiện không phản hồi."}
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setReloadTick((t) => t + 1)}
                  className="ms-btn-2d ms-btn-2d-amber inline-flex items-center gap-2 rounded-2xl border px-5 py-2.5 text-sm font-semibold text-white"
                >
                  <MangaIcon name="refresh-cw" className="h-4 w-4" />
                  <span>Thử lại</span>
                </button>
                <Link
                  to={`/doc-truyen?source=${encodeURIComponent(activeSourceId)}`}
                  className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-2xl border px-5 py-2.5 text-sm font-semibold text-white"
                >
                  <MangaIcon name="arrow-left" className="h-4 w-4" />
                  <span>Quay lại danh sách</span>
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Breadcrumb */}
            <div className="border-b border-white/10 bg-[#0B0D14]/85 backdrop-blur-xl">
              <div className="mx-auto max-w-7xl px-4 py-3.5 sm:px-6">
                <nav
                  aria-label="Breadcrumb"
                  className="flex flex-wrap items-center gap-2 text-xs text-slate-400 sm:text-sm"
                >
                  <Link to="/" className="transition-colors hover:text-white">
                    Trang chủ
                  </Link>
                  <MangaIcon name="chevron-right" className="h-3.5 w-3.5 text-slate-500" />
                  <Link
                    to="/doc-truyen"
                    className="transition-colors hover:text-cyan-300"
                  >
                    Đọc truyện Online
                  </Link>
                  <MangaIcon name="chevron-right" className="h-3.5 w-3.5 text-slate-500" />
                  <Link
                    to={`/doc-truyen?source=${encodeURIComponent(effectiveSourceId)}`}
                    className="transition-colors hover:text-cyan-300"
                  >
                    {sourceDisplayName}
                  </Link>
                  <MangaIcon name="chevron-right" className="h-3.5 w-3.5 text-slate-500" />
                  <span className="max-w-[16rem] truncate font-medium text-white sm:max-w-md">
                    {manga.title}
                  </span>
                </nav>
              </div>
            </div>

            <div className="mx-auto max-w-7xl space-y-6 px-4 pt-6 sm:px-6">
              {detail?.error_message ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-950/35 px-4 py-3 text-sm text-amber-200 backdrop-blur-xl">
                  <span>{detail.error_message}</span>
                  <button
                    type="button"
                    onClick={() => setReloadTick((t) => t + 1)}
                    className="ms-btn-2d ms-btn-2d-amber shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold text-amber-100"
                  >
                    Thử lại
                  </button>
                </div>
              ) : null}

              {/* Hero Detail Card with Blurred Cover Backdrop & 3D Book */}
              <div className="relative z-30 rounded-3xl border border-white/10 bg-[#131722]/90 p-5 shadow-2xl backdrop-blur-xl sm:p-7">
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
                  <img
                    src={manga.cover_url || DEFAULT_COVER_URL}
                    alt=""
                    aria-hidden="true"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = DEFAULT_COVER_URL;
                    }}
                    className="h-full w-full scale-110 object-cover opacity-20 blur-2xl"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#0B0D14]/95 via-[#0B0D14]/85 to-[#0B0D14]/75" />
                </div>

                <div className="relative z-10 grid grid-cols-1 gap-6 md:grid-cols-12">
                  <div className="md:col-span-4 lg:col-span-3">
                    <div className="mx-auto w-full max-w-[260px] md:max-w-none">
                      <MangaBook3D
                        coverUrl={manga.cover_url || DEFAULT_COVER_URL}
                        title={manga.title}
                        variant="cyan"
                        size="lg"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col justify-between gap-5 md:col-span-8 lg:col-span-9">
                    <div className="space-y-4">
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-lg border border-cyan-400/30 bg-cyan-500/15 px-2.5 py-0.5 text-xs font-semibold text-cyan-200">
                            {sourceDisplayName}
                          </span>
                          {manga.status_label || manga.status ? (
                            <span className="rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-200">
                              {manga.status_label || manga.status}
                            </span>
                          ) : null}
                          {manga.language ? (
                            <span className="rounded-lg border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-bold uppercase text-slate-300">
                              {manga.language}
                            </span>
                          ) : null}
                        </div>

                        <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                          {manga.title}
                        </h1>
                        {manga.alt_title &&
                        manga.alt_title.trim().toLowerCase() !==
                          manga.title.trim().toLowerCase() ? (
                          <p className="mt-1 text-sm text-slate-400">{manga.alt_title}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-300">
                        {manga.author ? (
                          <div className="flex items-center gap-1.5">
                            <MangaIcon name="user-pen" className="h-4 w-4 text-cyan-300" />
                            <span className="text-slate-400">Tác giả:</span>
                            <strong className="font-semibold text-white">
                              {manga.author}
                            </strong>
                          </div>
                        ) : null}
                        {manga.year && manga.year > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <MangaIcon name="calendar" className="h-4 w-4 text-sky-300" />
                            <span className="text-slate-400">Năm phát hành:</span>
                            <strong className="font-semibold text-white">{manga.year}</strong>
                          </div>
                        ) : null}
                        <div className="flex items-center gap-1.5">
                          <MangaIcon name="list-ordered" className="h-4 w-4 text-indigo-300" />
                          <span className="text-slate-400">Số chương:</span>
                          <strong className="font-semibold text-white">
                            {allChapters.length}
                          </strong>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MangaIcon name="star" className="h-4 w-4 text-amber-400" />
                          <span className="text-slate-400">Đánh giá:</span>
                          <strong className="font-semibold text-amber-300">
                            {formatReaderRating(manga.rating, manga.rating_max)}
                          </strong>
                          {manga.rating_count && manga.rating_count > 0 ? (
                            <span className="text-xs text-slate-400">
                              ({manga.rating_count.toLocaleString("vi-VN")})
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MangaIcon name="eye" className="h-4 w-4 text-cyan-400" />
                          <strong className="font-semibold text-white">
                            {formatCompactNumber(manga.view_count)}
                          </strong>
                          <span className="text-slate-400">lượt đọc</span>
                        </div>
                        {manga.follow_count && manga.follow_count > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <MangaIcon name="heart" className="h-4 w-4 text-rose-400" />
                            <strong className="font-semibold text-white">
                              {formatCompactNumber(manga.follow_count)}
                            </strong>
                            <span className="text-slate-400">theo dõi</span>
                          </div>
                        ) : null}
                        <a
                          href="#reader-comments"
                          className="inline-flex items-center gap-1.5 transition-colors hover:text-cyan-300"
                        >
                          <MangaIcon name="message-circle" className="h-4 w-4 text-cyan-300" />
                          <strong className="font-semibold text-white">
                            {formatCompactNumber(
                              localStats?.comment_count ?? manga.comment_count
                            )}
                          </strong>
                          <span className="text-slate-400">bình luận</span>
                        </a>
                      </div>

                      {/* Collapsible Description */}
                      <div className="rounded-2xl border border-white/10 bg-[#0B0D14]/70 p-4">
                        {!descriptionText ? (
                          <p className="text-sm leading-relaxed text-slate-400">
                            Chưa có mô tả chi tiết cho bộ truyện này.
                          </p>
                        ) : isLongDesc ? (
                          <div>
                            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">
                              {descExpanded ? descriptionText : `${headDesc}...`}
                            </p>
                            <button
                              type="button"
                              onClick={() => setDescExpanded((prev) => !prev)}
                              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                            >
                              <span>
                                {descExpanded ? "Thu gọn mô tả" : "Xem đầy đủ mô tả"}
                              </span>
                              <MangaIcon
                                name={descExpanded ? "chevron-up" : "chevron-down"}
                                className="h-3.5 w-3.5"
                              />
                            </button>
                            {descExpanded && tailDesc ? null : null}
                          </div>
                        ) : (
                          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">
                            {descriptionText}
                          </p>
                        )}
                      </div>

                      {/* Clickable Cyan Tags */}
                      {mangaTags.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            <PanelBadge asset="tab-reader-tags" className="h-4 w-4" />
                            <span>Thể loại:</span>
                          </span>
                          {mangaTags.map((tag) => (
                            <Link
                              key={tag.id}
                              to={`/doc-truyen?source=${encodeURIComponent(effectiveSourceId)}&tag=${encodeURIComponent(tag.id)}`}
                              className="ms-pill-2d inline-flex items-center gap-1 rounded-full border border-cyan-400/30 px-3 py-1 text-xs font-medium text-cyan-200 hover:border-cyan-400 hover:text-white"
                            >
                              <span>{tag.label}</span>
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      {firstChapter ? (
                        <Link
                          to={buildReadUrl(firstChapter.id)}
                          className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2.5 rounded-2xl border px-5 py-2.5 text-sm font-semibold text-white"
                        >
                          <PanelBadge asset="action-read-start" className="h-6 w-6" />
                          <span>Đọc từ đầu</span>
                        </Link>
                      ) : null}

                      {latestChapter ? (
                        <Link
                          to={buildReadUrl(latestChapter.id)}
                          className="ms-btn-2d ms-btn-2d-dark inline-flex items-center gap-2.5 rounded-2xl border px-5 py-2.5 text-sm font-semibold text-cyan-100 hover:border-cyan-400/50"
                        >
                          <PanelBadge asset="action-read-latest" className="h-6 w-6" />
                          <span>Đọc chương mới nhất</span>
                        </Link>
                      ) : null}

                      {detail?.last_history?.chapter_id ? (
                        <Link
                          to={buildReadUrl(
                            detail.last_history.chapter_id,
                            detail.last_history.current_page > 1
                              ? detail.last_history.current_page
                              : undefined
                          )}
                          className="ms-btn-2d ms-btn-2d-emerald inline-flex items-center gap-2.5 rounded-2xl border px-5 py-2.5 text-sm font-semibold text-white"
                        >
                          <PanelBadge asset="shelf-history" className="h-6 w-6" />
                          <span>
                            Đọc tiếp {detail.last_history.chapter_label || "Chương đang đọc"}
                            {detail.last_history.current_page > 1
                              ? ` (Trang ${detail.last_history.current_page})`
                              : ""}
                          </span>
                        </Link>
                      ) : null}

                      <div ref={bookmarkMenuRef} className="relative">
                        <button
                          type="button"
                          disabled={savingBookmark}
                          onClick={() => setBookmarkOpen((prev) => !prev)}
                          aria-expanded={bookmarkOpen}
                          aria-haspopup="menu"
                          className={`ms-btn-2d inline-flex items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-sm font-semibold text-white ${
                            isBookmarked
                              ? "ms-btn-2d-amber"
                              : "ms-btn-2d-dark hover:border-amber-400/55"
                          }`}
                        >
                          <PanelBadge asset="action-bookmark" className="h-6 w-6" />
                          <span>{bookmarkButtonLabel}</span>
                          <MangaIcon
                            name="chevron-down"
                            className={`h-4 w-4 text-slate-300 transition-transform ${
                              bookmarkOpen ? "rotate-180" : ""
                            }`}
                          />
                        </button>

                        {bookmarkOpen ? (
                          <div
                            role="menu"
                            className="absolute left-0 z-30 mt-2 w-56 space-y-1 rounded-2xl border border-white/15 bg-[#131722]/95 p-1.5 shadow-2xl backdrop-blur-xl"
                          >
                            {BOOKMARK_OPTIONS.map((opt) => {
                              const isSelected = activeBookmark === opt.value;
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  role="menuitem"
                                  disabled={savingBookmark}
                                  onClick={() => void handleSaveBookmark(opt.value)}
                                  className={`flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors ${
                                    isSelected
                                      ? opt.activeClass
                                      : "text-slate-200 hover:bg-white/10 hover:text-white"
                                  }`}
                                >
                                  <span className="flex items-center gap-2.5">
                                    <MangaIcon
                                      name={opt.icon}
                                      className={`h-3.5 w-3.5 ${opt.colorClass}`}
                                    />
                                    <span>{opt.label}</span>
                                  </span>
                                  {isSelected ? (
                                    <MangaIcon
                                      name="check"
                                      className={`h-3.5 w-3.5 ${opt.colorClass}`}
                                    />
                                  ) : null}
                                </button>
                              );
                            })}

                            {isBookmarked ? (
                              <>
                                <div className="my-1 border-t border-white/10" />
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={savingBookmark}
                                  onClick={() => void handleSaveBookmark("none")}
                                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-rose-300 hover:bg-rose-500/15"
                                >
                                  <MangaIcon name="trash-2" className="h-3.5 w-3.5" />
                                  <span>Bỏ lưu</span>
                                </button>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Store Bridge Card */}
              <div className="ms-panel-2d relative z-10 rounded-3xl border border-[#E63946]/30 bg-[#131722]/90 p-5 shadow-xl backdrop-blur-xl sm:p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E63946]/35 bg-[#E63946]/15 text-[#FF6B77]">
                      <MangaIcon name="shopping-bag" className="h-4 w-4" />
                    </span>
                    <h2 className="text-base font-bold text-white">
                      Phiên bản Sách In Tại Cửa Hàng
                    </h2>
                  </div>
                  <Link
                    to={`/products?search=${encodeURIComponent(manga.title)}`}
                    className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold text-white"
                  >
                    <PanelBadge asset="mode-store" className="h-5 w-5" />
                    <span>Tìm sách tại Cửa hàng</span>
                    <MangaIcon name="external-link" className="h-3.5 w-3.5" />
                  </Link>
                </div>

                {matchedStoreProducts.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {matchedStoreProducts.map((prod) => (
                      <MangaCard3D key={prod.id} product={prod} compact />
                    ))}
                  </div>
                ) : detail?.is_store_db_online === false ? (
                  <p className="text-xs text-amber-200/90">
                    Thông tin sản phẩm tại cửa hàng hiện tạm thời không khả dụng.
                  </p>
                ) : (
                  <p className="text-xs text-slate-400">
                    Chưa tìm thấy ấn bản sách in tương ứng tại cửa hàng.
                  </p>
                )}
              </div>

              {/* Chapter List Card */}
              <div className="ms-panel-2d space-y-4 rounded-3xl border border-white/10 bg-[#131722]/90 p-5 shadow-xl backdrop-blur-xl sm:p-6">
                <div className="flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-lg font-bold text-white">
                      Danh sách chương ({allChapters.length})
                      {chapterQuery.trim() ? (
                        <span className="text-sm font-normal text-cyan-300">
                          {" "}
                          • Khớp {filteredChapters.length}
                        </span>
                      ) : null}
                    </h2>

                    {(detail?.available_languages ?? []).length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(detail?.available_languages ?? []).map((langCode) => {
                          const isActive =
                            langCode.toLowerCase() === selectedLanguage.toLowerCase();
                          return (
                            <button
                              key={langCode}
                              type="button"
                              onClick={() => handleLanguageChange(langCode)}
                              className={`ms-pill-2d rounded-lg border px-2.5 py-1 text-xs font-semibold uppercase ${
                                isActive
                                  ? "ms-pill-2d-active-cyan text-cyan-100"
                                  : "border-white/10 text-slate-300 hover:border-white/25 hover:text-white"
                              }`}
                            >
                              {langCode}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                    <div className="relative flex items-center gap-2">
                      <div className="relative flex-1 sm:flex-none">
                        <MangaIcon
                          name="search"
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          type="text"
                          value={chapterQuery}
                          onChange={(e) => setChapterQuery(e.target.value)}
                          placeholder="Tìm số chương hoặc tên..."
                          aria-label="Tìm kiếm chương"
                          className="h-10 w-full rounded-xl border border-white/15 bg-[#0B0D14]/80 pl-9 pr-8 text-xs text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none sm:w-56"
                        />
                        {chapterQuery ? (
                          <button
                            type="button"
                            onClick={() => setChapterQuery("")}
                            aria-label="Xóa tìm kiếm chương"
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-white"
                          >
                            <MangaIcon name="x" className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setChapterOrder("desc")}
                        className={`ms-pill-2d inline-flex h-10 items-center justify-center rounded-xl border px-3 text-xs ${
                          chapterOrder === "desc"
                            ? "ms-pill-2d-active-cyan font-semibold text-cyan-100"
                            : "border-white/10 font-medium text-slate-300 hover:border-cyan-400/50 hover:text-white"
                        }`}
                      >
                        Mới nhất
                      </button>
                      <button
                        type="button"
                        onClick={() => setChapterOrder("asc")}
                        className={`ms-pill-2d inline-flex h-10 items-center justify-center rounded-xl border px-3 text-xs ${
                          chapterOrder === "asc"
                            ? "ms-pill-2d-active-cyan font-semibold text-cyan-100"
                            : "border-white/10 font-medium text-slate-300 hover:border-cyan-400/50 hover:text-white"
                        }`}
                      >
                        Cũ nhất
                      </button>
                    </div>
                  </div>
                </div>

                {filteredChapters.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-400">
                    {chapterQuery.trim()
                      ? `Không tìm thấy chương nào khớp với "${chapterQuery.trim()}".`
                      : "Chưa có chương nào khả dụng cho ngôn ngữ này."}
                  </div>
                ) : (
                  <div className="max-h-[40rem] divide-y divide-white/10 overflow-y-auto pr-1">
                    {filteredChapters.map((ch) => {
                      const chLabel =
                        ch.display_label?.trim() ||
                        (ch.chapter_number ? `Chương ${ch.chapter_number}` : "Chương");
                      const chTitle = (ch.title || "").trim();
                      const isCurrentChapter =
                        Boolean(detail?.last_history?.chapter_id) &&
                        detail?.last_history?.chapter_id.toLowerCase() === ch.id.toLowerCase();
                      const isReadChapter = readChapterSet.has(ch.id.toLowerCase());
                      const dotClass = isCurrentChapter
                        ? "bg-cyan-400"
                        : isReadChapter
                          ? "bg-emerald-400"
                          : "bg-slate-600";

                      return (
                        <Link
                          key={ch.id}
                          to={buildReadUrl(ch.id)}
                          className={`group flex flex-col gap-2 rounded-xl px-3 py-3 transition-colors hover:bg-cyan-500/10 sm:flex-row sm:items-center sm:justify-between ${
                            isCurrentChapter || isReadChapter ? "opacity-90" : ""
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${dotClass}`}
                            />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-white group-hover:text-cyan-300">
                                  {chLabel}
                                </span>
                                {chTitle &&
                                chTitle.toLowerCase() !== chLabel.toLowerCase() ? (
                                  <span className="truncate text-xs text-slate-300">
                                    - {chTitle}
                                  </span>
                                ) : null}
                                {isCurrentChapter ? (
                                  <span className="ms-pill-2d ms-pill-2d-active-cyan rounded-md border px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100">
                                    Đang đọc
                                  </span>
                                ) : isReadChapter ? (
                                  <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                                    Đã đọc
                                  </span>
                                ) : null}
                              </div>
                              {ch.scanlation_group ? (
                                <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                  {ch.scanlation_group}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-3 pl-5 text-xs text-slate-400 sm:pl-0">
                            {ch.language ? (
                              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-300">
                                {ch.language}
                              </span>
                            ) : null}
                            {ch.page_count > 0 ? <span>{ch.page_count} trang</span> : null}
                            {ch.published_at ? (
                              <span>{formatDate(ch.published_at)}</span>
                            ) : null}
                            <span
                              className={`ms-pill-2d inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                                isCurrentChapter
                                  ? "ms-pill-2d-active-cyan text-cyan-100"
                                  : "border-white/10 text-slate-200 group-hover:border-cyan-400/50 group-hover:text-cyan-200"
                              }`}
                            >
                              <span>{isCurrentChapter ? "Đọc tiếp" : "Đọc"}</span>
                              <MangaIcon name="chevron-right" className="h-3.5 w-3.5" />
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 5-Star Rating & 1-Level Threaded Comments */}
              <div
                id="reader-comments"
                className="ms-panel-2d space-y-6 rounded-3xl border border-white/10 bg-[#131722]/90 p-5 shadow-xl backdrop-blur-xl sm:p-6"
              >
                <div className="flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                      <MangaIcon name="message-circle" className="h-5 w-5 text-cyan-400" />
                      <span>Bình luận &amp; Đánh giá</span>
                    </h2>
                    {localStats && localStats.ratings_count > 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200">
                        <MangaIcon name="star" className="h-3.5 w-3.5 text-amber-400" />
                        <span>
                          {localStats.average_rating.toFixed(1)} / 5 (
                          {localStats.ratings_count.toLocaleString("vi-VN")} đánh giá)
                        </span>
                      </span>
                    ) : null}
                  </div>

                  {/* Inline 5-Star Selector */}
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#0B0D14]/70 px-3.5 py-2">
                    <span className="text-xs font-medium text-slate-300">
                      Đánh giá của bạn:
                    </span>
                    <div
                      className="flex items-center gap-1"
                      onMouseLeave={() => setHoverStar(null)}
                    >
                      {[1, 2, 3, 4, 5].map((star) => {
                        const activeScore = hoverStar ?? currentUserRating;
                        const isActive = star <= activeScore;
                        return (
                          <button
                            key={star}
                            type="button"
                            disabled={savingRating}
                            onMouseEnter={() => setHoverStar(star)}
                            onClick={() => void handleRate(star)}
                            title={`Đánh giá ${star} sao`}
                            aria-label={`Đánh giá ${star} sao`}
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-transform hover:scale-110 disabled:opacity-50 ${
                              isActive ? "text-amber-400" : "text-slate-500 hover:text-amber-300"
                            }`}
                          >
                            <MangaIcon name="star" className="h-4 w-4 text-current" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {user ? (
                  <form
                    onSubmit={(e) => void handlePostComment(e)}
                    className="space-y-3 rounded-2xl border border-white/10 bg-[#0B0D14]/70 p-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <img
                        src={resolveAvatar(user.avatar_url)}
                        alt={user.username}
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = DEFAULT_AVATAR_URL;
                        }}
                        className="h-8 w-8 rounded-full border border-white/15 bg-[#1B2130] object-cover"
                      />
                      <span className="text-xs font-semibold text-white">
                        {user.username}
                      </span>
                    </div>
                    <textarea
                      required
                      maxLength={2000}
                      rows={3}
                      value={commentInput}
                      onChange={(e) => setCommentInput(e.target.value)}
                      placeholder="Chia sẻ cảm nhận về bộ truyện..."
                      className="w-full rounded-xl border border-white/15 bg-[#131722]/90 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/25"
                    />
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={postingComment}
                        className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold text-white disabled:opacity-60 sm:text-sm"
                      >
                        <MangaIcon name="send" className="h-4 w-4" />
                        <span>{postingComment ? "Đang gửi..." : "Gửi bình luận"}</span>
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0B0D14]/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2.5 text-sm text-slate-300">
                      <MangaIcon name="lock" className="h-4 w-4 shrink-0 text-cyan-300" />
                      <span>Đăng nhập để bình luận và đánh giá truyện.</span>
                    </div>
                    <Link
                      to="/auth"
                      className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold text-white sm:text-sm"
                    >
                      <MangaIcon name="log-in" className="h-4 w-4" />
                      <span>Đăng nhập</span>
                    </Link>
                  </div>
                )}

                {comments.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-[#0B0D14]/50 px-5 py-8 text-center text-sm text-slate-400">
                    Chưa có bình luận nào. Hãy là người đầu tiên chia sẻ cảm nhận.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {comments.map((c) => {
                      const cName = resolveCommentUsername(c);
                      const cAvatar = resolveAvatar(c.avatar_url);
                      const replies = c.replies ?? [];
                      const isReplying = activeReplyId === c.id;

                      return (
                        <article
                          key={c.id}
                          className="space-y-3 rounded-2xl border border-white/10 bg-[#0B0D14]/65 p-4"
                        >
                          <div className="flex items-start gap-3">
                            <img
                              src={cAvatar}
                              alt={cName}
                              onError={(e) => {
                                e.currentTarget.onerror = null;
                                e.currentTarget.src = DEFAULT_AVATAR_URL;
                              }}
                              className="h-10 w-10 shrink-0 rounded-full border border-white/15 bg-[#1B2130] object-cover"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-white">
                                    {cName}
                                  </span>
                                  {c.is_staff ? (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                                      <MangaIcon name="shield-check" className="h-3 w-3" />
                                      <span>Staff / Admin</span>
                                    </span>
                                  ) : null}
                                  {c.chapter_label ? (
                                    <span className="rounded-md border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-200">
                                      {c.chapter_label}
                                    </span>
                                  ) : null}
                                </div>

                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                                  <MangaIcon name="clock" className="h-3 w-3" />
                                  <span>{formatDateTime(c.created_at)}</span>
                                </span>
                              </div>

                              <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-slate-200">
                                {c.content}
                              </p>

                              {user || c.can_delete ? (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  {user ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (isReplying) {
                                          setActiveReplyId(null);
                                          setReplyInput("");
                                        } else {
                                          setActiveReplyId(c.id);
                                          setReplyInput("");
                                        }
                                      }}
                                      className="ms-btn-2d ms-btn-2d-dark inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium text-slate-300 hover:border-cyan-400/40 hover:text-cyan-200"
                                    >
                                      <MangaIcon name="reply" className="h-3.5 w-3.5" />
                                      <span>{isReplying ? "Đóng" : "Trả lời"}</span>
                                    </button>
                                  ) : null}

                                  {c.can_delete ? (
                                    <button
                                      type="button"
                                      onClick={() => setCommentToDelete(c)}
                                      className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium text-rose-200"
                                    >
                                      <MangaIcon name="trash-2" className="h-3.5 w-3.5" />
                                      <span>Xóa</span>
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}

                              {isReplying && user ? (
                                <form
                                  onSubmit={(e) => void handlePostReply(e, c.id)}
                                  className="mt-3 space-y-2.5 rounded-xl border border-white/10 bg-[#131722]/90 p-3"
                                >
                                  <textarea
                                    required
                                    maxLength={2000}
                                    rows={2}
                                    value={replyInput}
                                    onChange={(e) => setReplyInput(e.target.value)}
                                    placeholder={`Trả lời ${cName}...`}
                                    className="w-full rounded-xl border border-white/15 bg-[#0B0D14]/85 px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/25 sm:text-sm"
                                  />
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveReplyId(null);
                                        setReplyInput("");
                                      }}
                                      className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:text-white"
                                    >
                                      Hủy
                                    </button>
                                    <button
                                      type="submit"
                                      disabled={postingReply}
                                      className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                                    >
                                      <MangaIcon name="send" className="h-3.5 w-3.5" />
                                      <span>{postingReply ? "Đang gửi..." : "Gửi trả lời"}</span>
                                    </button>
                                  </div>
                                </form>
                              ) : null}

                              {replies.length > 0 ? (
                                <div className="ml-4 mt-3 space-y-2.5 border-l border-cyan-500/25 pl-3.5 sm:ml-8">
                                  {replies.map((r) => {
                                    const rName = resolveCommentUsername(r);
                                    const rAvatar = resolveAvatar(r.avatar_url);
                                    return (
                                      <div
                                        key={r.id}
                                        className="rounded-xl border border-white/10 bg-[#131722]/75 p-3"
                                      >
                                        <div className="flex items-start gap-2.5">
                                          <img
                                            src={rAvatar}
                                            alt={rName}
                                            onError={(e) => {
                                              e.currentTarget.onerror = null;
                                              e.currentTarget.src = DEFAULT_AVATAR_URL;
                                            }}
                                            className="h-8 w-8 shrink-0 rounded-full border border-white/15 bg-[#1B2130] object-cover"
                                          />
                                          <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                              <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-xs font-semibold text-white sm:text-sm">
                                                  {rName}
                                                </span>
                                                {r.is_staff ? (
                                                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                                                    <MangaIcon
                                                      name="shield-check"
                                                      className="h-3 w-3"
                                                    />
                                                    <span>Staff / Admin</span>
                                                  </span>
                                                ) : null}
                                                {r.chapter_label ? (
                                                  <span className="rounded-md border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-200">
                                                    {r.chapter_label}
                                                  </span>
                                                ) : null}
                                              </div>
                                              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                                                <MangaIcon name="clock" className="h-3 w-3" />
                                                <span>{formatDateTime(r.created_at)}</span>
                                              </span>
                                            </div>

                                            <p className="mt-1.5 whitespace-pre-line break-words text-xs leading-relaxed text-slate-200 sm:text-sm">
                                              {r.content}
                                            </p>

                                            {r.can_delete ? (
                                              <div className="mt-2">
                                                <button
                                                  type="button"
                                                  onClick={() => setCommentToDelete(r)}
                                                  className="ms-btn-2d ms-btn-2d-crimson inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium text-rose-200"
                                                >
                                                  <MangaIcon name="trash-2" className="h-3 w-3" />
                                                  <span>Xóa</span>
                                                </button>
                                              </div>
                                            ) : null}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <ConfirmDialog
        open={commentToDelete !== null}
        title="Xóa bình luận"
        message="Bạn có chắc chắn muốn xóa bình luận này? Thao tác này không thể hoàn tác."
        confirmLabel="Xóa bình luận"
        danger
        busy={deletingComment}
        onConfirm={() => void handleConfirmDeleteComment()}
        onCancel={() => {
          if (!deletingComment) setCommentToDelete(null);
        }}
      />
    </StoreLayout>
  );
}

export default ReaderDetailPage;
