import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpDown,
  BookOpen,
  Filter,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { AuthModal } from "./components/AuthModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { MangaCard3D } from "./components/MangaCard3D";
import { MangaDetailReaderModal } from "./components/MangaDetailReaderModal";
import { MangaModal } from "./components/MangaModal";
import { Navbar } from "./components/Navbar";
import {
  ApiError,
  api,
  clearStoredToken,
  getStoredToken,
} from "./lib/api";
import { MANGA_STATUS_OPTIONS } from "./lib/format";
import type {
  AuthResponse,
  MangaOut,
  MangaSortOption,
  StatsOut,
  UserOut,
} from "./types/manga";

const SORT_OPTIONS: ReadonlyArray<{ value: MangaSortOption; label: string }> = [
  { value: "latest", label: "Mới cập nhật" },
  { value: "views", label: "Xem nhiều nhất" },
  { value: "rating", label: "Đánh giá cao" },
  { value: "title", label: "Tên truyện A–Z" },
];

const SKELETON_COUNT = 10;

export function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<UserOut | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(() => getStoredToken() !== null);

  const [stats, setStats] = useState<StatsOut | null>(null);
  const [statsLoading, setStatsLoading] = useState<boolean>(true);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedGenre, setSelectedGenre] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [sortBy, setSortBy] = useState<MangaSortOption>("latest");

  const [mangas, setMangas] = useState<MangaOut[]>([]);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [mangaModalState, setMangaModalState] = useState<{
    open: boolean;
    manga: MangaOut | null;
  }>({ open: false, manga: null });
  const [detailManga, setDetailManga] = useState<MangaOut | null>(null);

  const [mangaToDelete, setMangaToDelete] = useState<MangaOut | null>(null);
  const [deletingManga, setDeletingManga] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 260);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const stored = getStoredToken();
    if (!stored) {
      setAuthLoading(false);
      setUser(null);
      setToken(null);
      return;
    }

    const controller = new AbortController();
    setAuthLoading(true);

    api
      .getMe(stored, controller.signal)
      .then((me) => {
        setUser(me);
        setToken(stored);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof ApiError && err.status === 401) {
          clearStoredToken();
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setAuthLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  const loadStats = useCallback(async (signal?: AbortSignal) => {
    setStatsLoading(true);
    try {
      const data = await api.getStats(signal);
      setStats(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStats(null);
    } finally {
      if (!signal?.aborted) {
        setStatsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStats(controller.signal);
    return () => controller.abort();
  }, [loadStats, refreshTick]);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError(null);

    api
      .getMangaList(
        {
          search: debouncedSearch,
          genre: selectedGenre,
          status: selectedStatus,
          sort: sortBy,
        },
        controller.signal
      )
      .then((list) => {
        setMangas(list);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setMangas([]);
        setCatalogError(
          err instanceof ApiError
            ? err.message
            : "Không thể tải danh sách truyện từ máy chủ."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setCatalogLoading(false);
        }
      });

    return () => controller.abort();
  }, [debouncedSearch, selectedGenre, selectedStatus, sortBy, refreshTick]);

  const syncAfterMutation = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  const handleAuthSuccess = useCallback((auth: AuthResponse) => {
    setToken(auth.access_token);
    setUser(auth.user);
    setActionError(null);
  }, []);

  const handleLogout = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setUser(null);
    setActionError(null);
  }, []);

  const handleUnauthorized = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setUser(null);
    setAuthModalOpen(true);
  }, []);

  const handleMangaSynced = useCallback((updated: MangaOut) => {
    setMangas((prev) =>
      prev.map((item) =>
        item.id === updated.id
          ? {
              ...item,
              title: updated.title,
              author: updated.author,
              genre: updated.genre,
              status: updated.status,
              cover_url: updated.cover_url,
              description: updated.description,
              rating: updated.rating,
              views: updated.views,
              chapter_count: updated.chapter_count,
              updated_at: updated.updated_at,
            }
          : item
      )
    );
  }, []);

  const handleResetFilters = useCallback(() => {
    setSearchInput("");
    setDebouncedSearch("");
    setSelectedGenre("");
    setSelectedStatus("");
    setSortBy("latest");
  }, []);

  const handleConfirmDeleteManga = async () => {
    if (!mangaToDelete) return;
    const activeToken = token ?? getStoredToken();
    if (!activeToken) {
      setMangaToDelete(null);
      setAuthModalOpen(true);
      return;
    }

    setDeletingManga(true);
    setActionError(null);
    try {
      await api.deleteManga(mangaToDelete.id, activeToken);
      if (detailManga?.id === mangaToDelete.id) {
        setDetailManga(null);
      }
      setMangaToDelete(null);
      syncAfterMutation();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredToken();
        setToken(null);
        setUser(null);
        setAuthModalOpen(true);
      }
      setActionError(
        err instanceof ApiError ? err.message : "Không thể xóa truyện này."
      );
      setMangaToDelete(null);
    } finally {
      setDeletingManga(false);
    }
  };

  const hasActiveFilter =
    debouncedSearch !== "" || selectedGenre !== "" || selectedStatus !== "";
  const genres = stats?.genres ?? [];
  const isAuthenticated = Boolean(user && token);

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar
        search={searchInput}
        onSearchChange={setSearchInput}
        stats={stats}
        statsLoading={statsLoading}
        user={user}
        authLoading={authLoading}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenCreateManga={() => setMangaModalState({ open: true, manga: null })}
        onLogout={handleLogout}
        onResetHome={() => {
          handleResetFilters();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <section className="mb-6 rounded-2xl border border-[#232838] bg-[#131620]/80 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedGenre("")}
                className={`rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  selectedGenre === ""
                    ? "border-[#E63946] bg-[#E63946] text-white shadow-[0_4px_14px_rgba(230,57,70,0.3)]"
                    : "border-[#232838] bg-[#0A0B10] text-[#CBD5E1] hover:border-[#333B54] hover:text-white"
                }`}
              >
                Tất cả
              </button>

              {genres.map((genre) => {
                const active = selectedGenre === genre;
                return (
                  <button
                    key={genre}
                    type="button"
                    onClick={() => setSelectedGenre(active ? "" : genre)}
                    className={`rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? "border-[#06B6D4] bg-[#06B6D4]/20 text-[#67E8F9]"
                        : "border-[#232838] bg-[#0A0B10] text-[#CBD5E1] hover:border-[#333B54] hover:text-white"
                    }`}
                  >
                    {genre}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex items-center">
                <Filter className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-[#94A3B8]" />
                <select
                  aria-label="Lọc theo trạng thái"
                  value={selectedStatus}
                  onChange={(event) => setSelectedStatus(event.target.value)}
                  className="rounded-xl border border-[#232838] bg-[#0A0B10] py-2 pl-8 pr-8 text-xs font-semibold text-[#E2E8F0] focus:border-[#06B6D4] focus:outline-none"
                >
                  <option value="">Tất cả trạng thái</option>
                  {MANGA_STATUS_OPTIONS.map((statusOption) => (
                    <option key={statusOption} value={statusOption}>
                      {statusOption}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative flex items-center">
                <ArrowUpDown className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-[#94A3B8]" />
                <select
                  aria-label="Sắp xếp danh sách truyện"
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as MangaSortOption)}
                  className="rounded-xl border border-[#232838] bg-[#0A0B10] py-2 pl-8 pr-8 text-xs font-semibold text-[#E2E8F0] focus:border-[#06B6D4] focus:outline-none"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {hasActiveFilter ? (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#232838] bg-[#191D2A] px-3 py-2 text-xs font-semibold text-[#CBD5E1] transition-colors hover:border-[#333B54] hover:text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Đặt lại</span>
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {actionError ? (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-[#E63946]/45 bg-[#E63946]/12 px-4 py-3 text-sm text-[#FF9BA3]"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-[#E63946]" />
              <span>{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-xs font-semibold text-white/80 underline hover:text-white"
            >
              Đóng
            </button>
          </div>
        ) : null}

        {catalogError ? (
          <div
            role="alert"
            className="flex flex-col items-center justify-center rounded-2xl border border-[#E63946]/40 bg-[#131620] px-6 py-16 text-center"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#E63946]/40 bg-[#E63946]/15 text-[#E63946]">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-bold text-[#F5F6FA]">
              Không thể tải danh mục truyện
            </h2>
            <p className="mt-1.5 max-w-md text-sm text-[#94A3B8]">{catalogError}</p>
            <button
              type="button"
              onClick={syncAfterMutation}
              className="ms-btn-3d mt-5 inline-flex items-center gap-2 rounded-xl bg-[#E63946] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#EE4653]"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Thử lại</span>
            </button>
          </div>
        ) : catalogLoading ? (
          <div
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:gap-5"
            aria-label="Đang tải danh sách truyện"
          >
            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-2xl border border-[#232838] bg-[#131620]"
              >
                <div className="aspect-[3/4] w-full animate-pulse bg-[#1A1F2E]" />
                <div className="space-y-2.5 p-3.5">
                  <div className="h-4 w-4/5 animate-pulse rounded bg-[#1F2536]" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-[#1A1F2E]" />
                  <div className="flex justify-between pt-1">
                    <div className="h-5 w-16 animate-pulse rounded-lg bg-[#1A1F2E]" />
                    <div className="h-4 w-14 animate-pulse rounded bg-[#1A1F2E]" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : mangas.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#232838] bg-[#131620]/60 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#232838] bg-[#191D2A] text-[#06B6D4]">
              <BookOpen className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-bold text-[#F5F6FA]">
              {hasActiveFilter
                ? "Không tìm thấy truyện phù hợp"
                : "Thư viện hiện chưa có đầu truyện nào"}
            </h2>
            <p className="mt-1.5 max-w-md text-sm text-[#94A3B8]">
              {hasActiveFilter
                ? "Hãy thử đổi từ khóa tìm kiếm hoặc xóa bộ lọc thể loại, trạng thái."
                : isAuthenticated
                  ? "Bạn có thể thêm đầu truyện đầu tiên vào thư viện ngay bây giờ."
                  : "Hãy đăng nhập để đóng góp đầu truyện mới vào thư viện."}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              {hasActiveFilter ? (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="ms-btn-3d-subtle inline-flex items-center gap-2 rounded-xl border border-[#232838] bg-[#191D2A] px-4 py-2 text-sm font-semibold text-[#F5F6FA] hover:border-[#333B54]"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>Xóa bộ lọc</span>
                </button>
              ) : isAuthenticated ? (
                <button
                  type="button"
                  onClick={() => setMangaModalState({ open: true, manga: null })}
                  className="ms-btn-3d inline-flex items-center gap-2 rounded-xl bg-[#E63946] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#EE4653]"
                >
                  <Plus className="h-4 w-4" />
                  <span>Thêm truyện mới</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <section aria-label="Danh sách truyện tranh">
            <div className="mb-4 flex items-center justify-between text-xs font-medium text-[#94A3B8]">
              <span>
                Hiển thị <strong className="text-[#F5F6FA]">{mangas.length}</strong> đầu
                truyện
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:gap-5">
              {mangas.map((manga) => (
                <MangaCard3D
                  key={manga.id}
                  manga={manga}
                  isAuthenticated={isAuthenticated}
                  onOpenDetail={(item) => setDetailManga(item)}
                  onEdit={(item) => setMangaModalState({ open: true, manga: item })}
                  onDelete={(item) => setMangaToDelete(item)}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />

      <MangaModal
        open={mangaModalState.open}
        manga={mangaModalState.manga}
        token={token}
        availableGenres={genres}
        onClose={() => setMangaModalState({ open: false, manga: null })}
        onSaved={(saved, isEdit) => {
          if (isEdit && detailManga?.id === saved.id) {
            setDetailManga(saved);
          }
          syncAfterMutation();
        }}
        onUnauthorized={handleUnauthorized}
      />

      <MangaDetailReaderModal
        manga={detailManga}
        token={token}
        isAuthenticated={isAuthenticated}
        onClose={() => setDetailManga(null)}
        onDataChanged={syncAfterMutation}
        onMangaSynced={handleMangaSynced}
        onUnauthorized={handleUnauthorized}
      />

      <ConfirmDialog
        open={mangaToDelete !== null}
        title="Xóa đầu truyện"
        description={
          mangaToDelete
            ? `Bạn có chắc muốn xóa truyện "${mangaToDelete.title}" cùng toàn bộ các chương liên quan? Thao tác này không thể hoàn tác.`
            : ""
        }
        confirmLabel="Xóa truyện"
        loading={deletingManga}
        onConfirm={() => void handleConfirmDeleteManga()}
        onCancel={() => {
          if (!deletingManga) setMangaToDelete(null);
        }}
      />
    </div>
  );
}

export default App;
