import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  List,
  Lock,
  LogIn,
  MessageCircle,
  Minus,
  Plus,
  RefreshCw,
  Reply,
  RotateCcw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { ToastContainer } from "../../components/ui/ToastContainer";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { ApiError, apiClient, request } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import type {
  ReaderChapterDto,
  ReaderCommentDto,
  ReaderReadResponse,
} from "../../types/api";

type ReaderMode = "webtoon" | "vertical" | "rtl" | "ltr";
type ReaderTheme = "amoled" | "dark" | "sepia" | "light";
type ReaderFit = "width" | "compact" | "wide" | "height";
type ReaderQuality = "saver" | "original";

interface ReaderPrefs {
  mode: ReaderMode;
  theme: ReaderTheme;
  fit: ReaderFit;
  quality: ReaderQuality;
  useImageProxy: boolean;
  fontSize: number;
}

type ReaderCommentWire = ReaderCommentDto & {
  user_name?: string | null;
  is_staff?: boolean;
  can_delete?: boolean;
  replies?: ReaderCommentWire[];
};

type ReaderChapterWire = ReaderChapterDto & {
  chapter_id?: string | null;
  display_label?: string | null;
  chapter_number?: string | null;
  chapter?: string | null;
  title?: string | null;
  translated_language?: string | null;
  scanlation_group?: string | null;
};

type ReaderReadWire = ReaderReadResponse & {
  source_id?: string;
  source_name?: string;
  manga_id?: string;
  manga_title?: string;
  title?: string;
  cover_url?: string;
  chapter_id?: string;
  chapter_label?: string;
  chapter_title?: string;
  translated_language?: string;
  selected_language?: string;
  available_languages?: string[];
  is_text_content?: boolean;
  text_content?: string | null;
  original_pages?: string[];
  data_saver_pages?: string[];
  proxied_original_pages?: string[];
  proxied_data_saver_pages?: string[];
  proxied_saver_pages?: string[];
  raw_pages?: string[];
  proxied_pages?: string[];
  pages?: string[];
  next_chapter_id?: string | null;
  prev_chapter_id?: string | null;
  previous_chapter_id?: string | null;
  chapters?: ReaderChapterWire[];
  reader_comments?: ReaderCommentWire[];
  comments?: ReaderCommentWire[];
  total_comment_count?: number;
  current_page?: number;
  total_pages?: number;
  error_message?: string | null;
};

const PREFS_STORAGE_KEY = "ms_reader_prefs_v1";

const DEFAULT_PREFS: ReaderPrefs = {
  mode: "webtoon",
  theme: "amoled",
  fit: "width",
  quality: "saver",
  useImageProxy: true,
  fontSize: 18,
};

const MODE_OPTIONS: Array<{ value: ReaderMode; label: string; hint: string }> = [
  { value: "webtoon", label: "Webtoon", hint: "Cuộn dọc liền mạch" },
  { value: "vertical", label: "Cuộn tách trang", hint: "Có khoảng cách & số trang" },
  { value: "rtl", label: "Lật P → T", hint: "Manga Nhật (chạm/mũi tên)" },
  { value: "ltr", label: "Lật T → P", hint: "Truyện thường (chạm/mũi tên)" },
];

const THEME_OPTIONS: Array<{
  value: ReaderTheme;
  label: string;
  bgClass: string;
  textClass: string;
  surfaceClass: string;
  borderClass: string;
  swatchColor: string;
}> = [
  {
    value: "amoled",
    label: "AMOLED",
    bgClass: "bg-black",
    textClass: "text-[#F5F6FA]",
    surfaceClass: "bg-[#090B11]",
    borderClass: "border-white/10",
    swatchColor: "#000000",
  },
  {
    value: "dark",
    label: "Tối",
    bgClass: "bg-[#0B0D14]",
    textClass: "text-slate-100",
    surfaceClass: "bg-[#111522]",
    borderClass: "border-white/10",
    swatchColor: "#0B0D14",
  },
  {
    value: "sepia",
    label: "Giấy cổ",
    bgClass: "bg-[#F4ECD8]",
    textClass: "text-[#433422]",
    surfaceClass: "bg-[#EAE0C8]",
    borderClass: "border-[#CBB994]",
    swatchColor: "#F4ECD8",
  },
  {
    value: "light",
    label: "Sáng",
    bgClass: "bg-[#F8FAFC]",
    textClass: "text-[#0F172A]",
    surfaceClass: "bg-white",
    borderClass: "border-slate-200",
    swatchColor: "#F8FAFC",
  },
];

const FIT_OPTIONS: Array<{ value: ReaderFit; label: string }> = [
  { value: "width", label: "Vừa màn hình" },
  { value: "compact", label: "Thu gọn" },
  { value: "wide", label: "Mở rộng" },
  { value: "height", label: "Khớp chiều cao" },
];

function loadReaderPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    const mode: ReaderMode =
      parsed.mode === "webtoon" ||
      parsed.mode === "vertical" ||
      parsed.mode === "rtl" ||
      parsed.mode === "ltr"
        ? parsed.mode
        : DEFAULT_PREFS.mode;
    const theme: ReaderTheme =
      parsed.theme === "amoled" ||
      parsed.theme === "dark" ||
      parsed.theme === "sepia" ||
      parsed.theme === "light"
        ? parsed.theme
        : DEFAULT_PREFS.theme;
    const fit: ReaderFit =
      parsed.fit === "width" ||
      parsed.fit === "compact" ||
      parsed.fit === "wide" ||
      parsed.fit === "height"
        ? parsed.fit
        : DEFAULT_PREFS.fit;
    const quality: ReaderQuality =
      parsed.quality === "original" || parsed.quality === "saver"
        ? parsed.quality
        : DEFAULT_PREFS.quality;
    const useImageProxy =
      typeof parsed.useImageProxy === "boolean"
        ? parsed.useImageProxy
        : DEFAULT_PREFS.useImageProxy;
    const fontSize =
      typeof parsed.fontSize === "number" && parsed.fontSize >= 14 && parsed.fontSize <= 28
        ? parsed.fontSize
        : DEFAULT_PREFS.fontSize;
    return { mode, theme, fit, quality, useImageProxy, fontSize };
  } catch {
    return DEFAULT_PREFS;
  }
}

