import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { ApiError, DEFAULT_COVER_URL, api } from "../lib/api";
import {
  formatChapterNumber,
  formatInteger,
  getStatusMeta,
  resolveCoverUrl,
  stripChapterPrefix,
} from "../lib/format";
import { use3DTilt } from "../hooks/use3DTilt";
import type {
  ChapterOut,
  ChapterSummaryOut,
  MangaDetailOut,
  MangaOut,
} from "../types/manga";
import { ConfirmDialog } from "./ConfirmDialog";

type ReaderSurface = "dark" | "sepia" | "light";

const SURFACE_STYLES: Record<
  ReaderSurface,
  {
    label: string;
    container: string;
    muted: string;
    divider: string;
    button: string;
  }
> = {
  dark: {
    label: "Tối",
    container: "bg-[#0D0F17] text-[#E2E8F0]",
    muted: "text-[#94A3B8]",
    divider: "border-[#232838]",
    button: "border-[#232838] bg-[#161A26] text-[#E2E8F0] hover:border-[#333B54]",
  },
  sepia: {
    label: "Giấy dịu",
    container: "bg-[#F3EDE0] text-[#2B251D]",
    muted: "text-[#6E6251]",
    divider: "border-[#DFD5C0]",
    button: "border-[#D4C8B0] bg-[#EAE1CF] text-[#2B251D] hover:border-[#B9AA8F]",
  },
  light: {
    label: "Sáng",
    container: "bg-[#FAFAF9] text-[#18181B]",
    muted: "text-[#52525B]",
    divider: "border-[#E4E4E7]",
    button: "border-[#D4D4D8] bg-white text-[#18181B] hover:border-[#A1A1AA]",
  },
};

interface MangaDetailReaderModalProps {
  manga: MangaOut | null;
  token: string | null;
  isAuthenticated: boolean;
  onClose: () => void;
  onDataChanged: () => void;
  onMangaSynced: (updated: MangaOut) => void;
  onUnauthorized: () => void;
}

