import { BookOpen, Eye, Layers, LogIn, LogOut, Plus, Search, User, X } from "lucide-react";
import type { StatsOut, UserOut } from "../types/manga";
import { formatCompactNumber, formatInteger } from "../lib/format";

interface NavbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  stats: StatsOut | null;
  statsLoading: boolean;
  user: UserOut | null;
  authLoading: boolean;
  onOpenAuth: () => void;
  onOpenCreateManga: () => void;
  onLogout: () => void;
  onResetHome: () => void;
}

export function Navbar({
  search,
  onSearchChange,
  stats,
  statsLoading,
  user,
  authLoading,
  onOpenAuth,
  onOpenCreateManga,
  onLogout,
  onResetHome,
}: NavbarProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-[#232838] bg-[#0A0B10]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={onResetHome}
            className="group flex items-center gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#06B6D4] rounded-xl"
          >
            <img
              src="/brand-logo.svg"
              alt="MangaStore"
              width={38}
              height={38}
              className="h-9.5 w-9.5 rounded-xl transition-transform duration-200 group-hover:scale-105"
            />
            <div>
              <span className="block text-lg font-extrabold tracking-tight text-[#F5F6FA]">
                MangaStore
              </span>
              <span className="block text-[11px] font-medium text-[#94A3B8]">
                Thư viện truyện tranh
              </span>
            </div>
          </button>

          {stats ? (
            <div className="hidden items-center gap-3 rounded-xl border border-[#232838] bg-[#131620]/90 px-3 py-1.5 text-xs text-[#CBD5E1] lg:flex">
              <span className="flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5 text-[#E63946]" />
                <strong className="font-semibold text-[#F5F6FA]">
                  {formatInteger(stats.total_mangas)}
                </strong>
                <span className="text-[#94A3B8]">đầu truyện</span>
              </span>
              <span className="h-3.5 w-px bg-[#232838]" aria-hidden="true" />
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-[#06B6D4]" />
                <strong className="font-semibold text-[#F5F6FA]">
                  {formatInteger(stats.total_chapters)}
                </strong>
                <span className="text-[#94A3B8]">chương</span>
              </span>
              <span className="h-3.5 w-px bg-[#232838]" aria-hidden="true" />
              <span className="flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5 text-amber-400" />
                <strong className="font-semibold text-[#F5F6FA]">
                  {formatCompactNumber(stats.total_views)}
                </strong>
                <span className="text-[#94A3B8]">lượt đọc</span>
              </span>
            </div>
          ) : statsLoading ? (
            <div
              className="hidden h-8 w-64 animate-pulse rounded-xl border border-[#232838] bg-[#131620] lg:block"
              aria-hidden="true"
            />
          ) : null}
        </div>

        <div className="order-3 w-full sm:order-2 sm:max-w-xs md:max-w-sm lg:flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
            <input
              type="text"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Tìm tên truyện, tác giả..."
              aria-label="Tìm kiếm truyện theo tên hoặc tác giả"
              className="w-full rounded-xl border border-[#232838] bg-[#131620] py-2 pl-10 pr-9 text-sm text-[#F5F6FA] placeholder-[#64748B] transition-colors focus:border-[#06B6D4] focus:outline-none"
            />
            {search ? (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label="Xóa từ khóa tìm kiếm"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#94A3B8] transition-colors hover:bg-[#1E2436] hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="order-2 flex items-center gap-2.5 sm:order-3">
          {authLoading ? (
            <div className="h-9 w-28 animate-pulse rounded-xl border border-[#232838] bg-[#131620]" />
          ) : user ? (
            <>
              <button
                type="button"
                onClick={onOpenCreateManga}
                className="ms-btn-3d inline-flex items-center gap-1.5 rounded-xl bg-[#E63946] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#EE4653]"
              >
                <Plus className="h-4 w-4" />
                <span>Thêm truyện</span>
              </button>
              <div className="hidden items-center gap-2 rounded-xl border border-[#232838] bg-[#131620] px-3 py-1.5 text-sm text-[#E2E8F0] md:flex">
                <User className="h-3.5 w-3.5 text-[#06B6D4]" />
                <span className="max-w-[120px] truncate font-medium">{user.username}</span>
              </div>
              <button
                type="button"
                onClick={onLogout}
                title="Đăng xuất"
                aria-label="Đăng xuất"
                className="ms-btn-3d-subtle inline-flex items-center gap-1.5 rounded-xl border border-[#232838] bg-[#131620] px-3 py-2 text-sm font-medium text-[#CBD5E1] hover:border-[#333B54] hover:text-white"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Đăng xuất</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="ms-btn-3d inline-flex items-center gap-1.5 rounded-xl bg-[#E63946] px-4 py-2 text-sm font-semibold text-white hover:bg-[#EE4653]"
            >
              <LogIn className="h-4 w-4" />
              <span>Đăng nhập</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