function getChapterId(ch: ReaderChapterWire): string {
  return String(ch.id || ch.chapter_id || "");
}

function getChapterLabel(ch: ReaderChapterWire): string {
  if (ch.display_label) return ch.display_label;
  const num = ch.chapter || ch.chapter_number;
  const base = num ? `Chương ${num}` : "Chương";
  return ch.title ? `${base} — ${ch.title}` : base;
}

function getCommentAuthor(c: ReaderCommentWire): string {
  return c.user_name || c.username || "Độc giả";
}

function appendCacheBust(url: string, attempt: number): string {
  if (attempt <= 0) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_retry=${attempt}`;
}

export function ReaderReadPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const source = searchParams.get("source") || "mangadex-vi";
  const mangaId = searchParams.get("mangaId") || searchParams.get("manga_id") || "";
  const chapterId = searchParams.get("chapterId") || searchParams.get("chapter_id") || "";
  const lang = searchParams.get("lang") || "vi";
  const initialPageParam = Number(searchParams.get("page") || "1");

  const [prefs, setPrefs] = useState<ReaderPrefs>(loadReaderPrefs);
  const [hudVisible, setHudVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const [data, setData] = useState<ReaderReadWire | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [currentPage, setCurrentPage] = useState(1);
  const [failedPages, setFailedPages] = useState<Record<number, boolean>>({});
  const [retryCounts, setRetryCounts] = useState<Record<number, number>>({});

  // Comments state
  const [comments, setComments] = useState<ReaderCommentWire[]>([]);
  const [totalCommentCount, setTotalCommentCount] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [replyTargetId, setReplyTargetId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deletingComment, setDeletingComment] = useState(false);

  const settingsPopoverRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const lastSavedProgressRef = useRef<string>("");

  // Persist reader preferences
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore storage quota errors
    }
  }, [prefs]);

  // Close settings popover on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (
        settingsPopoverRef.current &&
        !settingsPopoverRef.current.contains(e.target as Node)
      ) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [settingsOpen]);

  // Fetch chapter read payload
  useEffect(() => {
    if (!chapterId) {
      setLoadError("Thiếu mã chương truyện để đọc.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setFailedPages({});
    setRetryCounts({});
    pageRefs.current = [];

    const qs = new URLSearchParams({
      source,
      manga_id: mangaId,
      chapter_id: chapterId,
      lang,
      quality: prefs.quality,
      proxy: String(prefs.useImageProxy),
    });
    if (Number.isFinite(initialPageParam) && initialPageParam > 1) {
      qs.set("page", String(initialPageParam));
    }

    request<ReaderReadWire>(`/api/reader/read?${qs.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        const list = res.reader_comments ?? res.comments ?? [];
        setComments(list);
        setTotalCommentCount(res.total_comment_count ?? list.length);
        const startPage =
          Number.isFinite(initialPageParam) && initialPageParam > 0
            ? initialPageParam
            : res.current_page && res.current_page > 0
            ? res.current_page
            : 1;
        setCurrentPage(startPage);
        window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : "Không thể tải nội dung chương truyện.";
        setLoadError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    source,
    mangaId,
    chapterId,
    lang,
    prefs.quality,
    prefs.useImageProxy,
    reloadNonce,
    initialPageParam,
  ]);

  // Resolve active image pages respecting quality & proxy preferences
  const resolvedPages = useMemo(() => {
    if (!data || data.is_text_content) return [];

    const proxiedSaver =
      data.proxied_data_saver_pages ?? data.proxied_saver_pages ?? [];
    const proxiedOrig = data.proxied_original_pages ?? data.proxied_pages ?? [];
    const rawSaver = data.data_saver_pages ?? [];
    const rawOrig = data.original_pages ?? data.raw_pages ?? [];
    const fallbackPages = data.pages ?? [];

    if (prefs.useImageProxy) {
      if (prefs.quality === "original") {
        if (proxiedOrig.length > 0) return proxiedOrig;
        if (proxiedSaver.length > 0) return proxiedSaver;
        if (rawOrig.length > 0) return rawOrig;
        return fallbackPages;
      }
      if (proxiedSaver.length > 0) return proxiedSaver;
      if (proxiedOrig.length > 0) return proxiedOrig;
      if (rawSaver.length > 0) return rawSaver;
      return fallbackPages;
    }

    if (prefs.quality === "original") {
      if (rawOrig.length > 0) return rawOrig;
      if (rawSaver.length > 0) return rawSaver;
      return fallbackPages;
    }
    if (rawSaver.length > 0) return rawSaver;
    if (rawOrig.length > 0) return rawOrig;
    return fallbackPages;
  }, [data, prefs.quality, prefs.useImageProxy]);

  const totalPages = data?.is_text_content
    ? 1
    : resolvedPages.length || data?.total_pages || 0;

  // Clamp currentPage when resolvedPages changes
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    } else if (currentPage < 1) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  const effectiveMangaId = data?.manga_id || mangaId;
  const effectiveLang = data?.selected_language || data?.translated_language || lang;
  const mangaTitle = data?.manga_title || data?.title || "Đọc truyện Online";
  const chapterLabel =
    data?.chapter_label || data?.chapter_title || (chapterId ? "Đọc chương" : "");
  const prevChapterId = data?.prev_chapter_id ?? data?.previous_chapter_id ?? null;
  const nextChapterId = data?.next_chapter_id ?? null;

  const detailUrl = useMemo(() => {
    const qs = new URLSearchParams({
      source,
      id: effectiveMangaId,
      lang: effectiveLang,
    });
    return `/doc-truyen/chi-tiet?${qs.toString()}`;
  }, [source, effectiveMangaId, effectiveLang]);

  const buildReadUrl = useCallback(
    (targetChapterId: string) => {
      const qs = new URLSearchParams({
        source,
        mangaId: effectiveMangaId,
        chapterId: targetChapterId,
        lang: effectiveLang,
      });
      return `/doc-truyen/doc?${qs.toString()}`;
    },
    [source, effectiveMangaId, effectiveLang],
  );

  const navigateToChapter = useCallback(
    (targetChapterId: string | null) => {
      if (!targetChapterId) return;
      navigate(buildReadUrl(targetChapterId));
    },
    [navigate, buildReadUrl],
  );

  const isPagedMode = prefs.mode === "rtl" || prefs.mode === "ltr";

  // Preload next 2 images in paged modes
  useEffect(() => {
    if (!isPagedMode || data?.is_text_content || resolvedPages.length === 0) return;
    const targets = [currentPage, currentPage + 1];
    for (const idx of targets) {
      const url = resolvedPages[idx];
      if (!url) continue;
      const img = new Image();
      img.src = url;
    }
  }, [isPagedMode, data?.is_text_content, resolvedPages, currentPage]);

  const goToNextPage = useCallback(() => {
    if (totalPages === 0) return;
    if (currentPage < totalPages) {
      setCurrentPage((p) => Math.min(totalPages, p + 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (nextChapterId) {
      navigateToChapter(nextChapterId);
    } else {
      showToast("Bạn đã ở trang cuối cùng của chương mới nhất.", "info");
    }
  }, [currentPage, totalPages, nextChapterId, navigateToChapter, showToast]);

  const goToPrevPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage((p) => Math.max(1, p - 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (prevChapterId) {
      navigateToChapter(prevChapterId);
    } else {
      showToast("Đây là trang đầu tiên.", "info");
    }
  }, [currentPage, prevChapterId, navigateToChapter, showToast]);

  // Keyboard shortcuts: H toggles HUD, ArrowLeft/Right navigate paged modes or chapters
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        setHudVisible((v) => !v);
        setSettingsOpen(false);
        return;
      }

      if (e.key === "Escape") {
        setSettingsOpen(false);
        return;
      }

      if (isPagedMode && !data?.is_text_content) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          if (prefs.mode === "rtl") goToNextPage();
          else goToPrevPage();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          if (prefs.mode === "rtl") goToPrevPage();
          else goToNextPage();
        }
      } else {
        if (e.key === "ArrowLeft" && prevChapterId) {
          e.preventDefault();
          navigateToChapter(prevChapterId);
        } else if (e.key === "ArrowRight" && nextChapterId) {
          e.preventDefault();
          navigateToChapter(nextChapterId);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isPagedMode,
    data?.is_text_content,
    prefs.mode,
    goToNextPage,
    goToPrevPage,
    prevChapterId,
    nextChapterId,
    navigateToChapter,
  ]);

  // Track visible page in vertical / webtoon scroll modes
  useEffect(() => {
    if (isPagedMode || data?.is_text_content || resolvedPages.length === 0) return;

    let rafId = 0;
    const detectVisiblePage = () => {
      rafId = 0;
      const anchorY = window.innerHeight * 0.35;
      let bestIndex = 0;
      let bestDist = Infinity;

      for (let i = 0; i < pageRefs.current.length; i++) {
        const el = pageRefs.current[i];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= anchorY && rect.bottom >= anchorY) {
          bestIndex = i;
          bestDist = 0;
          break;
        }
        const dist = Math.min(
          Math.abs(rect.top - anchorY),
          Math.abs(rect.bottom - anchorY),
        );
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = i;
        }
      }

      const nextPage = bestIndex + 1;
      setCurrentPage((prev) => (prev === nextPage ? prev : nextPage));
    };

    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(detectVisiblePage);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [isPagedMode, data?.is_text_content, resolvedPages.length]);

  // Sync reading progress to backend when logged in (debounced)
  useEffect(() => {
    if (!user || !data || !effectiveMangaId || !chapterId || loading) return;
    const progressKey = `${source}:${effectiveMangaId}:${chapterId}:${currentPage}`;
    if (lastSavedProgressRef.current === progressKey) return;

    const timer = window.setTimeout(() => {
      lastSavedProgressRef.current = progressKey;
      apiClient
        .post("/api/reader/progress", {
          source_id: source,
          manga_id: effectiveMangaId,
          chapter_id: chapterId,
          page: Math.max(1, currentPage),
          total_pages: Math.max(0, totalPages),
          title: mangaTitle,
          chapter_label: chapterLabel,
          cover_url: data.cover_url || "",
          language: effectiveLang,
        })
        .catch(() => {
          // Allow retry on subsequent interaction if sync temporarily failed
          if (lastSavedProgressRef.current === progressKey) {
            lastSavedProgressRef.current = "";
          }
        });
    }, 650);

    return () => window.clearTimeout(timer);
  }, [
    user,
    data,
    source,
    effectiveMangaId,
    chapterId,
    currentPage,
    totalPages,
    mangaTitle,
    chapterLabel,
    effectiveLang,
    loading,
  ]);

  const themeConfig = useMemo(
    () => THEME_OPTIONS.find((t) => t.value === prefs.theme) ?? THEME_OPTIONS[0],
    [prefs.theme],
  );

  const containerFitClass = useMemo(() => {
    switch (prefs.fit) {
      case "compact":
        return "max-w-2xl";
      case "wide":
        return "max-w-6xl";
      case "height":
        return "max-w-5xl";
      case "width":
      default:
        return "max-w-4xl";
    }
  }, [prefs.fit]);

  const imageFitClass = useMemo(() => {
    if (prefs.fit === "height") {
      return "max-h-[calc(100vh-7.5rem)] w-auto max-w-full mx-auto object-contain";
    }
    return "w-full h-auto mx-auto block";
  }, [prefs.fit]);

  const handleRetryImage = (idx: number) => {
    setFailedPages((prev) => ({ ...prev, [idx]: false }));
    setRetryCounts((prev) => ({ ...prev, [idx]: (prev[idx] || 0) + 1 }));
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = commentText.trim();
    if (!content) return;
    if (!user) {
      navigate("/auth");
      return;
    }

    setSubmittingComment(true);
    try {
      const res = await apiClient.post<{
        comment: ReaderCommentWire;
        comment_count: number;
      }>("/api/reader/comments", {
        source_id: source,
        manga_id: effectiveMangaId,
        chapter_id: chapterId,
        chapter_label: chapterLabel,
        content,
      });
      setComments((prev) => [res.comment, ...prev]);
      setTotalCommentCount(res.comment_count);
      setCommentText("");
      showToast("Đã đăng bình luận chương.", "success");
    } catch (err: unknown) {
      showToast(
        err instanceof Error ? err.message : "Không thể gửi bình luận.",
        "error",
      );
    } finally {
      setSubmittingComment(false);
    }
  };

  const handlePostReply = async (parentId: number) => {
    const content = replyText.trim();
    if (!content) return;
    if (!user) {
      navigate("/auth");
      return;
    }

    setSubmittingReply(true);
    try {
      const res = await apiClient.post<{
        comment: ReaderCommentWire;
        comment_count: number;
      }>("/api/reader/comments", {
        source_id: source,
        manga_id: effectiveMangaId,
        chapter_id: chapterId,
        chapter_label: chapterLabel,
        parent_comment_id: parentId,
        content,
      });
      setComments((prev) =>
        prev.map((c) =>
          c.id === parentId
            ? { ...c, replies: [...(c.replies ?? []), res.comment] }
            : c,
        ),
      );
      setTotalCommentCount(res.comment_count);
      setReplyTargetId(null);
      setReplyText("");
      showToast("Đã gửi phản hồi.", "success");
    } catch (err: unknown) {
      showToast(
        err instanceof Error ? err.message : "Không thể gửi phản hồi.",
        "error",
      );
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleConfirmDeleteComment = async () => {
    if (deleteTargetId === null) return;
    setDeletingComment(true);
    try {
      const res = await apiClient.del<{ comment_count: number }>(
        `/api/reader/comments/${deleteTargetId}`,
      );
      setComments((prev) =>
        prev
          .filter((c) => c.id !== deleteTargetId)
          .map((c) => ({
            ...c,
            replies: (c.replies ?? []).filter((r) => r.id !== deleteTargetId),
          })),
      );
      setTotalCommentCount(res.comment_count);
      setDeleteTargetId(null);
      showToast("Đã xóa bình luận.", "info");
    } catch (err: unknown) {
      showToast(
        err instanceof Error ? err.message : "Không thể xóa bình luận.",
        "error",
      );
    } finally {
      setDeletingComment(false);
    }
  };

  const chapters = data?.chapters ?? [];
  const isLightTheme = prefs.theme === "light" || prefs.theme === "sepia";
  const textParagraphs = useMemo(() => {
    if (!data?.is_text_content || !data.text_content) return [];
    return data.text_content
      .split(/\r?\n\s*\r?\n|\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }, [data?.is_text_content, data?.text_content]);

  return (
    <div
      className={`min-h-screen transition-colors duration-200 ${themeConfig.bgClass} ${themeConfig.textClass}`}
    >
      <ToastContainer />

      {/* Top HUD */}
      {hudVisible ? (
        <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#0B0D14]/92 text-slate-100 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-5">
            {/* Left: Back & title */}
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <Link
                to={detailUrl}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-slate-200 transition hover:border-cyan-400/50 hover:text-cyan-300"
                title="Quay lại trang chi tiết truyện"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Chi tiết</span>
              </Link>
              <div className="min-w-0">
                <p className="truncate text-xs font-extrabold text-white sm:text-sm">
                  {mangaTitle}
                </p>
                <p className="truncate text-[11px] font-medium text-cyan-300/90">
                  {chapterLabel || "Đang tải chương..."}
                  {!data?.is_text_content && totalPages > 0
                    ? ` · Trang ${currentPage}/${totalPages}`
                    : ""}
                </p>
              </div>
            </div>

            {/* Center/Right controls */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {/* Chapter selector */}
              {chapters.length > 0 && (
                <div className="relative flex items-center">
                  <List className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
                  <select
                    aria-label="Chọn chương"
                    value={chapterId}
                    onChange={(e) => navigateToChapter(e.target.value)}
                    className="max-w-[165px] truncate rounded-lg border border-white/15 bg-[#121622] py-1.5 pl-8 pr-3 text-xs font-semibold text-slate-100 outline-none transition focus:border-cyan-400 sm:max-w-[230px]"
                  >
                    {chapters.map((ch) => {
                      const cid = getChapterId(ch);
                      return (
                        <option key={cid} value={cid}>
                          {getChapterLabel(ch)}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Prev / Next Chapter quick buttons */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!prevChapterId}
                  onClick={() => navigateToChapter(prevChapterId)}
                  title="Chương trước"
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden md:inline">Trước</span>
                </button>
                <button
                  type="button"
                  disabled={!nextChapterId}
                  onClick={() => navigateToChapter(nextChapterId)}
                  title="Chương sau"
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="hidden md:inline">Sau</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Settings popover trigger */}
              <div className="relative" ref={settingsPopoverRef}>
                <button
                  type="button"
                  onClick={() => setSettingsOpen((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
                    settingsOpen
                      ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                      : "border-white/10 bg-white/5 text-slate-200 hover:border-cyan-400/40"
                  }`}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  <span className="hidden sm:inline">Cài đặt</span>
                </button>

                {settingsOpen && (
                  <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/15 bg-[#121622] p-4 text-slate-100 shadow-2xl">
                    <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-cyan-300">
                        Tùy chỉnh trình đọc
                      </span>
                      <button
                        type="button"
                        onClick={() => setSettingsOpen(false)}
                        className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="space-y-4 text-xs">
                      {/* 4 Reading Modes */}
                      <div>
                        <p className="mb-1.5 font-bold text-slate-300">Chế độ đọc</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {MODE_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() =>
                                setPrefs((p) => ({ ...p, mode: opt.value }))
                              }
                              className={`rounded-lg border px-2.5 py-1.5 text-left transition ${
                                prefs.mode === opt.value
                                  ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/25"
                              }`}
                            >
                              <div className="font-bold">{opt.label}</div>
                              <div className="text-[10px] opacity-75">{opt.hint}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 4 Themes */}
                      <div>
                        <p className="mb-1.5 font-bold text-slate-300">Màu nền</p>
                        <div className="grid grid-cols-4 gap-1.5">
                          {THEME_OPTIONS.map((t) => (
                            <button
                              key={t.value}
                              type="button"
                              onClick={() =>
                                setPrefs((p) => ({ ...p, theme: t.value }))
                              }
                              className={`flex flex-col items-center gap-1 rounded-lg border px-1.5 py-2 transition ${
                                prefs.theme === t.value
                                  ? "border-cyan-400 bg-cyan-500/15 text-cyan-200"
                                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/25"
                              }`}
                            >
                              <span
                                className="h-4 w-4 rounded-full border border-white/30"
                                style={{ backgroundColor: t.swatchColor }}
                              />
                              <span className="text-[10px] font-bold">{t.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 4 Fit widths */}
                      <div>
                        <p className="mb-1.5 font-bold text-slate-300">Khung hiển thị</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {FIT_OPTIONS.map((f) => (
                            <button
                              key={f.value}
                              type="button"
                              onClick={() =>
                                setPrefs((p) => ({ ...p, fit: f.value }))
                              }
                              className={`rounded-lg border px-2.5 py-1.5 font-semibold transition ${
                                prefs.fit === f.value
                                  ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/25"
                              }`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Quality & Image Proxy */}
                      {!data?.is_text_content && (
                        <div className="space-y-2.5 border-t border-white/10 pt-3">
                          <div>
                            <p className="mb-1.5 font-bold text-slate-300">Chất lượng ảnh</p>
                            <div className="grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setPrefs((p) => ({ ...p, quality: "saver" }))
                                }
                                className={`rounded-lg border px-2.5 py-1.5 font-semibold transition ${
                                  prefs.quality === "saver"
                                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                                    : "border-white/10 bg-white/5 text-slate-300"
                                }`}
                              >
                                Tiết kiệm (Nhanh)
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setPrefs((p) => ({ ...p, quality: "original" }))
                                }
                                className={`rounded-lg border px-2.5 py-1.5 font-semibold transition ${
                                  prefs.quality === "original"
                                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                                    : "border-white/10 bg-white/5 text-slate-300"
                                }`}
                              >
                                Ảnh gốc (HD)
                              </button>
                            </div>
                          </div>

                          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                            <span className="font-semibold text-slate-200">
                              Dùng Image Proxy (chống lỗi ảnh)
                            </span>
                            <input
                              type="checkbox"
                              checked={prefs.useImageProxy}
                              onChange={(e) =>
                                setPrefs((p) => ({
                                  ...p,
                                  useImageProxy: e.target.checked,
                                }))
                              }
                              className="h-4 w-4 accent-cyan-400"
                            />
                          </label>
                        </div>
                      )}

                      {/* Text font size controls */}
                      {data?.is_text_content && (
                        <div className="border-t border-white/10 pt-3">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-300">
                              Cỡ chữ ({prefs.fontSize}px)
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setPrefs((p) => ({
                                    ...p,
                                    fontSize: Math.max(14, p.fontSize - 2),
                                  }))
                                }
                                className="rounded-md border border-white/10 bg-white/5 p-1.5 hover:border-cyan-400/50"
                                aria-label="Giảm cỡ chữ"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setPrefs((p) => ({
                                    ...p,
                                    fontSize: Math.min(28, p.fontSize + 2),
                                  }))
                                }
                                className="rounded-md border border-white/10 bg-white/5 p-1.5 hover:border-cyan-400/50"
                                aria-label="Tăng cỡ chữ"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between border-t border-white/10 pt-2.5 text-[11px] text-slate-400">
                        <span>Phím tắt: H (Ẩn/hiện HUD), ←/→</span>
                        <button
                          type="button"
                          onClick={() => setPrefs(DEFAULT_PREFS)}
                          className="font-semibold text-cyan-400 hover:underline"
                        >
                          Mặc định
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Hide HUD button */}
              <button
                type="button"
                onClick={() => {
                  setHudVisible(false);
                  setSettingsOpen(false);
                }}
                title="Ẩn thanh điều khiển (Phím H)"
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-slate-300 transition hover:border-cyan-400/40 hover:text-white"
              >
                <EyeOff className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>
      ) : (
        <button
          type="button"
          onClick={() => setHudVisible(true)}
          title="Hiện thanh điều khiển (Phím H)"
          className="fixed right-4 top-4 z-40 inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-[#0B0D14]/85 px-3 py-1.5 text-xs font-bold text-cyan-300 shadow-lg backdrop-blur-md transition hover:bg-[#111522]"
        >
          <Eye className="h-4 w-4" />
          <span>Hiện HUD (H)</span>
        </button>
      )}

      {/* Main Reader Stage */}
      <main className={hudVisible ? "pt-16 pb-10" : "pt-4 pb-10"}>
        {loading ? (
          <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-4 text-center">
            <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-cyan-500/20 border-t-cyan-400" />
            <p className="text-sm font-bold opacity-85">Đang tải nội dung chương truyện...</p>
            <p className="mt-1 text-xs opacity-60">
              Nguồn: {source} · Chế độ {prefs.quality === "original" ? "Ảnh gốc" : "Tiết kiệm"}
            </p>
          </div>
        ) : loadError || data?.error_message ? (
          <div className="mx-auto my-12 max-w-xl px-4">
            <div className="rounded-2xl border border-rose-500/30 bg-[#121622] p-6 text-center text-slate-100 shadow-xl">
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-rose-400" />
              <h1 className="text-lg font-extrabold text-white">
                Không thể tải chương truyện
              </h1>
              <p className="mt-2 text-sm text-slate-300">
                {loadError || data?.error_message}
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setReloadNonce((n) => n + 1)}
                  className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 px-4 py-2 text-xs font-bold"
                >
                  <RefreshCw className="h-4 w-4" />
                  Thử lại
                </button>
                {!prefs.useImageProxy && (
                  <button
                    type="button"
                    onClick={() =>
                      setPrefs((p) => ({ ...p, useImageProxy: true }))
                    }
                    className="ms-btn-2d ms-btn-2d-dark px-4 py-2 text-xs font-bold"
                  >
                    Bật Image Proxy
                  </button>
                )}
                <Link
                  to={detailUrl}
                  className="ms-btn-2d ms-btn-2d-dark inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Quay lại truyện
                </Link>
              </div>
            </div>
          </div>
        ) : data?.is_text_content ? (
          /* Text Chapter Reader */
          <article className={`mx-auto px-4 py-6 sm:px-8 ${containerFitClass}`}>
            <div
              className={`rounded-2xl border p-6 shadow-lg sm:p-10 ${themeConfig.surfaceClass} ${themeConfig.borderClass}`}
            >
              <header className="mb-8 border-b border-current/15 pb-5 text-center">
                <p className="text-xs font-bold uppercase tracking-widest text-cyan-500">
                  {mangaTitle}
                </p>
                <h1 className="mt-2 font-serif text-2xl font-extrabold sm:text-3xl">
                  {chapterLabel}
                </h1>
              </header>

              {textParagraphs.length > 0 ? (
                <div
                  className="space-y-5 font-serif leading-relaxed tracking-normal"
                  style={{ fontSize: `${prefs.fontSize}px` }}
                >
                  {textParagraphs.map((para, index) => (
                    <p key={index} className="whitespace-pre-line">
                      {para}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="py-10 text-center text-sm opacity-70">
                  Chương này chưa có nội dung văn bản.
                </p>
              )}
            </div>
          </article>
        ) : resolvedPages.length === 0 ? (
          /* Empty images fallback */
          <div className="mx-auto my-12 max-w-lg px-4 text-center">
            <div className="rounded-2xl border border-white/10 bg-[#121622] p-8 text-slate-200">
              <BookOpen className="mx-auto mb-3 h-10 w-10 text-cyan-400" />
              <h2 className="text-base font-bold text-white">
                Chưa tìm thấy trang ảnh cho chương này
              </h2>
              <p className="mt-2 text-xs text-slate-400">
                Nguồn ảnh bên ngoài có thể đang bận hoặc bị chặn kết nối trực tiếp.
              </p>
              <div className="mt-5 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setReloadNonce((n) => n + 1)}
                  className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold"
                >
                  <RefreshCw className="h-4 w-4" />
                  Tải lại chương
                </button>
              </div>
            </div>
          </div>
        ) : isPagedMode ? (
          /* Paged Mode (RTL or LTR) */
          <div className={`mx-auto px-2 sm:px-4 ${containerFitClass}`}>
            <div className="relative flex min-h-[72vh] items-center justify-center select-none">
              {(() => {
                const idx = Math.max(0, Math.min(resolvedPages.length - 1, currentPage - 1));
                const pageUrl = appendCacheBust(resolvedPages[idx], retryCounts[idx] || 0);
                const isBroken = failedPages[idx];

                return isBroken ? (
                  <div className="my-12 rounded-2xl border border-white/15 bg-[#121622] p-8 text-center text-slate-200">
                    <p className="text-sm font-bold">
                      Không tải được trang {idx + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleRetryImage(idx)}
                      className="ms-btn-2d ms-btn-2d-cyan mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Tải lại trang
                    </button>
                  </div>
                ) : (
                  <div className="relative flex w-full justify-center">
                    <img
                      key={`${chapterId}-${idx}-${retryCounts[idx] || 0}`}
                      src={pageUrl}
                      alt={`Trang ${idx + 1}`}
                      className={`${imageFitClass} rounded-sm shadow-2xl`}
                      onError={() =>
                        setFailedPages((prev) => ({ ...prev, [idx]: true }))
                      }
                    />
                    {/* Tap Zones: Left 35% / Center 30% (HUD) / Right 35% */}
                    <button
                      type="button"
                      aria-label={prefs.mode === "rtl" ? "Trang sau" : "Trang trước"}
                      onClick={prefs.mode === "rtl" ? goToNextPage : goToPrevPage}
                      className="absolute inset-y-0 left-0 w-[35%] cursor-w-resize bg-transparent focus:outline-none"
                    />
                    <button
                      type="button"
                      aria-label="Ẩn hoặc hiện thanh điều khiển"
                      onClick={() => setHudVisible((v) => !v)}
                      className="absolute inset-y-0 left-[35%] w-[30%] cursor-pointer bg-transparent focus:outline-none"
                    />
                    <button
                      type="button"
                      aria-label={prefs.mode === "rtl" ? "Trang trước" : "Trang sau"}
                      onClick={prefs.mode === "rtl" ? goToPrevPage : goToNextPage}
                      className="absolute inset-y-0 right-0 w-[35%] cursor-e-resize bg-transparent focus:outline-none"
                    />
                  </div>
                );
              })()}
            </div>

            {/* Paged Mode Quick Navigation Bar */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={prefs.mode === "rtl" ? goToNextPage : goToPrevPage}
                className="inline-flex items-center gap-1.5 rounded-xl border border-current/15 bg-black/25 px-3.5 py-2 text-xs font-bold transition hover:border-cyan-400"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>{prefs.mode === "rtl" ? "Trang sau" : "Trang trước"}</span>
              </button>

              <div className="flex items-center gap-2 rounded-xl border border-current/15 bg-black/20 px-3 py-1.5 text-xs font-bold">
                <span>Trang</span>
                <select
                  aria-label="Chuyển tới trang"
                  value={currentPage}
                  onChange={(e) => {
                    setCurrentPage(Number(e.target.value));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className={`rounded-md bg-transparent font-extrabold outline-none ${
                    isLightTheme ? "text-slate-900" : "text-cyan-300"
                  }`}
                >
                  {resolvedPages.map((_, i) => (
                    <option
                      key={i}
                      value={i + 1}
                      className="bg-[#121622] text-slate-100"
                    >
                      {i + 1}
                    </option>
                  ))}
                </select>
                <span className="opacity-70">/ {totalPages}</span>
              </div>

              <button
                type="button"
                onClick={prefs.mode === "rtl" ? goToPrevPage : goToNextPage}
                className="inline-flex items-center gap-1.5 rounded-xl border border-current/15 bg-black/25 px-3.5 py-2 text-xs font-bold transition hover:border-cyan-400"
              >
                <span>{prefs.mode === "rtl" ? "Trang trước" : "Trang sau"}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          /* Vertical Scroll Modes: webtoon (seamless) | vertical (spaced + page number) */
          <div
            className={`mx-auto px-0 sm:px-4 ${containerFitClass} ${
              prefs.mode === "vertical" ? "space-y-5" : "space-y-0"
            }`}
          >
            {resolvedPages.map((rawUrl, idx) => {
              const srcUrl = appendCacheBust(rawUrl, retryCounts[idx] || 0);
              const isBroken = failedPages[idx];

              return (
                <div
                  key={`${chapterId}-${idx}`}
                  ref={(el) => {
                    pageRefs.current[idx] = el;
                  }}
                  className="relative flex flex-col items-center"
                >
                  {isBroken ? (
                    <div className="my-4 w-full rounded-xl border border-rose-500/30 bg-[#121622] p-6 text-center text-slate-200">
                      <p className="text-xs font-bold text-rose-300">
                        Trang {idx + 1} gặp lỗi kết nối ảnh
                      </p>
                      <button
                        type="button"
                        onClick={() => handleRetryImage(idx)}
                        className="ms-btn-2d ms-btn-2d-cyan mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Thử tải lại trang {idx + 1}
                      </button>
                    </div>
                  ) : (
                    <img
                      key={`${chapterId}-${idx}-${retryCounts[idx] || 0}`}
                      src={srcUrl}
                      alt={`Trang ${idx + 1}`}
                      loading={idx < 3 ? "eager" : "lazy"}
                      decoding="async"
                      onClick={() => setHudVisible((v) => !v)}
                      onError={() =>
                        setFailedPages((prev) => ({ ...prev, [idx]: true }))
                      }
                      className={`${imageFitClass} cursor-pointer ${
                        prefs.mode === "vertical" ? "rounded-lg shadow-xl" : ""
                      }`}
                    />
                  )}

                  {prefs.mode === "vertical" && (
                    <span className="mt-1.5 rounded-full border border-current/15 bg-black/25 px-3 py-0.5 text-[11px] font-bold opacity-75">
                      Trang {idx + 1} / {resolvedPages.length}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom Prev / Next Chapter Navigation Bar */}
        {!loading && !loadError && (
          <section className={`mx-auto mt-10 px-4 ${containerFitClass}`}>
            <div className="rounded-2xl border border-white/10 bg-[#111522] p-4 text-slate-100 shadow-xl sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={!prevChapterId}
                  onClick={() => navigateToChapter(prevChapterId)}
                  className="ms-btn-2d ms-btn-2d-dark inline-flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Chương trước</span>
                </button>

                <div className="flex items-center gap-2">
                  <Link
                    to={detailUrl}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-bold text-slate-200 transition hover:border-cyan-400/50 hover:text-cyan-300"
                  >
                    <BookOpen className="h-4 w-4" />
                    <span>Mục lục truyện</span>
                  </Link>

                  <button
                    type="button"
                    onClick={() => setCommentsOpen((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition ${
                      commentsOpen
                        ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                        : "border-white/10 bg-white/5 text-slate-200 hover:border-cyan-400/40"
                    }`}
                  >
                    <MessageCircle className="h-4 w-4" />
                    <span>Bình luận ({totalCommentCount})</span>
                  </button>
                </div>

                <button
                  type="button"
                  disabled={!nextChapterId}
                  onClick={() => navigateToChapter(nextChapterId)}
                  className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span>Chương sau</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              {/* Collapsible Comments Drawer */}
              {commentsOpen && (
                <div
                  id="reader-comments"
                  className="mt-5 border-t border-white/10 pt-5"
                >
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-white">
                    <MessageCircle className="h-4 w-4 text-cyan-400" />
                    <span>Thảo luận truyện ({totalCommentCount})</span>
                  </h2>

                  {user ? (
                    <form onSubmit={handlePostComment} className="mb-5 space-y-2.5">
                      <textarea
                        rows={3}
                        maxLength={2000}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder={`Bình luận về ${chapterLabel || "chương này"}...`}
                        className="w-full rounded-xl border border-white/15 bg-[#0B0D14] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                      />
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={submittingComment || !commentText.trim()}
                          className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold disabled:opacity-50"
                        >
                          <Send className="h-3.5 w-3.5" />
                          <span>
                            {submittingComment ? "Đang gửi..." : "Gửi bình luận"}
                          </span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/20 bg-cyan-950/20 px-4 py-3 text-xs text-slate-300">
                      <span className="inline-flex items-center gap-2">
                        <Lock className="h-4 w-4 text-cyan-400" />
                        Đăng nhập để viết bình luận và tự động lưu tiến độ đọc.
                      </span>
                      <Link
                        to="/auth"
                        className="ms-btn-2d ms-btn-2d-cyan inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold"
                      >
                        <LogIn className="h-3.5 w-3.5" />
                        Đăng nhập
                      </Link>
                    </div>
                  )}

                  {comments.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-400">
                      Chưa có bình luận nào. Hãy chia sẻ cảm nghĩ của bạn về chương này!
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {comments.map((comment) => {
                        const replies = comment.replies ?? [];
                        const isReplying = replyTargetId === comment.id;

                        return (
                          <div
                            key={comment.id}
                            className="rounded-xl border border-white/10 bg-[#0B0D14]/90 p-3.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-extrabold text-white">
                                  {getCommentAuthor(comment)}
                                </span>
                                {comment.is_staff && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                                    <ShieldCheck className="h-3 w-3" />
                                    Admin
                                  </span>
                                )}
                                {comment.chapter_label && (
                                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-cyan-300">
                                    {comment.chapter_label}
                                  </span>
                                )}
                                <span className="text-[11px] text-slate-500">
                                  {formatDateTime(comment.created_at)}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {user && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReplyTargetId(isReplying ? null : comment.id);
                                      setReplyText("");
                                    }}
                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-400 hover:bg-white/5 hover:text-cyan-300"
                                  >
                                    <Reply className="h-3 w-3" />
                                    Trả lời
                                  </button>
                                )}
                                {comment.can_delete && (
                                  <button
                                    type="button"
                                    onClick={() => setDeleteTargetId(comment.id)}
                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-rose-400 hover:bg-rose-500/10"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    Xóa
                                  </button>
                                )}
                              </div>
                            </div>

                            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-200">
                              {comment.content}
                            </p>

                            {isReplying && (
                              <div className="mt-3 flex gap-2 border-l-2 border-cyan-500/40 pl-3">
                                <input
                                  type="text"
                                  maxLength={2000}
                                  value={replyText}
                                  onChange={(e) => setReplyText(e.target.value)}
                                  placeholder="Viết phản hồi..."
                                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[#121622] px-3 py-1.5 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                                />
                                <button
                                  type="button"
                                  disabled={submittingReply || !replyText.trim()}
                                  onClick={() => handlePostReply(comment.id)}
                                  className="ms-btn-2d ms-btn-2d-cyan px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                                >
                                  Gửi
                                </button>
                              </div>
                            )}

                            {replies.length > 0 && (
                              <div className="mt-3 space-y-2 border-l-2 border-white/10 pl-3">
                                {replies.map((reply) => (
                                  <div
                                    key={reply.id}
                                    className="rounded-lg bg-white/5 p-2.5"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-xs font-bold text-slate-100">
                                          {getCommentAuthor(reply)}
                                        </span>
                                        {reply.is_staff && (
                                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                                            Admin
                                          </span>
                                        )}
                                        <span className="text-[10px] text-slate-500">
                                          {formatDateTime(reply.created_at)}
                                        </span>
                                      </div>
                                      {reply.can_delete && (
                                        <button
                                          type="button"
                                          onClick={() => setDeleteTargetId(reply.id)}
                                          className="text-[11px] font-semibold text-rose-400 hover:underline"
                                        >
                                          Xóa
                                        </button>
                                      )}
                                    </div>
                                    <p className="mt-1 whitespace-pre-wrap text-xs text-slate-300">
                                      {reply.content}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      <ConfirmDialog
        open={deleteTargetId !== null}
        title="Xóa bình luận?"
        message="Bạn có chắc chắn muốn xóa bình luận này không?"
        confirmLabel="Xóa"
        danger
        busy={deletingComment}
        onConfirm={handleConfirmDeleteComment}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
}

export default ReaderReadPage;