export function MangaDetailReaderModal({
  manga,
  token,
  isAuthenticated,
  onClose,
  onDataChanged,
  onMangaSynced,
  onUnauthorized,
}: MangaDetailReaderModalProps) {
  const { ref: bookRef, onPointerEnter, onPointerMove, onPointerLeave } =
    use3DTilt<HTMLDivElement>({
      maxTilt: 10,
      liftZ: 12,
      restRx: 2,
      restRy: -8,
    });

  const readerScrollRef = useRef<HTMLDivElement | null>(null);

  const [detail, setDetail] = useState<MangaDetailOut | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [failedCoverSrc, setFailedCoverSrc] = useState<string | null>(null);

  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);
  const [chapter, setChapter] = useState<ChapterOut | null>(null);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [chapterError, setChapterError] = useState<string | null>(null);

  const [fontSize, setFontSize] = useState<number>(18);
  const [surface, setSurface] = useState<ReaderSurface>("dark");

  const [showAddChapter, setShowAddChapter] = useState(false);
  const [newChapterNumber, setNewChapterNumber] = useState("1");
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [newChapterContent, setNewChapterContent] = useState("");
  const [addingChapter, setAddingChapter] = useState(false);
  const [addChapterError, setAddChapterError] = useState<string | null>(null);

  const [chapterToDelete, setChapterToDelete] = useState<ChapterSummaryOut | null>(null);
  const [deletingChapter, setDeletingChapter] = useState(false);
  const [deleteChapterError, setDeleteChapterError] = useState<string | null>(null);

  const mangaId = manga?.id ?? null;

  const loadDetail = useCallback(
    async (targetMangaId: number, signal?: AbortSignal) => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const result = await api.getMangaDetail(targetMangaId, signal);
        setDetail(result);
        onMangaSynced(result);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setDetailError(
          err instanceof ApiError
            ? err.message
            : "Không thể tải thông tin chi tiết truyện."
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [onMangaSynced]
  );

  const loadChapter = useCallback(
    async (targetChapterId: number, signal?: AbortSignal) => {
      setChapterLoading(true);
      setChapterError(null);
      try {
        const result = await api.getChapter(targetChapterId, signal);
        setChapter(result);
        readerScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setChapterError(
          err instanceof ApiError ? err.message : "Không thể tải nội dung chương."
        );
      } finally {
        setChapterLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (mangaId === null) {
      setDetail(null);
      setActiveChapterId(null);
      setChapter(null);
      setShowAddChapter(false);
      setChapterToDelete(null);
      setAddChapterError(null);
      setDeleteChapterError(null);
      return;
    }

    setActiveChapterId(null);
    setChapter(null);
    setShowAddChapter(false);
    setAddChapterError(null);
    setDeleteChapterError(null);
    setFailedCoverSrc(null);

    const controller = new AbortController();
    void loadDetail(mangaId, controller.signal);
    return () => controller.abort();
  }, [mangaId, loadDetail]);

  useEffect(() => {
    if (activeChapterId === null) {
      setChapter(null);
      setChapterError(null);
      return;
    }

    const controller = new AbortController();
    void loadChapter(activeChapterId, controller.signal);
    return () => controller.abort();
  }, [activeChapterId, loadChapter]);

  const sortedChapters = useMemo(() => {
    const list = detail?.chapters ?? [];
    return [...list].sort((a, b) => a.chapter_number - b.chapter_number);
  }, [detail?.chapters]);

  useEffect(() => {
    if (!showAddChapter) return;
    if (sortedChapters.length === 0) {
      setNewChapterNumber("1");
      return;
    }
    const maxNum = sortedChapters[sortedChapters.length - 1]?.chapter_number ?? 0;
    const nextNum = Number.isInteger(maxNum) ? maxNum + 1 : Math.floor(maxNum) + 1;
    setNewChapterNumber(String(nextNum));
  }, [showAddChapter, sortedChapters]);

  useEffect(() => {
    if (mangaId === null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (chapterToDelete) return;

      const targetTag = (event.target as HTMLElement | null)?.tagName;
      const isTyping = targetTag === "INPUT" || targetTag === "TEXTAREA";

      if (event.key === "Escape") {
        if (activeChapterId !== null) {
          setActiveChapterId(null);
        } else {
          onClose();
        }
        return;
      }

      if (activeChapterId !== null && chapter && !isTyping) {
        if (event.key === "ArrowLeft" && chapter.prev_chapter_id !== null) {
          setActiveChapterId(chapter.prev_chapter_id);
        } else if (event.key === "ArrowRight" && chapter.next_chapter_id !== null) {
          setActiveChapterId(chapter.next_chapter_id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mangaId, activeChapterId, chapter, chapterToDelete, onClose]);

  if (!manga) return null;

  const displayManga = detail ?? manga;
  const resolvedCover = resolveCoverUrl(displayManga.cover_url);
  const coverSrc =
    failedCoverSrc === resolvedCover ? DEFAULT_COVER_URL : resolvedCover;
  const statusMeta = getStatusMeta(displayManga.status);
  const firstChapter = sortedChapters[0] ?? null;
  const latestChapter =
    sortedChapters.length > 0 ? sortedChapters[sortedChapters.length - 1] : null;
  const activeSurface = SURFACE_STYLES[surface];

  const handleAddChapter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAddChapterError(null);

    if (!token || mangaId === null) {
      setAddChapterError("Vui lòng đăng nhập để thêm chương mới.");
      return;
    }

    const parsedNum = Number.parseFloat(newChapterNumber);
    if (!Number.isFinite(parsedNum) || parsedNum <= 0) {
      setAddChapterError("Số chương phải lớn hơn 0.");
      return;
    }
    if (!newChapterTitle.trim() || !newChapterContent.trim()) {
      setAddChapterError("Vui lòng nhập đầy đủ Tên chương và Nội dung chương.");
      return;
    }

    setAddingChapter(true);
    try {
      await api.createChapter(
        mangaId,
        {
          chapter_number: parsedNum,
          title: newChapterTitle.trim(),
          content: newChapterContent.trim(),
        },
        token
      );
      setNewChapterTitle("");
      setNewChapterContent("");
      setShowAddChapter(false);
      await loadDetail(mangaId);
      onDataChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
      }
      setAddChapterError(
        err instanceof ApiError ? err.message : "Không thể thêm chương mới."
      );
    } finally {
      setAddingChapter(false);
    }
  };

  const handleConfirmDeleteChapter = async () => {
    if (!chapterToDelete || !token || mangaId === null) return;
    setDeletingChapter(true);
    setDeleteChapterError(null);
    try {
      await api.deleteChapter(chapterToDelete.id, token);
      setChapterToDelete(null);
      await loadDetail(mangaId);
      onDataChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
      }
      setDeleteChapterError(
        err instanceof ApiError ? err.message : "Không thể xóa chương này."
      );
      setChapterToDelete(null);
    } finally {
      setDeletingChapter(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-reader-title"
        onClick={onClose}
      >
        <div
          className="flex h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#232838] bg-[#131620] shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          {activeChapterId === null ? (
            <>
              <div className="flex items-center justify-between border-b border-[#232838] px-5 py-3.5 sm:px-6">
                <div className="flex min-w-0 items-center gap-2.5">
                  <BookOpen className="h-4 w-4 shrink-0 text-[#E63946]" />
                  <h2
                    id="detail-reader-title"
                    className="truncate text-base font-bold text-[#F5F6FA]"
                  >
                    {displayManga.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Đóng cửa sổ"
                  className="rounded-lg p-1.5 text-[#94A3B8] transition-colors hover:bg-[#1E2436] hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 sm:p-6">
                {detailError ? (
                  <div
                    role="alert"
                    className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E63946]/45 bg-[#E63946]/12 px-4 py-3 text-sm text-[#FF9BA3]"
                  >
                    <div className="flex items-center gap-2.5">
                      <AlertCircle className="h-4 w-4 shrink-0 text-[#E63946]" />
                      <span>{detailError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadDetail(manga.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#E63946]/40 bg-[#E63946]/20 px-3 py-1 text-xs font-semibold text-white hover:bg-[#E63946]/35"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Thử lại</span>
                    </button>
                  </div>
                ) : null}

                <div className="grid gap-7 md:grid-cols-[220px_1fr]">
                  <div className="ms-book-stage mx-auto w-48 py-2 md:mx-0 md:w-full">
                    <div
                      ref={bookRef}
                      onPointerEnter={onPointerEnter}
                      onPointerMove={onPointerMove}
                      onPointerLeave={onPointerLeave}
                      className="ms-book-3d aspect-[3/4] w-full overflow-hidden rounded-xl border border-white/10 bg-[#0A0B10]"
                    >
                      <img
                        src={coverSrc}
                        alt={displayManga.title}
                        onError={() => {
                          if (coverSrc !== DEFAULT_COVER_URL) {
                            setFailedCoverSrc(resolvedCover);
                          }
                        }}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-lg border px-2.5 py-0.5 text-xs font-semibold ${statusMeta.badgeClass}`}
                        >
                          {statusMeta.label}
                        </span>
                        <span className="rounded-lg border border-[#232838] bg-[#191D2A] px-2.5 py-0.5 text-xs font-medium text-[#CBD5E1]">
                          {displayManga.genre}
                        </span>
                      </div>

                      <h3 className="mt-3 text-2xl font-extrabold leading-tight text-[#F5F6FA]">
                        {displayManga.title}
                      </h3>
                      <p className="mt-1 text-sm font-medium text-[#94A3B8]">
                        Tác giả:{" "}
                        <span className="text-[#E2E8F0]">{displayManga.author}</span>
                      </p>

                      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[#F5F6FA]">
                          <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                          <span>{displayManga.rating.toFixed(1)}</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[#CBD5E1]">
                          <Eye className="h-4 w-4 text-[#06B6D4]" />
                          <span>{formatInteger(displayManga.views)} lượt đọc</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[#CBD5E1]">
                          <BookOpen className="h-4 w-4 text-[#E63946]" />
                          <span>
                            {detail
                              ? `${detail.chapters.length} chương`
                              : `${displayManga.chapter_count} chương`}
                          </span>
                        </span>
                      </div>

                      <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-[#CBD5E1]">
                        {displayManga.description || "Chưa có mô tả cho đầu truyện này."}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        type="button"
                        disabled={!firstChapter}
                        onClick={() => {
                          if (firstChapter) setActiveChapterId(firstChapter.id);
                        }}
                        className="ms-btn-3d inline-flex items-center gap-2 rounded-xl bg-[#E63946] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#EE4653] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <BookOpen className="h-4 w-4" />
                        <span>
                          {firstChapter ? "Đọc từ đầu" : "Chưa có chương"}
                        </span>
                      </button>

                      {latestChapter && firstChapter && latestChapter.id !== firstChapter.id ? (
                        <button
                          type="button"
                          onClick={() => setActiveChapterId(latestChapter.id)}
                          className="ms-btn-3d-subtle inline-flex items-center gap-2 rounded-xl border border-[#232838] bg-[#191D2A] px-4 py-2.5 text-sm font-semibold text-[#E2E8F0] hover:border-[#06B6D4]/50 hover:text-white"
                        >
                          <span>
                            Đọc chương {formatChapterNumber(latestChapter.chapter_number)}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-8 border-t border-[#232838] pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-base font-bold text-[#F5F6FA]">
                      Danh sách chương ({sortedChapters.length})
                    </h4>

                    {isAuthenticated ? (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddChapter((prev) => !prev);
                          setAddChapterError(null);
                        }}
                        className="ms-btn-3d-subtle inline-flex items-center gap-1.5 rounded-xl border border-[#06B6D4]/40 bg-[#06B6D4]/12 px-3.5 py-1.5 text-xs font-semibold text-[#67E8F9] hover:bg-[#06B6D4]/20"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>{showAddChapter ? "Đóng biểu mẫu" : "Thêm chương mới"}</span>
                      </button>
                    ) : null}
                  </div>

                  {deleteChapterError ? (
                    <div
                      role="alert"
                      className="mt-3 flex items-center gap-2 rounded-xl border border-[#E63946]/45 bg-[#E63946]/12 px-3.5 py-2.5 text-sm text-[#FF9BA3]"
                    >
                      <AlertCircle className="h-4 w-4 shrink-0 text-[#E63946]" />
                      <span>{deleteChapterError}</span>
                    </div>
                  ) : null}

                  {showAddChapter && isAuthenticated ? (
                    <form
                      onSubmit={handleAddChapter}
                      className="mt-4 space-y-3 rounded-xl border border-[#232838] bg-[#0A0B10] p-4"
                    >
                      {addChapterError ? (
                        <div
                          role="alert"
                          className="flex items-start gap-2 rounded-lg border border-[#E63946]/45 bg-[#E63946]/12 px-3 py-2 text-xs text-[#FF9BA3]"
                        >
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#E63946]" />
                          <span>{addChapterError}</span>
                        </div>
                      ) : null}

                      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                        <div>
                          <label
                            htmlFor="new-chapter-number"
                            className="mb-1 block text-xs font-semibold text-[#CBD5E1]"
                          >
                            Số chương
                          </label>
                          <input
                            id="new-chapter-number"
                            type="number"
                            step="0.1"
                            min="0.1"
                            required
                            value={newChapterNumber}
                            onChange={(event) => setNewChapterNumber(event.target.value)}
                            className="w-full rounded-lg border border-[#232838] bg-[#131620] px-3 py-2 text-sm text-[#F5F6FA] focus:border-[#06B6D4] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="new-chapter-title"
                            className="mb-1 block text-xs font-semibold text-[#CBD5E1]"
                          >
                            Tên chương
                          </label>
                          <input
                            id="new-chapter-title"
                            type="text"
                            required
                            value={newChapterTitle}
                            onChange={(event) => setNewChapterTitle(event.target.value)}
                            placeholder="Ví dụ: Bình minh của chuyến hải trình"
                            className="w-full rounded-lg border border-[#232838] bg-[#131620] px-3 py-2 text-sm text-[#F5F6FA] placeholder-[#64748B] focus:border-[#06B6D4] focus:outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="new-chapter-content"
                          className="mb-1 block text-xs font-semibold text-[#CBD5E1]"
                        >
                          Nội dung chương
                        </label>
                        <textarea
                          id="new-chapter-content"
                          rows={5}
                          required
                          value={newChapterContent}
                          onChange={(event) => setNewChapterContent(event.target.value)}
                          placeholder="Nhập nội dung chương truyện..."
                          className="w-full resize-y rounded-lg border border-[#232838] bg-[#131620] px-3 py-2 text-sm leading-relaxed text-[#F5F6FA] placeholder-[#64748B] focus:border-[#06B6D4] focus:outline-none"
                        />
                      </div>

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowAddChapter(false)}
                          disabled={addingChapter}
                          className="rounded-lg border border-[#232838] px-3.5 py-1.5 text-xs font-medium text-[#CBD5E1] hover:text-white"
                        >
                          Hủy
                        </button>
                        <button
                          type="submit"
                          disabled={addingChapter}
                          className="ms-btn-3d inline-flex items-center gap-1.5 rounded-lg bg-[#E63946] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#EE4653] disabled:opacity-60"
                        >
                          {addingChapter ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                          <span>{addingChapter ? "Đang lưu..." : "Đăng chương"}</span>
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {detailLoading && !detail ? (
                    <div className="mt-4 space-y-2.5">
                      {[1, 2, 3].map((item) => (
                        <div
                          key={item}
                          className="h-12 animate-pulse rounded-xl border border-[#232838] bg-[#0A0B10]"
                        />
                      ))}
                    </div>
                  ) : sortedChapters.length === 0 ? (
                    <div className="mt-4 rounded-xl border border-dashed border-[#232838] bg-[#0A0B10]/60 px-4 py-8 text-center text-sm text-[#94A3B8]">
                      Chưa có chương nào được đăng cho truyện này.
                    </div>
                  ) : (
                    <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                      {sortedChapters.map((item) => (
                        <li
                          key={item.id}
                          className="group flex items-center justify-between gap-2 rounded-xl border border-[#232838] bg-[#0A0B10]/85 transition-colors hover:border-[#06B6D4]/50 hover:bg-[#181C28]"
                        >
                          <button
                            type="button"
                            onClick={() => setActiveChapterId(item.id)}
                            className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#06B6D4] rounded-xl"
                          >
                            <span className="truncate text-sm font-medium text-[#E2E8F0] group-hover:text-white">
                              <strong className="font-semibold text-[#F5F6FA]">
                                Chương {formatChapterNumber(item.chapter_number)}
                              </strong>
                              {" — "}
                              {stripChapterPrefix(item.title)}
                            </span>
                            <span className="shrink-0 text-xs text-[#64748B]">
                              {new Date(item.created_at).toLocaleDateString("vi-VN")}
                            </span>
                          </button>

                          {isAuthenticated ? (
                            <button
                              type="button"
                              onClick={() => setChapterToDelete(item)}
                              aria-label={`Xóa chương ${formatChapterNumber(item.chapter_number)}`}
                              title="Xóa chương"
                              className="mr-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#64748B] transition-colors hover:bg-[#E63946]/20 hover:text-[#FF8A93]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className={`flex h-full flex-col ${activeSurface.container}`}>
              <div
                className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 ${activeSurface.divider}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveChapterId(null)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${activeSurface.button}`}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Chi tiết</span>
                  </button>
                  <div className="min-w-0">
                    <h2
                      id="detail-reader-title"
                      className="truncate text-sm font-bold sm:text-base"
                    >
                      {chapter
                        ? `${chapter.manga_title} — Chương ${formatChapterNumber(chapter.chapter_number)}`
                        : displayManga.title}
                    </h2>
                    {chapter ? (
                      <p className={`truncate text-xs ${activeSurface.muted}`}>
                        {stripChapterPrefix(chapter.title)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className={`inline-flex items-center rounded-xl border p-0.5 ${activeSurface.divider}`}
                    role="group"
                    aria-label="Cỡ chữ đọc truyện"
                  >
                    <button
                      type="button"
                      onClick={() => setFontSize((size) => Math.max(14, size - 2))}
                      disabled={fontSize <= 14}
                      aria-label="Giảm cỡ chữ"
                      className="rounded-lg p-1.5 transition-opacity hover:opacity-80 disabled:opacity-40"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="px-2 text-xs font-semibold tabular-nums">
                      {fontSize}px
                    </span>
                    <button
                      type="button"
                      onClick={() => setFontSize((size) => Math.min(26, size + 2))}
                      disabled={fontSize >= 26}
                      aria-label="Tăng cỡ chữ"
                      className="rounded-lg p-1.5 transition-opacity hover:opacity-80 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div
                    className={`inline-flex items-center rounded-xl border p-0.5 ${activeSurface.divider}`}
                    role="group"
                    aria-label="Nền đọc truyện"
                  >
                    {(Object.keys(SURFACE_STYLES) as ReaderSurface[]).map((key) => {
                      const active = surface === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setSurface(key)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                            active
                              ? "bg-[#E63946] text-white"
                              : `${activeSurface.muted} hover:opacity-80`
                          }`}
                        >
                          {SURFACE_STYLES[key].label}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Đóng trình đọc"
                    className={`rounded-lg p-1.5 transition-opacity hover:opacity-80 ${activeSurface.muted}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div ref={readerScrollRef} className="flex-1 overflow-y-auto px-4 py-8 sm:px-8">
                {chapterLoading ? (
                  <div className="mx-auto flex max-w-3xl flex-col items-center justify-center py-20">
                    <Loader2 className="h-7 w-7 animate-spin text-[#E63946]" />
                    <p className={`mt-3 text-sm ${activeSurface.muted}`}>
                      Đang tải nội dung chương...
                    </p>
                  </div>
                ) : chapterError ? (
                  <div className="mx-auto max-w-xl rounded-2xl border border-[#E63946]/45 bg-[#E63946]/12 p-6 text-center">
                    <AlertCircle className="mx-auto h-7 w-7 text-[#E63946]" />
                    <p className="mt-3 text-sm font-medium text-[#FF9BA3]">
                      {chapterError}
                    </p>
                    <div className="mt-4 flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => setActiveChapterId(null)}
                        className="rounded-xl border border-[#232838] bg-[#191D2A] px-4 py-2 text-xs font-semibold text-white"
                      >
                        Quay lại chi tiết
                      </button>
                      <button
                        type="button"
                        onClick={() => void loadChapter(activeChapterId)}
                        className="ms-btn-3d inline-flex items-center gap-1.5 rounded-xl bg-[#E63946] px-4 py-2 text-xs font-semibold text-white"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Thử lại</span>
                      </button>
                    </div>
                  </div>
                ) : chapter ? (
                  <article className="mx-auto max-w-3xl">
                    <header className={`mb-8 border-b pb-5 ${activeSurface.divider}`}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#E63946]">
                        Chương {formatChapterNumber(chapter.chapter_number)}
                      </p>
                      <h3 className="mt-1.5 text-2xl font-bold leading-snug">
                        {stripChapterPrefix(chapter.title)}
                      </h3>
                    </header>

                    <div
                      className="ms-reader-prose whitespace-pre-line leading-[1.9]"
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      {chapter.content}
                    </div>
                  </article>
                ) : null}
              </div>

              <div
                className={`flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-6 ${activeSurface.divider}`}
              >
                <button
                  type="button"
                  disabled={!chapter || chapter.prev_chapter_id === null || chapterLoading}
                  onClick={() => {
                    if (chapter?.prev_chapter_id !== null && chapter?.prev_chapter_id !== undefined) {
                      setActiveChapterId(chapter.prev_chapter_id);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${activeSurface.button}`}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span>Chương trước</span>
                </button>

                {chapter ? (
                  <span className={`text-xs font-medium ${activeSurface.muted}`}>
                    Chương {formatChapterNumber(chapter.chapter_number)}
                  </span>
                ) : (
                  <span />
                )}

                <button
                  type="button"
                  disabled={!chapter || chapter.next_chapter_id === null || chapterLoading}
                  onClick={() => {
                    if (chapter?.next_chapter_id !== null && chapter?.next_chapter_id !== undefined) {
                      setActiveChapterId(chapter.next_chapter_id);
                    }
                  }}
                  className="ms-btn-3d inline-flex items-center gap-1.5 rounded-xl bg-[#E63946] px-4 py-2 text-sm font-semibold text-white hover:bg-[#EE4653] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span>Chương sau</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={chapterToDelete !== null}
        title="Xóa chương truyện"
        description={
          chapterToDelete
            ? `Bạn có chắc muốn xóa Chương ${formatChapterNumber(chapterToDelete.chapter_number)} — "${chapterToDelete.title}"? Thao tác này không thể hoàn tác.`
            : ""
        }
        confirmLabel="Xóa chương"
        loading={deletingChapter}
        onConfirm={() => void handleConfirmDeleteChapter()}
        onCancel={() => {
          if (!deletingChapter) setChapterToDelete(null);
        }}
      />
    </>
  );
}
